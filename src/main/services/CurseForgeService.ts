import type { ModSide } from "../../shared/types";

// Retained intact for possible future activation; the active pipeline is Modrinth-only.
const CURSEFORGE_URL = "https://api.curseforge.com";
const MINECRAFT_GAME_ID = 432;
const REQUEST_TIMEOUT_MS = 20_000;
const BATCH_SIZE = 50;
const REQUEST_CONCURRENCY = 3;
const MULTIPLEX = 1_540_583_477;

const isIgnoredWhitespace = (value: number): boolean =>
  value === 9 || value === 10 || value === 13 || value === 32;

/** CurseForge's normalized Murmur2 fingerprint. */
export function calculateCurseForgeFingerprint(buffer: Buffer): number {
  let len = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    if (!isIgnoredWhitespace(buffer[i])) len += 1;
  }

  let h = (1 ^ len) >>> 0;
  let word = 0;
  let bits = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const value = buffer[i];
    if (isIgnoredWhitespace(value)) continue;
    word |= value << bits;
    bits += 8;
    if (bits === 32) {
      const mixed = Math.imul(word, MULTIPLEX) >>> 0;
      const mixedAgain = Math.imul(mixed ^ (mixed >>> 24), MULTIPLEX) >>> 0;
      h = (Math.imul(h, MULTIPLEX) ^ mixedAgain) >>> 0;
      word = 0;
      bits = 0;
    }
  }

  if (bits > 0) {
    h = (h ^ word) >>> 0;
    h = Math.imul(h, MULTIPLEX) >>> 0;
  }
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, MULTIPLEX) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

export interface CurseForgeMatch {
  fingerprint: number;
  modId: number;
}

export interface CurseForgeModMetadata {
  id: number;
  slug: string;
  url: string;
  categories: string[];
  side: ModSide | null;
}

interface ExactMatch {
  file?: { modId?: unknown; fileFingerprint?: unknown };
}

async function postJson(
  url: string,
  apiKey: string,
  body: unknown,
): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "x-api-key": apiKey.trim(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        "CurseForge rejected the API key (401 Unauthorized). Check that Settings contains a valid key from the CurseForge for Studios developer console, then save it and retry.",
      );
    }
    throw new Error(
      `CurseForge request failed (${response.status} ${response.statusText})`,
    );
  }
  return response.json() as Promise<unknown>;
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const index = cursor++;
        if (index >= items.length) return;
        output[index] = await work(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return output;
}

function inferCurseForgeSide(mod: Record<string, unknown>): ModSide | null {
  const direct = mod.side;
  if (direct === "Client" || direct === "Server" || direct === "Both")
    return direct;
  if (mod.isClientOnly === true) return "Client";
  if (mod.isServerOnly === true) return "Server";
  const client = mod.clientSide ?? mod.client_side;
  const server = mod.serverSide ?? mod.server_side;
  const supported = (value: unknown): boolean | null => {
    if (typeof value === "boolean") return value;
    if (typeof value !== "string") return null;
    if (value === "required" || value === "optional" || value === "supported")
      return true;
    if (value === "unsupported") return false;
    return null;
  };
  const clientSupported = supported(client);
  const serverSupported = supported(server);
  if (clientSupported === true && serverSupported === true) return "Both";
  if (clientSupported === true && serverSupported === false) return "Client";
  if (clientSupported === false && serverSupported === true) return "Server";
  return null;
}

/** Exact fingerprint matches followed by a batched metadata lookup for categories. */
export async function fetchCurseForgeMetadata(
  fingerprints: number[],
  apiKey: string,
): Promise<Map<number, CurseForgeModMetadata>> {
  const uniqueFingerprints = [...new Set(fingerprints)];
  if (uniqueFingerprints.length === 0) return new Map();

  const fingerprintBatches = chunk(uniqueFingerprints, BATCH_SIZE);
  const matchResponses = await mapWithConcurrency(
    fingerprintBatches,
    REQUEST_CONCURRENCY,
    async (batch) =>
      postJson(
        `${CURSEFORGE_URL}/v1/fingerprints/${MINECRAFT_GAME_ID}`,
        apiKey,
        {
          fingerprints: batch,
        },
      ),
  );

  const modByFingerprint = new Map<number, number>();
  for (const response of matchResponses) {
    if (!response || typeof response !== "object") continue;
    const data = (response as { data?: unknown }).data;
    if (!data || typeof data !== "object") continue;
    const exactMatches = (data as { exactMatches?: unknown }).exactMatches;
    if (!Array.isArray(exactMatches)) continue;
    for (const rawMatch of exactMatches as ExactMatch[]) {
      const fingerprint = rawMatch?.file?.fileFingerprint;
      const modId = rawMatch?.file?.modId;
      if (
        typeof fingerprint === "number" &&
        Number.isSafeInteger(fingerprint) &&
        typeof modId === "number" &&
        Number.isSafeInteger(modId) &&
        modId > 0
      ) {
        modByFingerprint.set(fingerprint >>> 0, modId);
      }
    }
  }
  const modIds = [...new Set(modByFingerprint.values())];
  if (modIds.length === 0) return new Map();

  const modBatches = chunk(modIds, BATCH_SIZE);
  const modResponses = await mapWithConcurrency(
    modBatches,
    REQUEST_CONCURRENCY,
    async (batch) =>
      postJson(`${CURSEFORGE_URL}/v1/mods`, apiKey, {
        modIds: batch,
        filterPcOnly: true,
      }),
  );

  const metadataByModId = new Map<number, CurseForgeModMetadata>();
  for (const response of modResponses) {
    if (!response || typeof response !== "object") continue;
    const rawMods = (response as { data?: unknown }).data;
    if (!Array.isArray(rawMods)) continue;
    for (const value of rawMods) {
      if (!value || typeof value !== "object") continue;
      const mod = value as Record<string, unknown>;
      if (typeof mod.id !== "number" || !Number.isSafeInteger(mod.id)) continue;
      const categories = Array.isArray(mod.categories)
        ? mod.categories
            .map((category) =>
              category && typeof category === "object"
                ? (category as { name?: unknown }).name
                : null,
            )
            .filter(
              (name): name is string =>
                typeof name === "string" && name.length > 0,
            )
        : [];
      const slug = typeof mod.slug === "string" ? mod.slug : "";
      const links =
        mod.links && typeof mod.links === "object"
          ? (mod.links as Record<string, unknown>)
          : {};
      const url =
        typeof links.websiteUrl === "string" &&
        links.websiteUrl.startsWith("https://")
          ? links.websiteUrl
          : slug
            ? `https://www.curseforge.com/minecraft/mc-mods/${encodeURIComponent(slug)}`
            : `https://www.curseforge.com/minecraft/mc-mods`;
      metadataByModId.set(mod.id, {
        id: mod.id,
        slug,
        url,
        categories: [...new Set(categories)],
        side: inferCurseForgeSide(mod),
      });
    }
  }

  const metadataByFingerprint = new Map<number, CurseForgeModMetadata>();
  for (const [fingerprint, modId] of modByFingerprint) {
    const metadata = metadataByModId.get(modId);
    if (metadata) metadataByFingerprint.set(fingerprint, metadata);
  }
  return metadataByFingerprint;
}
