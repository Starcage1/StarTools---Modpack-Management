import AdmZip from "adm-zip";
import type { ModDependency, ModSide, ParsedMod } from "../../shared/types";
import type { ModParserStrategy } from "./types";
import { getSideOverride } from "../sideOverrides";

interface FabricModJson {
  id?: unknown;
  name?: unknown;
  version?: unknown;
  description?: unknown;
  authors?: unknown;
  environment?: unknown;
  icon?: unknown;
  depends?: unknown;
  recommends?: unknown;
  suggests?: unknown;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function versionFromFileName(fileName: string): string {
  const parts = fileName.replace(/\.jar$/i, "").split(/[-_]/);
  const versionParts: string[] = [];
  for (let index = parts.length - 1; index >= 0 && /^\d/.test(parts[index]); index--)
    versionParts.unshift(parts[index]);
  return versionParts.join("-") || "Unknown";
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) =>
      typeof entry === "string"
        ? entry.trim()
        : typeof entry === "object" && entry !== null &&
            typeof (entry as { name?: unknown }).name === "string"
          ? (entry as { name: string }).name.trim()
          : "",
    )
    .filter(Boolean);
}

function inferSide(environment: unknown): ModSide {
  if (environment === "client") return "Client";
  if (environment === "server") return "Server";
  if (environment === "*") return "Both";
  return "Unknown";
}

function resolveIcon(zip: AdmZip, icon: unknown): string | null {
  const candidates =
    typeof icon === "string"
      ? [icon]
      : typeof icon === "object" && icon !== null
        ? Object.values(icon as Record<string, unknown>)
            .filter((value): value is string => typeof value === "string")
            .reverse()
        : [];
  for (const candidate of candidates) {
    const entry = zip.getEntry(candidate.replace(/^\/+/, ""));
    if (!entry || entry.isDirectory) continue;
    const data = entry.getData();
    if (!data.length || data.length > 2 * 1024 * 1024) continue;
    const mime = /\.jpe?g$/i.test(candidate) ? "image/jpeg" : "image/png";
    return `data:${mime};base64,${data.toString("base64")}`;
  }
  return null;
}

function addDependencies(
  target: ModDependency[],
  value: unknown,
  mandatory: boolean,
): void {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return;
  for (const [modId, version] of Object.entries(value)) {
    if (!modId.trim()) continue;
    if (["minecraft", "fabricloader", "java"].includes(modId.toLowerCase()))
      continue;
    const versionRange = Array.isArray(version)
      ? version.filter((v) => typeof v === "string").join(" || ")
      : typeof version === "string"
        ? version
        : "";
    if (target.some((dependency) => dependency.modId === modId)) continue;
    target.push({
      modId,
      versionRange,
      mandatory,
      satisfied: false,
      source: "scanned",
      removed: false,
    });
  }
}

export class FabricParser implements ModParserStrategy {
  readonly loader = "fabric" as const;

  canHandle(zip: AdmZip): boolean {
    return Boolean(zip.getEntry("fabric.mod.json"));
  }

  parse(zip: AdmZip, fileName: string, filePath: string): ParsedMod | null {
    try {
      const entry = zip.getEntry("fabric.mod.json");
      if (!entry || entry.isDirectory) return null;
      const metadata = JSON.parse(entry.getData().toString("utf8")) as FabricModJson;
      const modId = text(metadata.id);
      if (!modId) return null;
      const sideOverride = getSideOverride(modId) ?? undefined;
      const dependencies: ModDependency[] = [];
      addDependencies(dependencies, metadata.depends, true);
      addDependencies(dependencies, metadata.recommends, false);
      addDependencies(dependencies, metadata.suggests, false);
      return {
        fileName,
        filePath,
        modId,
        name: text(metadata.name) || modId,
        version: text(metadata.version) || versionFromFileName(fileName),
        authors: stringList(metadata.authors).join(", "),
        enabled: true,
        side: sideOverride ?? inferSide(metadata.environment),
        sideOverride,
        description: text(metadata.description),
        iconDataUri: resolveIcon(zip, metadata.icon),
        dependencies,
        isFabricMod: true,
        incompatibleFabric: false,
        loader: "fabric",
      };
    } catch (error) {
      console.warn(`[FabricParser] Cannot parse "${fileName}":`, error);
      return null;
    }
  }
}
