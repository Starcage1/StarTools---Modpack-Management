import { useCallback, useEffect, useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  MoreHorizontal,
  RefreshCw,
  Save,
  Search,
  RotateCcw,
  Trash2,
} from "lucide-react";
import type {
  PackCategory,
  PackItem,
  PacksScanResult,
} from "../../../shared/types";

interface PacksViewProps {
  instancePath: string | null;
  active: boolean;
  onOpenArchive: (category: PackCategory, path: string) => Promise<void>;
}

const SECTIONS: { category: PackCategory; title: string }[] = [
  { category: "shaderpacks", title: "Shaderpacks" },
  { category: "resourcepacks", title: "Resource Packs" },
  { category: "datapacks", title: "Datapacks" },
];

const EMPTY_PACKS: PacksScanResult = {
  shaderpacks: [],
  resourcepacks: [],
  datapacks: [],
};
type PackFilter = "all" | "enabled" | "disabled";
type PackSort = "alphabetical" | "modified";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
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
  if (extension === "json" || extension === "json5" || extension === "mcmeta")
    return "json";
  if (extension === "yaml" || extension === "yml") return "yaml";
  if (extension === "glsl" || extension === "vsh" || extension === "fsh")
    return "glsl";
  return "plaintext";
}

function isZip(item: PackItem): boolean {
  return item.type === "file" && item.path.toLowerCase().endsWith(".zip");
}

function PacksView({
  instancePath,
  active,
  onOpenArchive,
}: PacksViewProps): React.JSX.Element {
  const editorTheme = document.documentElement.classList.contains("dark")
    ? "vs-dark"
    : "vs";
  const [packs, setPacks] = useState<PacksScanResult>(EMPTY_PACKS);
  const [loading, setLoading] = useState(() => Boolean(instancePath));
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PackFilter>("all");
  const [sort, setSort] = useState<PackSort>("alphabetical");
  const [expanded, setExpanded] = useState<Set<PackCategory>>(
    () => new Set(SECTIONS.map((section) => section.category)),
  );
  const [selected, setSelected] = useState<PackItem | null>(null);
  const [textFiles, setTextFiles] = useState<string[]>([]);
  const [activeTextFile, setActiveTextFile] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [editorBusy, setEditorBusy] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    pack: PackItem;
    x: number;
    y: number;
  } | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!instancePath) {
      setPacks(EMPTY_PACKS);
      setSelected(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setPacks(await window.api.scanPacks(instancePath));
    } catch (err) {
      setPacks(EMPTY_PACKS);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [instancePath]);

  useEffect(() => {
    if (!instancePath) return;
    let cancelled = false;
    window.api
      .scanPacks(instancePath)
      .then((scanned) => {
        if (!cancelled) setPacks(scanned);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPacks(EMPTY_PACKS);
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [instancePath]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return Object.fromEntries(
      SECTIONS.map(({ category }) => [
        category,
        packs[category]
          .filter(
            (item) =>
              (filter === "all" || (filter === "enabled") === item.enabled) &&
              (!needle ||
                `${item.name} ${item.description} ${item.path}`
                  .toLowerCase()
                  .includes(needle)),
          )
          .sort((a, b) =>
            sort === "modified"
              ? b.lastModified - a.lastModified ||
                a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
              : a.name.localeCompare(b.name, undefined, {
                  sensitivity: "base",
                }),
          ),
      ]),
    ) as Record<PackCategory, PackItem[]>;
  }, [filter, packs, query, sort]);

  const openPack = async (
    item: PackItem,
    dirtyStateConfirmed = false,
  ): Promise<void> => {
    if (
      !dirtyStateConfirmed &&
      selected &&
      activeTextFile !== null &&
      content !== savedContent &&
      !window.confirm("Discard unsaved changes before switching packs?")
    )
      return;
    setSelected(item);
    setTextFiles([]);
    setActiveTextFile(null);
    setContent("");
    setSavedContent("");
    if (!instancePath || isZip(item)) return;
    setEditorBusy(true);
    try {
      const files = await window.api.listPackTextFiles(
        instancePath,
        item.category,
        item.path,
      );
      setTextFiles(files);
      if (item.type === "file" && files.includes(""))
        await openTextFile(item, "");
      else if (item.type === "directory" && files.length > 0) {
        const preferred =
          files.find((file) => file.toLowerCase() === "pack.mcmeta") ??
          files.find((file) => file.toLowerCase() === "shaders.properties") ??
          files[0];
        await openTextFile(item, preferred);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEditorBusy(false);
    }
  };

  const openTextFile = async (
    pack: PackItem,
    filePath: string,
  ): Promise<void> => {
    if (!instancePath) return;
    if (
      activeTextFile !== null &&
      activeTextFile !== filePath &&
      content !== savedContent &&
      !window.confirm("Discard unsaved changes to the current pack file?")
    )
      return;
    setEditorBusy(true);
    setError(null);
    try {
      const document = await window.api.readPackTextFile(
        instancePath,
        pack.category,
        pack.path,
        filePath,
      );
      setActiveTextFile(filePath);
      setContent(document.content);
      setSavedContent(document.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEditorBusy(false);
    }
  };

  const saveTextFile = useCallback(async (): Promise<void> => {
    if (
      !instancePath ||
      !selected ||
      activeTextFile === null ||
      content === savedContent ||
      editorBusy
    )
      return;
    setEditorBusy(true);
    setError(null);
    try {
      await window.api.savePackTextFile(
        instancePath,
        selected.category,
        selected.path,
        activeTextFile,
        content,
      );
      setSavedContent(content);
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEditorBusy(false);
    }
  }, [
    activeTextFile,
    content,
    editorBusy,
    instancePath,
    refresh,
    savedContent,
    selected,
  ]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveTextFile();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, saveTextFile]);

  const togglePack = async (item: PackItem): Promise<void> => {
    if (!instancePath) return;
    if (
      activeTextFile !== null &&
      content !== savedContent &&
      !window.confirm(
        "Changing pack state will switch the editor selection. Discard unsaved changes?",
      )
    )
      return;
    setError(null);
    try {
      await window.api.setPackEnabled(
        instancePath,
        item.category,
        item.path,
        !item.enabled,
      );
      const next = await window.api.scanPacks(instancePath);
      setPacks(next);
      const moved = next[item.category].find(
        (candidate) =>
          candidate.name === item.name && candidate.enabled !== item.enabled,
      );
      if (moved) void openPack(moved, true);
      else setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const trashPack = async (item: PackItem): Promise<void> => {
    if (!instancePath || !window.confirm(`Move ${item.name} to the app trash?`))
      return;
    try {
      await window.api.trashPack(instancePath, item.category, item.path);
      if (selected?.path === item.path) setSelected(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const selectClass = (item: PackItem): string =>
    `flex w-full items-start gap-2 rounded px-2 py-2 text-left text-sm ${selected?.path === item.path ? "bg-sky-50 text-sky-900 dark:bg-sky-950/50 dark:text-sky-100" : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"}`;

  return (
    <section className="grid min-h-[65vh] grid-cols-1 overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900 lg:grid-cols-[minmax(240px,28%)_minmax(0,1fr)]">
      <aside className="flex min-h-64 flex-col border-b border-gray-200 dark:border-gray-700 lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-2 border-b border-gray-200 p-3 dark:border-gray-700">
          <div className="relative min-w-0 flex-1">
            <Search
              size={14}
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search packs…"
              aria-label="Search packs"
              className="w-full rounded border border-gray-300 bg-white py-1.5 pl-7 pr-2 text-sm outline-none focus:border-sky-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>
          <button
            type="button"
            title="Refresh packs"
            aria-label="Refresh packs"
            onClick={() => void refresh()}
            disabled={!instancePath || loading}
            className="rounded p-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-800"
          >
            <RefreshCw size={15} />
          </button>
        </div>
        <div className="border-b border-gray-200 px-3 py-2 dark:border-gray-700">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex min-w-0 items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
              Filter
              <select
                value={filter}
                onChange={(event) =>
                  setFilter(event.target.value as PackFilter)
                }
                className="min-w-0 rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
              >
                <option value="all">All packs</option>
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>
            <label className="flex min-w-0 items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
              Sort
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as PackSort)}
                className="min-w-0 rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
              >
                <option value="alphabetical">Alphabetical</option>
                <option value="modified">Last Modified</option>
              </select>
            </label>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {SECTIONS.map(({ category, title }) => (
            <div key={category} className="mb-2">
              <button
                type="button"
                onClick={() =>
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(category)) next.delete(category);
                    else next.add(category);
                    return next;
                  })
                }
                className="flex w-full items-center gap-1.5 rounded px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                {expanded.has(category) ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronRight size={14} />
                )}
                <span className="flex-1">{title}</span>
                <span>{filtered[category].length}</span>
              </button>
              {expanded.has(category) &&
                filtered[category].map((item) => (
                  <button
                    key={`${category}:${item.path}`}
                    type="button"
                    onClick={() => void openPack(item)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setContextMenu({
                        pack: item,
                        x: Math.min(event.clientX, window.innerWidth - 195),
                        y: Math.min(event.clientY, window.innerHeight - 145),
                      });
                    }}
                    className={selectClass(item)}
                    title={item.path}
                  >
                    {item.type === "directory" ? (
                      <Folder
                        size={15}
                        className="mt-0.5 shrink-0 text-amber-500"
                      />
                    ) : (
                      <File
                        size={15}
                        className="mt-0.5 shrink-0 text-gray-400"
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{item.name}</span>
                      {!item.enabled && (
                        <span className="block text-[10px] uppercase text-gray-400">
                          Disabled
                        </span>
                      )}
                    </span>
                    <MoreHorizontal
                      size={14}
                      className="mt-0.5 shrink-0 opacity-50"
                    />
                  </button>
                ))}
            </div>
          ))}
        </div>
      </aside>

      <main className="flex min-h-[28rem] min-w-0 flex-col bg-[var(--bg-surface)]">
        {error && (
          <div className="border-b border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {error}
          </div>
        )}
        {!instancePath ? (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-gray-400">
            Select an instance folder to view its packs.
          </div>
        ) : loading && !selected ? (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
            Scanning packs…
          </div>
        ) : !selected ? (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-gray-400">
            Choose a pack from the sidebar to view its details and files.
          </div>
        ) : isZip(selected) ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <article className="w-full max-w-xl rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 text-[var(--text-main)] shadow-xl">
              <div className="flex items-start gap-4">
                {selected.iconDataUri ? (
                  <img
                    src={selected.iconDataUri}
                    alt=""
                    className="h-20 w-20 rounded object-cover"
                  />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded bg-[var(--bg-elevated)]">
                    <Archive size={28} className="text-gray-400" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h2 className="break-words text-lg font-semibold">
                    {selected.name}
                  </h2>
                  <p className="mt-1 break-all font-mono text-xs text-gray-400">
                    {selected.path}
                  </p>
                  {selected.description && (
                    <p className="mt-3 whitespace-pre-wrap text-sm text-[var(--text-muted)]">
                      {selected.description}
                    </p>
                  )}
                </div>
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-[var(--border-subtle)] pt-4 text-sm">
                <div>
                  <dt className="text-xs uppercase text-gray-500">
                    Pack Format
                  </dt>
                  <dd className="mt-1">{selected.packFormat ?? "Unknown"}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-gray-500">File Size</dt>
                  <dd className="mt-1">{formatBytes(selected.size)}</dd>
                </div>
              </dl>
              <button
                type="button"
                onClick={() =>
                  void onOpenArchive(selected.category, selected.path).catch(
                    (err: unknown) =>
                      setError(
                        err instanceof Error ? err.message : String(err),
                      ),
                  )
                }
                className="mt-5 inline-flex items-center gap-2 rounded bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500"
              >
                <Archive size={15} /> Open Archive
              </button>
            </article>
          </div>
        ) : activeTextFile !== null ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
              <div className="flex min-w-0 items-center gap-2 text-sm text-[var(--text-main)]">
                <FolderOpen size={15} className="shrink-0 text-amber-500" />
                <span className="truncate">
                  {selected.name}
                  {activeTextFile ? ` / ${activeTextFile}` : ""}
                </span>
                {content !== savedContent && (
                  <span
                    className="h-2 w-2 rounded-full bg-sky-400"
                    title="Unsaved changes"
                  />
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => void saveTextFile()}
                  disabled={content === savedContent || editorBusy}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  <Save size={13} /> Save
                </button>
                <button
                  type="button"
                  onClick={() => setContent(savedContent)}
                  disabled={content === savedContent || editorBusy}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  <RotateCcw size={13} /> Revert
                </button>
              </div>
            </div>
            {textFiles.length > 1 && selected.type === "directory" && (
              <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2">
                {textFiles.map((file) => (
                  <button
                    key={file}
                    type="button"
                    onClick={() => void openTextFile(selected, file)}
                    title={file}
                    className={`max-w-48 shrink-0 truncate border-b-2 px-3 py-2 text-xs ${activeTextFile === file ? "border-sky-500 text-[var(--text-main)]" : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"}`}
                  >
                    {file}
                  </button>
                ))}
              </div>
            )}
            <div className="min-h-[26rem] min-w-0 flex-1">
              <Editor
                height="100%"
                language={languageForPath(activeTextFile || selected.name)}
                theme={editorTheme}
                value={content}
                onChange={(value) => setContent(value ?? "")}
                options={{
                  fontSize: 13,
                  lineHeight: 22,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  wordWrap: "on",
                }}
              />
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto p-5">
            <div className="mx-auto max-w-3xl">
              <div className="flex items-start gap-4">
                {selected.iconDataUri ? (
                  <img
                    src={selected.iconDataUri}
                    alt=""
                    className="h-20 w-20 rounded object-cover"
                  />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded bg-[var(--bg-elevated)]">
                    <FolderOpen size={28} className="text-amber-500" />
                  </div>
                )}
                <div className="min-w-0 flex-1 text-[var(--text-main)]">
                  <h2 className="break-words text-lg font-semibold">
                    {selected.name}
                  </h2>
                  <p className="mt-1 break-all font-mono text-xs text-gray-400">
                    {selected.path}
                  </p>
                  {selected.description && (
                    <p className="mt-3 whitespace-pre-wrap text-sm text-[var(--text-muted)]">
                      {selected.description}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-400">
                    <span>Pack format: {selected.packFormat ?? "Unknown"}</span>
                    <span>Size: {formatBytes(selected.size)}</span>
                    <span>{selected.enabled ? "Enabled" : "Disabled"}</span>
                  </div>
                </div>
              </div>
              <div className="mt-6 border-t border-[var(--border-subtle)] pt-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Editable text files
                </h3>
                {textFiles.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    No supported text files found in this pack.
                  </p>
                ) : (
                  <div className="grid gap-1 sm:grid-cols-2">
                    {textFiles.map((file) => (
                      <button
                        key={file}
                        type="button"
                        onClick={() => void openTextFile(selected, file)}
                        className="flex min-w-0 items-center gap-2 rounded px-2 py-2 text-left text-sm text-gray-300 hover:bg-gray-800"
                      >
                        <File size={14} className="shrink-0 text-gray-500" />
                        <span className="truncate">{file}</span>
                      </button>
                    ))}
                  </div>
                )}
                {editorBusy && activeTextFile === null && (
                  <p className="mt-2 text-xs text-gray-500">
                    Opening pack files…
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {contextMenu && (
        <>
          <button
            type="button"
            aria-label="Close pack menu"
            className="fixed inset-0 z-40 cursor-default bg-transparent"
            onClick={() => setContextMenu(null)}
          />
          <div
            className="fixed z-50 w-48 rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              type="button"
              onClick={() => {
                const item = contextMenu.pack;
                setContextMenu(null);
                void togglePack(item);
              }}
              className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              {contextMenu.pack.enabled ? "Disable" : "Enable"}
            </button>
            <button
              type="button"
              onClick={() => {
                const item = contextMenu.pack;
                setContextMenu(null);
                if (instancePath)
                  void window.api
                    .revealPack(instancePath, item.category, item.path)
                    .catch((err: unknown) =>
                      setError(
                        err instanceof Error ? err.message : String(err),
                      ),
                    );
              }}
              className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              Reveal in Explorer
            </button>
            <button
              type="button"
              onClick={() => {
                const item = contextMenu.pack;
                setContextMenu(null);
                void trashPack(item);
              }}
              className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
            >
              <Trash2 size={14} className="mr-2 inline" />
              Move to Trash
            </button>
          </div>
        </>
      )}
    </section>
  );
}

export default PacksView;
