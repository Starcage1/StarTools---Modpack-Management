export type ModSide = "Client" | "Server" | "Both" | "Unknown";

/** User-overridable side values (persisted in side_overrides.json). */
export type SideOverride = "Client" | "Server" | "Both";

export interface ModDependency {
  /** Mod ID of the dependency, e.g. "curios" */
  modId: string;
  /** Version range string from mods.toml, e.g. "[1.0,)" */
  versionRange: string;
  /** Whether this dependency is mandatory */
  mandatory: boolean;
  /** True if a matching installed mod was found */
  satisfied: boolean;
  /** Provenance: parsed from the jar vs added by the user */
  source: "scanned" | "manual";
  /** True when the user removed this dependency (kept for display/restore) */
  removed: boolean;
}

export interface ParsedMod {
  /** File name on disk, e.g. "curios-neoforge-9.0.0.jar" */
  fileName: string;
  /** Absolute path of the jar at scan time (mods or disabledmods) */
  filePath: string;
  /** Primary mod id (first [[mods]] entry) */
  modId: string;
  /** Display name from mods.toml or filename fallback */
  name: string;
  /** Version string, toml first then filename fallback */
  version: string;
  /** Author(s) from mods.toml, else MANIFEST.MF vendor, else '' */
  authors: string;
  /** False when the jar lives in \disabledmods\ */
  enabled: boolean;
  /** Client / Server / Both side */
  side: ModSide;
  /** Present when the user explicitly overrode the parser's side. */
  sideOverride?: SideOverride;
  /** Description text (may be empty) */
  description: string;
  /** Base64 data URI of the logo, if found */
  iconDataUri: string | null;
  /** External (non-core) dependencies after filtering */
  dependencies: ModDependency[];
  /** True when this archive contains Fabric Loader metadata. */
  isFabricMod?: boolean;
  /** True when a Fabric mod is incompatible with this Forge-family instance. */
  incompatibleFabric?: boolean;
  /** Mod IDs supplied by jars bundled inside this archive. */
  providedModIds?: string[];
  /** Loader that successfully parsed this file */
  loader: "fabric" | "neoforge" | "unknown";
}

export interface ScanModsResult {
  /** Absolute path of the instance folder the user picked */
  instancePath: string;
  /** Absolute path of the resolved mods folder */
  modsPath: string;
  /** Successfully parsed mods */
  mods: ParsedMod[];
  /** Loader inferred from the instance metadata or the majority of parsed mods. */
  modLoader: string;
  /** Whether an enabled Sinytra Connector installation was detected. */
  hasSinytraConnector: boolean;
  /** File names that were skipped (broken / not a mod / missing toml) */
  skipped: { fileName: string; reason: string }[];
}

export type RegistryKind = "item" | "block" | "biome" | "dimension" | "mob";

export interface RegistryEntry {
  id: string;
  displayName: string;
  namespace: string;
  type: RegistryKind;
  /** Config path relative to the archive root, read lazily by the main process. */
  texturePath: string | null;
  /** Jar containing the resolved texture, which may be the vanilla client jar. */
  textureSourceJar?: string;
  /** Registry JSON path inside the source jar, available for direct export. */
  modelPath?: string | null;
  sourceJar: string;
}

export interface RegistryScanResult {
  instancePath: string;
  minecraftVersion: string;
  fromCache: boolean;
  items: RegistryEntry[];
  blocks: RegistryEntry[];
  biomes: RegistryEntry[];
  dimensions: RegistryEntry[];
  mobs: RegistryEntry[];
}

export interface RegistryScanProgress {
  indexedMods: number;
  totalMods: number;
  currentFile?: string;
}

export interface RegistryAssetRequest {
  sourceJar: string;
  texturePath: string;
}

export interface RegistryAssetResult extends RegistryAssetRequest {
  dataUri: string | null;
}

export interface RegistryExportAssetRequest {
  modId: string;
  assetPath: string;
  defaultFileName: string;
  sourceJar?: string;
}

export type SyncDiffType =
  "only_local" | "only_peer" | "version_mismatch" | "synced";

export interface SyncManifestEntry {
  fileName: string;
  size: number;
  sha1: string;
  modId: string;
  version: string;
  name: string;
  enabled: boolean;
}

export interface SyncDiffEntry {
  type: SyncDiffType;
  key: string;
  local?: SyncManifestEntry;
  peer?: SyncManifestEntry;
}

export interface SyncConnection {
  peerIp: string;
  peerPort: number;
  peerName: string;
  localName: string;
  pingMs: number;
  localManifest: SyncManifestEntry[];
  peerManifest: SyncManifestEntry[];
  diff: SyncDiffEntry[];
}

export interface SyncDiffSummary {
  only_local: number;
  only_peer: number;
  version_mismatch: number;
  synced: number;
}

export interface SyncHostDiffUpdated {
  diff: SyncDiffEntry[];
  summary: SyncDiffSummary;
}

export interface SyncHostInfo {
  ip: string;
  port: number;
  instanceName: string;
}

export interface SyncTransferProgress {
  type: "progress";
  direction: "push" | "pull" | "incoming";
  fileName: string;
  percent: number;
  bytesTransferred: number;
  totalBytes: number;
}

export interface SyncNotification {
  type: "notification";
  message: string;
  action?: "delete-suggestion" | "incoming-upload";
  fileName?: string;
  modId?: string;
}

export type SyncEvent = SyncTransferProgress | SyncNotification;

export type ScanProgressStage = "reading" | "parsing";

export interface DepOverrideEntry {
  /** Mod IDs added manually by the user */
  added: string[];
  /** Scanned mod IDs the user removed */
  removed: string[];
}

/** Per-mod dependency overrides, keyed by lowercase mod id. */
export type DepOverrides = Record<string, DepOverrideEntry>;

export interface CatOverrideEntry {
  /** Custom categories added by the user */
  added: string[];
  /** Default Modrinth categories removed by the user */
  removed: string[];
}

/** Per-mod category overrides, keyed by lowercase mod id. */
export type CatOverrides = Record<string, CatOverrideEntry>;

export interface InstanceInfo {
  /** Instance/modpack display name */
  instanceName: string;
  /** Minecraft version, e.g. "1.21.1" */
  minecraftVersion: string;
  /** Loader name, e.g. "NeoForge" */
  modLoader: string;
  /** Loader version, e.g. "21.1.172" */
  loaderVersion: string;
  /** Jars currently in \mods\ */
  enabledCount: number;
  /** Jars currently in \disabledmods\ */
  disabledCount: number;
  /** Manifest file the specs were read from ('' when none found) */
  sourceFile: string;
}

export type ThemeSetting = "light" | "dark";
export type TableFontSetting = "small" | "medium" | "large";
export type DisabledPlacement = "end" | "start";
export type IncompatibleFabricPlacement = "end" | "start" | "alphabetical";
export type AppFontFamily = "sans" | "mono" | "serif";
export type StartupWindowMode = "windowed" | "maximized" | "fullscreen";
export type SearchInputDebounceMs = 100 | 150 | 250;
export type SyncBufferSizeKb = 512 | 1024 | 2048;

export interface AppSettings {
  theme: ThemeSetting;
  tableFont: TableFontSetting;
  disabledPlacement: DisabledPlacement;
  incompatibleFabricPlacement: IncompatibleFabricPlacement;
  /** UI font family. Defaults to system sans. */
  fontFamily: AppFontFamily;
  /** NanaZip executable path. Omitted when NanaZip is auto-detected. */
  nanaZipPath?: string;
  /** Visual Studio Code executable path. Omitted when VS Code is auto-detected. */
  vsCodePath?: string;
  /** Selected community theme id; built-in theme remains in `theme`. */
  customThemeId?: string;
  landingScreen: "home" | "last-instance";
  startupWindowMode: StartupWindowMode;
  confirmTrashMods: boolean;
  promptDeleteAssociatedConfigs: boolean;
  crossModOnlyCollisions: boolean;
  ignoreVanillaBackportDuplicates: boolean;
  syncPort: number;
  autoDetectRadmin: boolean;
  syncBufferSizeKb: SyncBufferSizeKb;
  searchInputDebounceMs: SearchInputDebounceMs;
}

export interface ManagedInstance {
  id: string;
  name: string;
  path: string;
  loader: string;
  mcVersion: string;
  lastOpened: number;
  /** Current total of enabled and disabled jar files. */
  modCount: number;
}

/** An ATLauncher instance found on disk but not necessarily tracked yet. */
export interface DetectedLauncherInstance {
  name: string;
  path: string;
  loader: string;
  mcVersion: string;
  modCount: number;
}

export interface SnapshotModState {
  fileName: string;
  enabled: boolean;
}

export interface SnapshotEntry {
  id: string;
  instanceId: string;
  name: string;
  timestamp: number;
  modState: SnapshotModState[];
  /** Zip filename stored beside snapshots.json. */
  configArchive: string;
}

export interface SnapshotRollbackResult {
  movedMods: number;
  restoredConfigFiles: number;
}

export interface CustomThemeColors {
  "--bg-app"?: string;
  "--bg-surface"?: string;
  "--bg-elevated"?: string;
  "--border-subtle"?: string;
  "--text-main"?: string;
  "--text-muted"?: string;
}

export interface CustomTheme {
  id: string;
  name: string;
  author: string;
  colors: CustomThemeColors;
  /** Optional local stylesheet contents, sanitized by the main process. */
  styleCss?: string;
  headerBannerDataUri?: string;
  mascotDataUri?: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  tableFont: "medium",
  disabledPlacement: "end",
  incompatibleFabricPlacement: "end",
  fontFamily: "sans",
  landingScreen: "home",
  startupWindowMode: "windowed",
  confirmTrashMods: true,
  promptDeleteAssociatedConfigs: true,
  crossModOnlyCollisions: true,
  ignoreVanillaBackportDuplicates: true,
  syncPort: 48500,
  autoDetectRadmin: true,
  syncBufferSizeKb: 1024,
  searchInputDebounceMs: 150,
};

/** Table body font size in px for each density setting. */
export const TABLE_FONT_PX: Record<TableFontSetting, number> = {
  small: 12,
  medium: 16,
  large: 24,
};

/** Row icon dimensions paired with the three typography presets. */
export const APP_ICON_SIZE_PX: Record<TableFontSetting, number> = {
  small: 14,
  medium: 20,
  large: 28,
};

/** UI font stacks applied via `--app-font-family` on `document.body`. */
export const APP_FONT_STACKS: Record<AppFontFamily, string> = {
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: 'ui-monospace, "JetBrains Mono", "Cascadia Mono", Consolas, monospace',
  serif: 'ui-serif, Georgia, "Times New Roman", serif',
};

export interface TrashEntry {
  /** Unique record id */
  id: string;
  /** Mod id of the trashed mod */
  modId: string;
  /** Original jar file name, e.g. "example-1.0.0.jar" */
  originalFileName: string;
  /** Full original file path the jar was trashed from */
  originalPath: string;
  /** Full path of the staged copy under trash_staging/ */
  stagedPath: string;
  /** Kind controls where the item is restored; missing values are legacy mods. */
  kind?: "mod" | "config" | "pack";
  /** Whether the staged entry is a file or directory. */
  itemType?: "file" | "directory";
  /** Instance root for validating restore targets of configs and packs. */
  instancePath?: string;
  /** Unix timestamp (ms) of the trash action */
  timestamp: number;
}

export interface TrashHistoryState {
  entries: TrashEntry[];
  /** Entries whose file still needs to be moved back into \mods\ */
  restorableCount: number;
}

export interface RestoreResult {
  restoredCount: number;
}

export interface ConfigTreeEntry {
  name: string;
  path: string;
  type: "directory" | "file";
  lastModified: number;
  children?: ConfigTreeEntry[];
}

export interface ConfigFileDocument {
  name: string;
  path: string;
  content: string;
  lastModified: number;
}

export interface ConfigMappingMatch {
  /** Config-root-relative path, using forward slashes. */
  filePath: string;
  type: "file" | "directory";
  source: "automatic" | "manual";
}

export interface ConfigModMatch {
  modId: string;
  source: "automatic" | "manual";
}

export type PackCategory = "shaderpacks" | "resourcepacks" | "datapacks";

export interface PackItem {
  name: string;
  /** Instance-root-relative path, using forward slashes. */
  path: string;
  category: PackCategory;
  type: "file" | "directory";
  enabled: boolean;
  description: string;
  packFormat: number | null;
  size: number;
  /** File/folder modification time in milliseconds since the Unix epoch. */
  lastModified: number;
  iconDataUri: string | null;
}

export interface PacksScanResult {
  shaderpacks: PackItem[];
  resourcepacks: PackItem[];
  datapacks: PackItem[];
}

export interface PackTextDocument {
  name: string;
  content: string;
}

export interface ConfigDeleteResult {
  deletedCount: number;
  errors: string[];
}

export interface ManagedInstance {
  id: string;
  name: string;
  path: string;
  loader: string;
  mcVersion: string;
  lastOpened: number;
  modCount: number;
}

export interface SnapshotModState {
  fileName: string;
  enabled: boolean;
}

export interface SnapshotEntry {
  id: string;
  instanceId: string;
  name: string;
  timestamp: number;
  modState: SnapshotModState[];
  configArchive: string;
}

export interface SnapshotRollbackResult {
  movedMods: number;
  restoredConfigFiles: number;
}

export interface CustomThemeColors {
  "--bg-app"?: string;
  "--bg-surface"?: string;
  "--bg-elevated"?: string;
  "--border-subtle"?: string;
  "--text-main"?: string;
  "--text-muted"?: string;
}

export interface CustomTheme {
  id: string;
  name: string;
  author: string;
  colors: CustomThemeColors;
  styleCss?: string;
  headerBannerDataUri?: string;
  mascotDataUri?: string;
}

/** Modrinth online enrichment for one jar. */
export interface OnlineModData {
  /** Absolute jar path this record belongs to (merge key) */
  filePath: string;
  /** SHA-1 hex of the jar */
  sha1: string;
  /** Modrinth project id, e.g. "AANobbMI" */
  projectId: string | null;
  /** URL slug, e.g. "sodium" */
  slug: string;
  /** Display title, e.g. "Sodium" */
  title: string;
  /** Project icon URL (empty when none) */
  iconUrl: string;
  /** Category tags, e.g. ["optimization", "client"] */
  categories: string[];
  modrinthSide?: ModSide | null;
  side?: ModSide | null;
  /** "mod", "resourcepack", etc. */
  projectType: string;
}

export interface OnlineFetchProgress {
  current: number;
  total: number;
  stage?: "hashing" | "lookup";
}

export interface OnlineFetchResult {
  data: Record<string, OnlineModData>;
}
