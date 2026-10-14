import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Camera,
  Check,
  ChevronRight,
  Clipboard,
  Clock3,
  Code2,
  ExternalLink,
  FileText,
  FolderOpen,
  Github,
  LoaderCircle,
  MessageCircle,
  Palette,
  Plus,
  Settings2,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import type {
  InstanceInfo,
  ManagedInstance,
  ScanModsResult,
  SnapshotEntry,
} from "../../../shared/types";
import ThemeGuideModal from "./ThemeGuideModal";

// Creator profile links and Discord identity shown on the home screen.
const CREATOR_SOCIALS = {
  name: "Star Cage",
  github: "https://github.com/Starcage1/StarTools---Modpack-Management",
  discordUsername: "starcage",
  discordUserId: "751000949732016128",
};

interface HomeScreenProps {
  instances: ManagedInstance[];
  appVersion: string;
  loading?: boolean;
  onAdd: () => void;
  onOpen: (instance: ManagedInstance) => void;
  onUntrack: (instance: ManagedInstance) => void;
  onSettings: () => void;
  onNotify: (message: string) => void;
  onError: (message: string) => void;
}

function dateLabel(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function HomeScreen({
  instances,
  appVersion,
  loading = false,
  onAdd,
  onOpen,
  onUntrack,
  onSettings,
  onNotify,
  onError,
}: HomeScreenProps): React.JSX.Element {
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(
    instances[0]?.id ?? null,
  );
  const [details, setDetails] = useState<InstanceInfo | null>(null);
  const [loadedInstanceId, setLoadedInstanceId] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotEntry[]>([]);
  const [missingDependencyCount, setMissingDependencyCount] = useState<
    number | null
  >(null);
  const [busyAction, setBusyAction] = useState(false);
  const [crashReports, setCrashReports] = useState<
    Array<{ name: string; modifiedAt: number }>
  >([]);
  const [showCrashReports, setShowCrashReports] = useState(false);
  const [crashReportsInstanceId, setCrashReportsInstanceId] = useState<
    string | null
  >(null);
  const [isThemeGuideOpen, setIsThemeGuideOpen] = useState(false);
  const selectedInstance = useMemo(
    () =>
      instances.find((instance) => instance.id === selectedInstanceId) ??
      instances[0] ??
      null,
    [instances, selectedInstanceId],
  );
  const selectedDetails =
    loadedInstanceId === selectedInstance?.id ? details : null;
  const selectedSnapshots =
    loadedInstanceId === selectedInstance?.id ? snapshots : [];
  const selectedMissingCount =
    loadedInstanceId === selectedInstance?.id ? missingDependencyCount : null;
  const inspectLoading = Boolean(
    selectedInstance && loadedInstanceId !== selectedInstance.id,
  );

  useEffect(() => {
    let cancelled = false;
    if (!selectedInstance) return;
    Promise.all([
      window.api.getInstanceInfo(selectedInstance.path),
      window.api.listSnapshots(selectedInstance.path),
      window.api.scanMods(selectedInstance.path),
    ])
      .then(
        ([info, entries, scan]: [
          InstanceInfo,
          SnapshotEntry[],
          ScanModsResult,
        ]) => {
          if (cancelled) return;
          setLoadedInstanceId(selectedInstance.id);
          setDetails(info);
          setSnapshots(entries.slice(0, 2));
          setMissingDependencyCount(
            scan.mods.filter((mod) =>
              mod.dependencies.some(
                (dependency) =>
                  dependency.mandatory &&
                  !dependency.satisfied &&
                  !dependency.removed,
              ),
            ).length,
          );
        },
      )
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadedInstanceId(selectedInstance.id);
        setDetails(null);
        setSnapshots([]);
        setMissingDependencyCount(null);
        onError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedInstance, onError]);

  const runAction = async (
    action: () => Promise<unknown>,
    success: string,
  ): Promise<void> => {
    if (!selectedInstance || busyAction) return;
    setBusyAction(true);
    try {
      await action();
      onNotify(success);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(false);
    }
  };

  const refreshInspector = async (): Promise<void> => {
    if (!selectedInstance) return;
    const [info, entries, scan] = await Promise.all([
      window.api.getInstanceInfo(selectedInstance.path),
      window.api.listSnapshots(selectedInstance.path),
      window.api.scanMods(selectedInstance.path),
    ]);
    setDetails(info);
    setLoadedInstanceId(selectedInstance.id);
    setSnapshots(entries.slice(0, 2));
    setMissingDependencyCount(
      scan.mods.filter((mod) =>
        mod.dependencies.some(
          (dependency) =>
            dependency.mandatory &&
            !dependency.satisfied &&
            !dependency.removed,
        ),
      ).length,
    );
  };

  const rollback = async (snapshot: SnapshotEntry): Promise<void> => {
    if (!selectedInstance || busyAction) return;
    const confirmed = window.confirm(
      `Restore “${snapshot.name}”? This changes matching mod enabled states and restores files from its config archive.`,
    );
    if (!confirmed) return;
    setBusyAction(true);
    try {
      const result = await window.api.rollbackSnapshot(
        selectedInstance.path,
        snapshot.id,
      );
      await refreshInspector();
      onNotify(
        `Restored ${result.movedMods} mod state(s) and ${result.restoredConfigFiles} config file(s).`,
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(false);
    }
  };

  const fetchCrashReports = async (): Promise<void> => {
    if (!selectedInstance) return;
    try {
      const reports = await window.api.scanCrashReports(selectedInstance.path);
      setCrashReports(reports);
      setCrashReportsInstanceId(selectedInstance.id);
      setShowCrashReports(true);
      if (!reports.length)
        onNotify("No crash reports were found for this instance.");
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-app)] text-[var(--text-main)]">
      <header className="relative z-10 flex h-14 items-center justify-between border-b border-zinc-800/80 px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-8 shrink-0 place-items-center rounded-lg border border-zinc-700 bg-zinc-900 text-cyan-300">
            <Code2 size={17} />
          </div>
          <span className="truncate text-sm font-semibold tracking-tight">
            StarTools - Modpack Manager
          </span>
          <span className="rounded-full border border-zinc-700 bg-zinc-900/80 px-2.5 py-1 font-mono text-[10px] text-zinc-400">
            Companion v{appVersion || "0.5.0"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsThemeGuideOpen(true)}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-zinc-800 px-3 text-xs text-zinc-300 transition-colors hover:border-cyan-400/60 hover:bg-cyan-300 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            <Palette size={14} /> Style Guide
          </button>
          <button
            type="button"
            onClick={onSettings}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-zinc-800 px-3 text-xs text-zinc-300 transition-colors hover:border-cyan-400/60 hover:bg-cyan-300 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            <Settings2 size={14} /> Settings
          </button>
        </div>
      </header>

      <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-7xl flex-col gap-6 px-5 py-6 lg:flex-row lg:gap-8 lg:px-6 lg:py-8">
        <section
          aria-label="Tracked instances"
          className="flex min-w-0 flex-col lg:w-[58%]"
        >
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-semibold tracking-tight">
                Tracked Instances
              </h1>
              <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 font-mono text-[11px] text-zinc-400">
                {instances.length} / 5
              </span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {instances.map((instance) => {
              const active = selectedInstance?.id === instance.id;
              const enabledCount = active
                ? selectedDetails?.enabledCount
                : undefined;
              const disabledCount = active
                ? selectedDetails?.disabledCount
                : undefined;
              return (
                <article
                  key={instance.id}
                  onClick={() => setSelectedInstanceId(instance.id)}
                  className={`rounded-xl border p-4 transition-colors ${active ? "border-cyan-500/50 bg-zinc-900 shadow-[0_0_0_1px_rgba(6,182,212,0.08)]" : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-700"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedInstanceId(instance.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <h2 className="truncate text-sm font-semibold">
                        {instance.name}
                      </h2>
                      <span className="mt-2 inline-flex rounded-md border border-indigo-400/20 bg-indigo-400/10 px-2 py-1 text-[11px] text-indigo-200">
                        {selectedDetails && active
                          ? selectedDetails.modLoader
                          : instance.loader}
                      </span>
                      <span className="ml-1.5 inline-flex rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 font-mono text-[10px] text-zinc-400">
                        MC{" "}
                        {selectedDetails && active
                          ? selectedDetails.minecraftVersion
                          : instance.mcVersion}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onUntrack(instance);
                      }}
                      title="Untrack instance"
                      aria-label={`Untrack ${instance.name}`}
                      className="rounded-md p-1.5 text-zinc-500 transition hover:bg-red-500/10 hover:text-red-400"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <p className="mt-3 text-xs text-zinc-400">
                    {active && inspectLoading ? (
                      <span className="inline-flex items-center gap-1.5">
                        <LoaderCircle size={12} className="animate-spin" />{" "}
                        Checking instance…
                      </span>
                    ) : (
                      `${enabledCount ?? "—"} enabled · ${disabledCount ?? "—"} disabled`
                    )}
                  </p>
                  <p
                    className="mt-2 truncate font-mono text-[10px] text-zinc-500"
                    title={instance.path}
                  >
                    {instance.path}
                  </p>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpen(instance);
                    }}
                    disabled={loading}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-zinc-100 px-4 py-2 text-xs font-medium text-zinc-900 transition hover:bg-white hover:text-black hover:shadow-md active:scale-[0.98] disabled:opacity-50"
                  >
                    <FolderOpen size={14} /> Open Workspace{" "}
                    <ChevronRight size={13} />
                  </button>
                </article>
              );
            })}
            {instances.length < 5 ? (
              <button
                type="button"
                onClick={onAdd}
                disabled={loading}
                className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-700 bg-transparent p-5 text-sm text-zinc-500 transition hover:border-zinc-500 hover:bg-zinc-900/40 hover:text-zinc-200 disabled:opacity-50"
              >
                <span className="grid size-9 place-items-center rounded-full bg-zinc-900">
                  <Plus size={17} />
                </span>
                <span className="font-medium">+ Add Instance</span>
              </button>
            ) : (
              <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-950/30 text-xs text-zinc-500">
                Instance limit reached (5/5)
              </div>
            )}
          </div>

          <div className="mt-auto pt-6">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-zinc-800 text-zinc-300">
                  <Code2 size={17} />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">
                    Created by {CREATOR_SOCIALS.name}
                  </p>
                  <p className="mt-0.5 truncate text-[10px] text-zinc-500">
                    Personal open-source modpack companion
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <a
                  href={CREATOR_SOCIALS.github}
                  target="_blank"
                  rel="noreferrer"
                  title="GitHub"
                  aria-label="Open GitHub"
                  className="rounded-md p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
                >
                  <Github size={15} />
                </a>
                <a
                  href={`https://discord.com/users/${CREATOR_SOCIALS.discordUserId}`}
                  target="_blank"
                  rel="noreferrer"
                  title={`Discord: ${CREATOR_SOCIALS.discordUsername}`}
                  aria-label={`Open Discord profile for ${CREATOR_SOCIALS.discordUsername}`}
                  className="rounded-md p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
                >
                  <MessageCircle size={15} />
                </a>
              </div>
            </div>
          </div>
        </section>

        <aside
          aria-label="Instance inspector"
          className="flex min-w-0 flex-col gap-4 lg:w-[42%]"
        >
          {!selectedInstance ? (
            <div className="grid min-h-64 place-items-center rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 text-center text-sm text-zinc-500">
              Add an instance to see its details and quick tools.
            </div>
          ) : (
            <>
              <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      Selected Instance
                    </p>
                    <h2 className="mt-1 truncate text-base font-semibold">
                      {selectedInstance.name}
                    </h2>
                    <p className="mt-1 break-all font-mono text-[10px] leading-4 text-zinc-500">
                      {selectedInstance.path}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      void window.api
                        .revealInstance(selectedInstance.path)
                        .catch((error: unknown) =>
                          onError(
                            error instanceof Error
                              ? error.message
                              : String(error),
                          ),
                        )
                    }
                    title="Open in Explorer"
                    aria-label="Open instance in Explorer"
                    className="shrink-0 rounded-md border border-zinc-800 p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
                  >
                    <ExternalLink size={14} />
                  </button>
                </div>
              </section>

              <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="mb-3 flex items-center gap-2 text-xs font-semibold">
                  <ShieldCheck size={14} className="text-cyan-300" /> Health &
                  Overview
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                    <p className="text-[10px] text-zinc-500">Mods</p>
                    <p className="mt-1 text-sm font-semibold">
                      {selectedDetails
                        ? `${selectedDetails.enabledCount} enabled · ${selectedDetails.disabledCount} disabled`
                        : `${selectedInstance.modCount} total`}
                    </p>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                    <p className="text-[10px] text-zinc-500">Loader Version</p>
                    <p className="mt-1 truncate font-mono text-xs text-zinc-300">
                      {selectedDetails?.loaderVersion ?? "Loading…"}
                    </p>
                  </div>
                </div>
                <div
                  className={`mt-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${missingDependencyCount === null ? "border-zinc-800 bg-zinc-950/40 text-zinc-400" : missingDependencyCount > 0 ? "border-amber-500/20 bg-amber-500/5 text-amber-300" : "border-emerald-500/20 bg-emerald-500/5 text-emerald-300"}`}
                >
                  {selectedMissingCount === null ? (
                    <LoaderCircle size={13} className="animate-spin" />
                  ) : selectedMissingCount > 0 ? (
                    <AlertTriangle size={13} />
                  ) : (
                    <Check size={13} />
                  )}
                  {selectedMissingCount === null
                    ? "Checking dependencies…"
                    : selectedMissingCount > 0
                      ? `${selectedMissingCount} mod${selectedMissingCount === 1 ? "" : "s"} with missing dependencies`
                      : "All required dependencies met"}
                </div>
              </section>

              <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-xs font-semibold">
                    <Camera size={14} className="text-zinc-400" /> Recent
                    Snapshots
                  </h3>
                  <span className="text-[10px] text-zinc-500">Last 2</span>
                </div>
                {selectedSnapshots.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-zinc-800 px-3 py-4 text-center text-xs text-zinc-500">
                    No snapshots created yet
                  </p>
                ) : (
                  <div className="space-y-2">
                    {selectedSnapshots.map((snapshot) => (
                      <div
                        key={snapshot.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium">
                            {snapshot.name}
                          </p>
                          <p className="mt-1 flex items-center gap-1 text-[10px] text-zinc-500">
                            <Clock3 size={11} /> {dateLabel(snapshot.timestamp)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void rollback(snapshot)}
                          disabled={busyAction}
                          className="shrink-0 rounded-md border border-zinc-700 px-2.5 py-1.5 text-[10px] font-medium text-zinc-300 transition hover:bg-zinc-800 hover:text-white disabled:opacity-50"
                        >
                          Rollback
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <h3 className="mb-3 text-xs font-semibold">Quick Tools</h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => void fetchCrashReports()}
                    className="flex items-center justify-center gap-2 rounded-md border border-zinc-800 px-3 py-2 text-[11px] text-zinc-300 transition hover:bg-zinc-800"
                  >
                    <FileText size={13} /> View Crash Logs
                  </button>
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() =>
                      void runAction(
                        () =>
                          window.api.exportModpackInfo(selectedInstance.path),
                        "Modpack info exported.",
                      )
                    }
                    className="flex items-center justify-center gap-2 rounded-md border border-zinc-800 px-3 py-2 text-[11px] text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-50"
                  >
                    <Clipboard size={13} /> Export Modlist
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void window.api
                        .openInstanceFolder(selectedInstance.path, "config")
                        .catch((error: unknown) =>
                          onError(
                            error instanceof Error
                              ? error.message
                              : String(error),
                          ),
                        )
                    }
                    className="flex items-center justify-center gap-2 rounded-md border border-zinc-800 px-3 py-2 text-[11px] text-zinc-300 transition hover:bg-zinc-800"
                  >
                    <FolderOpen size={13} /> Open Configs Folder
                  </button>
                </div>
                {showCrashReports &&
                  crashReportsInstanceId === selectedInstance.id && (
                    <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                          Crash Reports ({crashReports.length})
                        </p>
                        <button
                          type="button"
                          onClick={() => setShowCrashReports(false)}
                          aria-label="Close crash reports"
                          className="text-zinc-500 hover:text-zinc-200"
                        >
                          <X size={13} />
                        </button>
                      </div>
                      {crashReports.length ? (
                        <div className="max-h-32 space-y-1 overflow-auto">
                          {crashReports.slice(0, 8).map((report) => (
                            <button
                              type="button"
                              key={report.name}
                              onClick={() =>
                                void window.api
                                  .openCrashReport(
                                    selectedInstance.path,
                                    report.name,
                                  )
                                  .catch((error: unknown) =>
                                    onError(
                                      error instanceof Error
                                        ? error.message
                                        : String(error),
                                    ),
                                  )
                              }
                              className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-[10px] text-zinc-300 hover:bg-zinc-800"
                            >
                              <span className="truncate">{report.name}</span>
                              <span className="shrink-0 text-zinc-500">
                                {dateLabel(report.modifiedAt)}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[11px] text-zinc-500">
                          No crash reports found.
                        </p>
                      )}
                    </div>
                  )}
              </section>
            </>
          )}
        </aside>
      </main>

      {isThemeGuideOpen && (
        <ThemeGuideModal
          onClose={() => setIsThemeGuideOpen(false)}
          onOpenThemesFolder={() => window.api.openThemesFolder()}
          onError={onError}
        />
      )}
    </div>
  );
}

export default HomeScreen;

export function InstanceLoadingScreen({
  instanceName,
  status,
}: {
  instanceName: string;
  status: "reading" | "parsing" | "ready";
}): React.JSX.Element {
  const label =
    status === "reading"
      ? "Reading mods folder..."
      : status === "parsing"
        ? "Parsing metadata..."
        : "Ready";
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[var(--bg-app)] px-6 text-center text-[var(--text-main)]">
      <div className="mb-5 grid size-14 place-items-center rounded-2xl border border-gray-200 bg-gray-100 text-indigo-500 dark:border-gray-700 dark:bg-gray-900">
        <FolderOpen size={24} />
      </div>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
        Opening workspace
      </p>
      <h1 className="mt-2 max-w-xl truncate text-2xl font-semibold">
        {instanceName}
      </h1>
      <div className="mt-7 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        {status === "ready" ? (
          <span className="size-4 rounded-full bg-emerald-500" />
        ) : (
          <LoaderCircle size={16} className="animate-spin text-indigo-500" />
        )}
        <span>{label}</span>
      </div>
      <div className="mt-4 h-1 w-56 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
        <div
          className={`h-full rounded-full bg-indigo-500 transition-all duration-300 ${status === "reading" ? "w-1/3" : status === "parsing" ? "w-2/3 animate-pulse" : "w-full"}`}
        />
      </div>
    </main>
  );
}
