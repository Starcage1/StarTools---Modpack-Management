import { app } from "electron";
import { createHash } from "crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "fs";
import { basename, join, resolve } from "path";
import { getInstanceInfo } from "./instanceInfo";
import type { ManagedInstance } from "../shared/types";

export const MAX_MANAGED_INSTANCES = 5;

function registryPath(): string {
  return join(app.getPath("userData"), "managed_instances.json");
}

export function validateInstanceRoot(instancePath: string): string {
  if (typeof instancePath !== "string" || instancePath.trim().length === 0) {
    throw new Error("Invalid instance folder path");
  }
  const root = resolve(instancePath);
  let stats;
  try {
    stats = lstatSync(root);
  } catch {
    throw new Error("The selected instance folder does not exist");
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("The selected instance path must be a regular folder");
  }
  return root;
}

export function getManagedInstanceId(instancePath: string): string {
  const root = validateInstanceRoot(instancePath);
  const identity = process.platform === "win32" ? root.toLowerCase() : root;
  return createHash("sha256").update(identity).digest("hex").slice(0, 24);
}

function safeJarCount(folder: string): number {
  try {
    const entries = readdirSync(folder, { withFileTypes: true });
    return entries.filter(
      (entry) =>
        entry.isFile() &&
        !entry.isSymbolicLink() &&
        entry.name.toLowerCase().endsWith(".jar"),
    ).length;
  } catch {
    return 0;
  }
}

function minecraftVersionFromFolder(root: string): string | null {
  const versionsFolder = join(root, "minecraft", "versions");
  try {
    const versions = readdirSync(versionsFolder, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() && /^\d+\.\d+(?:\.\d+)?$/.test(entry.name),
      )
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return versions.at(-1) ?? null;
  } catch {
    return null;
  }
}

function readRegistry(): ManagedInstance[] {
  try {
    const path = registryPath();
    if (!existsSync(path)) return [];
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (entry): entry is ManagedInstance =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as ManagedInstance).id === "string" &&
          typeof (entry as ManagedInstance).path === "string" &&
          typeof (entry as ManagedInstance).name === "string",
      )
      .slice(0, MAX_MANAGED_INSTANCES)
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        path: entry.path,
        loader: entry.loader || "Unknown",
        mcVersion: entry.mcVersion || "Unknown",
        lastOpened: Number.isFinite(entry.lastOpened) ? entry.lastOpened : 0,
        modCount: Number.isFinite(entry.modCount) ? entry.modCount : 0,
      }))
      .sort((a, b) => b.lastOpened - a.lastOpened);
  } catch {
    return [];
  }
}

function writeRegistry(instances: ManagedInstance[]): void {
  const filePath = registryPath();
  mkdirSync(app.getPath("userData"), { recursive: true });
  writeFileSync(filePath, JSON.stringify(instances, null, 2), "utf8");
}

export function listManagedInstances(): ManagedInstance[] {
  return readRegistry();
}

/** Save or refresh metadata only; this never creates, moves, or removes instance files. */
export function saveManagedInstance(instancePath: string): ManagedInstance {
  const root = validateInstanceRoot(instancePath);
  const id = getManagedInstanceId(root);
  const instances = readRegistry();
  const existingIndex = instances.findIndex((entry) => entry.id === id);
  if (existingIndex < 0 && instances.length >= MAX_MANAGED_INSTANCES) {
    throw new Error(`Maximum ${MAX_MANAGED_INSTANCES} instances tracked`);
  }

  const info = getInstanceInfo(root);
  const instance: ManagedInstance = {
    id,
    name: info.instanceName || basename(root),
    path: root,
    loader: info.modLoader || "Unknown",
    mcVersion:
      info.minecraftVersion !== "Unknown"
        ? info.minecraftVersion
        : (minecraftVersionFromFolder(root) ?? "Unknown"),
    lastOpened: Date.now(),
    modCount:
      safeJarCount(join(root, "mods")) +
      safeJarCount(join(root, "disabledmods")),
  };

  if (existingIndex >= 0) instances[existingIndex] = instance;
  else instances.push(instance);
  writeRegistry(instances);
  return instance;
}

/** Remove one metadata record. The instance directory and its contents are untouched. */
export function untrackManagedInstance(id: string): boolean {
  if (typeof id !== "string" || !/^[a-f0-9]{24}$/i.test(id)) {
    throw new Error("Invalid tracked instance id");
  }
  const instances = readRegistry();
  const next = instances.filter((entry) => entry.id !== id);
  if (next.length === instances.length) return false;
  writeRegistry(next);
  return true;
}
