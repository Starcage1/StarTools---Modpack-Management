import { spawn } from "child_process";
import { existsSync, mkdirSync, renameSync, statSync } from "fs";
import { basename, join, resolve } from "path";
import { nextStagedPath, recordTrashEntry } from "./trashHistory";
import { detectNanaZipPath, normalizeNanaZipPath } from "./nanaZip";

export const MODS_DIR_NAME = "mods";
export const DISABLED_DIR_NAME = "disabledmods";

/** Resolve a jar path inside the instance, guarding against path traversal. */
function resolveJarPath(
  instancePath: string,
  dirName: string,
  fileName: string,
): string {
  if (typeof fileName !== "string" || fileName.length === 0) {
    throw new Error("Invalid file name");
  }
  if (
    basename(fileName) !== fileName ||
    !fileName.toLowerCase().endsWith(".jar")
  ) {
    throw new Error(`Invalid jar file name: ${fileName}`);
  }
  const instanceRoot = resolve(instancePath);
  const full = resolve(instanceRoot, dirName, fileName);
  if (
    full !== join(instanceRoot, dirName, fileName) ||
    !full.startsWith(instanceRoot)
  ) {
    throw new Error(`Invalid jar file name: ${fileName}`);
  }
  return full;
}

function findJar(
  instancePath: string,
  fileName: string,
): { path: string; enabled: boolean } {
  const inMods = resolveJarPath(instancePath, MODS_DIR_NAME, fileName);
  if (existsSync(inMods) && statSync(inMods).isFile())
    return { path: inMods, enabled: true };
  const inDisabled = resolveJarPath(instancePath, DISABLED_DIR_NAME, fileName);
  if (existsSync(inDisabled) && statSync(inDisabled).isFile()) {
    return { path: inDisabled, enabled: false };
  }
  throw new Error(`Mod file not found: ${fileName}`);
}

/**
 * Move a jar between `\mods\` and `\disabledmods\`. `enabled` is the desired
 * end state. Creates `\disabledmods\` on demand. Throws on any failure.
 */
export function setModEnabled(
  instancePath: string,
  fileName: string,
  enabled: boolean,
): { fileName: string; enabled: boolean } {
  const found = findJar(instancePath, fileName);
  if (found.enabled === enabled) return { fileName, enabled }; // already there
  const destDir = join(
    resolve(instancePath),
    enabled ? MODS_DIR_NAME : DISABLED_DIR_NAME,
  );
  mkdirSync(destDir, { recursive: true });
  const dest = resolveJarPath(
    instancePath,
    enabled ? MODS_DIR_NAME : DISABLED_DIR_NAME,
    fileName,
  );
  if (existsSync(dest)) {
    throw new Error(
      `Cannot move ${fileName}: a file with that name already exists`,
    );
  }
  renameSync(found.path, dest);
  return { fileName, enabled };
}

/**
 * "Trash" a jar (from `\mods\` or `\disabledmods\`) by moving it into the
 * app-managed `trash_staging/` buffer and recording it for restoration.
 * Unlike `shell.trashItem`, staged files stay restorable — the OS Recycle
 * Bin is write-only from Node and cannot be pulled back out of. The record
 * step is best-effort and never throws, so a successful move is always
 * followed by its history entry. Throws on failure (jar untouched).
 */
export function trashModFile(
  instancePath: string,
  fileName: string,
  modId: string,
): boolean {
  const found = findJar(instancePath, fileName);
  const { id, stagedPath } = nextStagedPath(fileName);
  renameSync(found.path, stagedPath);
  recordTrashEntry({
    id,
    modId: typeof modId === "string" ? modId : "",
    originalFileName: fileName,
    originalPath: found.path,
    stagedPath,
  });
  return true;
}

/**
 * Validate an archive path for opening (must be an existing .jar).
 * Returns the normalized path. Throws on invalid input.
 */
export function resolveArchivePath(filePath: string): string {
  if (typeof filePath !== "string" || filePath.length === 0) {
    throw new Error("Invalid archive path");
  }
  const full = resolve(filePath);
  if (
    !/\.(jar|zip)$/i.test(full) ||
    !existsSync(full) ||
    !statSync(full).isFile()
  ) {
    throw new Error(`Archive not found: ${filePath}`);
  }
  return full;
}

/** Open a mod archive directly in NanaZip. */
export async function openArchiveWithNanaZip(
  filePath: string,
  configuredPath?: string,
): Promise<boolean> {
  const full = resolveArchivePath(filePath);
  if (process.platform !== "win32") {
    throw new Error("Open Archive with NanaZip is only available on Windows");
  }

  const nanaZipPath = configuredPath
    ? normalizeNanaZipPath(configuredPath)
    : detectNanaZipPath();
  const isStoreAlias = nanaZipPath === "NanaZip.exe";
  if (
    !nanaZipPath ||
    (!isStoreAlias &&
      (!existsSync(nanaZipPath) || !statSync(nanaZipPath).isFile()))
  ) {
    throw new Error(
      "NanaZip was not found. Set its executable path in Settings.",
    );
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(nanaZipPath, [full], {
      detached: true,
      windowsHide: false,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
  return true;
}
