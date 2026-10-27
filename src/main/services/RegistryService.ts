import { createHash } from "crypto";
import AdmZip from "adm-zip";
import { app } from "electron";
import { parse as parseTomlDocument } from "smol-toml";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { basename, join, resolve } from "path";
import { getInstanceInfo } from "../instanceInfo";
import {
  getManagedInstanceId,
  validateInstanceRoot,
} from "../managedInstances";
import type {
  RegistryAssetRequest,
  RegistryAssetResult,
  RegistryEntry,
  RegistryExportAssetRequest,
  RegistryKind,
  RegistryScanProgress,
  RegistryScanResult,
} from "../../shared/types";

const CACHE_SCHEMA = 5;
const REGISTRY_FILE_PATTERNS: Array<{
  kind: RegistryKind;
  pattern: RegExp;
  translation: string;
}> = [
  {
    kind: "item",
    pattern: /^assets\/([a-z0-9_.-]+)\/models\/item\/([a-z0-9_.-]+)\.json$/i,
    translation: "item",
  },
  {
    kind: "block",
    pattern: /^assets\/([a-z0-9_.-]+)\/blockstates\/([a-z0-9_.-]+)\.json$/i,
    translation: "block",
  },
  {
    kind: "biome",
    pattern: /^data\/([a-z0-9_.-]+)\/worldgen\/biome\/([a-z0-9_.-]+)\.json$/i,
    translation: "biome",
  },
  {
    kind: "dimension",
    pattern: /^data\/([a-z0-9_.-]+)\/dimension\/([a-z0-9_.-]+)\.json$/i,
    translation: "dimension",
  },
];

interface RegistryCacheFile {
  schema: number;
  instancePath: string;
  minecraftVersion: string;
  items: RegistryEntry[];
  blocks: RegistryEntry[];
  biomes: RegistryEntry[];
  dimensions: RegistryEntry[];
  mobs: RegistryEntry[];
}

const VANILLA_DIMENSIONS: Array<[string, string]> = [
  ["minecraft:overworld", "The Overworld"],
  ["minecraft:the_nether", "The Nether"],
  ["minecraft:the_end", "The End"],
];

const VANILLA_MOBS: Array<[string, string]> = [
  ["allay", "Allay"],
  ["armadillo", "Armadillo"],
  ["axolotl", "Axolotl"],
  ["bat", "Bat"],
  ["bee", "Bee"],
  ["blaze", "Blaze"],
  ["bogged", "Bogged"],
  ["breeze", "Breeze"],
  ["camel", "Camel"],
  ["cat", "Cat"],
  ["cave_spider", "Cave Spider"],
  ["chicken", "Chicken"],
  ["cod", "Cod"],
  ["cow", "Cow"],
  ["creeper", "Creeper"],
  ["dolphin", "Dolphin"],
  ["donkey", "Donkey"],
  ["drowned", "Drowned"],
  ["elder_guardian", "Elder Guardian"],
  ["ender_dragon", "Ender Dragon"],
  ["enderman", "Enderman"],
  ["endermite", "Endermite"],
  ["evoker", "Evoker"],
  ["fox", "Fox"],
  ["frog", "Frog"],
  ["ghast", "Ghast"],
  ["giant", "Giant"],
  ["glow_squid", "Glow Squid"],
  ["goat", "Goat"],
  ["guardian", "Guardian"],
  ["hoglin", "Hoglin"],
  ["horse", "Horse"],
  ["husk", "Husk"],
  ["iron_golem", "Iron Golem"],
  ["llama", "Llama"],
  ["magma_cube", "Magma Cube"],
  ["mooshroom", "Mooshroom"],
  ["mule", "Mule"],
  ["ocelot", "Ocelot"],
  ["panda", "Panda"],
  ["parrot", "Parrot"],
  ["phantom", "Phantom"],
  ["pig", "Pig"],
  ["piglin", "Piglin"],
  ["piglin_brute", "Piglin Brute"],
  ["pillager", "Pillager"],
  ["polar_bear", "Polar Bear"],
  ["pufferfish", "Pufferfish"],
  ["rabbit", "Rabbit"],
  ["ravager", "Ravager"],
  ["salmon", "Salmon"],
  ["sheep", "Sheep"],
  ["shulker", "Shulker"],
  ["silverfish", "Silverfish"],
  ["skeleton", "Skeleton"],
  ["skeleton_horse", "Skeleton Horse"],
  ["slime", "Slime"],
  ["sniffer", "Sniffer"],
  ["snow_golem", "Snow Golem"],
  ["spider", "Spider"],
  ["squid", "Squid"],
  ["stray", "Stray"],
  ["strider", "Strider"],
  ["tadpole", "Tadpole"],
  ["trader_llama", "Trader Llama"],
  ["tropical_fish", "Tropical Fish"],
  ["turtle", "Turtle"],
  ["vex", "Vex"],
  ["villager", "Villager"],
  ["vindicator", "Vindicator"],
  ["wandering_trader", "Wandering Trader"],
  ["warden", "Warden"],
  ["witch", "Witch"],
  ["wither", "Wither"],
  ["wolf", "Wolf"],
  ["zoglin", "Zoglin"],
  ["zombie", "Zombie"],
  ["zombie_horse", "Zombie Horse"],
  ["zombie_villager", "Zombie Villager"],
  ["zombified_piglin", "Zombified Piglin"],
].map(([id, name]) => [`minecraft:${id}`, name]);

interface ModJar {
  name: string;
  path: string;
  modifiedAt: number;
  size: number;
}

function cacheRoot(): string {
  return join(app.getPath("userData"), "cache", "registries");
}

function enabledModJars(instanceRoot: string): ModJar[] {
  const modsPath = join(instanceRoot, "mods");
  const jars: ModJar[] = [];
  for (const entry of readdirSync(modsPath, { withFileTypes: true })) {
    if (
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      !entry.name.toLowerCase().endsWith(".jar")
    ) {
      continue;
    }
    const path = join(modsPath, entry.name);
    try {
      const stats = lstatSync(path);
      if (stats.isFile() && !stats.isSymbolicLink()) {
        jars.push({
          name: entry.name,
          path,
          modifiedAt: stats.mtimeMs,
          size: stats.size,
        });
      }
    } catch {
      // A mod may be removed while scanning; skip it safely.
    }
  }
  return jars.sort((a, b) => a.name.localeCompare(b.name));
}

function vanillaJarPath(instanceRoot: string, version: string): string | null {
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(version)) return null;
  const candidates = [
    join(instanceRoot, "minecraft", "versions", version, `${version}.jar`),
    join(instanceRoot, "versions", version, `${version}.jar`),
    join(
      app.getPath("appData"),
      ".minecraft",
      "versions",
      version,
      `${version}.jar`,
    ),
  ];
  for (const candidate of candidates) {
    try {
      const stats = lstatSync(candidate);
      if (stats.isFile() && !stats.isSymbolicLink()) return candidate;
    } catch {
      // Keep searching other launcher layouts.
    }
  }
  return null;
}

function makeCacheKey(
  jars: ModJar[],
  version: string,
  vanillaPath: string | null,
): string {
  const hash = createHash("sha256");
  hash.update(`minecraft:${version}\n`);
  for (const jar of jars) {
    hash.update(`${jar.name}\0${jar.modifiedAt}\0${jar.size}\n`);
  }
  if (vanillaPath) {
    try {
      const stats = statSync(vanillaPath);
      hash.update(
        `vanilla:${basename(vanillaPath)}\0${stats.mtimeMs}\0${stats.size}`,
      );
    } catch {
      // Vanilla jar may change while preparing the key.
    }
  }
  return hash.digest("hex").slice(0, 24);
}

function safeDisplayName(id: string): string {
  const part = id.split(":").at(-1) ?? id;
  return part
    .replace(/[_.-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((word) => (word.length ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

function resolvedDisplayName(
  translation: unknown,
  id: string,
  kind: RegistryKind,
  namespace: string,
): string {
  const value = typeof translation === "string" ? translation.trim() : "";
  const hasFormatSpecifier = /%(?:\d+\$)?[-+#0 ]*\d*(?:\.\d+)?[sdif]/i.test(
    value,
  );
  const isRawTranslationKey = /^(?:item|block|biome|dimension|entity)\./i.test(
    value,
  );
  let displayName =
    !value || hasFormatSpecifier || isRawTranslationKey
      ? safeDisplayName(id)
      : value;

  if (
    kind === "item" &&
    namespace !== "minecraft" &&
    displayName.toLocaleLowerCase() === "banner pattern"
  ) {
    const idPath = id.split(":").at(-1) ?? id;
    const variant = idPath
      .replace(/(?:^|[_-])banner[_-]?pattern(?:$|[_-])/gi, " ")
      .replace(/[_.-]+/g, " ")
      .trim()
      .split(/\s+/)
      .map((word) => (word ? word[0]!.toUpperCase() + word.slice(1) : word))
      .join(" ");
    if (variant) displayName = `${displayName} (${variant})`;
  }
  return displayName;
}

function readEntryText(entry: { getData(): Buffer }): string | null {
  try {
    return entry.getData().toString("utf8");
  } catch {
    return null;
  }
}

function verifiedModIds(zip: AdmZip): Set<string> {
  const ids = new Set<string>();
  try {
    const fabricEntry = zip.getEntry("fabric.mod.json");
    if (fabricEntry && !fabricEntry.isDirectory) {
      const metadata: unknown = JSON.parse(
        fabricEntry.getData().toString("utf8"),
      );
      if (
        typeof metadata === "object" &&
        metadata !== null &&
        "id" in metadata &&
        typeof metadata.id === "string" &&
        /^[a-z0-9_.-]+$/i.test(metadata.id)
      ) {
        ids.add(metadata.id.toLowerCase());
      }
    }
  } catch {
    // Continue to NeoForge metadata; malformed Fabric metadata is not trusted.
  }
  for (const metadataPath of [
    "META-INF/neoforge.mods.toml",
    "META-INF/mods.toml",
  ]) {
    try {
      const metadataEntry = zip.getEntry(metadataPath);
      const raw =
        metadataEntry && !metadataEntry.isDirectory
          ? readEntryText(metadataEntry)
          : null;
      if (!raw) continue;
      const metadata = parseTomlDocument(raw) as { mods?: unknown };
      if (!Array.isArray(metadata.mods)) continue;
      for (const mod of metadata.mods) {
        if (
          typeof mod !== "object" ||
          mod === null ||
          !("modId" in mod) ||
          typeof mod.modId !== "string"
        )
          continue;
        if (/^[a-z0-9_.-]+$/i.test(mod.modId)) ids.add(mod.modId.toLowerCase());
      }
      if (ids.size) break;
    } catch {
      // A malformed metadata file does not establish ownership of an entity namespace.
    }
  }
  return ids;
}

type ZipLike = Pick<AdmZip, "getEntry">;

function parseJson(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function normalizeTexturePath(
  value: string,
  defaultNamespace: string,
): string | null {
  const [rawNamespace, ...parts] = value.includes(":")
    ? value.split(":")
    : [defaultNamespace, value];
  const textureId = parts.join(":");
  if (
    !/^[a-z0-9_.-]+$/i.test(rawNamespace) ||
    !textureId ||
    textureId.split("/").some((part) => !part || part === "." || part === "..")
  )
    return null;
  return `assets/${rawNamespace}/textures/${textureId.replace(/\.png$/i, "")}.png`;
}

function modelArchivePath(
  value: string,
  defaultNamespace: string,
): string | null {
  const [rawNamespace, ...parts] = value.includes(":")
    ? value.split(":")
    : [defaultNamespace, value];
  let modelId = parts.join(":");
  if (
    !/^[a-z0-9_.-]+$/i.test(rawNamespace) ||
    !modelId ||
    modelId.split("/").some((part) => !part || part === "." || part === "..")
  )
    return null;
  modelId = modelId.replace(/\.json$/i, "");
  if (!modelId.startsWith("item/") && !modelId.startsWith("block/"))
    modelId = `item/${modelId}`;
  return `assets/${rawNamespace}/models/${modelId}.json`;
}

function modelTexture(
  zip: ZipLike,
  modelPath: string,
  fallbackZip: ZipLike | null,
  kind: RegistryKind,
  depth = 0,
  visited = new Set<string>(),
): { path: string; namespace: string } | null {
  if (depth > 3 || visited.has(modelPath)) return null;
  visited.add(modelPath);
  let entry = zip.getEntry(modelPath);
  let owner = zip;
  if (!entry && fallbackZip && modelPath.startsWith("assets/minecraft/")) {
    entry = fallbackZip.getEntry(modelPath);
    owner = fallbackZip;
  }
  const model = entry ? parseJson(readEntryText(entry)) : null;
  if (!model) return null;
  const textures =
    typeof model.textures === "object" && model.textures !== null
      ? (model.textures as Record<string, unknown>)
      : {};
  const priority =
    kind === "item"
      ? ["layer0"]
      : ["all", "side", "top", "particle", "texture"];
  const keys = [
    ...priority,
    ...Object.keys(textures).filter((key) => !priority.includes(key)),
  ];
  for (const key of keys) {
    let value = textures[key];
    const refs = new Set<string>();
    while (
      typeof value === "string" &&
      value.startsWith("#") &&
      !refs.has(value)
    ) {
      refs.add(value);
      value = textures[value.slice(1)];
    }
    if (typeof value !== "string") continue;
    const match = /^assets\/([a-z0-9_.-]+)\/textures\/(.+\.png)$/i.exec(value);
    const path = normalizeTexturePath(value, "minecraft");
    if (!path) continue;
    const textureEntry =
      owner.getEntry(path) ?? zip.getEntry(path) ?? fallbackZip?.getEntry(path);
    if (textureEntry) {
      const namespace = match?.[1] ?? path.split("/")[1] ?? "minecraft";
      return { path, namespace };
    }
  }
  const parent = typeof model.parent === "string" ? model.parent : null;
  const parentPath = parent
    ? modelArchivePath(parent, modelPath.split("/")[1] ?? "minecraft")
    : null;
  return parentPath
    ? modelTexture(owner, parentPath, fallbackZip, kind, depth + 1, visited)
    : null;
}

function blockModelPaths(
  blockstate: Record<string, unknown>,
  namespace: string,
): string[] {
  const found = new Set<string>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.model === "string") {
      const path = modelArchivePath(record.model, namespace);
      if (path) found.add(path);
    }
    Object.values(record).forEach(visit);
  };
  visit(blockstate.variants);
  visit(blockstate.multipart);
  return [...found];
}

function parseJar(
  jarPath: string,
  sourceJar: string,
  registries: Map<string, RegistryEntry>,
  fallbackZip: ZipLike | null = null,
  fallbackSourceJar: string | null = null,
): void {
  let zip: AdmZip;
  try {
    zip = new AdmZip(jarPath);
  } catch {
    return;
  }
  let entries;
  try {
    entries = zip.getEntries();
  } catch {
    return;
  }

  const translations = new Map<string, Record<string, unknown>>();
  const ownModIds = verifiedModIds(zip);
  for (const entry of entries) {
    const languageMatch = /^assets\/([a-z0-9_.-]+)\/lang\/en_us\.json$/i.exec(
      entry.entryName,
    );
    if (!languageMatch || entry.isDirectory) continue;
    const raw = readEntryText(entry);
    if (!raw) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        translations.set(
          languageMatch[1].toLowerCase(),
          parsed as Record<string, unknown>,
        );
      }
    } catch {
      // Invalid language files simply leave generated names as the fallback.
    }
  }

  for (const dictionary of translations.values()) {
    for (const [translationKey, translationValue] of Object.entries(
      dictionary,
    )) {
      const match = /^entity\.([a-z0-9_.-]+)\.([a-z0-9_.-]+)$/i.exec(
        translationKey,
      );
      if (
        !match ||
        typeof translationValue !== "string" ||
        !translationValue.trim()
      )
        continue;
      const namespace = match[1].toLowerCase();
      if (!ownModIds.has(namespace)) continue;
      const entityId = match[2].toLowerCase();
      const id = `${namespace}:${entityId}`;
      const key = `mob:${id}`;
      if (!registries.has(key)) {
        registries.set(key, {
          id,
          displayName: resolvedDisplayName(
            translationValue,
            id,
            "mob",
            namespace,
          ),
          namespace,
          type: "mob",
          texturePath: null,
          modelPath: null,
          sourceJar,
        });
      }
    }
  }

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const tagMatch =
      /^data\/([a-z0-9_.-]+)\/tags\/entity_type\/(.+)\.json$/i.exec(
        entry.entryName,
      );
    if (tagMatch) {
      const namespace = tagMatch[1].toLowerCase();
      if (!ownModIds.has(namespace)) continue;
      const tag = parseJson(readEntryText(entry));
      const values = Array.isArray(tag?.values) ? tag.values : [];
      for (const value of values) {
        const rawId =
          typeof value === "string"
            ? value
            : typeof value === "object" &&
                value !== null &&
                "id" in value &&
                typeof value.id === "string"
              ? value.id
              : null;
        if (!rawId || rawId.startsWith("#")) continue;
        const [rawNamespace, ...parts] = rawId.includes(":")
          ? rawId.split(":")
          : [namespace, rawId];
        const entityNamespace = rawNamespace.toLowerCase();
        if (!ownModIds.has(entityNamespace)) continue;
        const entityId = parts.join(":").toLowerCase();
        if (
          !/^[a-z0-9_.-]+$/i.test(entityNamespace) ||
          !entityId ||
          entityId
            .split("/")
            .some((part) => !part || part === "." || part === "..")
        )
          continue;
        const id = `${entityNamespace}:${entityId}`;
        const key = `mob:${id}`;
        if (!registries.has(key)) {
          const translated =
            translations.get(entityNamespace)?.[
              `entity.${entityNamespace}.${entityId}`
            ];
          registries.set(key, {
            id,
            displayName: resolvedDisplayName(
              translated,
              id,
              "mob",
              entityNamespace,
            ),
            namespace: entityNamespace,
            type: "mob",
            texturePath: null,
            modelPath: null,
            sourceJar,
          });
        }
      }
    }
    for (const { kind, pattern, translation } of REGISTRY_FILE_PATTERNS) {
      const match = pattern.exec(entry.entryName);
      if (!match) continue;
      const namespace = match[1].toLowerCase();
      const fileId = match[2].toLowerCase();
      const id = `${namespace}:${fileId}`;
      const key = `${kind}:${id}`;
      if (registries.has(key)) break;
      const translationValue =
        translations.get(namespace)?.[`${translation}.${namespace}.${fileId}`];
      const displayName = resolvedDisplayName(
        translationValue,
        id,
        kind,
        namespace,
      );
      let texturePath: string | null = null;
      let textureSourceJar: string | undefined;
      let modelPath: string | null = null;
      if (kind === "item") {
        modelPath = entry.entryName;
        const model = parseJson(readEntryText(entry));
        const texture = model
          ? modelTexture(zip, entry.entryName, fallbackZip, kind)
          : null;
        texturePath = texture?.path ?? null;
        if (
          texture &&
          texture.namespace === "minecraft" &&
          fallbackZip?.getEntry(texture.path) &&
          !zip.getEntry(texture.path)
        ) {
          textureSourceJar = fallbackSourceJar ?? undefined;
        }
      } else if (kind === "block") {
        const blockstate = parseJson(readEntryText(entry));
        for (const candidate of blockstate
          ? blockModelPaths(blockstate, namespace)
          : []) {
          if (!zip.getEntry(candidate) && !fallbackZip?.getEntry(candidate))
            continue;
          modelPath = candidate;
          const texture = modelTexture(zip, candidate, fallbackZip, kind);
          if (texture) {
            texturePath = texture.path;
            if (
              texture.namespace === "minecraft" &&
              fallbackZip?.getEntry(texture.path) &&
              !zip.getEntry(texture.path)
            )
              textureSourceJar = fallbackSourceJar ?? undefined;
          }
          break;
        }
      } else if (kind === "biome") {
        modelPath = entry.entryName;
      }
      registries.set(key, {
        id,
        displayName,
        namespace,
        type: kind,
        texturePath,
        textureSourceJar,
        modelPath,
        sourceJar,
      });
      break;
    }
  }
}

function cacheResult(cached: RegistryCacheFile): RegistryScanResult {
  return {
    instancePath: cached.instancePath,
    minecraftVersion: cached.minecraftVersion,
    fromCache: true,
    items: cached.items,
    blocks: cached.blocks,
    biomes: cached.biomes,
    dimensions: cached.dimensions,
    mobs: cached.mobs,
  };
}

function readCache(
  filePath: string,
  instanceRoot: string,
): RegistryCacheFile | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    if (
      typeof raw === "object" &&
      raw !== null &&
      (raw as RegistryCacheFile).schema === CACHE_SCHEMA &&
      resolve((raw as RegistryCacheFile).instancePath) === instanceRoot &&
      Array.isArray((raw as RegistryCacheFile).items) &&
      Array.isArray((raw as RegistryCacheFile).blocks) &&
      Array.isArray((raw as RegistryCacheFile).biomes) &&
      Array.isArray((raw as RegistryCacheFile).dimensions) &&
      Array.isArray((raw as RegistryCacheFile).mobs)
    ) {
      return raw as RegistryCacheFile;
    }
  } catch {
    // Rebuild a missing or malformed cache.
  }
  return null;
}

function removeStaleCaches(instanceId: string, activePath: string): void {
  try {
    for (const entry of readdirSync(cacheRoot(), { withFileTypes: true })) {
      if (
        entry.isFile() &&
        entry.name.startsWith(`${instanceId}_`) &&
        entry.name.endsWith(".json") &&
        join(cacheRoot(), entry.name) !== activePath
      ) {
        unlinkSync(join(cacheRoot(), entry.name));
      }
    }
  } catch {
    // Cleanup is optional; the current cache write remains authoritative.
  }
}

/** Remove every cached registry index for an instance after its active JAR set changes. */
export function invalidateInstanceRegistryCache(instancePath: string): void {
  const instanceRoot = validateInstanceRoot(instancePath);
  const instanceId = getManagedInstanceId(instanceRoot);
  try {
    for (const entry of readdirSync(cacheRoot(), { withFileTypes: true })) {
      if (
        entry.isFile() &&
        entry.name.startsWith(`${instanceId}_`) &&
        entry.name.endsWith(".json")
      ) {
        unlinkSync(join(cacheRoot(), entry.name));
      }
    }
  } catch {
    // A missing cache directory already represents an invalidated cache.
  }
}

export async function scanInstanceRegistries(
  instancePath: string,
  onProgress?: (progress: RegistryScanProgress) => void,
): Promise<RegistryScanResult> {
  const instanceRoot = validateInstanceRoot(instancePath);
  const modsPath = join(instanceRoot, "mods");
  if (!existsSync(modsPath) || !lstatSync(modsPath).isDirectory()) {
    throw new Error(`No mods folder found inside: ${instanceRoot}`);
  }
  const jars = enabledModJars(instanceRoot);
  const info = getInstanceInfo(instanceRoot);
  const minecraftVersion = info.minecraftVersion;
  const vanillaPath = vanillaJarPath(instanceRoot, minecraftVersion);
  const instanceId = getManagedInstanceId(instanceRoot);
  const cacheName = `${instanceId}_${makeCacheKey(jars, minecraftVersion, vanillaPath)}.json`;
  const filePath = join(cacheRoot(), cacheName);
  const cached = readCache(filePath, instanceRoot);
  if (cached) return cacheResult(cached);

  const registries = new Map<string, RegistryEntry>();
  let vanillaZip: AdmZip | null = null;
  const vanillaName = vanillaPath ? basename(vanillaPath) : null;
  const baselineJar = vanillaName ?? "vanilla-baseline.jar";
  for (const [id, displayName] of VANILLA_DIMENSIONS) {
    registries.set(`dimension:${id}`, {
      id,
      displayName,
      namespace: "minecraft",
      type: "dimension",
      texturePath: null,
      modelPath: null,
      sourceJar: baselineJar,
    });
  }
  for (const [id, displayName] of VANILLA_MOBS) {
    const namespacedId = id.includes(":") ? id : `minecraft:${id}`;
    registries.set(`mob:${namespacedId}`, {
      id: namespacedId,
      displayName,
      namespace: "minecraft",
      type: "mob",
      texturePath: null,
      modelPath: null,
      sourceJar: baselineJar,
    });
  }
  if (vanillaPath) {
    try {
      vanillaZip = new AdmZip(vanillaPath);
    } catch {
      vanillaZip = null;
    }
  }
  let indexedMods = 0;
  const totalMods = jars.length;
  onProgress?.({ indexedMods, totalMods });
  for (const jar of jars) {
    parseJar(jar.path, jar.name, registries, vanillaZip, vanillaName);
    indexedMods += 1;
    onProgress?.({ indexedMods, totalMods, currentFile: jar.name });
    await new Promise<void>((resolveNext) => setImmediate(resolveNext));
  }

  if (vanillaPath) {
    parseJar(vanillaPath, basename(vanillaPath), registries);
  }

  const sort = (a: RegistryEntry, b: RegistryEntry): number =>
    a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id);
  const cachedResult: RegistryCacheFile = {
    schema: CACHE_SCHEMA,
    instancePath: instanceRoot,
    minecraftVersion,
    items: [...registries.values()]
      .filter((entry) => entry.type === "item")
      .sort(sort),
    blocks: [...registries.values()]
      .filter((entry) => entry.type === "block")
      .sort(sort),
    biomes: [...registries.values()]
      .filter((entry) => entry.type === "biome")
      .sort(sort),
    dimensions: [...registries.values()]
      .filter((entry) => entry.type === "dimension")
      .sort(sort),
    mobs: [...registries.values()]
      .filter((entry) => entry.type === "mob")
      .sort(sort),
  };
  mkdirSync(cacheRoot(), { recursive: true });
  writeFileSync(filePath, JSON.stringify(cachedResult), "utf8");
  removeStaleCaches(instanceId, filePath);
  return {
    ...cachedResult,
    fromCache: false,
  };
}

function safeAssetPath(value: string): string {
  if (
    typeof value !== "string" ||
    value.includes("\\") ||
    value.split("/").some((part) => !part || part === "." || part === "..") ||
    !/^assets\/[a-z0-9_.-]+\/textures\/[a-z0-9_./-]+\.png$/i.test(value)
  ) {
    throw new Error("Invalid registry texture path");
  }
  return value;
}

function safeExportPath(value: string): string {
  if (
    typeof value !== "string" ||
    value.includes("\\") ||
    value.split("/").some((part) => !part || part === "." || part === "..") ||
    !/^(?:assets\/[a-z0-9_.-]+\/(?:textures\/[a-z0-9_./-]+\.png|models\/[a-z0-9_./-]+\.json)|data\/[a-z0-9_.-]+\/worldgen\/biome\/[a-z0-9_.-]+\.json)$/i.test(
      value,
    )
  )
    throw new Error("Invalid registry asset path");
  return value;
}

function availableJarPaths(root: string): Map<string, string> {
  const jars = new Map<string, string>();
  const modsPath = join(root, "mods");
  for (const entry of readdirSync(modsPath, { withFileTypes: true })) {
    if (
      entry.isFile() &&
      !entry.isSymbolicLink() &&
      entry.name.toLowerCase().endsWith(".jar")
    ) {
      jars.set(entry.name.toLowerCase(), join(modsPath, entry.name));
    }
  }
  const instanceInfo = getInstanceInfo(root);
  const vanillaPath = vanillaJarPath(root, instanceInfo.minecraftVersion);
  if (vanillaPath) jars.set(basename(vanillaPath).toLowerCase(), vanillaPath);
  return jars;
}

export function readRegistryAssetBuffer(
  instancePath: string,
  request: RegistryExportAssetRequest,
): Buffer | null {
  const root = validateInstanceRoot(instancePath);
  if (!/^[a-z0-9_.-]+$/i.test(request.modId))
    throw new Error("Invalid registry namespace");
  const safePath = safeExportPath(request.assetPath);
  if (
    request.sourceJar &&
    (basename(request.sourceJar) !== request.sourceJar ||
      !request.sourceJar.toLowerCase().endsWith(".jar"))
  ) {
    throw new Error("Invalid source archive");
  }
  const jars = availableJarPaths(root);
  const preferred = request.sourceJar
    ? jars.get(request.sourceJar.toLowerCase())
    : undefined;
  const candidates = preferred ? [preferred] : [...jars.values()];
  for (const jarPath of candidates) {
    try {
      const entry = new AdmZip(jarPath).getEntry(safePath);
      if (entry && entry.header.size <= 16 * 1024 * 1024)
        return entry.getData();
    } catch {
      // Try other enabled archives if the source jar changed during export.
    }
  }
  return null;
}

export function readRegistryAssets(
  instancePath: string,
  requests: RegistryAssetRequest[],
): RegistryAssetResult[] {
  const root = validateInstanceRoot(instancePath);
  const jars = availableJarPaths(root);

  const opened = new Map<string, AdmZip | null>();
  return requests.slice(0, 120).map((request) => {
    if (
      typeof request.sourceJar !== "string" ||
      basename(request.sourceJar) !== request.sourceJar ||
      !request.sourceJar.toLowerCase().endsWith(".jar")
    ) {
      return { ...request, dataUri: null };
    }
    let texturePath: string;
    try {
      texturePath = safeAssetPath(request.texturePath);
    } catch {
      return { ...request, dataUri: null };
    }
    const jarPath = jars.get(request.sourceJar.toLowerCase());
    if (!jarPath) return { ...request, dataUri: null };
    let zip = opened.get(jarPath);
    if (zip === undefined) {
      try {
        zip = new AdmZip(jarPath);
      } catch {
        zip = null;
      }
      opened.set(jarPath, zip);
    }
    let data: Buffer | undefined;
    try {
      const textureEntry = zip?.getEntry(texturePath);
      if (textureEntry && textureEntry.header.size <= 1024 * 1024) {
        data = textureEntry.getData();
      }
    } catch {
      data = undefined;
    }
    return {
      ...request,
      dataUri: data ? `data:image/png;base64,${data.toString("base64")}` : null,
    };
  });
}
