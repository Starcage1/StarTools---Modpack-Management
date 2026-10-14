import AdmZip from "adm-zip";
import { app } from "electron";
import { randomUUID } from "crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "path";
import {
  getManagedInstanceId,
  validateInstanceRoot,
} from "../managedInstances";
import type {
  SnapshotEntry,
  SnapshotModState,
  SnapshotRollbackResult,
} from "../../shared/types";

const MAX_CONFIG_BYTES = 200 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 20_000;

function snapshotsRoot(): string {
  return join(app.getPath("userData"), "snapshots");
}

function snapshotDirectory(instanceId: string): string {
  if (!/^[a-f0-9]{24}$/i.test(instanceId)) {
    throw new Error("Invalid instance id for snapshots");
  }
  const root = snapshotsRoot();
  if (existsSync(root)) {
    const stats = lstatSync(root);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error("Snapshot storage path is not a safe folder");
    }
  }
  const folder = join(root, instanceId);
  if (existsSync(folder)) {
    const stats = lstatSync(folder);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error("This instance's snapshot folder is not safe");
    }
  }
  return folder;
}

function manifestPath(instanceId: string): string {
  return join(snapshotDirectory(instanceId), "snapshots.json");
}

function writeManifest(instanceId: string, entries: SnapshotEntry[]): void {
  const path = manifestPath(instanceId);
  if (existsSync(path)) {
    const stats = lstatSync(path);
    if (!stats.isFile() || stats.isSymbolicLink())
      throw new Error("Snapshot manifest path is not a regular file");
  }
  writeFileSync(path, JSON.stringify(entries, null, 2), "utf8");
}

function readManifest(instanceId: string): SnapshotEntry[] {
  const path = manifestPath(instanceId);
  if (!existsSync(path)) return [];
  const stats = lstatSync(path);
  if (!stats.isFile() || stats.isSymbolicLink())
    throw new Error("Snapshot manifest path is not a regular file");
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("Snapshot manifest is invalid");
  return parsed.filter(
    (entry): entry is SnapshotEntry =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as SnapshotEntry).id === "string" &&
      typeof (entry as SnapshotEntry).name === "string" &&
      Array.isArray((entry as SnapshotEntry).modState) &&
      typeof (entry as SnapshotEntry).configArchive === "string",
  );
}

function validateManagedSnapshotId(id: string): void {
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id)) {
    throw new Error("Invalid snapshot id");
  }
}

function listJarState(instanceRoot: string): SnapshotModState[] {
  const result: SnapshotModState[] = [];
  for (const [directory, enabled] of [
    ["mods", true],
    ["disabledmods", false],
  ] as const) {
    const folder = join(instanceRoot, directory);
    try {
      const stats = lstatSync(folder);
      if (!stats.isDirectory() || stats.isSymbolicLink()) continue;
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        if (
          !entry.isFile() ||
          entry.isSymbolicLink() ||
          !entry.name.toLowerCase().endsWith(".jar")
        ) {
          continue;
        }
        result.push({ fileName: entry.name, enabled });
      }
    } catch {
      // Absent mod folders are treated as empty.
    }
  }
  return result.sort((a, b) => a.fileName.localeCompare(b.fileName));
}

function addConfigFilesToZip(
  zip: AdmZip,
  configRoot: string,
  current: string,
  budget: { bytes: number; entries: number },
): void {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const fullPath = join(current, entry.name);
    if (entry.isDirectory()) {
      addConfigFilesToZip(zip, configRoot, fullPath, budget);
      continue;
    }
    if (!entry.isFile()) continue;
    const stats = lstatSync(fullPath);
    if (stats.isSymbolicLink() || !stats.isFile()) continue;
    budget.bytes += stats.size;
    budget.entries += 1;
    if (budget.bytes > MAX_CONFIG_BYTES || budget.entries > MAX_ZIP_ENTRIES) {
      throw new Error("Config folder is too large to snapshot safely");
    }
    const entryName = relative(configRoot, fullPath).split(sep).join("/");
    zip.addFile(entryName, readFileSync(fullPath));
  }
}

export function listSnapshots(instancePath: string): SnapshotEntry[] {
  const root = validateInstanceRoot(instancePath);
  const instanceId = getManagedInstanceId(root);
  try {
    return readManifest(instanceId).sort((a, b) => b.timestamp - a.timestamp);
  } catch {
    throw new Error("Could not read this instance's snapshot list");
  }
}

export function createSnapshot(
  instancePath: string,
  name: string,
): SnapshotEntry {
  const root = validateInstanceRoot(instancePath);
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error("Enter a name for this snapshot");
  }
  const instanceId = getManagedInstanceId(root);
  const folder = snapshotDirectory(instanceId);
  const id = randomUUID();
  const configRoot = join(root, "config");
  const zip = new AdmZip();
  const configStats = existsSync(configRoot) ? lstatSync(configRoot) : null;
  if (
    configStats &&
    (!configStats.isDirectory() || configStats.isSymbolicLink())
  ) {
    throw new Error("The instance config path is not a safe regular folder");
  }
  if (configStats) {
    addConfigFilesToZip(zip, configRoot, configRoot, { bytes: 0, entries: 0 });
  }

  mkdirSync(folder, { recursive: true });
  const configArchive = `${id}.zip`;
  const archivePath = join(folder, configArchive);
  zip.writeZip(archivePath);
  const entry: SnapshotEntry = {
    id,
    instanceId,
    name: name.trim().slice(0, 80),
    timestamp: Date.now(),
    modState: listJarState(root),
    configArchive,
  };
  const entries = readManifest(instanceId);
  entries.push(entry);
  writeManifest(instanceId, entries);
  return entry;
}

interface ConfigWrite {
  filePath: string;
  content: Buffer;
}

function preflightConfigTarget(configRoot: string, filePath: string): void {
  const relativePath = relative(configRoot, filePath);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(
      "Snapshot contains a config path outside the config folder",
    );
  }
  let current = configRoot;
  const parts = relativePath.split(sep);
  for (const part of parts.slice(0, -1)) {
    current = join(current, part);
    if (!existsSync(current)) continue;
    const stats = lstatSync(current);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(
        "A config path is blocked by a non-folder or symbolic link",
      );
    }
  }
  if (existsSync(filePath)) {
    const stats = lstatSync(filePath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error("A snapshot config file would overwrite an unsafe path");
    }
  }
}

function physicalJars(
  instanceRoot: string,
): Map<string, { fileName: string; enabled: boolean }> {
  const files = new Map<string, { fileName: string; enabled: boolean }>();
  for (const [directory, enabled] of [
    ["mods", true],
    ["disabledmods", false],
  ] as const) {
    const folder = join(instanceRoot, directory);
    try {
      const folderStats = lstatSync(folder);
      if (!folderStats.isDirectory() || folderStats.isSymbolicLink()) {
        throw new Error(`The ${directory} folder is not safe to modify`);
      }
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        if (
          !entry.isFile() ||
          entry.isSymbolicLink() ||
          !entry.name.toLowerCase().endsWith(".jar")
        )
          continue;
        const key = entry.name.toLowerCase();
        if (files.has(key)) {
          throw new Error(
            `Duplicate jar exists in mods and disabledmods: ${entry.name}`,
          );
        }
        files.set(key, { fileName: entry.name, enabled });
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("The "))
        throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return files;
}

export function rollbackSnapshot(
  instancePath: string,
  snapshotId: string,
): SnapshotRollbackResult {
  const root = validateInstanceRoot(instancePath);
  validateManagedSnapshotId(snapshotId);
  const instanceId = getManagedInstanceId(root);
  const entry = readManifest(instanceId).find(
    (snapshot) => snapshot.id === snapshotId,
  );
  if (!entry) throw new Error("Snapshot not found for this instance");
  if (entry.configArchive !== `${entry.id}.zip`) {
    throw new Error("Snapshot config archive reference is invalid");
  }
  const archivePath = join(snapshotDirectory(instanceId), entry.configArchive);
  if (!existsSync(archivePath) || !lstatSync(archivePath).isFile()) {
    throw new Error("Snapshot config archive is missing");
  }

  const configRoot = join(root, "config");
  if (existsSync(configRoot)) {
    const stats = lstatSync(configRoot);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error("The instance config path is not a safe regular folder");
    }
  }
  const archive = new AdmZip(archivePath);
  const configWrites: ConfigWrite[] = [];
  let uncompressedBytes = 0;
  const zipEntries = archive.getEntries();
  if (zipEntries.length > MAX_ZIP_ENTRIES) {
    throw new Error("Snapshot archive contains too many files");
  }
  for (const zipEntry of zipEntries) {
    if (zipEntry.isDirectory) continue;
    const normalized = zipEntry.entryName.replace(/\\/g, "/");
    const parts = normalized.split("/");
    if (
      !normalized ||
      normalized.startsWith("/") ||
      /^[a-z]:/i.test(normalized) ||
      parts.some((part) => !part || part === "." || part === "..")
    ) {
      throw new Error("Snapshot archive contains an unsafe file path");
    }
    uncompressedBytes += Number(zipEntry.header.size) || 0;
    if (uncompressedBytes > MAX_CONFIG_BYTES) {
      throw new Error("Snapshot archive expands beyond the safe size limit");
    }
    const filePath = resolve(configRoot, ...parts);
    preflightConfigTarget(configRoot, filePath);
    const content = zipEntry.getData();
    if (content.length > MAX_CONFIG_BYTES) {
      throw new Error("Snapshot archive expands beyond the safe size limit");
    }
    configWrites.push({ filePath, content });
  }

  const currentJars = physicalJars(root);
  const plannedMoves: {
    source: string;
    destination: string;
    enabled: boolean;
  }[] = [];
  const seenSnapshotNames = new Set<string>();
  for (const item of entry.modState) {
    if (
      typeof item.fileName !== "string" ||
      basename(item.fileName) !== item.fileName ||
      !item.fileName.toLowerCase().endsWith(".jar") ||
      typeof item.enabled !== "boolean"
    ) {
      throw new Error("Snapshot mod state contains an invalid file entry");
    }
    const key = item.fileName.toLowerCase();
    if (seenSnapshotNames.has(key))
      throw new Error("Snapshot contains duplicate mod entries");
    seenSnapshotNames.add(key);
    const current = currentJars.get(key);
    if (!current || current.enabled === item.enabled) continue;
    const sourceDirectory = current.enabled ? "mods" : "disabledmods";
    const destinationDirectory = item.enabled ? "mods" : "disabledmods";
    const source = join(root, sourceDirectory, current.fileName);
    const destinationFolder = join(root, destinationDirectory);
    if (existsSync(destinationFolder)) {
      const stats = lstatSync(destinationFolder);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new Error(
          `The ${destinationDirectory} folder is not safe to modify`,
        );
      }
    }
    const destination = join(destinationFolder, current.fileName);
    if (existsSync(destination)) {
      throw new Error(
        `Rollback would collide with an existing jar: ${current.fileName}`,
      );
    }
    plannedMoves.push({ source, destination, enabled: item.enabled });
  }

  let movedMods = 0;
  for (const move of plannedMoves) {
    mkdirSync(dirname(move.destination), { recursive: true });
    renameSync(move.source, move.destination);
    movedMods += 1;
  }
  if (configWrites.length > 0 && !existsSync(configRoot)) {
    mkdirSync(configRoot, { recursive: true });
  }
  for (const write of configWrites) {
    mkdirSync(dirname(write.filePath), { recursive: true });
    const temporaryPath = `${write.filePath}.${randomUUID()}.snapshot-tmp`;
    try {
      writeFileSync(temporaryPath, write.content, { flag: "wx" });
      // Replace the directory entry atomically, avoiding writes through hard links.
      renameSync(temporaryPath, write.filePath);
    } catch (error) {
      if (existsSync(temporaryPath) && lstatSync(temporaryPath).isFile()) {
        unlinkSync(temporaryPath);
      }
      throw error;
    }
  }
  return { movedMods, restoredConfigFiles: configWrites.length };
}

export function deleteSnapshot(
  instancePath: string,
  snapshotId: string,
): boolean {
  const root = validateInstanceRoot(instancePath);
  validateManagedSnapshotId(snapshotId);
  const instanceId = getManagedInstanceId(root);
  const entries = readManifest(instanceId);
  const entry = entries.find((snapshot) => snapshot.id === snapshotId);
  if (!entry) return false;
  if (entry.configArchive !== `${entry.id}.zip`) {
    throw new Error("Snapshot config archive reference is invalid");
  }
  const zipPath = join(snapshotDirectory(instanceId), entry.configArchive);
  writeManifest(
    instanceId,
    entries.filter((snapshot) => snapshot.id !== snapshotId),
  );
  if (existsSync(zipPath) && lstatSync(zipPath).isFile()) unlinkSync(zipPath);
  return true;
}
