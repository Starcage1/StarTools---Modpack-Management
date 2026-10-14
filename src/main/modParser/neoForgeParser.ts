import AdmZip from "adm-zip";
import { parse as parseTomlDocument } from "smol-toml";
import type { ModDependency, ModSide, ParsedMod } from "../../shared/types";
import type { ModParserStrategy } from "./types";
import { getSideOverride } from "../sideOverrides";

/**
 * Candidate metadata paths for NeoForge mods, in priority order.
 * NeoForge 1.20.2+ uses `neoforge.mods.toml`; older builds (and Forge ports)
 * use `mods.toml`. The generic fallback scan covers renamed edge cases.
 */
const TOML_CANDIDATES = ["META-INF/neoforge.mods.toml", "META-INF/mods.toml"];

/** Nested jars embedded via Jar-in-Jar live under these directories. */
const JARJAR_JAR_PATTERN = /^META-INF\/(jarjar|jars)\/[^/]+\.jar$/i;

const JARJAR_METADATA_PATH = "META-INF/jarjar/metadata.json";

const EARLY_WINDOW_SERVICES = [
  "META-INF/services/net.neoforged.neoforgespi.earlywindow.GraphicsBootstrapper",
  "META-INF/services/net.neoforged.neoforgespi.earlywindow.ImmediateWindowProvider",
];

/** Mod IDs that are always present (game / loader / language runtimes). */
const CORE_MOD_IDS = new Set([
  "minecraft",
  "neoforge",
  "forge",
  "mcp",
  "fml",
  "fmlonly",
  "java",
  "kotlinforforge",
  "kotlin_for_forge",
  "mixinextras",
  "mixinsquared",
]);

interface TomlModEntry {
  modId?: string;
  version?: string;
  displayName?: string;
  description?: string;
  logoFile?: string;
  authors?: string | string[];
  // Some mods ship non-standard side hints; honoured when present.
  side?: string;
  modSide?: string;
}

interface TomlDependencyEntry {
  modId?: string;
  mandatory?: boolean;
  /** NeoForge standard: "required" | "optional" | "incompatible" | "discouraged". */
  type?: string;
  versionRange?: string;
  ordering?: string;
  side?: string;
}

interface ParsedToml {
  mods?: TomlModEntry[];
  dependencies?: Record<string, TomlDependencyEntry[]>;
}

interface JarJarEntry {
  identifier?: { group?: string; artifact?: string };
  version?: { range?: string; artifactVersion?: string };
  path?: string;
  filename?: string;
  isObfuscated?: boolean;
}

interface JarJarMetadata {
  jars?: JarJarEntry[];
}

interface FoundToml {
  path: string;
  /**
   * True for the canonical `neoforge.mods.toml` / `mods.toml` locations.
   * Canonical metadata is authoritative: when it parses, the JarJar
   * fallback must NOT run (embedded libs must never override the main mod).
   */
  canonical: boolean;
}

function findTomlEntry(zip: AdmZip): FoundToml | null {
  const names = new Set(zip.getEntries().map((e) => e.entryName));
  for (const candidate of TOML_CANDIDATES) {
    if (names.has(candidate)) return { path: candidate, canonical: true };
  }
  // Fallback: any toml directly under META-INF/
  const fallback = zip
    .getEntries()
    .find((e) => /^META-INF\/[^/]+\.toml$/i.test(e.entryName));
  return fallback ? { path: fallback.entryName, canonical: false } : null;
}

function parseTomlText(text: string): ParsedToml | null {
  try {
    // smol-toml implements TOML 1.0 (dotted keys, etc.) — the legacy `toml`
    // package choked on real-world files (e.g. Supplementaries' dotted keys
    // under ["lithium:options"]), which misrouted jars to the JarJar fallback.
    return parseTomlDocument(text) as unknown as ParsedToml;
  } catch {
    return null;
  }
}

function mimeForImage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "bmp":
      return "image/bmp";
    default:
      return "image/png";
  }
}

/** Root-level icon names probed when `logoFile` is absent from mods.toml. */
const LOGO_FALLBACKS = ["logo.png", "icon.png", "pack.png"];

function tryReadImageEntry(zip: AdmZip, entryName: string): string | null {
  try {
    const entry = zip.getEntry(entryName) ?? zip.getEntry(`/${entryName}`);
    if (!entry || entry.isDirectory) return null;
    const data = entry.getData();
    // Guard against absurdly large images blowing up IPC payloads (2 MB cap).
    if (data.length === 0 || data.length > 2 * 1024 * 1024) return null;
    return `data:${mimeForImage(entryName)};base64,${data.toString("base64")}`;
  } catch {
    return null;
  }
}

function readLogoAsDataUri(
  zip: AdmZip,
  logoFile: string | undefined,
): string | null {
  // Explicit `logoFile` from mods.toml always wins (PNG and ICO alike).
  if (typeof logoFile === "string" && logoFile.length > 0) {
    const found = tryReadImageEntry(zip, logoFile.replace(/^\/+/, ""));
    if (found) return found;
  }
  // Fallback: conventional root-level icon names (PNG and ICO alike).
  if (!logoFile) {
    for (const fallback of LOGO_FALLBACKS) {
      const found = tryReadImageEntry(zip, fallback);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Fallback version extraction from filenames like
 * `curios-neoforge-9.5.4+1.21.1.jar` -> `9.5.4+1.21.1`.
 * Takes the trailing run of `-`/`_` separated segments that start with a digit.
 */
export function versionFromFileName(fileName: string): string {
  const base = fileName.replace(/\.jar$/i, "");
  const parts = base.split(/[-_]/);
  const versionParts: string[] = [];
  for (let i = parts.length - 1; i >= 0; i--) {
    if (/^\d/.test(parts[i])) versionParts.unshift(parts[i]);
    else break;
  }
  return versionParts.length > 0 ? versionParts.join("-") : "Unknown";
}

/** True when a version string still holds an unresolved `${...}` placeholder. */
function hasVersionPlaceholder(version: string): boolean {
  return /\$\{[^}]+\}/.test(version);
}

/**
 * Read `META-INF/MANIFEST.MF` into a lowercase header map (unfolding
 * RFC-style continuation lines). Empty object when absent/unreadable.
 */
function readManifestHeaders(zip: AdmZip): Record<string, string> {
  try {
    const entry = zip.getEntry("META-INF/MANIFEST.MF");
    if (!entry || entry.isDirectory) return {};
    // Manifest lines wrap at 72 bytes; continuations start with a single space.
    const unfolded = entry
      .getData()
      .toString("utf8")
      .replace(/\r?\n /g, "");
    const headers: Record<string, string> = {};
    for (const line of unfolded.split(/\r?\n/)) {
      const idx = line.indexOf(":");
      if (idx > 0) {
        headers[line.slice(0, idx).trim().toLowerCase()] = line
          .slice(idx + 1)
          .trim();
      }
    }
    return headers;
  } catch {
    return {};
  }
}

/**
 * Read `META-INF/MANIFEST.MF` (unfolding RFC-style continuation lines) and
 * return `Implementation-Version` / `Bundle-Version` when present.
 */
function readManifestVersion(zip: AdmZip): string | null {
  const headers = readManifestHeaders(zip);
  const version =
    headers["implementation-version"] || headers["bundle-version"] || "";
  return version && !hasVersionPlaceholder(version) ? version : null;
}

/** `Implementation-Vendor` / `Bundle-Vendor` from MANIFEST.MF, if present. */
function readManifestVendor(zip: AdmZip): string {
  const headers = readManifestHeaders(zip);
  return headers["implementation-vendor"] || headers["bundle-vendor"] || "";
}

/**
 * A small number of NeoForge early-window extensions are service providers,
 * not regular mods, and therefore have no mods.toml. Only recognize this
 * known extension point so ordinary manifest-only library jars stay skipped.
 */
function parseEarlyWindowProvider(
  zip: AdmZip,
  fileName: string,
  filePath: string,
): ParsedMod | null {
  const names = new Set(zip.getEntries().map((entry) => entry.entryName));
  if (!EARLY_WINDOW_SERVICES.some((servicePath) => names.has(servicePath)))
    return null;

  const headers = readManifestHeaders(zip);
  const moduleName = headers["automatic-module-name"];
  const title = headers["implementation-title"] || moduleName;
  if (!title) return null;

  const modId = normalizeModId(moduleName || title);
  const sideOverride = getSideOverride(modId) ?? undefined;
  return {
    fileName,
    filePath,
    modId,
    name: title,
    version: readManifestVersion(zip) ?? versionFromFileName(fileName),
    side: sideOverride ?? "Client",
    sideOverride,
    description: "NeoForge early-window provider (manifest metadata only)",
    authors: readManifestVendor(zip),
    enabled: true,
    iconDataUri: null,
    dependencies: [],
    loader: "neoforge",
  };
}

/**
 * Resolve authors: `authors` from `[[mods]]` (string or, non-standardly, an
 * array), else the manifest vendor, else ''.
 */
function resolveAuthors(rawAuthors: unknown, manifestZip: AdmZip): string {
  if (typeof rawAuthors === "string" && rawAuthors.trim().length > 0) {
    return rawAuthors.trim();
  }
  if (Array.isArray(rawAuthors)) {
    const joined = rawAuthors
      .filter((a): a is string => typeof a === "string" && a.trim().length > 0)
      .map((a) => a.trim())
      .join(", ");
    if (joined) return joined;
  }
  return readManifestVendor(manifestZip);
}

/**
 * Resolve a raw toml version: literal values pass through, `${...}`
 * placeholders (e.g. `${file.jarVersion}`) resolve via MANIFEST.MF, and
 * anything unresolved falls back to the `.jar` filename.
 */
function resolveVersion(
  rawVersion: unknown,
  manifestZip: AdmZip,
  fileName: string,
): string {
  if (
    typeof rawVersion === "string" &&
    rawVersion.length > 0 &&
    !hasVersionPlaceholder(rawVersion)
  ) {
    return rawVersion;
  }
  return readManifestVersion(manifestZip) ?? versionFromFileName(fileName);
}

function mapSide(raw: unknown): ModSide {
  if (typeof raw !== "string") return "Both";
  const v = raw.trim().toLowerCase();
  if (["client", "client_only", "client-only"].includes(v)) return "Client";
  if (["server", "server_only", "server-only"].includes(v)) return "Server";
  return "Both";
}

/** Best-effort side inference for NeoForge (which has no mandatory side field). */
function inferSide(entry: TomlModEntry, fileName: string): ModSide {
  const explicit = mapSide(entry.side ?? entry.modSide);
  if (entry.side !== undefined || entry.modSide !== undefined) return explicit;
  const lower = fileName.toLowerCase();
  if (/(^|[-_.])client([-_.]|$)/.test(lower)) return "Client";
  if (/(^|[-_.])server([-_.]|$)/.test(lower)) return "Server";
  return "Both";
}

/** Raw JarJar entries from `META-INF/jarjar/metadata.json` (empty on any failure). */
function readJarJarEntries(zip: AdmZip): JarJarEntry[] {
  try {
    const entry = zip.getEntry(JARJAR_METADATA_PATH);
    if (!entry || entry.isDirectory) return [];
    const meta = JSON.parse(entry.getData().toString("utf8")) as JarJarMetadata;
    return Array.isArray(meta.jars) ? meta.jars : [];
  } catch {
    return [];
  }
}

/** Mod IDs embedded via Jar-in-Jar (jarjar), which users never install manually. */
function readEmbeddedArtifacts(zip: AdmZip): Set<string> {
  const embedded = new Set<string>();
  for (const jar of readJarJarEntries(zip)) {
    const artifact = jar.identifier?.artifact
      ?.toLowerCase()
      .replace(/[-_]/g, "");
    if (artifact) embedded.add(artifact);
    const fileBase = jar.filename
      ?.split("/")
      .pop()
      ?.replace(/\.jar$/i, "")
      .toLowerCase()
      .replace(/[-_]/g, "");
    if (fileBase) embedded.add(fileBase);
  }
  return embedded;
}

/** Normalize a maven artifact id into a NeoForge-style mod id. */
function normalizeModId(raw: string): string {
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "unknown";
}

/**
 * Map a raw `[[dependencies.<modid>]]` entry to a `ModDependency`.
 * Returns `null` when the entry must be excluded entirely (incompatible /
 * discouraged dependencies are never shown to the user).
 *
 * Classification order (NeoForge-first, Forge fallback):
 *  1. `type` "incompatible"/"discouraged", or a `versionRange` containing
 *     "NOT-COMPATIBLE"/"incompatible" -> excluded.
 *  2. `type` "required" -> mandatory; "optional" -> optional.
 *  3. `type` undefined -> legacy Forge `mandatory` boolean (default true).
 *  4. Any other `type` string -> mandatory (fail safe: a requirement we
 *     don't understand must warn, never silently pass).
 */
function toDependency(raw: TomlDependencyEntry): ModDependency | null {
  if (!raw.modId || typeof raw.modId !== "string") return null;
  const type =
    typeof raw.type === "string" ? raw.type.trim().toLowerCase() : undefined;
  if (type === "incompatible" || type === "discouraged") return null;
  const versionRange =
    typeof raw.versionRange === "string" ? raw.versionRange : "";
  if (/not-compatible|incompatible/i.test(versionRange)) return null;

  let mandatory: boolean;
  if (type === "required") {
    mandatory = true;
  } else if (type === "optional") {
    mandatory = false;
  } else if (type === undefined) {
    mandatory = raw.mandatory !== false;
  } else {
    mandatory = true;
  }

  return {
    modId: raw.modId,
    versionRange,
    mandatory,
    satisfied: false, // resolved later by cross-referencing in ModParserService
    source: "scanned",
    removed: false,
  };
}

function collectDependencies(
  parsed: ParsedToml,
  embedded: Set<string>,
): ModDependency[] {
  const rawDeps: TomlDependencyEntry[] = [];
  if (parsed.dependencies && typeof parsed.dependencies === "object") {
    // Dependencies are keyed per mod id: [[dependencies.<modId>]]
    for (const list of Object.values(parsed.dependencies)) {
      if (Array.isArray(list)) rawDeps.push(...list);
    }
  }

  const dependencies: ModDependency[] = [];
  for (const raw of rawDeps) {
    const dep = toDependency(raw);
    if (!dep) continue;
    const id = dep.modId.toLowerCase();
    if (CORE_MOD_IDS.has(id)) continue; // minecraft / neoforge / java / ...
    const normalized = id.replace(/[-_]/g, "");
    if (
      [...embedded].some(
        (e) => normalized.includes(e) || e.includes(normalized),
      )
    ) {
      continue; // embedded Jar-in-Jar library, not user-installed
    }
    // De-duplicate (same modId can appear under several [[mods]] keys).
    if (!dependencies.some((d) => d.modId.toLowerCase() === id)) {
      dependencies.push(dep);
    }
  }
  return dependencies;
}

function buildFromToml(
  parsed: ParsedToml,
  assetZip: AdmZip,
  manifestZip: AdmZip,
  embedded: Set<string>,
  fileName: string,
  filePath: string,
): ParsedMod | null {
  const modEntries = Array.isArray(parsed.mods) ? parsed.mods : [];
  if (modEntries.length === 0) return null;
  const primary = modEntries[0];
  if (!primary.modId) return null;
  const sideOverride = getSideOverride(primary.modId) ?? undefined;

  return {
    fileName,
    filePath,
    modId: primary.modId,
    name:
      typeof primary.displayName === "string" && primary.displayName.length > 0
        ? primary.displayName
        : primary.modId,
    version: resolveVersion(primary.version, manifestZip, fileName),
    // User-defined override wins over inferred metadata.
    side: sideOverride ?? inferSide(primary, fileName),
    sideOverride,
    description:
      typeof primary.description === "string" ? primary.description : "",
    authors: resolveAuthors(primary.authors, manifestZip),
    enabled: true, // the scan service flips this for jars in \disabledmods\
    iconDataUri: readLogoAsDataUri(assetZip, primary.logoFile),
    dependencies: collectDependencies(parsed, embedded),
    loader: "neoforge",
  };
}

/**
 * Fallback for jars without root-level `mods.toml` (e.g. aggregator/library
 * jars whose real metadata lives in embedded sub-jars or JarJar metadata):
 *  1. Open each nested jar under `META-INF/jarjar/` / `META-INF/jars/` and
 *     parse its inner `mods.toml` when present.
 *  2. Otherwise resolve identity from `META-INF/jarjar/metadata.json`
 *     (`identifier` + `artifactVersion`).
 */
function parseFromJarJar(
  zip: AdmZip,
  fileName: string,
  filePath: string,
): ParsedMod | null {
  const embedded = readEmbeddedArtifacts(zip);

  let nested: AdmZip.IZipEntry[];
  try {
    nested = zip
      .getEntries()
      .filter((e) => !e.isDirectory && JARJAR_JAR_PATTERN.test(e.entryName))
      .sort((a, b) => a.entryName.localeCompare(b.entryName));
  } catch {
    nested = [];
  }

  for (const entry of nested) {
    try {
      const inner = new AdmZip(entry.getData());
      const innerToml = findTomlEntry(inner);
      if (!innerToml) continue;
      const innerEntry = inner.getEntry(innerToml.path);
      if (!innerEntry || innerEntry.isDirectory) continue;
      const parsed = parseTomlText(innerEntry.getData().toString("utf8"));
      if (!parsed) continue;
      const mod = buildFromToml(
        parsed,
        inner,
        inner,
        embedded,
        fileName,
        filePath,
      );
      if (mod) return mod;
    } catch {
      // One unreadable sub-jar must not abort the remaining candidates.
    }
  }

  for (const jar of readJarJarEntries(zip)) {
    const artifact = jar.identifier?.artifact;
    if (!artifact) continue;
    const group = jar.identifier?.group;
    const modId = normalizeModId(artifact);
    const sideOverride = getSideOverride(modId) ?? undefined;
    return {
      fileName,
      filePath,
      modId,
      name: artifact,
      version: resolveVersion(jar.version?.artifactVersion, zip, fileName),
      side: sideOverride ?? "Both",
      sideOverride,
      description: group
        ? `${group}:${artifact} (embedded via JarJar)`
        : `${artifact} (embedded via JarJar)`,
      authors: "",
      enabled: true, // the scan service flips this for jars in \disabledmods\
      iconDataUri: null,
      dependencies: [],
      loader: "neoforge",
    };
  }

  return null;
}

/** NeoForge metadata parser (META-INF/neoforge.mods.toml / mods.toml). */
export class NeoForgeParser implements ModParserStrategy {
  readonly loader = "neoforge" as const;

  canHandle(zip: AdmZip): boolean {
    try {
      if (findTomlEntry(zip) !== null) return true;
      // JarJar aggregator jars: metadata or nested sub-jars can still identify the mod.
      if (zip.getEntry(JARJAR_METADATA_PATH)) return true;
      return (
        zip
          .getEntries()
          .some(
            (e) => !e.isDirectory && JARJAR_JAR_PATTERN.test(e.entryName),
          ) ||
        EARLY_WINDOW_SERVICES.some(
          (servicePath) => zip.getEntry(servicePath) !== null,
        )
      );
    } catch {
      return false;
    }
  }

  parse(zip: AdmZip, fileName: string, filePath: string): ParsedMod | null {
    try {
      const found = findTomlEntry(zip);
      if (found) {
        let text: string | null = null;
        try {
          const tomlEntry = zip.getEntry(found.path);
          if (tomlEntry && !tomlEntry.isDirectory) {
            text = tomlEntry.getData().toString("utf8");
          }
        } catch {
          text = null;
        }
        if (text !== null) {
          const parsed = parseTomlText(text);
          if (parsed) {
            const mod = buildFromToml(
              parsed,
              zip,
              zip,
              readEmbeddedArtifacts(zip),
              fileName,
              filePath,
            );
            // Canonical root metadata is authoritative: a successfully parsed
            // root toml ends the search — embedded JarJar modules must never
            // override the main mod or become their own row. A non-canonical
            // toml without mod data is not mod metadata, so fall through.
            if (mod || found.canonical) return mod;
          }
          // Unparsable root toml (critically broken) -> JarJar fallback below.
        }
      }
      // Root mods.toml completely missing (or critically broken) — only then
      // try embedded sub-jars / JarJar metadata. Still exactly one row per jar.
      return (
        parseFromJarJar(zip, fileName, filePath) ??
        parseEarlyWindowProvider(zip, fileName, filePath)
      );
    } catch (err) {
      console.warn(
        `[NeoForgeParser] Skipping "${fileName}":`,
        (err as Error).message,
      );
      return null;
    }
  }
}
