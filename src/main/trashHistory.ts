import { app, shell } from "electron";
import {
  existsSync,
  copyFileSync,
  cpSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { basename, dirname, join, relative, resolve, sep } from "path";
import type {
  RestoreResult,
  TrashEntry,
  TrashHistoryState,
} from "../shared/types";
import { DISABLED_DIR_NAME, MODS_DIR_NAME } from "./modFiles";

export const TRASH_STAGING_DIR_NAME = "trash_staging";

function userDataDir(): string | null {
  try {
    // Escape hatch for tests / portable setups.
    const env = process.env["MODPACKTOOL_USERDATA"];
    if (env) return env;
    return app.getPath("userData");
  } catch {
    // No Electron runtime (e.g. plain-node tests).
    return null;
  }
}

function historyPath(): string | null {
  const dir = userDataDir();
  return dir ? join(dir, "trash_history.json") : null;
}

function stagingDir(): string | null {
  const dir = userDataDir();
  return dir ? join(dir, TRASH_STAGING_DIR_NAME) : null;
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeEntry(raw: unknown): TrashEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r["id"] !== "string" ||
    typeof r["originalFileName"] !== "string" ||
    typeof r["originalPath"] !== "string" ||
    typeof r["stagedPath"] !== "string" ||
    typeof r["timestamp"] !== "number" ||
    r["id"].length === 0 ||
    r["originalFileName"].length === 0 ||
    r["originalPath"].length === 0 ||
    r["stagedPath"].length === 0
  ) {
    return null; // also drops pre-staging-format entries
  }
  return {
    id: r["id"],
    modId: typeof r["modId"] === "string" ? r["modId"] : "",
    originalFileName: r["originalFileName"],
    originalPath: r["originalPath"],
    stagedPath: r["stagedPath"],
    ...(r["kind"] === "config" || r["kind"] === "pack" || r["kind"] === "mod"
      ? { kind: r["kind"] }
      : {}),
    ...(r["itemType"] === "file" || r["itemType"] === "directory"
      ? { itemType: r["itemType"] }
      : {}),
    ...(typeof r["instancePath"] === "string"
      ? { instancePath: r["instancePath"] }
      : {}),
    timestamp: r["timestamp"],
  };
}

function readHistory(): TrashEntry[] {
  try {
    const path = historyPath();
    if (!path || !existsSync(path)) return [];
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((e) => {
      const clean = sanitizeEntry(e);
      return clean ? [clean] : [];
    });
  } catch {
    return [];
  }
}

function writeHistory(entries: TrashEntry[]): void {
  const path = historyPath();
  if (!path) throw new Error("User data directory is unavailable");
  const dir = userDataDir();
  if (!dir) throw new Error("User data directory is unavailable");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(entries, null, 2), "utf8");
}

function isFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Reserve a unique staged path for a trashed jar (creates the staging dir).
 * The caller moves the file there. Throws when userData is unavailable.
 */
export function nextStagedPath(originalFileName: string): {
  id: string;
  stagedPath: string;
} {
  const dir = stagingDir();
  if (!dir) throw new Error("User data directory is unavailable");
  mkdirSync(dir, { recursive: true });
  const id = makeId();
  return { id, stagedPath: join(dir, `${id}__${basename(originalFileName)}`) };
}

function pathExists(path: string): boolean {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

function ensureNoSymlinks(path: string): void {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink())
    throw new Error("Symbolic links cannot be moved to app trash");
  if (!stats.isDirectory()) return;
  for (const name of readdirSync(path)) ensureNoSymlinks(join(path, name));
}

function moveIntoStaging(
  sourcePath: string,
  stagedPath: string,
  itemType: "file" | "directory",
): void {
  try {
    renameSync(sourcePath, stagedPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    if (itemType === "directory")
      cpSync(sourcePath, stagedPath, { recursive: true, errorOnExist: true });
    else copyFileSync(sourcePath, stagedPath);
    try {
      if (itemType === "directory") rmSync(sourcePath, { recursive: true });
      else unlinkSync(sourcePath);
    } catch (removeError) {
      rmSync(stagedPath, { recursive: true, force: true });
      throw removeError;
    }
  }
}

/** Stage a validated file or directory and make it available to Restore. */
export function trashPath(
  originalPath: string,
  kind: "config" | "pack",
  instancePath: string,
): boolean {
  const sourcePath = resolve(originalPath);
  if (!pathExists(sourcePath))
    throw new Error(`Item not found: ${originalPath}`);
  ensureNoSymlinks(sourcePath);
  const stats = statSync(sourcePath);
  if (!stats.isFile() && !stats.isDirectory())
    throw new Error("Only files and folders can be moved to trash");
  const itemType = stats.isDirectory() ? "directory" : "file";
  const { id, stagedPath } = nextStagedPath(basename(sourcePath));
  moveIntoStaging(sourcePath, stagedPath, itemType);
  recordTrashEntry({
    id,
    modId: "",
    originalFileName: basename(sourcePath),
    originalPath: sourcePath,
    stagedPath,
    kind,
    itemType,
    instancePath: resolve(instancePath),
  });
  return true;
}

/**
 * Record a staged trash action. Recorded BEFORE the move so a failed move
 * leaves a phantom entry (staged file missing) that restore self-clears —
 * the reverse (orphan staged file, no record) would leak disk silently.
 * Never throws (history is best-effort).
 */
export function recordTrashEntry(entry: Omit<TrashEntry, "timestamp">): void {
  try {
    const entries = readHistory().filter(
      (e) => e.stagedPath !== entry.stagedPath,
    );
    entries.unshift({ ...entry, timestamp: Date.now() });
    writeHistory(entries);
  } catch (err) {
    console.warn("[TrashHistory] Could not record trash entry:", err);
  }
}

/** History plus how many staged entries are available to restore. */
export function getTrashHistory(): TrashHistoryState {
  const entries = readHistory();
  const restorableCount = entries.filter((e) =>
    pathExists(e.stagedPath),
  ).length;
  return { entries, restorableCount };
}

/**
 * Discard a staged file we cannot restore (name clash, vanished instance):
 * prefer the OS recycle bin, fall back to direct delete. The data either
 * already exists at the destination or is homeless — never silently kept.
 */
function discardStaged(stagedPath: string): void {
  try {
    if (!pathExists(stagedPath)) return;
    if (typeof shell?.trashItem === "function") {
      void shell.trashItem(stagedPath).catch(() => {
        try {
          rmSync(stagedPath, { force: true, recursive: true });
        } catch {
          // Leave it; a later restore attempt retries.
        }
      });
      return;
    }
  } catch {
    // No Electron runtime — fall through to direct delete.
  }
  try {
    rmSync(stagedPath, { force: true, recursive: true });
  } catch {
    // Leave it; a later restore attempt retries.
  }
}

/**
 * Restore trashed mods: move each staged file back into its instance's
 * `\mods\` folder. Clears the history and leaves staging empty:
 * - staged file missing -> drop entry (nothing to restore).
 * - instance root gone or name clash at destination -> discard staged copy,
 *   drop entry without counting.
 */
export function restoreTrashedMods(): RestoreResult {
  const entries = readHistory();
  const remaining: TrashEntry[] = [];
  let restoredCount = 0;

  for (const entry of entries) {
    try {
      if (!pathExists(entry.stagedPath)) {
        continue; // drop phantom entries
      }
      const kind = entry.kind ?? "mod";
      if (kind === "config" || kind === "pack") {
        const instanceRoot = entry.instancePath
          ? resolve(entry.instancePath)
          : "";
        if (
          !instanceRoot ||
          !existsSync(instanceRoot) ||
          !statSync(instanceRoot).isDirectory()
        ) {
          discardStaged(entry.stagedPath);
          continue;
        }
        const target = resolve(entry.originalPath);
        const rel = relative(instanceRoot, target);
        if (!rel || rel === ".." || rel.startsWith(`..${sep}`)) {
          discardStaged(entry.stagedPath);
          continue;
        }
        if (pathExists(target)) {
          discardStaged(entry.stagedPath);
          continue;
        }
        mkdirSync(dirname(target), { recursive: true });
        renameSync(entry.stagedPath, target);
        restoredCount += 1;
        continue;
      }
      const parentDirName = basename(dirname(entry.originalPath)).toLowerCase();
      const instanceRoot =
        parentDirName === MODS_DIR_NAME.toLowerCase() ||
        parentDirName === DISABLED_DIR_NAME.toLowerCase()
          ? dirname(dirname(entry.originalPath))
          : dirname(entry.originalPath);
      if (!existsSync(instanceRoot)) {
        discardStaged(entry.stagedPath); // instance deleted; recycle the copy
        continue;
      }
      const destDir = join(instanceRoot, MODS_DIR_NAME);
      const dest = join(destDir, entry.originalFileName);
      if (isFile(dest)) {
        discardStaged(entry.stagedPath); // user re-added it; recycle the duplicate
        continue;
      }
      mkdirSync(destDir, { recursive: true });
      renameSync(entry.stagedPath, dest);
      restoredCount += 1;
    } catch (err) {
      console.warn(
        `[TrashHistory] Could not restore ${entry.originalFileName}:`,
        err,
      );
      remaining.push(entry);
    }
  }

  try {
    writeHistory(remaining);
  } catch (err) {
    console.warn("[TrashHistory] Could not persist history:", err);
  }
  return { restoredCount };
}
