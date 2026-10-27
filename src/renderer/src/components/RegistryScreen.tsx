import { useEffect, useMemo, useState } from "react";
import {
  Blocks,
  Bug,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileDown,
  Globe2,
  LoaderCircle,
  Package,
  Search,
  TreePine,
} from "lucide-react";
import type {
  RegistryAssetRequest,
  RegistryEntry,
  RegistryExportAssetRequest,
  RegistryKind,
  RegistryScanProgress,
  RegistryScanResult,
} from "../../../shared/types";
import { useDebounce } from "../hooks/useDebounce";

type RegistryCategory = Exclude<RegistryKind, never>;

interface DuplicateGroup {
  entries: RegistryEntry[];
  sameName: boolean;
  sameId: boolean;
  names: string[];
  paths: string[];
}

const CATEGORIES: Array<{
  id: RegistryCategory;
  title: string;
  icon: typeof Package;
}> = [
  { id: "item", title: "Items", icon: Package },
  { id: "block", title: "Blocks", icon: Blocks },
  { id: "biome", title: "Biomes", icon: TreePine },
  { id: "dimension", title: "Dimensions", icon: Globe2 },
  { id: "mob", title: "Mobs", icon: Bug },
];

const EMPTY_RESULT: RegistryScanResult = {
  instancePath: "",
  minecraftVersion: "Unknown",
  fromCache: false,
  items: [],
  blocks: [],
  biomes: [],
  dimensions: [],
  mobs: [],
};

const iconCache = new Map<string, string | null>();
const keyFor = (entry: RegistryAssetRequest): string =>
  `${entry.sourceJar}\u0000${entry.texturePath}`;

interface RegistryScreenProps {
  instancePath: string | null;
  active: boolean;
  crossModOnlyDefault: boolean;
  onCrossModOnlyChange: (enabled: boolean) => void;
  ignoreVanillaBackports: boolean;
  searchDebounceMs: number;
  onError: (message: string) => void;
  onNotify: (message: string) => void;
}

function entriesFor(
  result: RegistryScanResult,
  kind: RegistryCategory,
): RegistryEntry[] {
  if (kind === "item") return result.items;
  if (kind === "block") return result.blocks;
  if (kind === "biome") return result.biomes;
  if (kind === "dimension") return result.dimensions;
  return result.mobs;
}

function findDuplicateGroups(
  entries: RegistryEntry[],
  crossModOnly: boolean,
  ignoreVanillaBackports: boolean,
): DuplicateGroup[] {
  const buckets = new Map<
    string,
    { type: "name" | "id"; key: string; entries: RegistryEntry[] }
  >();
  const add = (
    type: "name" | "id",
    key: string,
    entry: RegistryEntry,
  ): void => {
    const bucketId = `${type}:${key}`;
    const bucket = buckets.get(bucketId) ?? { type, key, entries: [] };
    bucket.entries.push(entry);
    buckets.set(bucketId, bucket);
  };
  for (const entry of entries) {
    add("name", entry.displayName.trim().toLocaleLowerCase(), entry);
    add(
      "id",
      entry.id.split(":").slice(1).join(":").trim().toLocaleLowerCase(),
      entry,
    );
  }

  const collisions = [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      entries: [
        ...new Map(bucket.entries.map((entry) => [entry.id, entry])).values(),
      ],
    }))
    .filter((bucket) => {
      if (bucket.entries.length < 2) return false;
      return (
        !crossModOnly ||
        new Set(
          bucket.entries.map((entry) => entry.namespace.toLocaleLowerCase()),
        ).size > 1
      );
    });
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const current = parent.get(id);
    if (!current) {
      parent.set(id, id);
      return id;
    }
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const unite = (first: string, second: string): void => {
    const firstRoot = find(first);
    const secondRoot = find(second);
    if (firstRoot !== secondRoot) parent.set(secondRoot, firstRoot);
  };
  for (const collision of collisions) {
    const [first, ...rest] = collision.entries;
    if (!first) continue;
    for (const entry of rest) unite(first.id, entry.id);
  }

  const groups = new Map<string, DuplicateGroup>();
  for (const collision of collisions) {
    const root = find(collision.entries[0]!.id);
    const group = groups.get(root) ?? {
      entries: [],
      sameName: false,
      sameId: false,
      names: [],
      paths: [],
    };
    group.sameName ||= collision.type === "name";
    group.sameId ||= collision.type === "id";
    if (collision.type === "name") group.names.push(collision.key);
    else group.paths.push(collision.key);
    for (const entry of collision.entries) {
      if (!group.entries.some((item) => item.id === entry.id))
        group.entries.push(entry);
    }
    groups.set(root, group);
  }

  return [...groups.values()]
    .filter(
      (group) =>
        !crossModOnly ||
        new Set(
          group.entries.map((entry) => entry.namespace.toLocaleLowerCase()),
        ).size > 1,
    )
    .filter((group) => {
      if (!ignoreVanillaBackports) return true;
      const namespaces = new Set(
        group.entries.map((entry) => entry.namespace.toLocaleLowerCase()),
      );
      const backports = new Set([
        "vanillabackport",
        "futuremc",
        "backported_mobs",
        "minecraft_backport",
      ]);
      return !(
        namespaces.has("minecraft") &&
        [...namespaces].every(
          (value) => value === "minecraft" || backports.has(value),
        )
      );
    })
    .sort((a, b) =>
      (a.names[0] ?? a.paths[0] ?? "").localeCompare(
        b.names[0] ?? b.paths[0] ?? "",
      ),
    );
}

function RegistryScreen({
  instancePath,
  active,
  crossModOnlyDefault,
  onCrossModOnlyChange,
  ignoreVanillaBackports,
  searchDebounceMs,
  onError,
  onNotify,
}: RegistryScreenProps): React.JSX.Element {
  const [result, setResult] = useState<RegistryScanResult>(EMPTY_RESULT);
  const [progress, setProgress] = useState<RegistryScanProgress>({
    indexedMods: 0,
    totalMods: 0,
  });
  const [scannedPath, setScannedPath] = useState<string | null>(null);
  const [kind, setKind] = useState<RegistryCategory>("item");
  const [expandedCategory, setExpandedCategory] =
    useState<RegistryCategory | null>("item");
  const [namespace, setNamespace] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [duplicateMode, setDuplicateMode] = useState(false);
  const crossModOnly = crossModOnlyDefault;
  const [registryRevision, setRegistryRevision] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [icons, setIcons] = useState<Record<string, string | null>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const debouncedQuery = useDebounce(query, searchDebounceMs);

  useEffect(
    () =>
      window.api.onRegistryOutdated(({ instancePath: changedPath }) => {
        if (
          !active ||
          !instancePath ||
          changedPath.toLocaleLowerCase() !== instancePath.toLocaleLowerCase()
        )
          return;
        setScannedPath(null);
        setPage(1);
        setRegistryRevision((revision) => revision + 1);
      }),
    [active, instancePath],
  );

  useEffect(() => {
    if (!active || !instancePath) return;
    let cancelled = false;
    window.api
      .scanRegistries(instancePath, setProgress)
      .then((scan) => {
        if (!cancelled) {
          setResult(scan);
          setPage(1);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled)
          onError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setScannedPath(instancePath);
      });
    return () => {
      cancelled = true;
    };
  }, [active, instancePath, onError, registryRevision]);

  const sourceEntries = entriesFor(result, kind);
  const namespaceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of sourceEntries) {
      counts.set(entry.namespace, (counts.get(entry.namespace) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => {
      if (a === "minecraft") return -1;
      if (b === "minecraft") return 1;
      return a.localeCompare(b);
    });
  }, [sourceEntries]);

  const filtered = useMemo(() => {
    const normalized = debouncedQuery.trim().toLocaleLowerCase();
    return sourceEntries.filter((entry) => {
      if (namespace && entry.namespace !== namespace) return false;
      if (!normalized) return true;
      return (
        entry.displayName.toLocaleLowerCase().includes(normalized) ||
        entry.id.toLocaleLowerCase().includes(normalized)
      );
    });
  }, [sourceEntries, namespace, debouncedQuery]);

  const duplicateGroups = useMemo(
    () =>
      findDuplicateGroups(sourceEntries, crossModOnly, ignoreVanillaBackports),
    [sourceEntries, crossModOnly, ignoreVanillaBackports],
  );
  const filteredDuplicateGroups = useMemo(() => {
    const normalized = debouncedQuery.trim().toLocaleLowerCase();
    if (!normalized) return duplicateGroups;
    return duplicateGroups.filter(
      (group) =>
        group.entries.some(
          (entry) =>
            entry.displayName.toLocaleLowerCase().includes(normalized) ||
            entry.id.toLocaleLowerCase().includes(normalized),
        ) ||
        group.names.some((name) => name.includes(normalized)) ||
        group.paths.some((path) => path.includes(normalized)),
    );
  }, [duplicateGroups, debouncedQuery]);
  const displayCount = duplicateMode
    ? filteredDuplicateGroups.length
    : filtered.length;
  const totalPages = Math.max(1, Math.ceil(displayCount / pageSize));
  const safePage = Math.min(page, totalPages);
  const visibleEntries = useMemo(
    () => filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filtered, safePage, pageSize],
  );
  const visibleDuplicateGroups = useMemo(
    () =>
      filteredDuplicateGroups.slice(
        (safePage - 1) * pageSize,
        safePage * pageSize,
      ),
    [filteredDuplicateGroups, safePage, pageSize],
  );
  const iconEntries = useMemo(
    () =>
      duplicateMode
        ? visibleDuplicateGroups.flatMap((group) => group.entries)
        : visibleEntries,
    [duplicateMode, visibleDuplicateGroups, visibleEntries],
  );

  useEffect(() => {
    if (!instancePath) return;
    const requests = iconEntries
      .filter((entry): entry is RegistryEntry & { texturePath: string } =>
        Boolean(entry.texturePath),
      )
      .map(({ sourceJar, textureSourceJar, texturePath }) => ({
        sourceJar: textureSourceJar ?? sourceJar,
        texturePath,
      }));
    const missing = requests.filter(
      (request) => !iconCache.has(keyFor(request)),
    );
    if (!missing.length) return;
    let cancelled = false;
    window.api
      .readRegistryAssets(instancePath, missing)
      .then((assets) => {
        if (cancelled) return;
        for (const asset of assets) {
          const key = keyFor(asset);
          iconCache.set(key, asset.dataUri);
          if (iconCache.size > 512) {
            const oldestKey = iconCache.keys().next().value;
            if (oldestKey) iconCache.delete(oldestKey);
          }
        }
        setIcons((current) => {
          const next = { ...current };
          for (const asset of assets) next[keyFor(asset)] = asset.dataUri;
          return next;
        });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          onError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [instancePath, iconEntries, onError]);

  const selectedLabel = namespace ?? "All Namespaces";
  const loading = Boolean(
    active && instancePath && scannedPath !== instancePath,
  );
  const shownStart = displayCount ? (safePage - 1) * pageSize + 1 : 0;
  const shownEnd = Math.min(safePage * pageSize, displayCount);

  const handleCategoryClick = (categoryKey: RegistryCategory): void => {
    if (expandedCategory === categoryKey) {
      setExpandedCategory(null);
      return;
    }
    setExpandedCategory(categoryKey);
    setKind(categoryKey);
    setNamespace(null);
    setPage(1);
  };

  const copyId = async (id: string): Promise<void> => {
    try {
      await window.api.copyText(id);
      setCopiedId(id);
      window.setTimeout(
        () => setCopiedId((current) => (current === id ? null : current)),
        1300,
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  const exportAsset = async (
    entry: RegistryEntry,
    assetPath: string,
    defaultFileName: string,
  ): Promise<void> => {
    if (!instancePath) return;
    try {
      const request: RegistryExportAssetRequest = {
        modId: entry.namespace,
        assetPath,
        defaultFileName,
        sourceJar:
          assetPath === entry.texturePath
            ? (entry.textureSourceJar ?? entry.sourceJar)
            : entry.sourceJar,
      };
      const result = await window.api.exportRegistryAsset(
        instancePath,
        request,
      );
      if (result.success) onNotify(`Exported ${defaultFileName}`);
      else onError("The registry asset could not be exported.");
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section className="flex min-h-[calc(100vh-10.5rem)] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/30">
      <aside className="flex w-[260px] shrink-0 flex-col border-r border-zinc-800 bg-zinc-950/50">
        <div className="border-b border-zinc-800 px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
            Registries
          </p>
          <p className="mt-1 truncate text-xs text-zinc-400">
            Minecraft {result.minecraftVersion}
          </p>
        </div>
        <div className="space-y-1 overflow-y-auto p-2">
          {CATEGORIES.map(({ id, title, icon: Icon }) => {
            const count = entriesFor(result, id).length;
            const selected = kind === id;
            const expanded = expandedCategory === id;
            return (
              <div key={id}>
                <button
                  type="button"
                  onClick={() => handleCategoryClick(id)}
                  className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition ${selected ? "border-cyan-500/50 bg-zinc-900 text-cyan-400" : "border-transparent text-zinc-400 hover:bg-zinc-900/70 hover:text-zinc-200"}`}
                  aria-expanded={expanded}
                >
                  <Icon size={15} />
                  <span className="flex-1 font-medium">{title}</span>
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                    {count.toLocaleString()}
                  </span>
                  <ChevronDown
                    size={13}
                    className={expanded ? "" : "-rotate-90"}
                  />
                </button>
                {expanded && (
                  <div className="mt-1 space-y-0.5 pl-3">
                    <button
                      type="button"
                      onClick={() => {
                        setNamespace(null);
                        setPage(1);
                      }}
                      className={`flex w-full items-center justify-between rounded px-2.5 py-1.5 text-left text-[11px] ${namespace === null ? "bg-zinc-900 text-cyan-300" : "text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200"}`}
                    >
                      <span>All Namespaces</span>
                      <span className="font-mono text-[10px]">
                        {count.toLocaleString()}
                      </span>
                    </button>
                    {namespaceCounts.map(([name, namespaceCount]) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => {
                          setNamespace(name);
                          setPage(1);
                        }}
                        className={`flex w-full items-center justify-between rounded px-2.5 py-1.5 text-left text-[11px] ${namespace === name ? "bg-zinc-900 text-cyan-300" : "text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200"}`}
                      >
                        <span className="truncate">
                          {name}
                          {name === "minecraft" ? " (vanilla)" : ""}
                        </span>
                        <span className="ml-2 font-mono text-[10px]">
                          {namespaceCount.toLocaleString()}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-4 py-3">
          <div className="min-w-44 flex-1">
            <h2 className="text-sm font-semibold">
              {duplicateMode
                ? "Duplicate Checker"
                : CATEGORIES.find((category) => category.id === kind)
                    ?.title}{" "}
              <span className="px-1 text-zinc-600">➔</span>{" "}
              <span className="text-cyan-300">
                {duplicateMode
                  ? CATEGORIES.find((category) => category.id === kind)?.title
                  : selectedLabel}
              </span>
            </h2>
            <p className="mt-1 text-[10px] text-zinc-500">
              {displayCount.toLocaleString()}{" "}
              {duplicateMode ? "collision groups" : "entries"}
            </p>
          </div>
          <button
            type="button"
            aria-pressed={duplicateMode}
            onClick={() => {
              setDuplicateMode((value) => !value);
              setNamespace(null);
              setPage(1);
            }}
            className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs transition ${duplicateMode ? "border-amber-700/60 bg-amber-950/50 text-amber-300" : "border-zinc-800 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"}`}
            title={`${duplicateGroups.length} collision group(s) in ${CATEGORIES.find((category) => category.id === kind)?.title}`}
          >
            <Search size={13} /> Check Duplicates{" "}
            <span className="rounded bg-black/20 px-1.5 py-0.5 font-mono text-[10px]">
              {duplicateGroups.length}
            </span>
          </button>
          {duplicateMode && (
            <label className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-md border border-zinc-800 px-2.5 text-xs text-zinc-300 hover:bg-zinc-900">
              <input
                type="checkbox"
                checked={crossModOnly}
                onChange={(event) => {
                  onCrossModOnlyChange(event.target.checked);
                  setPage(1);
                }}
                className="accent-cyan-500"
              />
              Cross-Mod Only
              <span className="text-[10px] text-zinc-500">
                (Default: Checked)
              </span>
            </label>
          )}
          <label
            className="relative z-10 min-w-52 flex-1 sm:max-w-sm"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500"
            />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="Search name or registry ID…"
              autoComplete="off"
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
              className="relative z-10 h-8 w-full cursor-text select-text pointer-events-auto rounded-md border border-zinc-800 bg-zinc-950 pl-8 pr-3 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-cyan-600/60 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
          </label>
          <select
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(1);
            }}
            aria-label="Items per page"
            className="h-8 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-300 outline-none focus:border-cyan-600/60"
          >
            {[25, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size} / page
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            <span className="mr-1 whitespace-nowrap text-[10px] text-zinc-500">
              Page {safePage} of {totalPages}
            </span>
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              className="rounded border border-zinc-800 p-1.5 text-zinc-400 hover:bg-zinc-900 disabled:opacity-30"
              aria-label="Previous page"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() =>
                setPage((value) => Math.min(totalPages, value + 1))
              }
              className="rounded border border-zinc-800 p-1.5 text-zinc-400 hover:bg-zinc-900 disabled:opacity-30"
              aria-label="Next page"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div className="flex min-h-56 flex-col items-center justify-center gap-3 px-4 text-center">
              <LoaderCircle size={22} className="animate-spin text-cyan-400" />
              <p className="text-sm text-zinc-300">
                Scanning mod registries and assets...
              </p>
              <p className="font-mono text-xs text-zinc-500">
                ({progress.indexedMods} / {progress.totalMods} mods indexed)
                {progress.currentFile ? ` · ${progress.currentFile}` : ""}
              </p>
            </div>
          ) : !instancePath ? (
            <div className="grid min-h-56 place-items-center text-sm text-zinc-500">
              Select an instance to scan its registries.
            </div>
          ) : displayCount === 0 ? (
            <div className="grid min-h-56 place-items-center px-5 text-center text-sm text-zinc-500">
              {duplicateMode
                ? debouncedQuery.trim()
                  ? `No duplicate groups match '${debouncedQuery.trim()}' in ${CATEGORIES.find((category) => category.id === kind)?.title}.`
                  : `No duplicate names or IDs were found in ${CATEGORIES.find((category) => category.id === kind)?.title}.`
                : debouncedQuery.trim()
                  ? `No registry entries match '${debouncedQuery.trim()}' in ${CATEGORIES.find((category) => category.id === kind)?.title}.`
                  : `No ${CATEGORIES.find((category) => category.id === kind)?.title.toLowerCase()} were found for this instance.`}
            </div>
          ) : duplicateMode ? (
            <div className="divide-y divide-zinc-800/70">
              {visibleDuplicateGroups.map((group) => {
                const collisionKey = [
                  group.sameName ? group.entries[0]?.displayName : null,
                  group.sameId ? group.paths[0] : null,
                ]
                  .filter(Boolean)
                  .join(" / ");
                return (
                  <div
                    key={group.entries
                      .map((entry) => entry.id)
                      .sort()
                      .join("|")}
                    className="flex min-h-16 flex-col gap-2 px-4 py-2.5 lg:flex-row lg:items-center"
                  >
                    <div className="flex w-full shrink-0 flex-wrap items-center gap-1.5 lg:w-48">
                      <span
                        className="mr-1 max-w-full truncate text-xs font-semibold text-zinc-200"
                        title={collisionKey}
                      >
                        {collisionKey}
                      </span>
                      {group.sameName && (
                        <span className="rounded border border-amber-800/50 bg-amber-950/60 px-1.5 py-0.5 text-[9px] font-semibold text-amber-400">
                          SAME NAME
                        </span>
                      )}
                      {group.sameId && (
                        <span className="rounded border border-cyan-800/50 bg-cyan-950/60 px-1.5 py-0.5 text-[9px] font-semibold text-cyan-400">
                          SAME ID
                        </span>
                      )}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                      {group.entries.map((entry) => {
                        const request = entry.texturePath
                          ? {
                              sourceJar:
                                entry.textureSourceJar ?? entry.sourceJar,
                              texturePath: entry.texturePath,
                            }
                          : null;
                        const image = request
                          ? (icons[keyFor(request)] ??
                            iconCache.get(keyFor(request)) ??
                            null)
                          : null;
                        return (
                          <div
                            key={entry.id}
                            className="flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-1"
                          >
                            {image ? (
                              <img
                                src={image}
                                alt=""
                                className="size-5 shrink-0 object-contain"
                                style={{ imageRendering: "pixelated" }}
                              />
                            ) : (
                              <span className="grid size-5 shrink-0 place-items-center rounded bg-zinc-800 text-[9px] text-zinc-500">
                                {entry.type === "mob"
                                  ? "M"
                                  : entry.type === "dimension"
                                    ? "D"
                                    : entry.type[0].toUpperCase()}
                              </span>
                            )}
                            <span
                              className="max-w-28 truncate rounded border border-zinc-700/70 bg-zinc-900 px-1 py-0.5 font-mono text-[9px] text-zinc-400"
                              title={entry.namespace}
                            >
                              {entry.namespace}
                            </span>
                            <span
                              className="max-w-56 truncate font-mono text-[10px] text-zinc-300"
                              title={entry.id}
                            >
                              {entry.id}
                            </span>
                            <button
                              type="button"
                              onClick={() => void copyId(entry.id)}
                              title={
                                copiedId === entry.id ? "Copied!" : "Copy ID"
                              }
                              aria-label={`Copy ${entry.id}`}
                              className="shrink-0 rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
                            >
                              {copiedId === entry.id ? (
                                <Check size={11} className="text-emerald-400" />
                              ) : (
                                <Copy size={11} />
                              )}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <table className="w-full min-w-[780px] table-fixed border-collapse text-left">
              <thead className="sticky top-0 z-10 bg-zinc-950/95 text-[10px] uppercase tracking-wider text-zinc-500 backdrop-blur">
                <tr className="border-b border-zinc-800">
                  <th className="w-14 px-3 py-2 font-medium">Icon</th>
                  <th className="w-[30%] px-3 py-2 font-medium">
                    Display Name
                  </th>
                  <th className="w-[34%] px-3 py-2 font-medium">Registry ID</th>
                  <th className="w-[20%] px-3 py-2 font-medium">
                    Namespace / Mod
                  </th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="w-24 px-3 py-2 text-right font-medium">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleEntries.map((entry) => {
                  const assetRequest = entry.texturePath
                    ? {
                        sourceJar: entry.textureSourceJar ?? entry.sourceJar,
                        texturePath: entry.texturePath,
                      }
                    : null;
                  const image = assetRequest
                    ? (icons[keyFor(assetRequest)] ??
                      iconCache.get(keyFor(assetRequest)) ??
                      null)
                    : null;
                  const Icon =
                    entry.type === "item"
                      ? Package
                      : entry.type === "block"
                        ? Blocks
                        : TreePine;
                  return (
                    <tr
                      key={`${entry.type}:${entry.id}`}
                      className="h-14 border-b border-zinc-800/70 transition-colors hover:bg-white/[0.025]"
                    >
                      <td className="px-3 py-1.5">
                        <div className="grid size-9 place-items-center overflow-hidden rounded-md border border-zinc-800 bg-zinc-900 text-zinc-500">
                          {image ? (
                            <img
                              src={image}
                              alt=""
                              className="size-8 object-contain"
                              style={{ imageRendering: "pixelated" }}
                            />
                          ) : (
                            <Icon size={17} />
                          )}
                        </div>
                      </td>
                      <td
                        className="truncate px-3 py-1.5 text-xs font-medium text-zinc-200"
                        title={entry.displayName}
                      >
                        {entry.displayName}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="group flex min-w-0 items-center gap-1.5">
                          <span
                            className="truncate font-mono text-[11px] text-zinc-400"
                            title={entry.id}
                          >
                            {entry.id}
                          </span>
                          <button
                            type="button"
                            onClick={() => void copyId(entry.id)}
                            title={
                              copiedId === entry.id
                                ? "Copied!"
                                : "Copy registry ID"
                            }
                            aria-label={`Copy ${entry.id}`}
                            className="shrink-0 rounded p-1 text-zinc-600 opacity-0 transition hover:bg-zinc-800 hover:text-zinc-200 group-hover:opacity-100 focus:opacity-100"
                          >
                            {copiedId === entry.id ? (
                              <Check size={12} className="text-emerald-400" />
                            ) : (
                              <Copy size={12} />
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="truncate px-3 py-1.5">
                        <span
                          className="rounded border border-zinc-700/70 bg-zinc-900 px-1.5 py-1 font-mono text-[10px] text-zinc-400"
                          title={entry.sourceJar}
                        >
                          {entry.namespace}
                        </span>
                      </td>
                      <td className="px-3 py-1.5">
                        <span className="rounded-full border border-cyan-500/20 bg-cyan-500/5 px-2 py-1 text-[10px] text-cyan-300">
                          {entry.type[0].toUpperCase() + entry.type.slice(1)}
                        </span>
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            disabled={!entry.texturePath}
                            title={
                              entry.texturePath
                                ? "Export Texture PNG"
                                : "No texture asset found"
                            }
                            aria-label={
                              entry.texturePath
                                ? `Export ${entry.displayName} texture`
                                : "No texture asset found"
                            }
                            onClick={() =>
                              entry.texturePath &&
                              void exportAsset(
                                entry,
                                entry.texturePath,
                                `${entry.id.replace(":", "_")}.png`,
                              )
                            }
                            className="rounded p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-25"
                          >
                            <Download size={13} />
                          </button>
                          <button
                            type="button"
                            disabled={!entry.modelPath}
                            title={
                              entry.modelPath
                                ? "Export Model JSON"
                                : "No model asset found"
                            }
                            aria-label={
                              entry.modelPath
                                ? `Export ${entry.displayName} model`
                                : "No model asset found"
                            }
                            onClick={() =>
                              entry.modelPath &&
                              void exportAsset(
                                entry,
                                entry.modelPath,
                                `${entry.id.replace(":", "_")}.json`,
                              )
                            }
                            className="rounded p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-25"
                          >
                            <FileDown size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {!loading && displayCount > 0 && (
          <div className="flex items-center justify-between border-t border-zinc-800 px-4 py-2 text-[10px] text-zinc-500">
            <span>
              Showing {shownStart}–{shownEnd} of {displayCount.toLocaleString()}{" "}
              {duplicateMode ? "groups" : "entries"}
            </span>
            <span>
              {duplicateMode
                ? "Names and ID paths compared"
                : result.fromCache
                  ? "Cached registry index"
                  : "Registry index ready"}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

export default RegistryScreen;
