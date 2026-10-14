import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Folder,
  Home,
  Info,
  PackageSearch,
  Settings as SettingsIcon,
} from "lucide-react";
import {
  APP_FONT_STACKS,
  APP_ICON_SIZE_PX,
  DEFAULT_SETTINGS,
  TABLE_FONT_PX,
  type AppSettings,
  type CatOverrideEntry,
  type CatOverrides,
  type ConfigMappingMatch,
  type ConfigTreeEntry,
  type DepOverrideEntry,
  type InstanceInfo,
  type ManagedInstance,
  type CustomTheme,
  type OnlineFetchProgress,
  type OnlineModData,
  type ParsedMod,
  type ScanModsResult,
  type ScanProgressStage,
  type SideOverride,
} from "../../shared/types";
import CategoryEditor from "./components/CategoryEditor";
import ConfigView from "./components/ConfigView";
import ConfigTrashDialog from "./components/ConfigTrashDialog";
import DependencyEditor from "./components/DependencyEditor";
import FolderSelector from "./components/FolderSelector";
import InstanceInfoModal from "./components/InstanceInfoModal";
import ModTable, { type SortDir, type SortKey } from "./components/ModTable";
import Pagination from "./components/Pagination";
import PacksView from "./components/PacksView";
import SearchFilterBar, {
  type SideFilter,
  type StatusFilter,
  type WarningFilter,
} from "./components/SearchFilterBar";
import SettingsModal from "./components/SettingsModal";
import HomeScreen, { InstanceLoadingScreen } from "./components/HomeScreen";
import SnapshotManagerModal from "./components/SnapshotManagerModal";

const PAGE_SIZE = 20;

function instanceBadgeLabel(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  const instanceName = parts.at(-1) ?? path;
  const parent = parts.at(-2) ?? "Instance";
  const launcher =
    parent.toLowerCase() === "instances" ? (parts.at(-3) ?? parent) : parent;
  return `${launcher} / ${instanceName}`;
}

function prefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return true;
  }
}

function isDarkColor(value: string | undefined): boolean {
  if (!value) return true;
  let hex = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hex))
    hex = hex
      .split("")
      .map((part) => part + part)
      .join("");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return true;
  const channels = [0, 2, 4].map(
    (offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255,
  );
  const luminance =
    0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  return luminance < 0.48;
}

function App(): React.JSX.Element {
  const [currentView, setCurrentView] = useState<"home" | "workspace">("home");
  const [managedInstances, setManagedInstances] = useState<ManagedInstance[]>(
    [],
  );
  const [appVersion, setAppVersion] = useState("");
  const [customThemes, setCustomThemes] = useState<CustomTheme[]>([]);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [isSwitchingInstance, setIsSwitchingInstance] = useState(false);
  const [switchingInstanceName, setSwitchingInstanceName] = useState("");
  const [switchingStage, setSwitchingStage] = useState<
    ScanProgressStage | "ready"
  >("reading");
  const [activeTab, setActiveTab] = useState<"modlist" | "config" | "packs">(
    "modlist",
  );
  const [instancePath, setInstancePath] = useState<string | null>(null);
  const [result, setResult] = useState<ScanModsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [query, setQuery] = useState("");
  const [sideFilter, setSideFilter] = useState<SideFilter>("All");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [warningFilter, setWarningFilter] = useState<WarningFilter>("All");
  const [editingModId, setEditingModId] = useState<string | null>(null);
  const [editingCatsModId, setEditingCatsModId] = useState<string | null>(null);
  const [catOverrides, setCatOverrides] = useState<CatOverrides>({});
  const [infoOpen, setInfoOpen] = useState(false);
  const [instanceInfo, setInstanceInfo] = useState<InstanceInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(() => ({
    ...DEFAULT_SETTINGS,
    // First run follows the OS; thereafter the persisted choice wins.
    theme: prefersDark() ? "dark" : "light",
  }));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [restorableCount, setRestorableCount] = useState(0);
  const [restoring, setRestoring] = useState(false);
  const [onlineData, setOnlineData] = useState<Record<string, OnlineModData>>(
    {},
  );
  const [fetchingOnline, setFetchingOnline] = useState(false);
  const [fetchProgress, setFetchProgress] =
    useState<OnlineFetchProgress | null>(null);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingConfigDelete, setPendingConfigDelete] = useState<{
    mod: ParsedMod;
    matches: ConfigMappingMatch[];
    selected: Set<string>;
  } | null>(null);
  const [configDeleteBusy, setConfigDeleteBusy] = useState(false);
  const [configOpenRequest, setConfigOpenRequest] = useState<{
    path: string;
    id: number;
  } | null>(null);
  const configOpenSequence = useRef(0);
  const didAutoLoad = useRef(false);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  // Apply theme + table font size + font family to the document.
  useEffect(() => {
    const root = document.documentElement;
    const custom = customThemes.find(
      (theme) => theme.id === settings.customThemeId,
    );
    const dark = custom
      ? isDarkColor(custom.colors["--bg-app"])
      : settings.theme === "dark";
    root.classList.toggle("dark", dark);
    root.dataset.theme = custom
      ? `custom-${custom.id}`
      : settings.theme === "dark"
        ? "obsidian"
        : "warm-oat";
    let style = document.getElementById(
      "custom-theme-css",
    ) as HTMLStyleElement | null;
    if (custom) {
      for (const [name, value] of Object.entries(custom.colors))
        if (value) root.style.setProperty(name, value);
      const bg = custom.colors["--bg-app"] ?? "#0c0d10";
      const surface = custom.colors["--bg-surface"] ?? "#14151a";
      const elevated = custom.colors["--bg-elevated"] ?? "#1e2027";
      const border =
        custom.colors["--border-subtle"] ?? "rgba(255,255,255,.07)";
      const text = custom.colors["--text-main"] ?? "#f4f4f5";
      const muted = custom.colors["--text-muted"] ?? "#a1a1aa";
      const variables: Record<string, string> = {
        "--color-white": surface,
        "--color-gray-50": text,
        "--color-gray-100": text,
        "--color-gray-200": border,
        "--color-gray-300": muted,
        "--color-gray-400": muted,
        "--color-gray-500": muted,
        "--color-gray-600": muted,
        "--color-gray-700": border,
        "--color-gray-800": elevated,
        "--color-gray-900": surface,
        "--color-gray-950": bg,
        "--color-zinc-600": muted,
      };
      for (const [name, value] of Object.entries(variables))
        root.style.setProperty(name, value);
      if (!style) {
        style = document.createElement("style");
        style.id = "custom-theme-css";
        document.head.append(style);
      }
      style.textContent = custom.styleCss ?? "";
    } else {
      for (const name of [
        "--bg-app",
        "--bg-surface",
        "--bg-elevated",
        "--border-subtle",
        "--text-main",
        "--text-muted",
        "--color-white",
        "--color-gray-50",
        "--color-gray-100",
        "--color-gray-200",
        "--color-gray-300",
        "--color-gray-400",
        "--color-gray-500",
        "--color-gray-600",
        "--color-gray-700",
        "--color-gray-800",
        "--color-gray-900",
        "--color-gray-950",
        "--color-zinc-600",
      ])
        root.style.removeProperty(name);
      style?.remove();
    }
    document.documentElement.style.setProperty(
      "--app-font-size",
      `${TABLE_FONT_PX[settings.tableFont]}px`,
    );
    document.documentElement.style.setProperty(
      "--app-icon-size",
      `${APP_ICON_SIZE_PX[settings.tableFont]}px`,
    );
    document.body.style.setProperty(
      "--app-font-family",
      APP_FONT_STACKS[settings.fontFamily],
    );
  }, [settings, customThemes]);

  const refreshTrashState = useCallback((): void => {
    window.api
      .getTrashHistory()
      .then((state) => setRestorableCount(state.restorableCount))
      .catch(() => setRestorableCount(0));
  }, []);

  const refreshCatOverrides = useCallback((): void => {
    window.api
      .getCatOverrides()
      .then((map) => setCatOverrides(map))
      .catch(() => setCatOverrides({}));
  }, []);

  const scanFolder = useCallback(
    async (
      folder: string,
      keepPage = false,
      onProgress?: (stage: ScanProgressStage) => void,
    ): Promise<boolean> => {
      setInstancePath(folder);
      setLoading(true);
      setError(null);
      try {
        const scan = await window.api.scanMods(folder, onProgress);
        setResult(scan);
        void window.api
          .listManagedInstances()
          .then(async (tracked) => {
            if (
              tracked.some(
                (instance) =>
                  instance.path.toLowerCase() === folder.toLowerCase(),
              )
            ) {
              await window.api.saveManagedInstance(folder);
              setManagedInstances(await window.api.listManagedInstances());
            }
          })
          .catch(() => undefined);
        if (!keepPage) setPage(1);
        // Persist only after a successful scan.
        await window.api.saveLastFolder(folder).catch(() => undefined);
        refreshTrashState();
        return true;
      } catch (err) {
        setResult(null);
        setError(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        setLoading(false);
      }
    },
    [refreshTrashState],
  );

  // On startup, restore the last opened instance folder (if it still exists).
  useEffect(() => {
    if (didAutoLoad.current) return;
    didAutoLoad.current = true;
    const settingsPromise = window.api
      .getSettings()
      .then((saved) => {
        setSettings((prev) => ({ ...prev, ...saved }));
        return saved;
      })
      .catch(() => DEFAULT_SETTINGS);
    refreshTrashState();
    refreshCatOverrides();
    void window.api
      .listManagedInstances()
      .then(setManagedInstances)
      .catch(() => setManagedInstances([]));
    void window.api
      .getAppVersion()
      .then(setAppVersion)
      .catch(() => undefined);
    void window.api
      .getAvailableThemes()
      .then(setCustomThemes)
      .catch(() => setCustomThemes([]));
    const unsubscribeTrash = window.api.onTrashCountChanged((count) => {
      setRestorableCount(count);
    });
    void settingsPromise.then(async (savedSettings) => {
      const saved = await window.api.getLastFolder().catch(() => null);
      if (!saved) return;
      try {
        const known = await window.api.listManagedInstances();
        if (
          known.length < 5 ||
          known.some((item) => item.path.toLowerCase() === saved.toLowerCase())
        ) {
          await window.api.saveManagedInstance(saved);
          setManagedInstances(await window.api.listManagedInstances());
        }
      } catch {
        // A missing previous instance should not block the Home screen.
      }
      if (savedSettings.landingScreen === "last-instance") {
        const folderName = saved.split(/[\\/]/).filter(Boolean).at(-1);
        setSwitchingInstanceName(folderName ?? saved);
        setSwitchingStage("reading");
        setIsSwitchingInstance(true);
        try {
          const opened = await scanFolder(saved, false, setSwitchingStage);
          if (opened) {
            setSwitchingStage("ready");
            await new Promise((resolve) => window.setTimeout(resolve, 200));
            setCurrentView("workspace");
          }
        } finally {
          setIsSwitchingInstance(false);
        }
      }
    });
    return () => {
      unsubscribeTrash();
    };
  }, [refreshCatOverrides, refreshTrashState, scanFolder]);

  const handleSelect = async (): Promise<void> => {
    setError(null);
    try {
      const picked = await window.api.selectInstanceFolder();
      if (!picked) return; // user cancelled
      const opened = await scanFolder(picked);
      if (!opened) return;
      setCurrentView("workspace");
      try {
        await window.api.saveManagedInstance(picked);
        setManagedInstances(await window.api.listManagedInstances());
      } catch {
        setToast(
          "Workspace opened. The instance list is full, so it was not tracked.",
        );
      }
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleAddInstance = async (): Promise<void> => {
    try {
      const picked = await window.api.selectInstanceFolder();
      if (!picked) return;
      const saved = await window.api.saveManagedInstance(picked);
      setManagedInstances(await window.api.listManagedInstances());
      setToast(`${saved.name} added to your instances.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleOpenManagedInstance = async (
    instance: ManagedInstance,
  ): Promise<void> => {
    setError(null);
    setSwitchingInstanceName(instance.name);
    setSwitchingStage("reading");
    setIsSwitchingInstance(true);
    try {
      const opened = await scanFolder(instance.path, false, setSwitchingStage);
      if (!opened) return;
      setSwitchingStage("ready");
      await new Promise((resolve) => window.setTimeout(resolve, 200));
      try {
        await window.api.saveManagedInstance(instance.path);
        setManagedInstances(await window.api.listManagedInstances());
      } catch {
        // The opened instance remains available even if its registry refresh fails.
      }
      setCurrentView("workspace");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSwitchingInstance(false);
    }
  };

  const handleUntrackInstance = async (
    instance: ManagedInstance,
  ): Promise<void> => {
    if (
      !window.confirm(
        `Remove ${instance.name} from the list? Files on disk will not be changed.`,
      )
    )
      return;
    try {
      await window.api.untrackManagedInstance(instance.id);
      setManagedInstances(await window.api.listManagedInstances());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRefresh = (): void => {
    if (instancePath && !loading) void scanFolder(instancePath, true);
  };

  const handleFetchOnline = async (): Promise<void> => {
    if (!result || loading || fetchingOnline) return;
    setError(null);
    setFetchingOnline(true);
    setFetchProgress({
      stage: "hashing",
      current: 0,
      total: result.mods.length,
    });
    try {
      const response = await window.api.fetchOnlineData(
        result.mods.map((m) => m.filePath),
        setFetchProgress,
      );
      // Merge by file path so earlier fetches (other instances) are kept.
      setOnlineData((prev) => ({ ...prev, ...response.data }));
      refreshCatOverrides();
      setToast("Modrinth metadata lookup complete.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetchingOnline(false);
      setFetchProgress(null);
    }
  };

  const refreshAfterMutation = (): void => {
    if (instancePath && !loading) void scanFolder(instancePath, true);
  };

  const handleToggleEnabled = async (mod: ParsedMod): Promise<void> => {
    if (!instancePath || loading) return;
    setError(null);
    try {
      await window.api.setModEnabled(instancePath, mod.fileName, !mod.enabled);
      refreshAfterMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const moveModToTrash = async (mod: ParsedMod): Promise<void> => {
    if (!instancePath || loading) return;
    await window.api.trashMod(instancePath, mod.fileName, mod.modId);
    if (editingModId === mod.modId) setEditingModId(null);
    if (editingCatsModId === mod.modId) setEditingCatsModId(null);
    refreshAfterMutation();
    refreshTrashState();
  };

  const handleTrash = async (mod: ParsedMod): Promise<void> => {
    if (!instancePath || loading) return;
    setError(null);
    try {
      const matches = await window.api.getMappedConfigFiles(
        instancePath,
        mod.modId,
      );
      if (settings.promptDeleteAssociatedConfigs && matches.length > 0) {
        setPendingConfigDelete({
          mod,
          matches,
          selected: new Set(matches.map((match) => match.filePath)),
        });
      } else if (
        !settings.confirmTrashMods ||
        window.confirm(`Move ${mod.fileName} to the trash?`)
      ) {
        await moveModToTrash(mod);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const findFirstFile = (
    entries: ConfigTreeEntry[],
    insidePrefix = "",
  ): string | null => {
    for (const entry of entries) {
      if (entry.type === "file") {
        const extension = entry.name.split(".").pop()?.toLowerCase();
        const readable = new Set([
          "toml",
          "cfg",
          "ini",
          "json",
          "json5",
          "yaml",
          "yml",
          "properties",
          "txt",
          "mcmeta",
        ]);
        if (
          readable.has(extension ?? "") &&
          (!insidePrefix || entry.path.toLowerCase().startsWith(insidePrefix))
        )
          return entry.path;
      } else {
        const prefixMatches =
          !insidePrefix ||
          entry.path.toLowerCase() === insidePrefix.slice(0, -1) ||
          entry.path.toLowerCase().startsWith(insidePrefix);
        if (prefixMatches) {
          const nested = findFirstFile(
            entry.children ?? [],
            insidePrefix || `${entry.path.toLowerCase()}/`,
          );
          if (nested) return nested;
        }
      }
    }
    return null;
  };

  const handleOpenModConfig = async (
    mod: ParsedMod,
    inVSCode = false,
  ): Promise<void> => {
    if (!instancePath) return;
    setError(null);
    try {
      const matches = await window.api.getMappedConfigFiles(
        instancePath,
        mod.modId,
      );
      if (matches.length === 0) {
        setToast(`No config file is mapped to ${mod.modId}.`);
        return;
      }
      const fileMatch =
        matches.find(
          (match) => match.source === "manual" && match.type === "file",
        ) ?? matches.find((match) => match.type === "file");
      let target = fileMatch?.filePath;
      if (!target) {
        const directoryMatch =
          matches.find(
            (match) => match.source === "manual" && match.type === "directory",
          ) ?? matches.find((match) => match.type === "directory");
        if (directoryMatch) {
          const tree = await window.api.scanConfigTree(instancePath);
          target =
            findFirstFile(tree, `${directoryMatch.filePath.toLowerCase()}/`) ??
            undefined;
        }
      }
      if (!target) {
        setToast(`No config file is available for ${mod.modId}.`);
        return;
      }
      if (inVSCode) {
        await window.api.openConfigInVSCode(
          instancePath,
          target,
          settings.vsCodePath,
        );
        setToast(`Opened ${target} in VS Code.`);
      } else {
        configOpenSequence.current += 1;
        setConfigOpenRequest({ path: target, id: configOpenSequence.current });
        setActiveTab("config");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleOpenModFromConfig = (modId: string): void => {
    setQuery(modId);
    setPage(1);
    setSideFilter("All");
    setStatusFilter("All");
    setWarningFilter("All");
    setActiveTab("modlist");
  };

  const finishConfigDelete = async (includeConfigs: boolean): Promise<void> => {
    const pending = pendingConfigDelete;
    if (!pending || !instancePath || configDeleteBusy) return;
    setConfigDeleteBusy(true);
    setError(null);
    try {
      if (includeConfigs) {
        const paths = [...pending.selected];
        const result = await window.api.deleteConfigFiles(instancePath, paths);
        refreshTrashState();
        if (result.errors.length > 0) {
          setError(
            `Moved ${result.deletedCount} config item(s) to Restore. Mod left in place: ${result.errors.join("; ")}`,
          );
          setPendingConfigDelete(null);
          return;
        }
      }
      await moveModToTrash(pending.mod);
      setPendingConfigDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConfigDeleteBusy(false);
    }
  };

  const handleRestore = async (): Promise<void> => {
    if (loading || restoring) return;
    setError(null);
    setRestoring(true);
    try {
      await window.api.restoreTrashedMods();
      if (instancePath) await scanFolder(instancePath, true);
      refreshTrashState();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRestoring(false);
    }
  };

  const handleExport = async (): Promise<void> => {
    if (!instancePath || exporting || loading) return;
    setError(null);
    setExporting(true);
    try {
      await window.api.exportModpackInfo(instancePath);
      setToast("Modpack info exported to \\export\\modlist_export.md");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };

  const updateSettings = (patch: Partial<AppSettings>): void => {
    const previous = settings;
    // Optimistic apply; the effect above paints theme/font immediately.
    setSettings((prev) => ({ ...prev, ...patch }));
    window.api
      .saveSettings(patch)
      .then((saved) => setSettings((prev) => ({ ...prev, ...saved })))
      .catch((err: unknown) => {
        setSettings(previous);
        setError(err instanceof Error ? err.message : String(err));
      });
  };

  const handleOpenArchive = async (mod: ParsedMod): Promise<void> => {
    if (loading) return;
    setError(null);
    try {
      await window.api.openArchive(mod.filePath, settings.nanaZipPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleOpenPackArchive = async (
    category: "shaderpacks" | "resourcepacks" | "datapacks",
    path: string,
  ): Promise<void> => {
    if (!instancePath) return;
    await window.api.openPackArchive(
      instancePath,
      category,
      path,
      settings.nanaZipPath,
    );
  };

  const handleDepMutate = async (
    modId: string,
    entry: DepOverrideEntry,
  ): Promise<void> => {
    if (!instancePath || loading) return;
    setError(null);
    try {
      await window.api.setDepOverrides(modId, entry);
      await scanFolder(instancePath, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCatMutate = async (
    modId: string,
    entry: CatOverrideEntry,
  ): Promise<void> => {
    if (loading) return;
    setError(null);
    try {
      await window.api.setCatOverrides(modId, entry);
      refreshCatOverrides();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleOpenInfo = async (): Promise<void> => {
    if (!instancePath || loading) return;
    setInfoOpen(true);
    setInfoLoading(true);
    setInstanceInfo(null);
    try {
      const info = await window.api.getInstanceInfo(instancePath);
      setInstanceInfo(info);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setInfoOpen(false);
    } finally {
      setInfoLoading(false);
    }
  };

  const handleSideOverride = async (
    modId: string,
    side: SideOverride,
  ): Promise<void> => {
    if (!result) return;
    const previousMod = result.mods.find((m) => m.modId === modId);
    const previous = previousMod?.side;
    // Optimistic UI update.
    setResult({
      ...result,
      mods: result.mods.map((m) =>
        m.modId === modId ? { ...m, side, sideOverride: side } : m,
      ),
    });
    try {
      await window.api.setSideOverride(modId, side);
    } catch (err) {
      // Revert on failure so the UI never lies about persisted state.
      setResult((prev) =>
        prev
          ? {
              ...prev,
              mods: prev.mods.map((m) =>
                m.modId === modId && previous
                  ? {
                      ...m,
                      side: previous,
                      sideOverride: previousMod?.sideOverride,
                    }
                  : m,
              ),
            }
          : prev,
      );
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSort = (key: "name" | "side"): void => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    }
    setPage(1);
  };

  const filteredMods = useMemo(() => {
    const mods = (result?.mods ?? []).map((mod) => {
      const onlineSide = onlineData[mod.filePath]?.side;
      return !mod.sideOverride && onlineSide
        ? { ...mod, side: onlineSide }
        : mod;
    });
    const q = query.trim().toLowerCase();
    return mods.filter((m) => {
      if (sideFilter !== "All" && m.side !== sideFilter) return false;
      if (statusFilter === "Enabled" && !m.enabled) return false;
      if (statusFilter === "Disabled" && m.enabled) return false;
      if (
        warningFilter === "MissingMandatory" &&
        !m.dependencies.some((d) => d.mandatory && !d.satisfied && !d.removed)
      ) {
        return false;
      }
      if (
        warningFilter === "OptionalOnly" &&
        !m.dependencies.some((d) => !d.mandatory && !d.satisfied && !d.removed)
      ) {
        return false;
      }
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.modId.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q)
      );
    });
  }, [result, onlineData, query, sideFilter, statusFilter, warningFilter]);

  const sortedMods = useMemo(() => {
    const base = !sortKey
      ? filteredMods
      : [...filteredMods].sort(
          (a, b) =>
            a[sortKey].localeCompare(b[sortKey]) * (sortDir === "asc" ? 1 : -1),
        );
    // Pin disabled mods to the configured end (stable: relative order kept).
    const rank = (enabled: boolean): number =>
      settings.disabledPlacement === "end"
        ? enabled
          ? 0
          : 1
        : enabled
          ? 1
          : 0;
    return [...base].sort((a, b) => rank(a.enabled) - rank(b.enabled));
  }, [filteredMods, sortKey, sortDir, settings.disabledPlacement]);

  const isFiltering =
    query.trim().length > 0 ||
    sideFilter !== "All" ||
    statusFilter !== "All" ||
    warningFilter !== "All";

  const totalPages = Math.max(1, Math.ceil(sortedMods.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageMods = sortedMods.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );
  const missingCount =
    result?.mods.filter((m) =>
      m.dependencies.some((d) => d.mandatory && !d.satisfied && !d.removed),
    ).length ?? 0;
  const disabledCount = result?.mods.filter((m) => !m.enabled).length ?? 0;
  const editingMod = editingModId
    ? (result?.mods.find((m) => m.modId === editingModId) ?? null)
    : null;
  const editingCatsMod = editingCatsModId
    ? (result?.mods.find((m) => m.modId === editingCatsModId) ?? null)
    : null;
  const editingCatsEntry: CatOverrideEntry = (editingCatsMod &&
    catOverrides[editingCatsMod.modId.toLowerCase()]) ?? {
    added: [],
    removed: [],
  };
  const editingCatsScanned =
    (editingCatsMod && onlineData[editingCatsMod.filePath]?.categories) ?? [];

  if (currentView === "home" && isSwitchingInstance) {
    return (
      <InstanceLoadingScreen
        instanceName={switchingInstanceName}
        status={switchingStage}
      />
    );
  }

  if (currentView === "home") {
    return (
      <div className="min-h-screen bg-[var(--bg-app)] text-[var(--text-main)]">
        {customThemes.find((theme) => theme.id === settings.customThemeId)
          ?.headerBannerDataUri && (
          <img
            aria-hidden="true"
            className="pointer-events-none fixed inset-x-0 top-0 h-36 w-full object-cover opacity-20"
            src={
              customThemes.find((theme) => theme.id === settings.customThemeId)
                ?.headerBannerDataUri
            }
          />
        )}
        <HomeScreen
          instances={managedInstances}
          appVersion={appVersion}
          loading={loading || isSwitchingInstance}
          onAdd={() => void handleAddInstance()}
          onOpen={(instance) => void handleOpenManagedInstance(instance)}
          onUntrack={(instance) => void handleUntrackInstance(instance)}
          onSettings={() => setSettingsOpen(true)}
          onNotify={setToast}
          onError={setError}
        />
        {settingsOpen && (
          <SettingsModal
            settings={settings}
            onChange={updateSettings}
            onBrowseNanaZip={async () => {
              const path = await window.api.selectNanaZipPath();
              if (path) updateSettings({ nanaZipPath: path });
            }}
            onDetectNanaZip={async () => {
              const path = await window.api.detectNanaZipPath();
              if (path) updateSettings({ nanaZipPath: path });
              else
                setError(
                  "NanaZip was not found. Use Browse to select NanaZip.exe.",
                );
            }}
            onBrowseVSCode={async () => {
              const path = await window.api.selectVSCodePath();
              if (path) updateSettings({ vsCodePath: path });
            }}
            onDetectVSCode={async () => {
              const path = await window.api.detectVSCodePath();
              if (path) updateSettings({ vsCodePath: path });
              else
                setError(
                  "VS Code was not found. Install Visual Studio Code or use Browse to select Code.exe.",
                );
            }}
            customThemes={customThemes}
            onOpenThemesFolder={async () => {
              try {
                await window.api.openThemesFolder();
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            }}
            onRefreshThemes={async () => {
              try {
                setCustomThemes(await window.api.getAvailableThemes());
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            }}
            onClose={() => setSettingsOpen(false)}
          />
        )}
        {error && (
          <div
            role="alert"
            className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700 shadow-lg dark:border-red-800 dark:bg-red-950 dark:text-red-300"
          >
            {error}
            <button className="ml-3 underline" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}
        {toast && (
          <div
            role="status"
            className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-md border border-green-300 bg-green-50 px-4 py-2 text-sm font-medium text-green-800 shadow-lg dark:border-green-800 dark:bg-green-950 dark:text-green-200"
          >
            {toast}
          </div>
        )}
        {customThemes.find((theme) => theme.id === settings.customThemeId)
          ?.mascotDataUri && (
          <img
            alt=""
            className="fixed bottom-2 right-3 h-16 max-w-20 object-contain"
            src={
              customThemes.find((theme) => theme.id === settings.customThemeId)
                ?.mascotDataUri
            }
          />
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-app)] text-[var(--text-main)]">
      <div
        className={`mx-auto w-full max-w-none px-3 py-3 ${activeTab === "modlist" && editingCatsMod ? "lg:pr-80" : ""}`}
      >
        <header className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-3 dark:border-gray-700">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <PackageSearch
                size={20}
                className="text-gray-700 dark:text-gray-300"
              />
              <h1 className="text-lg font-semibold">
                StarTools - Modpack Manager
              </h1>
              <button
                type="button"
                onClick={() => setCurrentView("home")}
                title="Home"
                aria-label="Home"
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <Home size={14} />
                Home
              </button>
              {instancePath && (
                <button
                  type="button"
                  className="instance-badge"
                  title={`Copy instance path: ${instancePath}`}
                  aria-label={`Copy instance path ${instancePath}`}
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(instancePath)
                      .then(() => setToast("Instance path copied."))
                      .catch(() =>
                        setError("Could not copy the instance path."),
                      );
                  }}
                >
                  <Folder size={13} className="shrink-0" />
                  <span className="truncate">
                    {instanceBadgeLabel(instancePath)}
                  </span>
                </button>
              )}
            </div>
            <div
              role="tablist"
              aria-label="Main views"
              className="view-tabs self-start"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "modlist"}
                onClick={() => setActiveTab("modlist")}
                className="view-tab"
              >
                Modlist
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "config"}
                onClick={() => setActiveTab("config")}
                className="view-tab"
              >
                Config
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "packs"}
                onClick={() => setActiveTab("packs")}
                className="view-tab"
              >
                Packs
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <FolderSelector
              instancePath={instancePath}
              loading={loading}
              fetchingOnline={fetchingOnline}
              fetchProgress={fetchProgress}
              onSelect={handleSelect}
              onRefresh={handleRefresh}
              onFetchOnline={() => void handleFetchOnline()}
            />
            <button
              type="button"
              onClick={() => setSnapshotsOpen(true)}
              disabled={!instancePath}
              title="Snapshots"
              aria-label="Open snapshots"
              className="inline-flex items-center rounded-md border border-gray-300 bg-white px-2 py-1.5 text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              <Camera size={16} />
            </button>
            <button
              type="button"
              onClick={() => void handleOpenInfo()}
              disabled={!instancePath || loading}
              title="Modpack info"
              aria-label="Open modpack info"
              className="inline-flex items-center rounded-md border border-gray-300 bg-white px-2 py-1.5 text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              <Info size={16} />
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              title="Settings"
              aria-label="Open settings"
              className="inline-flex items-center rounded-md border border-gray-300 bg-white px-2 py-1.5 text-gray-700 shadow-sm hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              <SettingsIcon size={16} />
            </button>
          </div>
        </header>

        <div className={activeTab === "modlist" ? "" : "hidden"}>
          {error && (
            <div className="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              {error}
            </div>
          )}

          {result && (
            <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
              <span>
                <strong className="text-gray-700 dark:text-gray-200">
                  {result.mods.length}
                </strong>{" "}
                mods parsed
              </span>
              {result.skipped.length > 0 && (
                <span>{result.skipped.length} files skipped</span>
              )}
              {disabledCount > 0 && (
                <span>
                  <strong className="text-gray-700 dark:text-gray-200">
                    {disabledCount}
                  </strong>{" "}
                  disabled
                </span>
              )}
              {isFiltering && (
                <span>
                  <strong className="text-gray-700 dark:text-gray-200">
                    {filteredMods.length}
                  </strong>{" "}
                  of {result.mods.length} match
                </span>
              )}
              {missingCount > 0 && (
                <span className="text-red-600 dark:text-red-400">
                  {missingCount} mod{missingCount === 1 ? "" : "s"} with missing
                  mandatory dependencies
                </span>
              )}
            </div>
          )}

          {result && (
            <SearchFilterBar
              query={query}
              onQueryChange={(q) => {
                setQuery(q);
                setPage(1);
              }}
              sideFilter={sideFilter}
              onSideFilterChange={(s) => {
                setSideFilter(s);
                setPage(1);
              }}
              statusFilter={statusFilter}
              onStatusFilterChange={(s) => {
                setStatusFilter(s);
                setPage(1);
              }}
              warningFilter={warningFilter}
              onWarningFilterChange={(w) => {
                setWarningFilter(w);
                setPage(1);
              }}
              restorableCount={restorableCount}
              restoring={restoring || loading}
              onRestore={() => void handleRestore()}
              exporting={exporting}
              onExport={() => void handleExport()}
            />
          )}

          <ModTable
            mods={pageMods}
            onlineData={onlineData}
            catOverrides={catOverrides}
            page={safePage}
            pageSize={PAGE_SIZE}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={handleSort}
            onSideOverride={handleSideOverride}
            onToggleEnabled={(mod) => void handleToggleEnabled(mod)}
            onTrash={(mod) => void handleTrash(mod)}
            onEditDeps={(mod) => {
              setEditingModId(mod.modId);
              setEditingCatsModId(null);
            }}
            onEditCats={(mod) => {
              setEditingCatsModId(mod.modId);
              setEditingModId(null);
            }}
            onOpenArchive={(mod) => void handleOpenArchive(mod)}
            onOpenConfig={(mod) => void handleOpenModConfig(mod)}
            onOpenConfigInVSCode={(mod) => void handleOpenModConfig(mod, true)}
            emptyHint={
              result ? "No mods match the current search or filter." : undefined
            }
          />

          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {sortedMods.length > 0
                ? `Showing ${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, sortedMods.length)} of ${sortedMods.length}`
                : ""}
            </span>
            <Pagination
              page={safePage}
              totalPages={totalPages}
              onPageChange={setPage}
            />
          </div>

          {result && result.skipped.length > 0 && (
            <details className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              <summary className="cursor-pointer hover:text-gray-700 dark:hover:text-gray-200">
                Skipped files ({result.skipped.length})
              </summary>
              <ul className="mt-1 max-h-32 list-disc overflow-y-auto pl-5 font-mono">
                {result.skipped.map((s) => (
                  <li key={s.fileName}>
                    {s.fileName} — {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {editingMod && result && (
            <DependencyEditor
              mod={editingMod}
              allMods={result.mods}
              busy={loading}
              onClose={() => setEditingModId(null)}
              onMutate={handleDepMutate}
            />
          )}

          {editingCatsMod && (
            <CategoryEditor
              modName={editingCatsMod.name}
              modId={editingCatsMod.modId}
              scanned={editingCatsScanned}
              entry={editingCatsEntry}
              busy={loading}
              onClose={() => setEditingCatsModId(null)}
              onMutate={handleCatMutate}
            />
          )}
        </div>

        <div className={activeTab === "config" ? "" : "hidden"}>
          <ConfigView
            key={instancePath ?? "no-instance"}
            instancePath={instancePath}
            active={activeTab === "config"}
            mods={result?.mods ?? []}
            openRequest={configOpenRequest}
            onOpenRequestHandled={(id) =>
              setConfigOpenRequest((current) =>
                current?.id === id ? null : current,
              )
            }
            onOpenMod={handleOpenModFromConfig}
            vsCodePath={settings.vsCodePath}
          />
        </div>

        <div className={activeTab === "packs" ? "" : "hidden"}>
          <PacksView
            key={instancePath ?? "no-instance"}
            instancePath={instancePath}
            active={activeTab === "packs"}
            onOpenArchive={handleOpenPackArchive}
          />
        </div>

        {pendingConfigDelete && (
          <ConfigTrashDialog
            mod={pendingConfigDelete.mod}
            matches={pendingConfigDelete.matches}
            selected={pendingConfigDelete.selected}
            onToggle={(filePath) =>
              setPendingConfigDelete((current) => {
                if (!current) return current;
                const selected = new Set(current.selected);
                if (selected.has(filePath)) selected.delete(filePath);
                else selected.add(filePath);
                return { ...current, selected };
              })
            }
            onModOnly={() => void finishConfigDelete(false)}
            onModAndConfigs={() => void finishConfigDelete(true)}
            onCancel={() => !configDeleteBusy && setPendingConfigDelete(null)}
            busy={configDeleteBusy}
          />
        )}

        {infoOpen && (
          <InstanceInfoModal
            info={instanceInfo}
            loading={infoLoading}
            appVersion={appVersion}
            onClose={() => setInfoOpen(false)}
          />
        )}

        {settingsOpen && (
          <SettingsModal
            settings={settings}
            onChange={updateSettings}
            onBrowseNanaZip={async () => {
              const path = await window.api.selectNanaZipPath();
              if (path) updateSettings({ nanaZipPath: path });
            }}
            onDetectNanaZip={async () => {
              const path = await window.api.detectNanaZipPath();
              if (path) updateSettings({ nanaZipPath: path });
              else
                setError(
                  "NanaZip was not found. Use Browse to select NanaZip.exe.",
                );
            }}
            onBrowseVSCode={async () => {
              const path = await window.api.selectVSCodePath();
              if (path) updateSettings({ vsCodePath: path });
            }}
            onDetectVSCode={async () => {
              const path = await window.api.detectVSCodePath();
              if (path) updateSettings({ vsCodePath: path });
              else
                setError(
                  "VS Code was not found. Install Visual Studio Code or use Browse to select Code.exe.",
                );
            }}
            customThemes={customThemes}
            onOpenThemesFolder={async () => {
              try {
                await window.api.openThemesFolder();
                setCustomThemes(await window.api.getAvailableThemes());
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            }}
            onRefreshThemes={async () => {
              try {
                setCustomThemes(await window.api.getAvailableThemes());
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            }}
            onClose={() => setSettingsOpen(false)}
          />
        )}
        {snapshotsOpen && instancePath && (
          <SnapshotManagerModal
            instancePath={instancePath}
            onClose={() => setSnapshotsOpen(false)}
            onRestored={() => {
              void scanFolder(instancePath, true);
              setToast("Snapshot restored.");
            }}
          />
        )}
        {toast && (
          <div
            role="status"
            className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-md border border-green-300 bg-green-50 px-4 py-2 text-sm font-medium text-green-800 shadow-lg dark:border-green-800 dark:bg-green-950 dark:text-green-200"
          >
            {toast}
          </div>
        )}
      </div>
      {customThemes.find((theme) => theme.id === settings.customThemeId)
        ?.headerBannerDataUri && (
        <img
          aria-hidden="true"
          className="pointer-events-none fixed inset-x-0 top-0 z-0 h-28 w-full object-cover opacity-20"
          src={
            customThemes.find((theme) => theme.id === settings.customThemeId)
              ?.headerBannerDataUri
          }
        />
      )}
      {customThemes.find((theme) => theme.id === settings.customThemeId)
        ?.mascotDataUri && (
        <img
          alt=""
          className="pointer-events-none fixed bottom-2 right-3 z-40 h-16 max-w-20 object-contain"
          src={
            customThemes.find((theme) => theme.id === settings.customThemeId)
              ?.mascotDataUri
          }
        />
      )}
    </div>
  );
}

export default App;
