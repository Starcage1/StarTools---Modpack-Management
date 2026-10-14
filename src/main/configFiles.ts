import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "fs";
import { join, relative, resolve, sep } from "path";
import type { ConfigFileDocument, ConfigTreeEntry } from "../shared/types";

function getConfigRoot(instancePath: string): string {
  if (typeof instancePath !== "string" || instancePath.trim().length === 0) {
    throw new Error("Invalid instance path");
  }
  const root = resolve(instancePath, "config");
  if (
    !existsSync(root) ||
    !lstatSync(root).isDirectory() ||
    lstatSync(root).isSymbolicLink()
  ) {
    throw new Error("This instance does not have a config folder");
  }
  return root;
}

function toRelativePath(root: string, absolutePath: string): string {
  return relative(root, absolutePath).split(sep).join("/");
}

function scanDirectory(root: string, directory: string): ConfigTreeEntry[] {
  const entries: ConfigTreeEntry[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const fullPath = join(directory, entry.name);
    let stats;
    try {
      stats = statSync(fullPath);
    } catch {
      continue;
    }
    if (entry.isDirectory() && stats.isDirectory()) {
      entries.push({
        name: entry.name,
        path: toRelativePath(root, fullPath),
        type: "directory",
        lastModified: stats.mtimeMs,
        children: scanDirectory(root, fullPath),
      });
    } else if (entry.isFile() && stats.isFile()) {
      entries.push({
        name: entry.name,
        path: toRelativePath(root, fullPath),
        type: "file",
        lastModified: stats.mtimeMs,
      });
    }
  }

  return entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

export function scanConfigTree(instancePath: string): ConfigTreeEntry[] {
  const root = getConfigRoot(instancePath);
  return scanDirectory(root, root);
}

export function resolveConfigFile(
  instancePath: string,
  relativePath: string,
): string {
  const root = getConfigRoot(instancePath);
  if (typeof relativePath !== "string" || relativePath.trim().length === 0) {
    throw new Error("Invalid config file path");
  }
  const absolutePath = resolve(root, relativePath);
  const rel = relative(root, absolutePath);
  if (
    !rel ||
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    resolve(root, rel) !== absolutePath
  ) {
    throw new Error("Config file path is outside the config folder");
  }

  let current = root;
  for (const part of rel.split(sep)) {
    current = join(current, part);
    const stats = lstatSync(current);
    if (stats.isSymbolicLink())
      throw new Error("Symbolic links are not supported in config files");
  }
  if (!statSync(absolutePath).isFile())
    throw new Error("Config path is not a file");
  return absolutePath;
}

export function readConfigFile(
  instancePath: string,
  relativePath: string,
): ConfigFileDocument {
  const absolutePath = resolveConfigFile(instancePath, relativePath);
  const content = readFileSync(absolutePath, "utf8");
  if (content.includes("\u0000"))
    throw new Error("This file is not a text config file");
  return {
    name: absolutePath.slice(absolutePath.lastIndexOf(sep) + 1),
    path: relativePath.split(sep).join("/"),
    content,
    lastModified: statSync(absolutePath).mtimeMs,
  };
}

export function saveConfigFile(
  instancePath: string,
  relativePath: string,
  content: string,
): boolean {
  if (typeof content !== "string") throw new Error("Invalid file contents");
  const absolutePath = resolveConfigFile(instancePath, relativePath);
  writeFileSync(absolutePath, content, "utf8");
  return true;
}
