import { readdirSync, existsSync, statSync } from "fs";
import { join } from "path";
import AdmZip from "adm-zip";
import type { ParsedMod, ScanModsResult } from "../../shared/types";
import type { ModParserStrategy } from "./types";
import { NeoForgeParser } from "./neoForgeParser";
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
const STRATEGIES: ModParserStrategy[] = [new NeoForgeParser()];

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
  for (const strategy of STRATEGIES) {
    try {
      if (strategy.canHandle(zip)) {
        return strategy.parse(zip, fileName, filePath);
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

  // Cross-reference: flag required deps that are not installed.
  const installed = new Set(mods.map((m) => m.modId.toLowerCase()));
  for (const mod of mods) {
    for (const dep of mod.dependencies) {
      dep.satisfied = installed.has(dep.modId.toLowerCase());
    }
  }

  return { instancePath, modsPath, mods, skipped };
}
