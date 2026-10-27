import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Archive,
  ArrowUpDown,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Pencil,
  Tag,
  Trash2,
} from "lucide-react";
import type {
  CatOverrides,
  OnlineModData,
  ParsedMod,
  SideOverride,
} from "../../../shared/types";
import { mergeCategories } from "../../../shared/categoryMerge";
import ModIcon from "./ModIcon";

export type SortKey = "name" | "side" | null;
export type SortDir = "asc" | "desc";

interface ModTableProps {
  mods: ParsedMod[];
  /** Modrinth enrichment keyed by absolute file path (may be empty = offline). */
  onlineData: Record<string, OnlineModData>;
  /** Category overrides keyed by lowercase mod id. */
  catOverrides: CatOverrides;
  page: number;
  pageSize: number;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: "name" | "side") => void;
  onSideOverride: (modId: string, side: SideOverride) => void;
  onToggleEnabled: (mod: ParsedMod) => void;
  onTrash: (mod: ParsedMod) => void;
  onEditDeps: (mod: ParsedMod) => void;
  onOpenArchive: (mod: ParsedMod) => void;
  onOpenConfig: (mod: ParsedMod) => void;
  onOpenConfigInVSCode: (mod: ParsedMod) => void;
  onEditCats: (mod: ParsedMod) => void;
  forgeFamilyInstance: boolean;
  sinytraConnectorActive: boolean;
  emptyHint?: string;
}

const SIDE_OPTIONS: SideOverride[] = ["Client", "Server", "Both"];

function SortButton({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 font-medium hover:text-gray-900 dark:hover:text-gray-100"
    >
      {label}
      <ArrowUpDown
        size={12}
        className={
          active ? "text-gray-900 dark:text-gray-100" : "text-gray-400"
        }
      />
      {active && <span className="text-xs">{dir === "asc" ? "▲" : "▼"}</span>}
    </button>
  );
}

function ModTable({
  mods,
  onlineData,
  catOverrides,
  page,
  pageSize,
  sortKey,
  sortDir,
  onSort,
  onSideOverride,
  onToggleEnabled,
  onTrash,
  onEditDeps,
  onOpenArchive,
  onOpenConfig,
  onOpenConfigInVSCode,
  onEditCats,
  forgeFamilyInstance,
  sinytraConnectorActive,
  emptyHint,
}: ModTableProps): React.JSX.Element {
  const [menu, setMenu] = useState<{
    modId: string;
    x: number;
    y: number;
  } | null>(null);

  // Close the context menu on Escape.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menu]);

  if (mods.length === 0) {
    return (
      <div className="rounded-md border border-gray-200 px-4 py-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
        {emptyHint ?? (
          <>
            No mods to display. Select an instance folder to scan its{" "}
            <code>\mods</code> directory.
          </>
        )}
      </div>
    );
  }

  const menuMod = menu ? mods.find((m) => m.modId === menu.modId) : undefined;

  const table = (
    <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <table
        className="mod-table w-full table-fixed border-collapse text-left"
        style={{ fontSize: "var(--app-font-size, 16px)" }}
      >
        <colgroup>
          <col style={{ width: "5%" }} />
          <col style={{ width: "18%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "16%" }} />
          <col style={{ width: "6%" }} />
          <col style={{ width: "22%" }} />
          <col style={{ width: "6%" }} />
          <col style={{ width: "7%" }} />
        </colgroup>
        <thead>
          <tr className="divide-x divide-gray-200 border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:divide-gray-700/60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
            <th className="px-2 py-2 font-medium">S.No.</th>
            <th className="px-3 py-2">
              <SortButton
                label="Name"
                active={sortKey === "name"}
                dir={sortDir}
                onClick={() => onSort("name")}
              />
            </th>
            <th className="px-2 py-2 font-medium">Version</th>
            <th className="px-2 py-2 font-medium">Author</th>
            <th className="px-2 py-2 font-medium">Dependencies</th>
            <th className="px-2 py-2">
              <SortButton
                label="Side"
                active={sortKey === "side"}
                dir={sortDir}
                onClick={() => onSort("side")}
              />
            </th>
            <th className="px-2 py-2 font-medium">Description</th>
            <th className="px-2 py-2 font-medium">Links</th>
            <th className="px-2 py-2 font-medium">Categories</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {mods.map((mod, i) => {
            const online = onlineData[mod.filePath];
            const iconSrc = mod.iconDataUri ?? (online?.iconUrl || null);
            const categories = mergeCategories(
              online?.categories ?? [],
              catOverrides[mod.modId.toLowerCase()],
            );
            return (
              <tr
                key={`${mod.modId}-${mod.fileName}`}
                onClick={() => onEditDeps(mod)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ modId: mod.modId, x: e.clientX, y: e.clientY });
                }}
                title={
                  mod.enabled
                    ? "Click to edit dependencies"
                    : "Disabled — click to edit dependencies"
                }
                className={`h-12 divide-x divide-gray-200/60 align-middle transition-colors duration-100 hover:bg-gray-100/50 dark:divide-gray-800/60 dark:hover:bg-white/[0.025] ${
                  mod.enabled ? "" : "opacity-60"
                }`}
              >
                <td className="whitespace-nowrap px-2 py-1 font-mono text-xs tabular-nums text-gray-500 dark:text-gray-400">
                  {(page - 1) * pageSize + i + 1}
                </td>
                <td className="min-w-0 px-2 py-1 align-middle">
                  <div className="flex min-w-0 items-center gap-1.5">
                    {/* Keyed per mod so a previous image error never leaks across rows. */}
                    <ModIcon
                      key={mod.modId}
                      iconUrl={iconSrc}
                      modName={mod.name}
                    />
                    <span
                      className="min-w-0 truncate font-sans font-medium text-gray-900 dark:text-gray-100"
                      title={mod.fileName}
                    >
                      {mod.name}
                    </span>
                    {mod.isFabricMod && forgeFamilyInstance && sinytraConnectorActive && (
                      <span
                        title="Fabric mod supported through Sinytra Connector"
                        className="mod-table-badge inline-flex shrink-0 items-center rounded-full border border-cyan-500/40 bg-cyan-950/80 px-1.5 py-0.5 font-mono font-semibold uppercase tracking-wider text-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.15)]"
                      >
                        FABRIC
                      </span>
                    )}
                    {mod.incompatibleFabric && (
                      <span
                        title="Fabric Mod (Incompatible on Forge/NeoForge without Sinytra Connector)"
                        className="mod-table-badge inline-flex shrink-0 items-center gap-1 rounded border border-amber-700/40 bg-amber-950/30 px-1.5 py-0.5 font-sans text-amber-300"
                      >
                        <AlertTriangle size={10} /> Incompatible
                      </span>
                    )}
                    {!mod.enabled && (
                      <span
                        title="Disabled (in \disabledmods\)"
                        className="mod-table-badge inline-flex shrink-0 items-center gap-0.5 rounded border border-gray-300 px-1 py-px font-medium uppercase tracking-wide text-gray-500 dark:border-gray-600 dark:text-gray-400"
                      >
                        <EyeOff size={10} /> Off
                      </span>
                    )}
                  </div>
                  <div
                    className="mt-0.5 truncate font-mono text-xs text-gray-400"
                    title={mod.modId}
                  >
                    {mod.modId}
                  </div>
                </td>
                <td
                  className="truncate whitespace-nowrap px-2 py-1 font-mono text-xs text-gray-600 dark:text-gray-300"
                  title={mod.version}
                >
                  {mod.version}
                </td>
                <td
                  className="mod-table-scaled truncate px-2 py-1 font-sans text-sm text-gray-600 dark:text-gray-300"
                  title={mod.authors || undefined}
                >
                  {mod.authors || <span className="text-gray-400">—</span>}
                </td>
                <td className="overflow-hidden px-2 py-1 align-middle">
                  {mod.dependencies.length === 0 ? (
                    <span className="text-zinc-600">·</span>
                  ) : (
                    <ul className="flex max-h-10 flex-wrap items-center gap-1 overflow-hidden">
                      {mod.dependencies.slice(0, 2).map((dep) => {
                        if (dep.removed) {
                          return (
                            <li
                              key={dep.modId}
                              title={`${dep.modId} — removed by user (restore in dependency editor)`}
                              className="mod-table-badge max-w-full truncate rounded border border-red-500/20 bg-red-500/10 px-1.5 py-0.5 font-sans text-red-400 line-through"
                            >
                              {dep.modId}
                            </li>
                          );
                        }
                        const missingMandatory =
                          dep.mandatory && !dep.satisfied;
                        const missingOptional =
                          !dep.mandatory && !dep.satisfied;
                        const pillStyle = missingMandatory
                          ? "border-red-500/20 bg-red-500/10 text-red-400"
                          : missingOptional
                            ? "border-amber-500/20 bg-amber-500/10 text-amber-400"
                            : "border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300";
                        return (
                          <li
                            key={dep.modId}
                            title={`${dep.modId}${dep.versionRange ? ` ${dep.versionRange}` : ""}${dep.mandatory ? "" : " (optional)"}${missingMandatory ? " — missing required dependency" : missingOptional ? " — missing optional dependency" : ""}`}
                            className={`mod-table-badge inline-flex max-w-full min-w-0 items-center gap-1 truncate rounded border px-1.5 py-0.5 font-sans ${pillStyle}`}
                          >
                            {(missingMandatory || missingOptional) && (
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                            )}
                            <span className="min-w-0 truncate">
                              {dep.modId}
                            </span>
                          </li>
                        );
                      })}
                      {mod.dependencies.length > 2 && (
                        <li
                          title={mod.dependencies
                            .slice(2)
                            .map(
                              (dep) =>
                                `${dep.modId}${dep.mandatory ? "" : " (optional)"}${!dep.satisfied ? " — missing" : ""}`,
                            )
                            .join("\n")}
                          className="mod-table-badge shrink-0 rounded border border-gray-200 px-1.5 py-0.5 font-sans text-gray-500 dark:border-gray-700 dark:text-gray-400"
                        >
                          +{mod.dependencies.length - 2} more
                        </li>
                      )}
                    </ul>
                  )}
                </td>
                <td className="px-2 py-1 align-middle">
                  <span
                    className={`mod-table-badge inline-block whitespace-nowrap rounded border px-1.5 py-0.5 ${mod.side === "Client" ? "border-teal-500/20 bg-teal-500/10 text-teal-700 dark:text-teal-300" : mod.side === "Server" ? "border-indigo-500/20 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300" : "border-gray-200 bg-gray-100 text-gray-600 dark:border-gray-700/50 dark:bg-gray-800 dark:text-gray-400"}`}
                  >
                    {mod.side}
                  </span>
                </td>
                <td
                  className="mod-table-scaled px-2 py-1 align-middle font-sans text-sm text-gray-600 dark:text-gray-300"
                  title={mod.description}
                >
                  <div className="line-clamp-2 whitespace-normal break-words leading-4">
                    {mod.description || (
                      <span className="text-gray-400">—</span>
                    )}
                  </div>
                </td>
                <td className="max-w-[120px] overflow-hidden px-2 py-1 align-middle">
                  <div className="flex flex-col items-start gap-1">
                    {online?.projectId && (
                      <a
                        href={`https://modrinth.com/mod/${online.slug || online.projectId}`}
                        target="_blank"
                        rel="noreferrer"
                        title={online.title || online.slug || online.projectId}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-xs text-green-700 hover:underline dark:text-green-400"
                      >
                        <ExternalLink size={12} />
                        Modrinth
                      </a>
                    )}
                    {!online?.projectId && (
                      <span className="text-zinc-600">·</span>
                    )}
                  </div>
                </td>
                <td
                  className="mod-table-scaled max-w-[120px] cursor-pointer truncate px-2 py-1 align-middle font-sans text-xs text-gray-600 hover:underline dark:text-gray-300"
                  title={
                    categories.length > 0
                      ? `${categories.join(", ")} — click to edit`
                      : "Click to edit categories"
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditCats(mod);
                  }}
                >
                  {categories.length > 0 ? (
                    categories.join(", ")
                  ) : (
                    <span className="text-zinc-600">·</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  if (!menu) return table;

  // Clamp so the menu never overflows the viewport.
  const menuX = Math.max(4, Math.min(menu.x, window.innerWidth - 220));
  const menuY = Math.max(4, Math.min(menu.y, window.innerHeight - 430));
  const menuItem =
    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700";

  return (
    <>
      {table}
      {/* Click-catcher to dismiss the menu. */}
      <button
        type="button"
        aria-label="Close menu"
        className="fixed inset-0 z-40 cursor-default bg-transparent"
        onClick={() => setMenu(null)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu(null);
        }}
      />
      <div
        className="fixed z-50 max-h-[calc(100vh-8px)] w-56 overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
        data-app-scale="true"
        style={{ left: menuX, top: menuY }}
      >
        <div
          className="truncate px-3 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400"
          title={menuMod?.fileName}
        >
          {menuMod?.name ?? menu.modId}
        </div>
        <div className="px-3 pb-0.5 pt-1 text-[11px] uppercase tracking-wide text-gray-400">
          Override side
        </div>
        {SIDE_OPTIONS.map((side) => (
          <button
            key={side}
            type="button"
            onClick={() => {
              onSideOverride(menu.modId, side);
              setMenu(null);
            }}
            className={menuItem}
          >
            <span className="w-4 text-xs text-gray-400">
              {menuMod?.side === side ? "✓" : ""}
            </span>
            {side}
          </button>
        ))}
        <div className="my-1 border-t border-gray-200 dark:border-gray-700" />
        <button
          type="button"
          onClick={() => {
            if (menuMod) onOpenConfig(menuMod);
            setMenu(null);
          }}
          className={menuItem}
        >
          <FileText size={14} />
          Open Config
        </button>
        <button
          type="button"
          onClick={() => {
            if (menuMod) onOpenConfigInVSCode(menuMod);
            setMenu(null);
          }}
          className={menuItem}
        >
          <FileText size={14} />
          Open Config in VS Code
        </button>
        <button
          type="button"
          onClick={() => {
            if (menuMod) onToggleEnabled(menuMod);
            setMenu(null);
          }}
          className={menuItem}
        >
          {menuMod?.enabled ? <EyeOff size={14} /> : <Eye size={14} />}
          {menuMod?.enabled ? "Disable Mod" : "Enable Mod"}
        </button>
        <button
          type="button"
          onClick={() => {
            if (menuMod) onEditDeps(menuMod);
            setMenu(null);
          }}
          className={menuItem}
        >
          <Pencil size={14} />
          Edit Dependencies
        </button>
        <button
          type="button"
          onClick={() => {
            if (menuMod) onEditCats(menuMod);
            setMenu(null);
          }}
          className={menuItem}
        >
          <Tag size={14} />
          Edit Categories
        </button>
        <button
          type="button"
          onClick={() => {
            if (menuMod) onOpenArchive(menuMod);
            setMenu(null);
          }}
          className={menuItem}
        >
          <Archive size={14} />
          Open Archive
        </button>
        <div className="my-1 border-t border-gray-200 dark:border-gray-700" />
        <button
          type="button"
          onClick={() => {
            if (menuMod) onTrash(menuMod);
            setMenu(null);
          }}
          className={`${menuItem} text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950`}
        >
          <Trash2 size={14} />
          Move to Trash
        </button>
      </div>
    </>
  );
}

export default ModTable;
