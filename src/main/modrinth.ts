import { createHash } from "crypto";
import { existsSync, readFileSync, statSync } from "fs";
import type { OnlineFetchProgress, OnlineModData } from "../shared/types";

const VERSION_FILES_URL = "https://api.modrinth.com/v2/version_files";
const PROJECTS_URL = "https://api.modrinth.com/v2/projects";
const USER_AGENT = "StarTools-Modpack-Manager/0.6.0";
const REQUEST_TIMEOUT_MS = 20000;
const ICON_TIMEOUT_MS = 15000;
const ICON_MAX_BYTES = 1024 * 1024;
const ICON_CONCURRENCY = 8;
const MAX_FILES = 500;

interface VersionFileHit {
  project_id?: string;
}

interface ProjectHit {
  id?: string;
  slug?: string;
  title?: string;
  icon_url?: string | null;
  categories?: string[];
  project_type?: string;
  client_side?: string;
  server_side?: string;
}

function resolveModrinthSide(
  project: ProjectHit | undefined,
): OnlineModData["modrinthSide"] {
  const supported = (value: unknown): boolean | null => {
    if (value === "required" || value === "optional") return true;
    if (value === "unsupported") return false;
    return null;
  };
  const client = supported(project?.client_side);
  const server = supported(project?.server_side);
  if (client === null && server === null) return null;
  if (client === true && server === true) return "Both";
  if (client === true && server !== true) return "Client";
  if (server === true && client !== true) return "Server";
  return null;
}

/** SHA-1 hex digest of a file. Throws when unreadable. */
export function sha1OfFile(filePath: string): string {
  return createHash("sha1").update(readFileSync(filePath)).digest("hex");
}

/** Detect an image MIME from magic bytes. Null when unrecognized. */
export function sniffImageMime(buf: Buffer): string | null {
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 && // RIFF
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50 // WEBP
  ) {
    return "image/webp";
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    buf.length >= 3 &&
    buf[0] === 0xff &&
    buf[1] === 0xd8 &&
    buf[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    buf.length >= 6 &&
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 // GIF
  ) {
    return "image/gif";
  }
  if (
    buf.length >= 4 &&
    buf[0] === 0x00 &&
    buf[1] === 0x00 &&
    buf[2] === 0x01 &&
    buf[3] === 0x00
  ) {
    return "image/x-icon";
  }
  return null;
}

/**
 * Download an icon and convert it to a base64 data URI (bypasses renderer
 * CORS/hotlink restrictions entirely). Returns null on any failure or when
 * the payload is missing/oversize/unrecognized — callers keep the remote URL
 * as a fallback so the frontend `onError` path still applies.
 */
export async function fetchIconDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(ICON_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > ICON_MAX_BYTES) return null;
    const mime = sniffImageMime(buf);
    if (!mime) return null;
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function isReadableJar(filePath: unknown): filePath is string {
  if (typeof filePath !== "string" || filePath.length === 0) return false;
  if (!filePath.toLowerCase().endsWith(".jar")) return false;
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(
      `Modrinth request failed (${res.status} ${res.statusText})`,
    );
  }
  return res.json() as Promise<unknown>;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(
      `Modrinth request failed (${res.status} ${res.statusText})`,
    );
  }
  return res.json() as Promise<unknown>;
}

/**
 * Enrich jars with Modrinth data: SHA-1 each file, look up version files,
 * then hydrate the distinct projects (categories + icon). Offline-capable by
 * default — this only ever runs on explicit user action. Files that fail to
 * hash or have no Modrinth match are skipped (never abort the batch).
 * Returns records keyed by absolute file path.
 */
export async function fetchOnlineData(
  modPaths: string[],
): Promise<Record<string, OnlineModData>> {
  if (!Array.isArray(modPaths) || modPaths.length === 0) return {};
  const paths = [...new Set(modPaths.filter(isReadableJar))].slice(
    0,
    MAX_FILES,
  );
  if (paths.length === 0) return {};

  const pathsByHash = new Map<string, string[]>(); // sha1 -> every filePath with that content
  for (const filePath of paths) {
    try {
      const sha1 = sha1OfFile(filePath);
      const matchingPaths = pathsByHash.get(sha1);
      if (matchingPaths) matchingPaths.push(filePath);
      else pathsByHash.set(sha1, [filePath]);
    } catch (err) {
      console.warn(`[Modrinth] Skipping unhashable file "${filePath}":`, err);
    }
  }
  if (pathsByHash.size === 0) return {};

  return fetchModrinthDataBySha(pathsByHash);
}

/** Fetch Modrinth project metadata from SHA-1 groups already calculated by the unified scanner. */
export async function fetchModrinthDataBySha(
  pathsByHash: Map<string, string[]>,
  onProgress?: (progress: OnlineFetchProgress) => void,
): Promise<Record<string, OnlineModData>> {
  onProgress?.({ stage: "lookup", current: 0, total: 1 });
  try {
    return await fetchModrinthDataByShaInternal(pathsByHash);
  } finally {
    onProgress?.({ stage: "lookup", current: 1, total: 1 });
  }
}

async function fetchModrinthDataByShaInternal(
  pathsByHash: Map<string, string[]>,
): Promise<Record<string, OnlineModData>> {
  if (pathsByHash.size === 0) return {};

  const versions = (await postJson(VERSION_FILES_URL, {
    hashes: [...pathsByHash.keys()],
    algorithm: "sha1",
  })) as Record<string, VersionFileHit>;

  // sha1 -> project id (dedupe projects for the second call).
  const projectBySha = new Map<string, string>();
  for (const [sha1, hit] of Object.entries(versions)) {
    if (
      hit &&
      typeof hit.project_id === "string" &&
      hit.project_id.length > 0
    ) {
      projectBySha.set(sha1, hit.project_id);
    }
  }
  if (projectBySha.size === 0) return {};

  const projectIds = [...new Set(projectBySha.values())];
  const projects = (await getJson(
    `${PROJECTS_URL}?ids=${encodeURIComponent(JSON.stringify(projectIds))}`,
  )) as ProjectHit[];
  const projectById = new Map<string, ProjectHit>();
  for (const p of projects) {
    if (p && typeof p.id === "string") projectById.set(p.id, p);
  }

  const out: Record<string, OnlineModData> = {};
  for (const [sha1, filePaths] of pathsByHash) {
    const projectId = projectBySha.get(sha1);
    if (!projectId) continue;
    const p = projectById.get(projectId);
    const scannedCats = Array.isArray(p?.categories)
      ? p.categories.filter((c) => typeof c === "string")
      : [];
    for (const filePath of filePaths) {
      out[filePath] = {
        filePath,
        sha1,
        projectId,
        slug: typeof p?.slug === "string" ? p.slug : "",
        title: typeof p?.title === "string" ? p.title : "",
        iconUrl: typeof p?.icon_url === "string" ? p.icon_url : "",
        categories: scannedCats,
        modrinthSide: resolveModrinthSide(p),
        projectType: typeof p?.project_type === "string" ? p.project_type : "",
      };
    }
  }

  // NOTE: category overrides are applied renderer-side (the scan's modId is
  // needed to key them; see applyCatOverrides in catOverrides.ts and the
  // shared merge helper). This lower-level function returns raw provider data.

  // Inline icons as data URIs (bounded concurrency so 300 mods don't
  // stampede the CDN). Failures keep the remote URL as fallback.
  const withRemoteIcons = Object.values(out).filter((r) =>
    r.iconUrl.startsWith("http"),
  );
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(ICON_CONCURRENCY, withRemoteIcons.length) },
    async () => {
      while (cursor < withRemoteIcons.length) {
        const rec = withRemoteIcons[cursor++];
        const dataUri = await fetchIconDataUri(rec.iconUrl);
        if (dataUri) rec.iconUrl = dataUri;
      }
    },
  );
  await Promise.all(workers);
  return out;
}
