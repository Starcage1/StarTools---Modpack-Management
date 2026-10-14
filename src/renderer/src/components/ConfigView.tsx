import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import {
  ChevronDown,
  ChevronRight,
  File,
  FileText,
  Folder,
  FolderOpen,
  PackageSearch,
  RotateCcw,
  Save,
  Search,
  X,
} from "lucide-react";
import type {
  ConfigFileDocument,
  ConfigModMatch,
  ConfigTreeEntry,
} from "../../../shared/types";
import type { ParsedMod } from "../../../shared/types";

type ConfigSort = "alphabetical" | "modified";
interface OpenFile extends ConfigFileDocument {
  savedContent: string;
}

interface ConfigViewProps {
  instancePath: string | null;
  active: boolean;
  mods: ParsedMod[];
  openRequest: { path: string; id: number } | null;
  onOpenRequestHandled: (id: number) => void;
  onOpenMod: (modId: string) => void;
  vsCodePath?: string;
}

function languageForPath(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  if (
    extension === "toml" ||
    extension === "cfg" ||
    extension === "properties" ||
    extension === "ini"
  )
    return "ini";
  if (extension === "json" || extension === "json5") return "json";
  if (extension === "yaml" || extension === "yml") return "yaml";
  return "plaintext";
}

function isDirty(file: OpenFile): boolean {
  return file.content !== file.savedContent;
}

function sortEntries(
  entries: ConfigTreeEntry[],
  sort: ConfigSort,
): ConfigTreeEntry[] {
  return [...entries]
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      if (sort === "modified")
        return b.lastModified - a.lastModified || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    })
    .map((entry) =>
      entry.type === "directory"
        ? { ...entry, children: sortEntries(entry.children ?? [], sort) }
        : entry,
    );
}

function filterEntries(
  entries: ConfigTreeEntry[],
  query: string,
): ConfigTreeEntry[] {
  if (!query) return entries;
  return entries.flatMap((entry) => {
    if (entry.type === "file") {
      return entry.name.toLowerCase().includes(query) ? [entry] : [];
    }
    const children = filterEntries(entry.children ?? [], query);
    return entry.name.toLowerCase().includes(query) || children.length > 0
      ? [{ ...entry, children }]
      : [];
  });
}

function findTreeEntry(
  entries: ConfigTreeEntry[],
  path: string,
): ConfigTreeEntry | null {
  for (const entry of entries) {
    if (entry.path.toLowerCase() === path.toLowerCase()) return entry;
    const nested = findTreeEntry(entry.children ?? [], path);
    if (nested) return nested;
  }
  return null;
}

function findFirstFile(entry: ConfigTreeEntry): ConfigTreeEntry | null {
  if (entry.type === "file") return entry;
  for (const child of entry.children ?? []) {
    const nested = findFirstFile(child);
    if (nested) return nested;
  }
  return null;
}

function ConfigView({
  instancePath,
  active,
  mods,
  openRequest,
  onOpenRequestHandled,
  onOpenMod,
  vsCodePath,
}: ConfigViewProps): React.JSX.Element {
  const editorTheme = document.documentElement.classList.contains("dark")
    ? "vs-dark"
    : "vs";
  const [tree, setTree] = useState<ConfigTreeEntry[]>([]);
  const [loadingTree, setLoadingTree] = useState(() => Boolean(instancePath));
  const [treeError, setTreeError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ConfigSort>("alphabetical");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [files, setFiles] = useState<OpenFile[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    path: string;
    x: number;
    y: number;
  } | null>(null);
  const [bindingPath, setBindingPath] = useState<string | null>(null);
  const [bindingModId, setBindingModId] = useState("");
  const [bindingBusy, setBindingBusy] = useState(false);
  const [fileBindingState, setFileBindingState] = useState<{
    path: string;
    matches: ConfigModMatch[];
  } | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const handledOpenRequest = useRef<number | null>(null);

  const reloadTree = useCallback(async (): Promise<void> => {
    if (!instancePath) {
      setTree([]);
      setTreeError(null);
      return;
    }
    setLoadingTree(true);
    setTreeError(null);
    try {
      setTree(await window.api.scanConfigTree(instancePath));
    } catch (err) {
      setTree([]);
      setTreeError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingTree(false);
    }
  }, [instancePath]);

  useEffect(() => {
    if (!instancePath) return;
    let cancelled = false;
    window.api
      .scanConfigTree(instancePath)
      .then((entries) => {
        if (!cancelled) setTree(entries);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setTree([]);
          setTreeError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingTree(false);
      });
    return () => {
      cancelled = true;
    };
  }, [instancePath]);

  const sortedTree = useMemo(() => sortEntries(tree, sort), [tree, sort]);
  const visibleTree = useMemo(
    () => filterEntries(sortedTree, query.trim().toLowerCase()),
    [sortedTree, query],
  );
  const activeFile = files.find((file) => file.path === activePath) ?? null;
  const activeFilePath = activeFile?.path;
  const fileBindings =
    activeFile && fileBindingState?.path === activeFile.path
      ? fileBindingState.matches
      : [];

  const openFile = async (entry: ConfigTreeEntry): Promise<void> => {
    const existing = files.find((file) => file.path === entry.path);
    if (existing) {
      setActivePath(existing.path);
      setEditorError(null);
      setStatusMessage(null);
      return;
    }
    if (!instancePath || busy) return;
    setBusy(true);
    setEditorError(null);
    setStatusMessage(null);
    try {
      const document = await window.api.readConfigFile(
        instancePath,
        entry.path,
      );
      setFiles((current) => [
        ...current,
        { ...document, savedContent: document.content },
      ]);
      setActivePath(document.path);
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!active || !openRequest || loadingTree || busy) return;
    if (handledOpenRequest.current === openRequest.id) return;
    handledOpenRequest.current = openRequest.id;
    const target = findTreeEntry(tree, openRequest.path);
    const file = target && findFirstFile(target);
    if (file) {
      const parents = file.path.split("/").slice(0, -1);
      const folders = new Set<string>();
      for (let i = 0; i < parents.length; i += 1) {
        folders.add(parents.slice(0, i + 1).join("/"));
      }
      const expandParents = (): void => {
        setExpanded((current) => new Set([...current, ...folders]));
      };
      const existing = files.find((open) => open.path === file.path);
      if (existing) {
        Promise.resolve().then(() => {
          if (handledOpenRequest.current !== openRequest.id) return;
          setActivePath(existing.path);
          setEditorError(null);
          expandParents();
        });
      } else if (instancePath) {
        window.api
          .readConfigFile(instancePath, file.path)
          .then((document) => {
            if (handledOpenRequest.current !== openRequest.id) return;
            setFiles((current) => [
              ...current,
              { ...document, savedContent: document.content },
            ]);
            setActivePath(document.path);
            setEditorError(null);
            expandParents();
          })
          .catch((err: unknown) =>
            setEditorError(err instanceof Error ? err.message : String(err)),
          );
      }
    } else {
      Promise.resolve().then(() => {
        if (handledOpenRequest.current === openRequest.id)
          setEditorError(`Could not find config file: ${openRequest.path}`);
      });
    }
    onOpenRequestHandled(openRequest.id);
  }, [
    active,
    busy,
    files,
    instancePath,
    loadingTree,
    openRequest,
    onOpenRequestHandled,
    tree,
  ]);

  useEffect(() => {
    if (!instancePath || !activeFilePath) return;
    let cancelled = false;
    window.api
      .getConfigModMatches(
        instancePath,
        activeFilePath,
        mods.map((mod) => mod.modId),
      )
      .then((matches) => {
        if (!cancelled) setFileBindingState({ path: activeFilePath, matches });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setEditorError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [activeFilePath, instancePath, mods]);

  const openModForFile = async (path: string): Promise<void> => {
    if (!instancePath) return;
    try {
      const matches = await window.api.getConfigModMatches(
        instancePath,
        path,
        mods.map((mod) => mod.modId),
      );
      const match = matches[0];
      if (!match) {
        setStatusMessage(
          "No installed mod is currently associated with this file.",
        );
        return;
      }
      onOpenMod(match.modId);
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : String(err));
    }
  };

  const openInVSCode = async (path: string): Promise<void> => {
    if (!instancePath) return;
    const openFileState = files.find((file) => file.path === path);
    if (
      openFileState &&
      isDirty(openFileState) &&
      !window.confirm(
        `${openFileState.name} has unsaved changes in StarTools - Modpack Manager. VS Code will open the saved disk version. Continue?`,
      )
    )
      return;
    try {
      await window.api.openConfigInVSCode(instancePath, path, vsCodePath);
      setStatusMessage(`Opened ${path} in VS Code.`);
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : String(err));
    }
  };

  const resetBindings = async (path: string): Promise<void> => {
    if (!instancePath) return;
    try {
      const removed = await window.api.resetManualConfigMappings(
        instancePath,
        path,
      );
      if (activeFile?.path === path) {
        setFileBindingState((current) =>
          current?.path === path
            ? {
                ...current,
                matches: current.matches.filter(
                  (match) => match.source !== "manual",
                ),
              }
            : current,
        );
      } else if (activeFile && instancePath) {
        const fresh = await window.api.getConfigModMatches(
          instancePath,
          activeFile.path,
          mods.map((mod) => mod.modId),
        );
        setFileBindingState({ path: activeFile.path, matches: fresh });
      }
      setStatusMessage(
        removed.length > 0
          ? `Reset ${removed.length} manual mod binding(s). Automatic matches remain available.`
          : "This file had no manual mod bindings.",
      );
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : String(err));
    }
  };

  const updateContent = (content: string): void => {
    if (!activePath) return;
    setFiles((current) =>
      current.map((file) =>
        file.path === activePath ? { ...file, content } : file,
      ),
    );
  };

  const saveActive = useCallback(async (): Promise<void> => {
    if (!instancePath || !activeFile || !isDirty(activeFile) || busy) return;
    setBusy(true);
    setEditorError(null);
    try {
      await window.api.saveConfigFile(
        instancePath,
        activeFile.path,
        activeFile.content,
      );
      setFiles((current) =>
        current.map((file) =>
          file.path === activeFile.path
            ? { ...file, savedContent: file.content }
            : file,
        ),
      );
      void reloadTree();
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [activeFile, busy, instancePath, reloadTree]);

  const revertActive = async (): Promise<void> => {
    if (!instancePath || !activeFile || busy) return;
    if (
      isDirty(activeFile) &&
      !window.confirm(`Discard unsaved changes to ${activeFile.name}?`)
    )
      return;
    setBusy(true);
    setEditorError(null);
    try {
      const fresh = await window.api.readConfigFile(
        instancePath,
        activeFile.path,
      );
      setFiles((current) =>
        current.map((file) =>
          file.path === fresh.path
            ? { ...fresh, savedContent: fresh.content }
            : file,
        ),
      );
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const closeTab = (path: string): void => {
    const file = files.find((item) => item.path === path);
    if (
      file &&
      isDirty(file) &&
      !window.confirm(`Close ${file.name} and discard unsaved changes?`)
    ) {
      return;
    }
    const index = files.findIndex((item) => item.path === path);
    const remaining = files.filter((item) => item.path !== path);
    setFiles(remaining);
    if (activePath === path) {
      setActivePath(
        remaining[Math.max(0, index - 1)]?.path ?? remaining[0]?.path ?? null,
      );
    }
  };

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveActive();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, saveActive]);

  const renderEntries = (
    entries: ConfigTreeEntry[],
    depth = 0,
  ): React.JSX.Element[] =>
    entries.map((entry) => {
      const isOpen = query.trim().length > 0 || expanded.has(entry.path);
      if (entry.type === "directory") {
        return (
          <div key={entry.path}>
            <button
              type="button"
              onClick={() =>
                setExpanded((current) => {
                  const next = new Set(current);
                  if (next.has(entry.path)) next.delete(entry.path);
                  else next.add(entry.path);
                  return next;
                })
              }
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
              style={{ paddingLeft: `${8 + depth * 14}px` }}
              title={entry.name}
            >
              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              {isOpen ? (
                <FolderOpen size={15} className="text-sky-500" />
              ) : (
                <Folder size={15} className="text-sky-500" />
              )}
              <span className="truncate">{entry.name}</span>
            </button>
            {isOpen && (
              <div>{renderEntries(entry.children ?? [], depth + 1)}</div>
            )}
          </div>
        );
      }
      return (
        <button
          key={entry.path}
          type="button"
          onClick={() => void openFile(entry)}
          onContextMenu={(event) => {
            event.preventDefault();
            setContextMenu({
              path: entry.path,
              x: Math.min(event.clientX, window.innerWidth - 205),
              y: Math.min(event.clientY, window.innerHeight - 60),
            });
          }}
          className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 ${activePath === entry.path ? "bg-sky-50 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200" : "text-gray-700 dark:text-gray-300"}`}
          style={{ paddingLeft: `${25 + depth * 14}px` }}
          title={entry.path}
        >
          <File size={14} className="shrink-0 text-gray-400" />
          <span className="truncate">{entry.name}</span>
        </button>
      );
    });

  return (
    <section className="grid min-h-[65vh] grid-cols-1 overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900 lg:grid-cols-[minmax(220px,30%)_minmax(0,1fr)]">
      <aside className="flex min-h-64 flex-col border-b border-gray-200 dark:border-gray-700 lg:border-b-0 lg:border-r">
        <div className="border-b border-gray-200 p-3 dark:border-gray-700">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
              Config Files
            </h2>
            <button
              type="button"
              onClick={() => void reloadTree()}
              disabled={!instancePath || loadingTree}
              className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-800"
              title="Refresh config files"
              aria-label="Refresh config files"
            >
              <RotateCcw size={14} />
            </button>
          </div>
          <div className="relative mb-2">
            <Search
              size={14}
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter files…"
              aria-label="Filter config files"
              className="w-full rounded border border-gray-300 bg-white py-1.5 pl-7 pr-2 text-sm outline-none focus:border-sky-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>
          <label className="flex items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
            Sort
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as ConfigSort)}
              className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
            >
              <option value="alphabetical">Alphabetical</option>
              <option value="modified">Last Modified</option>
            </select>
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {!instancePath && (
            <p className="px-2 py-4 text-sm text-gray-500">
              Select an instance folder to browse its config files.
            </p>
          )}
          {loadingTree && (
            <p className="px-2 py-4 text-sm text-gray-500">
              Loading config files…
            </p>
          )}
          {treeError && (
            <p className="px-2 py-4 text-sm text-red-500">{treeError}</p>
          )}
          {instancePath && !loadingTree && !treeError && tree.length === 0 && (
            <p className="px-2 py-4 text-sm text-gray-500">
              This instance has no config files.
            </p>
          )}
          {instancePath &&
            !loadingTree &&
            !treeError &&
            tree.length > 0 &&
            visibleTree.length === 0 && (
              <p className="px-2 py-4 text-sm text-gray-500">
                No config files match that search.
              </p>
            )}
          {instancePath &&
            !loadingTree &&
            !treeError &&
            renderEntries(visibleTree)}
        </div>
      </aside>

      <div className="flex min-h-[28rem] min-w-0 flex-col">
        <div className="flex min-h-11 items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-2 dark:border-gray-700 dark:bg-gray-800">
          <div className="flex min-w-0 flex-1 items-center overflow-x-auto">
            {files.map((file) => (
              <div
                key={file.path}
                className={`group flex h-10 shrink-0 items-center gap-2 border-r border-gray-200 px-3 text-sm dark:border-gray-700 ${activePath === file.path ? "border-b-2 border-b-sky-500 bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100" : "text-gray-500 dark:text-gray-400"}`}
              >
                <button
                  type="button"
                  onClick={() => setActivePath(file.path)}
                  className="max-w-40 truncate"
                  title={file.path}
                >
                  {file.name}
                </button>
                {isDirty(file) && (
                  <span
                    className="h-2 w-2 rounded-full bg-sky-500"
                    title="Unsaved changes"
                  />
                )}
                <button
                  type="button"
                  onClick={() => closeTab(file.path)}
                  className="rounded p-0.5 opacity-70 hover:bg-gray-200 hover:opacity-100 dark:hover:bg-gray-700"
                  title={`Close ${file.name}`}
                  aria-label={`Close ${file.name}`}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
            {files.length === 0 && (
              <span className="px-2 text-xs text-gray-500">
                Open a file from the tree
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => activeFile && void openModForFile(activeFile.path)}
              disabled={!activeFile || fileBindings.length === 0}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-200 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-700"
              title="Open the associated mod in the modlist"
            >
              <PackageSearch size={14} /> Open Mod
            </button>
            <button
              type="button"
              onClick={() => activeFile && void openInVSCode(activeFile.path)}
              disabled={!activeFile || !instancePath}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-200 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-700"
              title="Open this config in VS Code"
            >
              <FileText size={14} /> VS Code
            </button>
            <button
              type="button"
              onClick={() => activeFile && void resetBindings(activeFile.path)}
              disabled={
                !activeFile ||
                !fileBindings.some((match) => match.source === "manual")
              }
              className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-200 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-700"
              title="Remove manual mod bindings for this file"
            >
              Reset Binding
            </button>
            <button
              type="button"
              onClick={() => void saveActive()}
              disabled={!activeFile || !isDirty(activeFile) || busy}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-200 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-700"
              title="Save (Ctrl+S)"
            >
              <Save size={14} /> Save
            </button>
            <button
              type="button"
              onClick={() => void revertActive()}
              disabled={!activeFile || busy}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-200 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-700"
              title="Reload from disk"
            >
              <RotateCcw size={14} /> Revert
            </button>
            <button
              type="button"
              onClick={() => activePath && closeTab(activePath)}
              disabled={!activeFile}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-200 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-700"
              title="Close active tab"
            >
              <X size={14} /> Close Tab
            </button>
          </div>
        </div>
        {editorError && (
          <div className="border-b border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {editorError}
          </div>
        )}
        {statusMessage && (
          <div className="border-b border-sky-900 bg-sky-950 px-3 py-2 text-xs text-sky-200">
            {statusMessage}
          </div>
        )}
        {activeFile ? (
          <div className="min-h-[28rem] min-w-0 flex-1 bg-[var(--bg-surface)] text-[var(--text-main)]">
            <Editor
              height="100%"
              language={languageForPath(activeFile.path)}
              theme={editorTheme}
              value={activeFile.content}
              onChange={(value) => updateContent(value ?? "")}
              options={{
                fontSize: 13,
                lineHeight: 22,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                wordWrap: "on",
                tabSize: 2,
                renderLineHighlight: "line",
              }}
            />
          </div>
        ) : (
          <div className="flex min-h-[28rem] flex-1 items-center justify-center bg-[var(--bg-surface)] p-6 text-center text-sm text-gray-400">
            {busy
              ? "Opening file…"
              : "Choose a configuration file from the tree to view and edit it."}
          </div>
        )}
      </div>
      {contextMenu && (
        <>
          <button
            type="button"
            aria-label="Close config file menu"
            className="fixed inset-0 z-40 cursor-default bg-transparent"
            onClick={() => setContextMenu(null)}
          />
          <div
            className="fixed z-50 w-48 rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              type="button"
              className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
              onClick={() => {
                setBindingPath(contextMenu.path);
                setBindingModId(mods[0]?.modId ?? "");
                setContextMenu(null);
              }}
            >
              Bind to Mod…
            </button>
            <button
              type="button"
              className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
              onClick={() => {
                const path = contextMenu.path;
                setContextMenu(null);
                void openModForFile(path);
              }}
            >
              Open Mod
            </button>
            <button
              type="button"
              className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
              onClick={() => {
                const path = contextMenu.path;
                setContextMenu(null);
                void openInVSCode(path);
              }}
            >
              Open with VS Code
            </button>
            <button
              type="button"
              className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
              onClick={() => {
                const path = contextMenu.path;
                setContextMenu(null);
                void resetBindings(path);
              }}
            >
              Reset Manual Binding
            </button>
          </div>
        </>
      )}
      {bindingPath && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setBindingPath(null)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-4 shadow-xl dark:border-gray-700 dark:bg-gray-900"
            role="dialog"
            aria-modal="true"
            aria-label="Bind config to mod"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Bind config to mod
            </h3>
            <p className="mt-1 break-all text-xs text-gray-500 dark:text-gray-400">
              {bindingPath}
            </p>
            <label
              className="mt-3 block text-xs text-gray-500 dark:text-gray-400"
              htmlFor="config-binding-mod"
            >
              Mod
            </label>
            <select
              id="config-binding-mod"
              value={bindingModId}
              onChange={(event) => setBindingModId(event.target.value)}
              className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-2 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            >
              {mods.map((mod) => (
                <option key={`${mod.modId}:${mod.fileName}`} value={mod.modId}>
                  {mod.name} ({mod.modId})
                </option>
              ))}
            </select>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setBindingPath(null)}
                className="rounded border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!instancePath || !bindingModId || bindingBusy}
                onClick={() => {
                  if (!instancePath || !bindingPath || !bindingModId) return;
                  setBindingBusy(true);
                  window.api
                    .setManualConfigMapping(
                      instancePath,
                      bindingModId,
                      bindingPath,
                    )
                    .then(() => setBindingPath(null))
                    .catch((err: unknown) =>
                      setEditorError(
                        err instanceof Error ? err.message : String(err),
                      ),
                    )
                    .finally(() => setBindingBusy(false));
                }}
                className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {bindingBusy ? "Saving…" : "Bind"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default ConfigView;
