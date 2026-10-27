import { readdirSync, existsSync, statSync } from "fs";
import { join } from "path";
import AdmZip from "adm-zip";
import type { ParsedMod, ScanModsResult } from "../../shared/types";
import type { ModParserStrategy } from "./types";
import { NeoForgeParser } from "./neoForgeParser";
import { FabricParser } from "./fabricParser";
import { readEmbeddedModIds } from "./embeddedMods";
import { getInstanceInfo } from "../instanceInfo";
import { reloadSideOverrides } from "../sideOverrides";
import {
  applyDepOverrides,
  getDepOverrides,
  reloadDepOverrides,
} from "../depOverrides";
import { DISABLED_DIR_NAME, MODS_DIR_NAME } from "../modFiles";

/**
 * Scans a modpack instance folder for mods.
 *
 * Strategies are tried in order — to support a new loader (Fabric/Quilt,
 * Forge), implement `ModParserStrategy` and append it to this array.
 */
const STRATEGIES: ModParserStrategy[] = [
  new NeoForgeParser(),
  new FabricParser(),
];

const BUNDLED_DEPENDENCY_PROVIDERS: Record<string, string[]> = {
  create: ["flywheel"],
  create_aeronautics: ["simulated", "create_simulated"],
  aeronautics: ["simulated", "create_simulated"],
};

const FABRIC_API_IDS = new Set([
  "fabricapi",
  "fabric",
  "fabricapibase",
]);
const CONNECTOR_IDS = new Set([
  "connectormod",
  "connector",
  "sinytra",
  "sinytraconnector",
]);

function normalizeId(value: string): string {
  return value.trim().toLowerCase().replace(/[-_.]/g, "");
}

function isProvidedByInstalledMod(
  dependencyId: string,
  installedIds: Set<string>,
): boolean {
  const dependency = normalizeId(dependencyId);
  for (const [provider, provides] of Object.entries(
    BUNDLED_DEPENDENCY_PROVIDERS,
  )) {
    if (
      installedIds.has(normalizeId(provider)) &&
      provides.some((provided) => normalizeId(provided) === dependency)
    ) {
      return true;
    }
  }
  // Aeronautics packs commonly declare either spelling of the bundled module.
  if (["simulated", "createsimulated"].includes(dependency)) {
    return installedIds.has("aeronautics") || installedIds.has("createaeronautics");
  }
  return false;
}

function resolveModsDir(instancePath: string): string | null {
  const direct = join(instancePath, MODS_DIR_NAME);
  try {
    if (existsSync(direct) && statSync(direct).isDirectory()) return direct;
  } catch {
    return null;
  }
  return null;
}

function parseJarFile(filePath: string, fileName: string): ParsedMod | null {
  let zip: AdmZip;
  try {
    zip = new AdmZip(filePath);
  } catch (err) {
    console.warn(
      `[ModParser] Cannot open "${fileName}" as zip:`,
      (err as Error).message,
    );
    return null;
  }
  const hasNativeForgeMetadata = Boolean(
    zip.getEntry("META-INF/neoforge.mods.toml") ??
      zip.getEntry("META-INF/mods.toml"),
  );
  const strategies = hasNativeForgeMetadata
    ? STRATEGIES
    : [...STRATEGIES].reverse();
  for (const strategy of strategies) {
    try {
      if (strategy.canHandle(zip)) {
        const parsed = strategy.parse(zip, fileName, filePath);
        if (parsed) parsed.providedModIds = readEmbeddedModIds(zip);
        return parsed;
      }
    } catch (err) {
      console.warn(
        `[ModParser] Strategy "${strategy.loader}" failed on "${fileName}":`,
        err,
      );
    }
  }
  return null;
}

export function scanModsFolder(
  instancePath: string,
  onProgress?: (stage: "reading" | "parsing") => void,
): ScanModsResult {
  // Pick up user overrides (and external edits) before parsing.
  reloadSideOverrides();
  reloadDepOverrides();
  const depOverrides = getDepOverrides();
  const modsPath = resolveModsDir(instancePath);
  if (!modsPath) {
    throw new Error(`No "mods" folder found inside: ${instancePath}`);
  }

  onProgress?.("reading");
  let files: string[];
  try {
    files = readdirSync(modsPath).filter((f) =>
      f.toLowerCase().endsWith(".jar"),
    );
  } catch (err) {
    throw new Error(
      `Cannot read mods folder "${modsPath}": ${(err as Error).message}`,
    );
  }
  files.sort((a, b) => a.localeCompare(b));

  // Disabled mods live in \disabledmods\ (sibling of \mods\); absence == none.
  let disabledFiles: string[] = [];
  const disabledPath = join(instancePath, DISABLED_DIR_NAME);
  try {
    if (existsSync(disabledPath) && statSync(disabledPath).isDirectory()) {
      disabledFiles = readdirSync(disabledPath)
        .filter((f) => f.toLowerCase().endsWith(".jar"))
        .sort((a, b) => a.localeCompare(b));
    }
  } catch (err) {
    console.warn(
      `[ModParser] Cannot read disabled mods folder "${disabledPath}":`,
      err,
    );
  }

  const mods: ParsedMod[] = [];
  const skipped: ScanModsResult["skipped"] = [];
  onProgress?.("parsing");

  const scanFiles = (
    dir: string,
    dirFiles: string[],
    enabled: boolean,
  ): void => {
    for (const fileName of dirFiles) {
      try {
        const parsed = parseJarFile(join(dir, fileName), fileName);
        if (parsed) {
          parsed.enabled = enabled;
          parsed.filePath = join(dir, fileName);
          parsed.dependencies = applyDepOverrides(
            parsed.modId,
            parsed.dependencies,
            depOverrides,
          );
          mods.push(parsed);
        } else {
          skipped.push({
            fileName,
            reason: "No recognizable mod metadata (not a NeoForge mod?)",
          });
        }
      } catch (err) {
        // One broken jar must never abort the whole scan.
        console.warn(`[ModParser] Skipping "${fileName}":`, err);
        skipped.push({ fileName, reason: (err as Error).message });
      }
    }
  };

  scanFiles(modsPath, files, true);
  scanFiles(disabledPath, disabledFiles, false);

  // Prefer explicit loader metadata; fall back to Fabric metadata majority.
  const metadataLoader = getInstanceInfo(instancePath).modLoader;
  const fabricCount = mods.filter((mod) => mod.isFabricMod).length;
  const neoForgeCount = mods.filter((mod) => mod.loader === "neoforge").length;
  const modLoader =
    metadataLoader !== "Unknown"
      ? metadataLoader
      : fabricCount > neoForgeCount
        ? "Fabric"
        : neoForgeCount > 0
          ? "NeoForge"
          : "Unknown";
  const forgeFamily = /^(forge|neoforge)$/i.test(modLoader);
  const hasSinytraConnector = mods.some(
    (mod) =>
      mod.enabled &&
      (CONNECTOR_IDS.has(normalizeId(mod.modId)) ||
        mod.fileName.toLowerCase().includes("connector-")),
  );
  for (const mod of mods) {
    mod.incompatibleFabric = Boolean(
      mod.isFabricMod && forgeFamily && !hasSinytraConnector,
    );
  }

  // Count libraries embedded in a mod as present, along with safe ecosystem aliases.
  const installed = new Set(
    mods.flatMap((mod) => [mod.modId, ...(mod.providedModIds ?? [])])
      .map((id) => normalizeId(id)),
  );
  for (const mod of mods) {
    for (const dep of mod.dependencies) {
      const depId = normalizeId(dep.modId);
      const fabricApiProviderInstalled =
        FABRIC_API_IDS.has(depId) &&
        mods.some(
          (candidate) =>
            candidate.enabled &&
            FABRIC_API_IDS.has(normalizeId(candidate.modId)),
        );
      dep.satisfied =
        installed.has(depId) ||
        isProvidedByInstalledMod(dep.modId, installed) ||
        fabricApiProviderInstalled;
    }
  }

  return {
    instancePath,
    modsPath,
    mods,
    skipped,
    modLoader,
    hasSinytraConnector,
  };
}
