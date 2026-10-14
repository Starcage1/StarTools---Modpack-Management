import AdmZip from "adm-zip";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "fs";
import { extname, join, relative, resolve, sep } from "path";
import type { PackCategory, PackItem, PacksScanResult } from "../shared/types";
import { trashPath } from "./trashHistory";

const CATEGORIES: PackCategory[] = [
  "shaderpacks",
  "resourcepacks",
  "datapacks",
];
const TEXT_EXTENSIONS = new Set([
  ".toml",
  ".cfg",
  ".ini",
  ".json",
  ".json5",
  ".yaml",
  ".yml",
  ".properties",
  ".mcmeta",
  ".txt",
  ".glsl",
  ".vsh",
  ".fsh",
  ".lang",
  ".properties",
]);

function assertCategory(category: string): asserts category is PackCategory {
  if (!CATEGORIES.includes(category as PackCategory))
    throw new Error("Invalid pack category");
}

function instanceRoot(instancePath: string): string {
  if (typeof instancePath !== "string" || !instancePath.trim())
    throw new Error("Invalid instance path");
  return resolve(instancePath);
}

function relativePosix(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function safeRootPath(
  instancePath: string,
  category: PackCategory,
  relativePath: string,
): string {
  const root = instanceRoot(instancePath);
  if (typeof relativePath !== "string" || !relativePath.trim())
    throw new Error("Invalid pack path");
  const absolutePath = resolve(root, relativePath);
  const rel = relative(root, absolutePath);
  const activePrefix = `${category}${sep}`;
  const disabledPrefix = `disabledpacks${sep}${category}${sep}`;
  if (
    !rel ||
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    (!rel.startsWith(activePrefix) && !rel.startsWith(disabledPrefix))
  ) {
    throw new Error("Pack path is outside its pack folder");
  }
  let current = root;
  for (const part of rel.split(sep)) {
    current = join(current, part);
    const stats = lstatSync(current);
    if (stats.isSymbolicLink())
      throw new Error("Symbolic links are not supported in packs");
  }
  return absolutePath;
}

function recursiveSize(path: string): number {
  const stats = statSync(path);
  if (stats.isFile()) return stats.size;
  return readdirSync(path, { withFileTypes: true }).reduce((total, entry) => {
    if (entry.isSymbolicLink()) return total;
    return total + recursiveSize(join(path, entry.name));
  }, 0);
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value))
    return value.map(textValue).filter(Boolean).join("");
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj["text"] === "string") return obj["text"];
    if (Array.isArray(obj["extra"])) return textValue(obj["extra"]);
    if (typeof obj["translate"] === "string") return obj["translate"];
  }
  return "";
}

function decodeMetadata(content: string): {
  description: string;
  packFormat: number | null;
} {
  try {
    const root = JSON.parse(content) as {
      pack?: { description?: unknown; pack_format?: unknown };
    };
    const pack = root.pack;
    return {
      description: textValue(pack?.description),
      packFormat:
        typeof pack?.pack_format === "number" ? pack.pack_format : null,
    };
  } catch {
    return { description: "", packFormat: null };
  }
}

function metadataFor(
  path: string,
  isDirectory: boolean,
): {
  description: string;
  packFormat: number | null;
  iconDataUri: string | null;
} {
  try {
    let metadata: string | null = null;
    let icon: Buffer | null = null;
    if (isDirectory) {
      const metadataPath = join(path, "pack.mcmeta");
      const iconPath = join(path, "pack.png");
      if (existsSync(metadataPath) && statSync(metadataPath).isFile())
        metadata = readFileSync(metadataPath, "utf8");
      if (existsSync(iconPath) && statSync(iconPath).isFile())
        icon = readFileSync(iconPath);
    } else if (extname(path).toLowerCase() === ".zip") {
      const archive = new AdmZip(path);
      const metadataEntry = archive.getEntry("pack.mcmeta");
      const iconEntry = archive.getEntry("pack.png");
      if (metadataEntry && !metadataEntry.isDirectory)
        metadata = metadataEntry.getData().toString("utf8");
      if (iconEntry && !iconEntry.isDirectory) icon = iconEntry.getData();
    }
    const decoded = metadata
      ? decodeMetadata(metadata)
      : { description: "", packFormat: null };
    return {
      ...decoded,
      iconDataUri: icon
        ? `data:image/png;base64,${icon.toString("base64")}`
        : null,
    };
  } catch {
    return { description: "", packFormat: null, iconDataUri: null };
  }
}

function createPackItem(
  instance: string,
  category: PackCategory,
  path: string,
  enabled: boolean,
): PackItem {
  const stats = statSync(path);
  const isDirectory = stats.isDirectory();
  const name = isDirectory
    ? (path.split(/[\\/]/).pop() ?? path)
    : (path.split(/[\\/]/).pop() ?? path);
  const metadata = metadataFor(path, isDirectory);
  return {
    name,
    path: relativePosix(instance, path),
    category,
    type: isDirectory ? "directory" : "file",
    enabled,
    description: metadata.description,
    packFormat: metadata.packFormat,
    size: recursiveSize(path),
    lastModified: stats.mtimeMs,
    iconDataUri: metadata.iconDataUri,
  };
}

function scanFolder(
  instance: string,
  category: PackCategory,
  relativeFolder: string,
  enabled: boolean,
): PackItem[] {
  const folder = resolve(instance, relativeFolder);
  if (
    !existsSync(folder) ||
    !lstatSync(folder).isDirectory() ||
    lstatSync(folder).isSymbolicLink()
  )
    return [];
  const results: PackItem[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const path = join(folder, entry.name);
    try {
      if (entry.isDirectory())
        results.push(createPackItem(instance, category, path, enabled));
      else if (
        entry.isFile() &&
        (extname(entry.name).toLowerCase() === ".zip" ||
          TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase()))
      ) {
        results.push(createPackItem(instance, category, path, enabled));
      }
    } catch {
      // Ignore unreadable entries; keep other packs available.
    }
  }
  return results;
}

export function scanAllPacks(instancePath: string): PacksScanResult {
  const root = instanceRoot(instancePath);
  return {
    shaderpacks: [
      ...scanFolder(root, "shaderpacks", "shaderpacks", true),
      ...scanFolder(root, "shaderpacks", "disabledpacks/shaderpacks", false),
    ],
    resourcepacks: [
      ...scanFolder(root, "resourcepacks", "resourcepacks", true),
      ...scanFolder(
        root,
        "resourcepacks",
        "disabledpacks/resourcepacks",
        false,
      ),
    ],
    datapacks: [
      ...scanFolder(root, "datapacks", "datapacks", true),
      ...scanFolder(root, "datapacks", "disabledpacks/datapacks", false),
    ],
  };
}

export function setPackEnabled(
  instancePath: string,
  category: PackCategory,
  packPath: string,
  enabled: boolean,
): boolean {
  assertCategory(category);
  const root = instanceRoot(instancePath);
  const source = safeRootPath(root, category, packPath);
  const rel = relative(root, source);
  const isDisabled = rel.startsWith(`disabledpacks${sep}${category}${sep}`);
  if (enabled === !isDisabled) return true;
  const destination = isDisabled
    ? resolve(
        root,
        category,
        rel.slice(`disabledpacks${sep}${category}${sep}`.length),
      )
    : resolve(
        root,
        "disabledpacks",
        category,
        rel.slice(`${category}${sep}`.length),
      );
  if (existsSync(destination))
    throw new Error(
      `A pack named ${packPath} already exists at the destination`,
    );
  mkdirSync(resolve(destination, ".."), { recursive: true });
  renameSync(source, destination);
  return true;
}

export function trashPack(
  instancePath: string,
  category: PackCategory,
  packPath: string,
): boolean {
  assertCategory(category);
  const root = instanceRoot(instancePath);
  const absolutePath = safeRootPath(root, category, packPath);
  trashPath(absolutePath, "pack", root);
  return true;
}

export function resolvePackItemPath(
  instancePath: string,
  category: PackCategory,
  packPath: string,
): string {
  assertCategory(category);
  return safeRootPath(instanceRoot(instancePath), category, packPath);
}

function isEditableText(path: string): boolean {
  return TEXT_EXTENSIONS.has(extname(path).toLowerCase());
}

export function listPackTextFiles(
  instancePath: string,
  category: PackCategory,
  packPath: string,
): string[] {
  assertCategory(category);
  const root = instanceRoot(instancePath);
  const pack = safeRootPath(root, category, packPath);
  const stats = statSync(pack);
  if (stats.isFile()) return isEditableText(pack) ? [""] : [];
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const file = join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && isEditableText(file))
        files.push(relativePosix(pack, file));
    }
  };
  walk(pack);
  return files.sort((a, b) => a.localeCompare(b));
}

function resolvePackTextFile(
  instancePath: string,
  category: PackCategory,
  packPath: string,
  relativeFilePath: string,
): string {
  const root = instanceRoot(instancePath);
  const pack = safeRootPath(root, category, packPath);
  const packStats = statSync(pack);
  const target = relativeFilePath ? resolve(pack, relativeFilePath) : pack;
  if (packStats.isDirectory()) {
    const rel = relative(pack, target);
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`))
      throw new Error("File path is outside the pack folder");
  } else if (relativeFilePath) {
    throw new Error("A file pack cannot contain child files");
  }
  if (!isEditableText(target))
    throw new Error("This file type is not editable");
  let current = packStats.isDirectory() ? pack : resolve(root);
  for (const part of relative(current, target).split(sep)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink())
      throw new Error("Symbolic links are not supported in packs");
  }
  if (!statSync(target).isFile()) throw new Error("Pack path is not a file");
  return target;
}

export function readPackTextFile(
  instancePath: string,
  category: PackCategory,
  packPath: string,
  relativeFilePath: string,
): { content: string; name: string } {
  const target = resolvePackTextFile(
    instancePath,
    category,
    packPath,
    relativeFilePath,
  );
  const content = readFileSync(target, "utf8");
  if (content.includes("\u0000"))
    throw new Error("This file is not a text file");
  return { content, name: target.split(/[\\/]/).pop() ?? target };
}

export function savePackTextFile(
  instancePath: string,
  category: PackCategory,
  packPath: string,
  relativeFilePath: string,
  content: string,
): boolean {
  if (typeof content !== "string") throw new Error("Invalid file contents");
  const target = resolvePackTextFile(
    instancePath,
    category,
    packPath,
    relativeFilePath,
  );
  writeFileSync(target, content, "utf8");
  return true;
}
