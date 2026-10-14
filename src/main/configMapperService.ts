import { app } from "electron";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "fs";
import { join, relative, resolve, sep } from "path";
import type { ConfigMappingMatch, ConfigModMatch } from "../shared/types";
import { trashPath } from "./trashHistory";

type ManualBindings = Record<string, Record<string, string[]>>;

function userDataPath(): string {
  const override = process.env["MODPACKTOOL_USERDATA"];
  return override || app.getPath("userData");
}

function bindingsPath(): string {
  return join(userDataPath(), "config_bindings.json");
}

function instanceKey(instancePath: string): string {
  const path = resolve(instancePath);
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function normalizeModId(modId: string): string {
  if (typeof modId !== "string" || !/^[a-zA-Z0-9_.-]{1,128}$/.test(modId)) {
    throw new Error("Invalid mod ID");
  }
  return modId.toLowerCase();
}

function readBindings(): ManualBindings {
  try {
    const filePath = bindingsPath();
    if (!existsSync(filePath)) return {};
    const raw: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const clean: ManualBindings = {};
    for (const [instance, value] of Object.entries(raw)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      clean[instance] = {};
      for (const [modId, paths] of Object.entries(value)) {
        if (Array.isArray(paths)) {
          clean[instance][modId] = paths.filter(
            (path): path is string => typeof path === "string",
          );
        }
      }
    }
    return clean;
  } catch {
    return {};
  }
}

function writeBindings(bindings: ManualBindings): void {
  const filePath = bindingsPath();
  mkdirSync(userDataPath(), { recursive: true });
  writeFileSync(filePath, JSON.stringify(bindings, null, 2), "utf8");
}

function configRoot(instancePath: string): string | null {
  if (typeof instancePath !== "string" || !instancePath.trim())
    throw new Error("Invalid instance path");
  const root = resolve(instancePath, "config");
  try {
    const stats = lstatSync(root);
    if (stats.isDirectory() && !stats.isSymbolicLink()) return root;
  } catch {
    return null;
  }
  return null;
}

function safeConfigPath(
  root: string,
  relativePath: string,
): { absolutePath: string; type: "file" | "directory" } {
  if (typeof relativePath !== "string" || !relativePath.trim())
    throw new Error("Invalid config path");
  const absolutePath = resolve(root, relativePath);
  const rel = relative(root, absolutePath);
  if (
    !rel ||
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    resolve(root, rel) !== absolutePath
  ) {
    throw new Error("Config path is outside the config folder");
  }
  let current = root;
  for (const part of rel.split(sep)) {
    current = join(current, part);
    const stats = lstatSync(current);
    if (stats.isSymbolicLink())
      throw new Error("Symbolic links are not supported in config files");
  }
  const stats = statSync(absolutePath);
  if (!stats.isFile() && !stats.isDirectory())
    throw new Error("Config path is not a file or folder");
  return { absolutePath, type: stats.isDirectory() ? "directory" : "file" };
}

function relativePosix(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

export function getMappedConfigFiles(
  instancePath: string,
  modId: string,
): ConfigMappingMatch[] {
  const id = normalizeModId(modId);
  const root = configRoot(instancePath);
  if (!root) return [];
  const filenamePattern = new RegExp(
    `^${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([-_.].+)?\\.(toml|json|cfg|ini)$`,
    "i",
  );
  const matches = new Map<string, ConfigMappingMatch>();

  const scan = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = join(directory, entry.name);
      try {
        statSync(fullPath);
      } catch {
        continue;
      }
      if (
        entry.isDirectory() &&
        directory === root &&
        entry.name.toLowerCase() === id
      ) {
        const filePath = relativePosix(root, fullPath);
        matches.set(filePath.toLowerCase(), {
          filePath,
          type: "directory",
          source: "automatic",
        });
      } else if (entry.isDirectory()) {
        scan(fullPath);
      } else if (entry.isFile() && filenamePattern.test(entry.name)) {
        const filePath = relativePosix(root, fullPath);
        matches.set(filePath.toLowerCase(), {
          filePath,
          type: "file",
          source: "automatic",
        });
      }
    }
  };
  scan(root);

  const saved = readBindings()[instanceKey(instancePath)]?.[id] ?? [];
  for (const filePath of saved) {
    try {
      const item = safeConfigPath(root, filePath);
      const relativePath = relativePosix(root, item.absolutePath);
      matches.set(relativePath.toLowerCase(), {
        filePath: relativePath,
        type: item.type,
        source: "manual",
      });
    } catch {
      // Ignore stale or invalid manual mappings; the next explicit mapping save repairs them.
    }
  }
  return [...matches.values()].sort((a, b) =>
    a.filePath.localeCompare(b.filePath),
  );
}

export function setManualConfigMapping(
  instancePath: string,
  modId: string,
  filePath: string,
): boolean {
  const id = normalizeModId(modId);
  const root = configRoot(instancePath);
  if (!root) throw new Error("This instance does not have a config folder");
  const item = safeConfigPath(root, filePath);
  if (item.type !== "file")
    throw new Error("Manual mappings must point to a config file");
  const path = relativePosix(root, item.absolutePath);
  const bindings = readBindings();
  const key = instanceKey(instancePath);
  bindings[key] ??= {};
  const entries = bindings[key][id] ?? [];
  if (!entries.some((entry) => entry.toLowerCase() === path.toLowerCase()))
    entries.push(path);
  bindings[key][id] = entries;
  writeBindings(bindings);
  return true;
}

export function getConfigModMatches(
  instancePath: string,
  filePath: string,
  modIds: string[],
): ConfigModMatch[] {
  if (!Array.isArray(modIds) || modIds.some((id) => typeof id !== "string")) {
    throw new Error("Invalid mod ID list");
  }
  const root = configRoot(instancePath);
  if (!root) return [];
  const item = safeConfigPath(root, filePath);
  if (item.type !== "file") return [];
  const target = relativePosix(root, item.absolutePath).toLowerCase();
  const ids = [...new Set(modIds.map(normalizeModId))];
  const manual = readBindings()[instanceKey(instancePath)] ?? {};
  const matches = new Map<string, ConfigModMatch>();

  for (const id of ids) {
    const paths = manual[id] ?? [];
    if (
      paths.some((path) => path.replace(/\\/g, "/").toLowerCase() === target)
    ) {
      matches.set(id, { modId: id, source: "manual" });
    }
  }

  const segments = target.split("/");
  const basename = segments[segments.length - 1] ?? "";
  for (const id of ids) {
    const lowerName = basename.toLowerCase();
    const extension = lowerName.slice(lowerName.lastIndexOf("."));
    const stem =
      lowerName.lastIndexOf(".") >= 0
        ? lowerName.slice(0, lowerName.lastIndexOf("."))
        : "";
    const suffix = stem.slice(id.length);
    const fileMatch =
      [".toml", ".json", ".cfg", ".ini"].includes(extension) &&
      (stem === id ||
        (suffix.length > 1 &&
          ["-", "_", "."].includes(suffix[0]) &&
          stem.startsWith(id)));
    const folderMatch = segments[0]?.toLowerCase() === id;
    if ((fileMatch || folderMatch) && !matches.has(id)) {
      matches.set(id, { modId: id, source: "automatic" });
    }
  }

  return [...matches.values()].sort((a, b) =>
    a.source !== b.source
      ? a.source === "manual"
        ? -1
        : 1
      : a.modId.localeCompare(b.modId),
  );
}

export function resetManualConfigMappings(
  instancePath: string,
  filePath: string,
): string[] {
  const root = configRoot(instancePath);
  if (!root) throw new Error("This instance does not have a config folder");
  const item = safeConfigPath(root, filePath);
  if (item.type !== "file") throw new Error("Expected a config file");
  const target = relativePosix(root, item.absolutePath).toLowerCase();
  const bindings = readBindings();
  const key = instanceKey(instancePath);
  const byMod = bindings[key] ?? {};
  const removed: string[] = [];
  for (const [modId, paths] of Object.entries(byMod)) {
    const retained = paths.filter(
      (path) => path.replace(/\\/g, "/").toLowerCase() !== target,
    );
    if (retained.length !== paths.length) removed.push(modId);
    if (retained.length > 0) byMod[modId] = retained;
    else delete byMod[modId];
  }
  if (Object.keys(byMod).length > 0) bindings[key] = byMod;
  else delete bindings[key];
  writeBindings(bindings);
  return removed;
}

export function deleteMappedConfigFiles(
  instancePath: string,
  filePaths: string[],
): { deletedCount: number; errors: string[] } {
  if (
    !Array.isArray(filePaths) ||
    filePaths.some((path) => typeof path !== "string")
  ) {
    throw new Error("Invalid config file list");
  }
  const root = configRoot(instancePath);
  if (!root) throw new Error("This instance does not have a config folder");

  const unique = [
    ...new Set(filePaths.map((path) => path.replace(/[\\/]+/g, sep))),
  ].sort((a, b) => a.length - b.length);
  const candidates = unique.map((path) => ({
    path,
    ...safeConfigPath(root, path),
  }));
  const selected = candidates.filter(
    (candidate) =>
      !candidates.some(
        (parent) =>
          parent !== candidate &&
          parent.type === "directory" &&
          candidate.absolutePath.startsWith(`${parent.absolutePath}${sep}`),
      ),
  );

  const errors: string[] = [];
  let deletedCount = 0;
  for (const item of selected) {
    try {
      trashPath(item.absolutePath, "config", instancePath);
      deletedCount += 1;
    } catch (error) {
      errors.push(
        `${item.path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { deletedCount, errors };
}
