import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  dialog,
  clipboard,
} from "electron";
import { lstatSync, readdirSync, statSync, writeFileSync } from "fs";
import { basename, join, resolve, sep } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import { scanModsFolder } from "./modParser";
import { getLastFolder, saveLastFolder } from "./config";
import { getSettings, saveSettings } from "./settings";
import { setSideOverride } from "./sideOverrides";
import { getDepOverrides, setDepOverrides } from "./depOverrides";
import { getCatOverrides, setCatOverrides } from "./catOverrides";
import { getTrashHistory, restoreTrashedMods } from "./trashHistory";
import { getInstanceInfo } from "./instanceInfo";
import {
  openArchiveWithNanaZip,
  setModEnabled,
  trashModFile,
} from "./modFiles";
import { detectNanaZipPath } from "./nanaZip";
import { fetchOnlineMetadata } from "./onlineMetadata";
import { exportModpackInfo } from "./exportInfo";
import { readConfigFile, saveConfigFile, scanConfigTree } from "./configFiles";
import {
  listManagedInstances,
  scanAtLauncherInstances,
  saveManagedInstance,
  untrackManagedInstance,
  validateInstanceRoot,
} from "./managedInstances";
import {
  createSnapshot,
  deleteSnapshot,
  listSnapshots,
  rollbackSnapshot,
} from "./services/SnapshotService";
import { listAvailableThemes, openThemesFolder } from "./themes";
import {
  deleteMappedConfigFiles,
  getConfigModMatches,
  getMappedConfigFiles,
  resetManualConfigMappings,
  setManualConfigMapping,
} from "./configMapperService";
import { detectVSCodePath, openConfigInVSCode } from "./vsCode";
import { logCrash } from "./crashLogger";
import {
  readRegistryAssetBuffer,
  readRegistryAssets,
  invalidateInstanceRegistryCache,
  scanInstanceRegistries,
} from "./services/RegistryService";
import {
  cancelAllSyncTransfers,
  cancelSyncTransfer,
  clearHostedPeer,
  configureSyncOptions,
  connectSyncPeer,
  disconnectSyncPeer,
  pullSyncFile,
  pushSyncFile,
  startSyncHost,
  stopSyncHost,
  suggestPeerDelete,
} from "./services/SyncService";
import {
  listPackTextFiles,
  readPackTextFile,
  resolvePackItemPath,
  savePackTextFile,
  scanAllPacks,
  setPackEnabled,
  trashPack,
} from "./packs";
import type {
  AppSettings,
  CatOverrideEntry,
  DepOverrideEntry,
  PackCategory,
  RegistryAssetRequest,
  RegistryExportAssetRequest,
  SideOverride,
  SyncManifestEntry,
} from "../shared/types";

let mainWindow: BrowserWindow | null = null;

process.on("uncaughtException", (error) => {
  const logPath = logCrash("UNCAUGHT_EXCEPTION", error);
  const logLocation = logPath
    ? `A crash log was saved to:\n${logPath}`
    : "The crash log could not be saved.";
  try {
    dialog.showErrorBox(
      "StarTools Unexpected Error",
      `An unexpected error occurred:\n${error.message}\n\n${logLocation}`,
    );
  } catch (dialogError) {
    console.error("Failed to show crash dialog", dialogError);
  } finally {
    // An uncaught exception leaves the main process in an unknown state.
    app.exit(1);
  }
});

process.on("unhandledRejection", (reason) => {
  logCrash("UNHANDLED_REJECTION", reason);
});

/** Push the current restorable count so the Restore button updates live. */
function broadcastTrashCount(): void {
  try {
    const { restorableCount } = getTrashHistory();
    mainWindow?.webContents.send("trash:count-changed", restorableCount);
  } catch {
    // Window gone — renderer refetches after its own awaits as fallback.
  }
}

function createWindow(): void {
  const startupWindowMode = getSettings().startupWindowMode;
  const window_ = new BrowserWindow({
    title: "StarTools - Modpack Manager",
    icon: join(
      is.dev ? app.getAppPath() : process.resourcesPath,
      ...(is.dev ? ["build", "logo.ico"] : ["logo.ico"]),
    ),
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    center: true,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  mainWindow = window_;

  if (startupWindowMode === "maximized") window_.maximize();
  else if (startupWindowMode === "fullscreen") window_.setFullScreen(true);

  window_.once("ready-to-show", () => {
    window_.show();
    window_.focus();
  });

  window_.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    window_.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    window_.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.modpacktool.app");

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  ipcMain.handle("dialog:select-instance", async () => {
    const result = await dialog.showOpenDialog({
      title: "Select modpack instance folder",
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("app:get-version", () => app.getVersion());
  ipcMain.handle(
    "sync:start-host",
    (event, instancePath: string, port: number) =>
      startSyncHost(instancePath, port, (syncEvent) => {
        if (event.sender.isDestroyed()) return;
        if (syncEvent.type === "peer-connected") {
          event.sender.send("sync:peer-connected", syncEvent.connection);
        } else if (syncEvent.type === "diff-updated") {
          event.sender.send("sync:diff-updated", {
            diff: syncEvent.diff,
            summary: syncEvent.summary,
          });
        } else if (syncEvent.type === "peer-disconnected") {
          event.sender.send("sync:peer-disconnected");
        } else {
          event.sender.send("sync:event", syncEvent);
        }
      }),
  );
  ipcMain.handle("sync:stop-host", () => {
    cancelAllSyncTransfers();
    return stopSyncHost();
  });
  ipcMain.handle("sync:cancel-transfer", (_event, transferId: string) =>
    cancelSyncTransfer(transferId),
  );
  ipcMain.handle("sync:cancel-all-transfers", () => cancelAllSyncTransfers());
  ipcMain.handle("sync:clear-hosted-peer", async () => {
    cancelAllSyncTransfers();
    await clearHostedPeer();
    return true;
  });
  ipcMain.handle(
    "sync:disconnect-peer",
    async (_event, peerIp: string, peerPort: number) => {
      cancelAllSyncTransfers();
      await disconnectSyncPeer(peerIp, peerPort);
      await clearHostedPeer();
      return true;
    },
  );
  ipcMain.handle(
    "sync:connect-peer",
    (_event, instancePath: string, peerIp: string, peerPort: number) =>
      connectSyncPeer(instancePath, peerIp, peerPort),
  );
  ipcMain.handle(
    "sync:push-file",
    (
      event,
      instancePath: string,
      peerIp: string,
      peerPort: number,
      entry: SyncManifestEntry,
      replaceModId?: string,
      transferId?: string,
    ) =>
      pushSyncFile(
        instancePath,
        peerIp,
        peerPort,
        entry,
        replaceModId,
        (syncEvent) => {
          if (!event.sender.isDestroyed())
            event.sender.send("sync:event", syncEvent);
        },
        transferId,
      ),
  );
  ipcMain.handle(
    "sync:pull-file",
    (
      event,
      instancePath: string,
      peerIp: string,
      peerPort: number,
      entry: SyncManifestEntry,
      replaceModId?: string,
      transferId?: string,
    ) =>
      pullSyncFile(
        instancePath,
        peerIp,
        peerPort,
        entry,
        replaceModId,
        (syncEvent) => {
          if (!event.sender.isDestroyed())
            event.sender.send("sync:event", syncEvent);
        },
        transferId,
      ),
  );
  ipcMain.handle(
    "sync:suggest-delete",
    (_event, peerIp: string, peerPort: number, entry: SyncManifestEntry) =>
      suggestPeerDelete(peerIp, peerPort, entry),
  );
  ipcMain.handle(
    "registry:scan-instance",
    async (event, instancePath: string) =>
      scanInstanceRegistries(instancePath, (progress) =>
        event.sender.send("registry:scan-progress", progress),
      ),
  );
  ipcMain.handle(
    "registry:read-assets",
    (_event, instancePath: string, requests: RegistryAssetRequest[]) =>
      readRegistryAssets(instancePath, requests),
  );
  ipcMain.handle(
    "registry:export-asset",
    async (
      _event,
      instancePath: string,
      request: RegistryExportAssetRequest,
    ) => {
      if (!request || typeof request.defaultFileName !== "string")
        return { success: false };
      const assetPath = request.assetPath;
      const isPng =
        typeof assetPath === "string" &&
        assetPath.toLowerCase().endsWith(".png");
      const isJson =
        typeof assetPath === "string" &&
        assetPath.toLowerCase().endsWith(".json");
      if (!isPng && !isJson) return { success: false };
      const defaultFileName = basename(request.defaultFileName)
        .replace(/[<>:"/\\|?*]/g, "_")
        .split("")
        .filter((character) => character.charCodeAt(0) >= 32)
        .join("");
      const options = {
        title: "Export Registry Asset",
        defaultPath: join(
          app.getPath("desktop"),
          defaultFileName || (isPng ? "texture.png" : "model.json"),
        ),
        filters: isPng
          ? [{ name: "PNG Image", extensions: ["png"] }]
          : [{ name: "Model JSON", extensions: ["json"] }],
      };
      const result = mainWindow
        ? await dialog.showSaveDialog(mainWindow, options)
        : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return { success: false };
      const data = readRegistryAssetBuffer(instancePath, request);
      if (!data) return { success: false };
      writeFileSync(result.filePath, data);
      return { success: true, filePath: result.filePath };
    },
  );
  ipcMain.handle("instances:list", () => listManagedInstances());
  ipcMain.handle("instances:scan-atlauncher", () => scanAtLauncherInstances());
  ipcMain.handle("instances:save", (_event, instancePath: string) =>
    saveManagedInstance(instancePath),
  );
  ipcMain.handle("instances:untrack", (_event, id: string) =>
    untrackManagedInstance(id),
  );
  ipcMain.handle("instances:reveal", (_event, instancePath: string) => {
    shell.showItemInFolder(validateInstanceRoot(instancePath));
    return true;
  });
  ipcMain.handle(
    "instances:open-folder",
    async (
      _event,
      instancePath: string,
      folder: "config" | "crash-reports",
    ) => {
      if (folder !== "config" && folder !== "crash-reports") {
        throw new Error("Unsupported instance folder");
      }
      const root = validateInstanceRoot(instancePath);
      const target = resolve(root, folder);
      const stats = lstatSync(target);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new Error(`The ${folder} folder is unavailable`);
      }
      const error = await shell.openPath(target);
      if (error) throw new Error(error);
      return true;
    },
  );
  ipcMain.handle(
    "instances:scan-crash-reports",
    (_event, instancePath: string) => {
      const root = validateInstanceRoot(instancePath);
      const reportDir = resolve(root, "crash-reports");
      let directoryStats;
      try {
        directoryStats = lstatSync(reportDir);
      } catch {
        return [];
      }
      if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink())
        return [];
      return readdirSync(reportDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
        .map((entry) => {
          const filePath = resolve(reportDir, entry.name);
          const fileStats = statSync(filePath);
          return { name: entry.name, modifiedAt: fileStats.mtimeMs };
        })
        .sort((a, b) => b.modifiedAt - a.modifiedAt);
    },
  );
  ipcMain.handle(
    "instances:open-crash-report",
    async (_event, instancePath: string, fileName: string) => {
      const root = validateInstanceRoot(instancePath);
      if (typeof fileName !== "string" || basename(fileName) !== fileName) {
        throw new Error("Invalid crash report name");
      }
      const reportDir = resolve(root, "crash-reports");
      const directoryStats = lstatSync(reportDir);
      if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
        throw new Error("The crash-reports folder is unavailable");
      }
      const filePath = resolve(reportDir, fileName);
      if (!filePath.startsWith(`${reportDir}${sep}`)) {
        throw new Error("Invalid crash report path");
      }
      const stats = lstatSync(filePath);
      if (!stats.isFile() || stats.isSymbolicLink()) {
        throw new Error("The selected crash report is unavailable");
      }
      const error = await shell.openPath(filePath);
      if (error) throw new Error(error);
      return true;
    },
  );
  ipcMain.handle("clipboard:write-text", (_event, value: string) => {
    if (typeof value !== "string") throw new Error("Invalid clipboard text");
    clipboard.writeText(value);
    return true;
  });
  ipcMain.handle("snapshots:list", (_event, instancePath: string) =>
    listSnapshots(instancePath),
  );
  ipcMain.handle(
    "snapshots:create",
    (_event, instancePath: string, name: string) =>
      createSnapshot(instancePath, name),
  );
  ipcMain.handle(
    "snapshots:rollback",
    (_event, instancePath: string, snapshotId: string) =>
      rollbackSnapshot(instancePath, snapshotId),
  );
  ipcMain.handle(
    "snapshots:delete",
    (_event, instancePath: string, snapshotId: string) =>
      deleteSnapshot(instancePath, snapshotId),
  );
  ipcMain.handle("themes:get-available", () => listAvailableThemes());
  ipcMain.handle("themes:open-folder", async () => {
    const path = openThemesFolder();
    const error = await shell.openPath(path);
    if (error) throw new Error(error);
    return true;
  });

  ipcMain.handle("dialog:select-nanazip", async () => {
    const result = await dialog.showOpenDialog({
      title: "Select NanaZip executable",
      properties: ["openFile"],
      filters: [{ name: "Applications", extensions: ["exe"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("settings:detect-nanazip", () => detectNanaZipPath());

  ipcMain.handle("dialog:select-vscode", async () => {
    const result = await dialog.showOpenDialog({
      title: "Select Visual Studio Code executable",
      properties: ["openFile"],
      filters: [{ name: "Applications", extensions: ["exe"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("settings:detect-vscode", () => detectVSCodePath());

  ipcMain.handle("mods:scan", async (event, instancePath: string) => {
    // Errors (e.g. missing /mods folder) propagate to the renderer as rejections.
    return scanModsFolder(instancePath, (stage) =>
      event.sender.send("mods:scan-progress", stage),
    );
  });

  ipcMain.handle(
    "mods:set-side-override",
    (_event, modId: string, side: SideOverride | null) => {
      // Persists a user-defined side; the next scan (or immediate UI update)
      // reflects it. Invalid input throws and rejects the renderer's invoke.
      setSideOverride(modId, side);
      return true;
    },
  );

  ipcMain.handle(
    "mods:set-enabled",
    async (
      _event,
      instancePath: string,
      fileName: string,
      enabled: boolean,
    ) => {
      // Moves the jar between \mods\ and \disabledmods\. Throws on failure.
      const result = setModEnabled(instancePath, fileName, enabled);
      invalidateInstanceRegistryCache(instancePath);
      for (const window_ of BrowserWindow.getAllWindows()) {
        if (!window_.webContents.isDestroyed())
          window_.webContents.send("instance:registry-outdated", {
            instancePath,
          });
      }
      return result;
    },
  );

  ipcMain.handle(
    "configs:get-mapped-files",
    (_event, instancePath: string, modId: string) => {
      return getMappedConfigFiles(instancePath, modId);
    },
  );

  ipcMain.handle(
    "configs:set-manual-mapping",
    (_event, instancePath: string, modId: string, filePath: string) => {
      return setManualConfigMapping(instancePath, modId, filePath);
    },
  );

  ipcMain.handle(
    "configs:get-mod-matches",
    (_event, instancePath: string, filePath: string, modIds: string[]) =>
      getConfigModMatches(instancePath, filePath, modIds),
  );

  ipcMain.handle(
    "configs:reset-manual-mappings",
    (_event, instancePath: string, filePath: string) =>
      resetManualConfigMappings(instancePath, filePath),
  );

  ipcMain.handle(
    "configs:open-with-vscode",
    (_event, instancePath: string, filePath: string, vsCodePath?: string) =>
      openConfigInVSCode(instancePath, filePath, vsCodePath),
  );

  ipcMain.handle(
    "configs:delete-configs",
    (_event, instancePath: string, filePaths: string[]) => {
      try {
        return deleteMappedConfigFiles(instancePath, filePaths);
      } finally {
        broadcastTrashCount();
      }
    },
  );

  ipcMain.handle("packs:scan-all", (_event, instancePath: string) =>
    scanAllPacks(instancePath),
  );

  ipcMain.handle(
    "packs:set-enabled",
    (
      _event,
      instancePath: string,
      category: PackCategory,
      path: string,
      enabled: boolean,
    ) => {
      return setPackEnabled(instancePath, category, path, enabled);
    },
  );

  ipcMain.handle(
    "packs:trash",
    (_event, instancePath: string, category: PackCategory, path: string) => {
      try {
        return trashPack(instancePath, category, path);
      } finally {
        broadcastTrashCount();
      }
    },
  );

  ipcMain.handle(
    "packs:reveal",
    (_event, instancePath: string, category: PackCategory, path: string) => {
      shell.showItemInFolder(resolvePackItemPath(instancePath, category, path));
      return true;
    },
  );

  ipcMain.handle(
    "packs:open-archive",
    (
      _event,
      instancePath: string,
      category: PackCategory,
      path: string,
      nanaZipPath?: string,
    ) => {
      return openArchiveWithNanaZip(
        resolvePackItemPath(instancePath, category, path),
        nanaZipPath,
      );
    },
  );

  ipcMain.handle(
    "packs:list-text-files",
    (_event, instancePath: string, category: PackCategory, path: string) => {
      return listPackTextFiles(instancePath, category, path);
    },
  );

  ipcMain.handle(
    "packs:read-text-file",
    (
      _event,
      instancePath: string,
      category: PackCategory,
      packPath: string,
      filePath: string,
    ) => {
      return readPackTextFile(instancePath, category, packPath, filePath);
    },
  );

  ipcMain.handle(
    "packs:save-text-file",
    (
      _event,
      instancePath: string,
      category: PackCategory,
      packPath: string,
      filePath: string,
      content: string,
    ) => {
      return savePackTextFile(
        instancePath,
        category,
        packPath,
        filePath,
        content,
      );
    },
  );

  ipcMain.handle(
    "mods:trash",
    (_event, instancePath: string, fileName: string, modId: string) => {
      // Stages the jar in trash_staging/ (restorable). Throws on failure.
      try {
        return trashModFile(instancePath, fileName, modId);
      } finally {
        broadcastTrashCount();
      }
    },
  );

  ipcMain.handle(
    "mods:open-archive",
    async (_event, filePath: string, nanaZipPath?: string) => {
      return openArchiveWithNanaZip(filePath, nanaZipPath);
    },
  );

  ipcMain.handle(
    "mods:fetch-online-data",
    async (event, modPaths: string[]) => {
      return fetchOnlineMetadata(modPaths, (progress) =>
        event.sender.send("mods:fetch-progress", progress),
      );
    },
  );

  ipcMain.handle("mods:get-trash-history", () => {
    return getTrashHistory();
  });

  ipcMain.handle("mods:restore-trashed-mods", () => {
    // Moves staged jars back into their instance's \mods\ folder.
    try {
      return restoreTrashedMods();
    } finally {
      broadcastTrashCount();
    }
  });

  ipcMain.handle("mods:get-instance-info", (_event, instancePath: string) => {
    // Parses the instance manifest + counts jars. Throws on invalid input.
    return getInstanceInfo(instancePath);
  });

  ipcMain.handle("mods:export-info", (_event, instancePath: string) => {
    return exportModpackInfo(instancePath);
  });

  ipcMain.handle(
    "reports:save-file",
    async (
      _event,
      request: { format: "md" | "json" | "csv"; content: string },
    ) => {
      if (
        !request ||
        !["md", "json", "csv"].includes(request.format) ||
        typeof request.content !== "string"
      )
        throw new Error("Invalid report export request.");
      const extension = request.format;
      const result = mainWindow
        ? await dialog.showSaveDialog(mainWindow, {
            title: "Save Modpack Report",
            defaultPath: join(
              app.getPath("desktop"),
              `modpack-report.${extension}`,
            ),
            filters: [
              {
                name: `${extension.toUpperCase()} file`,
                extensions: [extension],
              },
            ],
          })
        : await dialog.showSaveDialog({
            title: "Save Modpack Report",
            defaultPath: join(
              app.getPath("desktop"),
              `modpack-report.${extension}`,
            ),
            filters: [
              {
                name: `${extension.toUpperCase()} file`,
                extensions: [extension],
              },
            ],
          });
      if (result.canceled || !result.filePath) return null;
      writeFileSync(result.filePath, request.content, "utf8");
      return result.filePath;
    },
  );

  ipcMain.handle("config:scan-tree", (_event, instancePath: string) => {
    return scanConfigTree(instancePath);
  });

  ipcMain.handle(
    "config:read-file",
    (_event, instancePath: string, relativePath: string) => {
      return readConfigFile(instancePath, relativePath);
    },
  );

  ipcMain.handle(
    "config:save-file",
    (_event, instancePath: string, relativePath: string, content: string) => {
      return saveConfigFile(instancePath, relativePath, content);
    },
  );

  ipcMain.handle("settings:get", () => {
    const settings = getSettings();
    configureSyncOptions(settings.syncBufferSizeKb, settings.autoDetectRadmin);
    return settings;
  });

  ipcMain.handle("settings:save", (_event, patch: Partial<AppSettings>) => {
    // Merges and persists UI preferences. Throws on failure.
    if (typeof patch !== "object" || patch === null) {
      throw new Error("Invalid settings patch");
    }
    const saved = saveSettings(patch);
    configureSyncOptions(saved.syncBufferSizeKb, saved.autoDetectRadmin);
    return saved;
  });

  ipcMain.handle("mods:get-dep-overrides", () => {
    return getDepOverrides();
  });

  ipcMain.handle(
    "mods:set-dep-overrides",
    (_event, modId: string, entry: DepOverrideEntry) => {
      // Replaces the dependency override entry for one mod. Throws on failure.
      return setDepOverrides(modId, entry);
    },
  );

  ipcMain.handle("mods:get-cat-overrides", () => {
    return getCatOverrides();
  });

  ipcMain.handle(
    "mods:set-cat-overrides",
    (_event, modId: string, entry: CatOverrideEntry) => {
      // Replaces the category override entry for one mod. Throws on failure.
      return setCatOverrides(modId, entry);
    },
  );

  ipcMain.handle("config:get-last-folder", () => {
    return getLastFolder();
  });

  ipcMain.handle("config:save-last-folder", (_event, folder: string) => {
    if (typeof folder !== "string" || folder.length === 0) {
      throw new Error("Invalid folder path");
    }
    saveLastFolder(folder);
    return true;
  });

  createWindow();

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  void stopSyncHost();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
