import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import type {
  AppSettings,
  CatOverrideEntry,
  CatOverrides,
  ConfigFileDocument,
  ConfigDeleteResult,
  ConfigMappingMatch,
  ConfigModMatch,
  ConfigTreeEntry,
  CustomTheme,
  DetectedLauncherInstance,
  DepOverrideEntry,
  DepOverrides,
  InstanceInfo,
  ManagedInstance,
  OnlineFetchProgress,
  OnlineFetchResult,
  PackCategory,
  PackTextDocument,
  PacksScanResult,
  RestoreResult,
  RegistryAssetRequest,
  RegistryAssetResult,
  RegistryExportAssetRequest,
  RegistryScanProgress,
  RegistryScanResult,
  ScanModsResult,
  ScanProgressStage,
  SideOverride,
  SnapshotEntry,
  SnapshotRollbackResult,
  SyncConnection,
  SyncDiffSummary,
  SyncEvent,
  SyncHostInfo,
  SyncManifestEntry,
  TrashHistoryState,
} from "../shared/types";

// Custom APIs for renderer
const api = {
  getAppVersion: (): Promise<string> => ipcRenderer.invoke("app:get-version"),
  listManagedInstances: (): Promise<ManagedInstance[]> =>
    ipcRenderer.invoke("instances:list"),
  scanAtLauncherInstances: (): Promise<DetectedLauncherInstance[]> =>
    ipcRenderer.invoke("instances:scan-atlauncher"),
  saveManagedInstance: (instancePath: string): Promise<ManagedInstance> =>
    ipcRenderer.invoke("instances:save", instancePath),
  untrackManagedInstance: (id: string): Promise<boolean> =>
    ipcRenderer.invoke("instances:untrack", id),
  /** Reveal the selected instance folder in the system file manager. */
  revealInstance: (instancePath: string): Promise<boolean> =>
    ipcRenderer.invoke("instances:reveal", instancePath),
  /** Open one known instance subfolder without allowing arbitrary paths. */
  openInstanceFolder: (
    instancePath: string,
    folder: "config" | "crash-reports",
  ): Promise<boolean> =>
    ipcRenderer.invoke("instances:open-folder", instancePath, folder),
  /** List recent crash report files for an instance. */
  scanCrashReports: (
    instancePath: string,
  ): Promise<Array<{ name: string; modifiedAt: number }>> =>
    ipcRenderer.invoke("instances:scan-crash-reports", instancePath),
  /** Open one file returned by scanCrashReports in its registered instance. */
  openCrashReport: (instancePath: string, fileName: string): Promise<boolean> =>
    ipcRenderer.invoke("instances:open-crash-report", instancePath, fileName),
  /** Copy a short user-provided string to the system clipboard. */
  copyText: (value: string): Promise<boolean> =>
    ipcRenderer.invoke("clipboard:write-text", value),
  listSnapshots: (instancePath: string): Promise<SnapshotEntry[]> =>
    ipcRenderer.invoke("snapshots:list", instancePath),
  createSnapshot: (
    instancePath: string,
    name: string,
  ): Promise<SnapshotEntry> =>
    ipcRenderer.invoke("snapshots:create", instancePath, name),
  rollbackSnapshot: (
    instancePath: string,
    snapshotId: string,
  ): Promise<SnapshotRollbackResult> =>
    ipcRenderer.invoke("snapshots:rollback", instancePath, snapshotId),
  deleteSnapshot: (
    instancePath: string,
    snapshotId: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke("snapshots:delete", instancePath, snapshotId),
  startSyncHost: (instancePath: string, port: number): Promise<SyncHostInfo> =>
    ipcRenderer.invoke("sync:start-host", instancePath, port),
  stopSyncHost: (): Promise<void> => ipcRenderer.invoke("sync:stop-host"),
  connectSyncPeer: (
    instancePath: string,
    peerIp: string,
    peerPort: number,
  ): Promise<SyncConnection> =>
    ipcRenderer.invoke("sync:connect-peer", instancePath, peerIp, peerPort),
  pushSyncFile: (
    instancePath: string,
    peerIp: string,
    peerPort: number,
    entry: SyncManifestEntry,
    replaceModId?: string,
    transferId?: string,
  ): Promise<void> =>
    ipcRenderer.invoke(
      "sync:push-file",
      instancePath,
      peerIp,
      peerPort,
      entry,
      replaceModId,
      transferId,
    ),
  pullSyncFile: (
    instancePath: string,
    peerIp: string,
    peerPort: number,
    entry: SyncManifestEntry,
    replaceModId?: string,
    transferId?: string,
  ): Promise<void> =>
    ipcRenderer.invoke(
      "sync:pull-file",
      instancePath,
      peerIp,
      peerPort,
      entry,
      replaceModId,
      transferId,
    ),
  cancelSyncTransfer: (transferId: string): Promise<boolean> =>
    ipcRenderer.invoke("sync:cancel-transfer", transferId),
  cancelAllSyncTransfers: (): Promise<void> =>
    ipcRenderer.invoke("sync:cancel-all-transfers"),
  disconnectSyncPeer: (peerIp: string, peerPort: number): Promise<boolean> =>
    ipcRenderer.invoke("sync:disconnect-peer", peerIp, peerPort),
  disconnectHostedPeer: (): Promise<boolean> =>
    ipcRenderer.invoke("sync:clear-hosted-peer"),
  suggestSyncDelete: (
    peerIp: string,
    peerPort: number,
    entry: SyncManifestEntry,
  ): Promise<void> =>
    ipcRenderer.invoke("sync:suggest-delete", peerIp, peerPort, entry),
  onSyncEvent: (callback: (event: SyncEvent) => void): (() => void) => {
    const listener = (_event: unknown, syncEvent: SyncEvent): void =>
      callback(syncEvent);
    ipcRenderer.on("sync:event", listener);
    return () => ipcRenderer.removeListener("sync:event", listener);
  },
  onSyncPeerConnected: (
    callback: (connection: SyncConnection) => void,
  ): (() => void) => {
    const listener = (_event: unknown, connection: SyncConnection): void =>
      callback(connection);
    ipcRenderer.on("sync:peer-connected", listener);
    return () => ipcRenderer.removeListener("sync:peer-connected", listener);
  },
  onSyncDiffUpdated: (
    callback: (update: {
      diff: SyncConnection["diff"];
      summary: SyncDiffSummary;
    }) => void,
  ): (() => void) => {
    const listener = (
      _event: unknown,
      update: { diff: SyncConnection["diff"]; summary: SyncDiffSummary },
    ): void => callback(update);
    ipcRenderer.on("sync:diff-updated", listener);
    return () => ipcRenderer.removeListener("sync:diff-updated", listener);
  },
  onSyncPeerDisconnected: (callback: () => void): (() => void) => {
    const listener = (): void => callback();
    ipcRenderer.on("sync:peer-disconnected", listener);
    return () => ipcRenderer.removeListener("sync:peer-disconnected", listener);
  },
  getAvailableThemes: (): Promise<CustomTheme[]> =>
    ipcRenderer.invoke("themes:get-available"),
  openThemesFolder: (): Promise<boolean> =>
    ipcRenderer.invoke("themes:open-folder"),
  /** Opens a native folder picker; resolves to the path or null if cancelled. */
  selectInstanceFolder: (): Promise<string | null> =>
    ipcRenderer.invoke("dialog:select-instance"),
  /** Scans the instance's /mods folder and returns parsed mod metadata. */
  scanMods: (
    instancePath: string,
    onProgress?: (stage: ScanProgressStage) => void,
  ): Promise<ScanModsResult> => {
    const listener = (_event: unknown, stage: ScanProgressStage): void =>
      onProgress?.(stage);
    ipcRenderer.on("mods:scan-progress", listener);
    return ipcRenderer
      .invoke("mods:scan", instancePath)
      .finally(() =>
        ipcRenderer.removeListener("mods:scan-progress", listener),
      );
  },
  scanRegistries: (
    instancePath: string,
    onProgress?: (progress: RegistryScanProgress) => void,
  ): Promise<RegistryScanResult> => {
    const listener = (_event: unknown, progress: RegistryScanProgress): void =>
      onProgress?.(progress);
    ipcRenderer.on("registry:scan-progress", listener);
    return ipcRenderer
      .invoke("registry:scan-instance", instancePath)
      .finally(() =>
        ipcRenderer.removeListener("registry:scan-progress", listener),
      );
  },
  onRegistryOutdated: (
    listener: (payload: { instancePath: string }) => void,
  ): (() => void) => {
    const handler = (
      _event: unknown,
      payload: { instancePath: string },
    ): void => listener(payload);
    ipcRenderer.on("instance:registry-outdated", handler);
    return () =>
      ipcRenderer.removeListener("instance:registry-outdated", handler);
  },
  readRegistryAssets: (
    instancePath: string,
    requests: RegistryAssetRequest[],
  ): Promise<RegistryAssetResult[]> =>
    ipcRenderer.invoke("registry:read-assets", instancePath, requests),
  exportRegistryAsset: (
    instancePath: string,
    request: RegistryExportAssetRequest,
  ): Promise<{ success: boolean; filePath?: string }> =>
    ipcRenderer.invoke("registry:export-asset", instancePath, request),
  /** Returns the last successfully scanned instance folder, or null. */
  getLastFolder: (): Promise<string | null> =>
    ipcRenderer.invoke("config:get-last-folder"),
  /** Persists the last successfully scanned instance folder. */
  saveLastFolder: (folder: string): Promise<boolean> =>
    ipcRenderer.invoke("config:save-last-folder", folder),
  /** Persists a user-defined side override for a mod id. */
  setSideOverride: (modId: string, side: SideOverride): Promise<boolean> =>
    ipcRenderer.invoke("mods:set-side-override", modId, side),
  /** Moves a jar between \mods\ and \disabledmods\. `enabled` is the target state. */
  setModEnabled: (
    instancePath: string,
    fileName: string,
    enabled: boolean,
  ): Promise<{ fileName: string; enabled: boolean }> =>
    ipcRenderer.invoke("mods:set-enabled", instancePath, fileName, enabled),
  /** Sends a mod jar to the app trash staging (restorable). */
  trashMod: (
    instancePath: string,
    fileName: string,
    modId: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke("mods:trash", instancePath, fileName, modId),
  /** Opens a jar directly in NanaZip. */
  openArchive: (filePath: string, nanaZipPath?: string): Promise<boolean> =>
    ipcRenderer.invoke("mods:open-archive", filePath, nanaZipPath),
  /** Opens the executable picker for the NanaZip application. */
  selectNanaZipPath: (): Promise<string | null> =>
    ipcRenderer.invoke("dialog:select-nanazip"),
  /** Detects NanaZip's app execution alias or standard installation path. */
  detectNanaZipPath: (): Promise<string | null> =>
    ipcRenderer.invoke("settings:detect-nanazip"),
  /** Opens the executable picker for Visual Studio Code. */
  selectVSCodePath: (): Promise<string | null> =>
    ipcRenderer.invoke("dialog:select-vscode"),
  /** Detects Visual Studio Code in standard installation locations. */
  detectVSCodePath: (): Promise<string | null> =>
    ipcRenderer.invoke("settings:detect-vscode"),
  /** Fetches Modrinth enrichment for the given jar paths (explicit user action). */
  fetchOnlineData: (
    modPaths: string[],
    onProgress?: (progress: OnlineFetchProgress) => void,
  ): Promise<OnlineFetchResult> => {
    const listener = (_event: unknown, progress: OnlineFetchProgress): void =>
      onProgress?.(progress);
    ipcRenderer.on("mods:fetch-progress", listener);
    return ipcRenderer
      .invoke("mods:fetch-online-data", modPaths)
      .finally(() =>
        ipcRenderer.removeListener("mods:fetch-progress", listener),
      );
  },
  /** Returns the trash history plus the restorable count. */
  getTrashHistory: (): Promise<TrashHistoryState> =>
    ipcRenderer.invoke("mods:get-trash-history"),
  /** Moves restorable jars back into their \mods\ folders. */
  restoreTrashedMods: (): Promise<RestoreResult> =>
    ipcRenderer.invoke("mods:restore-trashed-mods"),
  /**
   * Subscribes to live trash-count pushes from main. Returns an unsubscribe fn.
   * Complements the refetch-after-await pattern so the button updates even if
   * an awaited call resolves before its side effects land.
   */
  onTrashCountChanged: (cb: (count: number) => void): (() => void) => {
    const listener = (_event: unknown, count: number): void => cb(count);
    ipcRenderer.on("trash:count-changed", listener);
    return () => {
      ipcRenderer.removeListener("trash:count-changed", listener);
    };
  },
  /** Loads persisted UI preferences. */
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke("settings:get"),
  /** Merges and persists UI preferences. */
  saveSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke("settings:save", patch),
  /** Returns all dependency overrides. */
  getDepOverrides: (): Promise<DepOverrides> =>
    ipcRenderer.invoke("mods:get-dep-overrides"),
  /** Replaces the dependency override entry for one mod. */
  setDepOverrides: (modId: string, entry: DepOverrideEntry): Promise<boolean> =>
    ipcRenderer.invoke("mods:set-dep-overrides", modId, entry),
  /** Returns all category overrides. */
  getCatOverrides: (): Promise<CatOverrides> =>
    ipcRenderer.invoke("mods:get-cat-overrides"),
  /** Replaces the category override entry for one mod. */
  setCatOverrides: (modId: string, entry: CatOverrideEntry): Promise<boolean> =>
    ipcRenderer.invoke("mods:set-cat-overrides", modId, entry),
  /** Parses the instance manifest and counts jars. */
  getInstanceInfo: (instancePath: string): Promise<InstanceInfo> =>
    ipcRenderer.invoke("mods:get-instance-info", instancePath),
  /** Export parsed mod and instance metadata to an instance-local Markdown file. */
  exportModpackInfo: (instancePath: string): Promise<string> =>
    ipcRenderer.invoke("mods:export-info", instancePath),
  saveModpackReport: (
    format: "md" | "json" | "csv",
    content: string,
  ): Promise<string | null> =>
    ipcRenderer.invoke("reports:save-file", { format, content }),
  /** Recursively list text config files and folders in an instance. */
  scanConfigTree: (instancePath: string): Promise<ConfigTreeEntry[]> =>
    ipcRenderer.invoke("config:scan-tree", instancePath),
  /** Read one file beneath the instance config directory. */
  readConfigFile: (
    instancePath: string,
    relativePath: string,
  ): Promise<ConfigFileDocument> =>
    ipcRenderer.invoke("config:read-file", instancePath, relativePath),
  /** Save one file beneath the instance config directory. */
  saveConfigFile: (
    instancePath: string,
    relativePath: string,
    content: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke("config:save-file", instancePath, relativePath, content),
  getMappedConfigFiles: (
    instancePath: string,
    modId: string,
  ): Promise<ConfigMappingMatch[]> =>
    ipcRenderer.invoke("configs:get-mapped-files", instancePath, modId),
  setManualConfigMapping: (
    instancePath: string,
    modId: string,
    filePath: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke(
      "configs:set-manual-mapping",
      instancePath,
      modId,
      filePath,
    ),
  getConfigModMatches: (
    instancePath: string,
    filePath: string,
    modIds: string[],
  ): Promise<ConfigModMatch[]> =>
    ipcRenderer.invoke(
      "configs:get-mod-matches",
      instancePath,
      filePath,
      modIds,
    ),
  resetManualConfigMappings: (
    instancePath: string,
    filePath: string,
  ): Promise<string[]> =>
    ipcRenderer.invoke("configs:reset-manual-mappings", instancePath, filePath),
  openConfigInVSCode: (
    instancePath: string,
    filePath: string,
    vsCodePath?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke(
      "configs:open-with-vscode",
      instancePath,
      filePath,
      vsCodePath,
    ),
  deleteConfigFiles: (
    instancePath: string,
    filePaths: string[],
  ): Promise<ConfigDeleteResult> =>
    ipcRenderer.invoke("configs:delete-configs", instancePath, filePaths),
  scanPacks: (instancePath: string): Promise<PacksScanResult> =>
    ipcRenderer.invoke("packs:scan-all", instancePath),
  setPackEnabled: (
    instancePath: string,
    category: PackCategory,
    path: string,
    enabled: boolean,
  ): Promise<boolean> =>
    ipcRenderer.invoke(
      "packs:set-enabled",
      instancePath,
      category,
      path,
      enabled,
    ),
  trashPack: (
    instancePath: string,
    category: PackCategory,
    path: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke("packs:trash", instancePath, category, path),
  openPackArchive: (
    instancePath: string,
    category: PackCategory,
    path: string,
    nanaZipPath?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke(
      "packs:open-archive",
      instancePath,
      category,
      path,
      nanaZipPath,
    ),
  revealPack: (
    instancePath: string,
    category: PackCategory,
    path: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke("packs:reveal", instancePath, category, path),
  listPackTextFiles: (
    instancePath: string,
    category: PackCategory,
    path: string,
  ): Promise<string[]> =>
    ipcRenderer.invoke("packs:list-text-files", instancePath, category, path),
  readPackTextFile: (
    instancePath: string,
    category: PackCategory,
    packPath: string,
    filePath: string,
  ): Promise<PackTextDocument> =>
    ipcRenderer.invoke(
      "packs:read-text-file",
      instancePath,
      category,
      packPath,
      filePath,
    ),
  savePackTextFile: (
    instancePath: string,
    category: PackCategory,
    packPath: string,
    filePath: string,
    content: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke(
      "packs:save-text-file",
      instancePath,
      category,
      packPath,
      filePath,
      content,
    ),
};

export type ModpackApi = typeof api;

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI;
  // @ts-ignore (define in dts)
  window.api = api;
}
