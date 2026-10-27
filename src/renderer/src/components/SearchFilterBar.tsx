import { History, Search } from "lucide-react";

export type SideFilter = "All" | "Client" | "Server" | "Both";
export type StatusFilter = "All" | "Enabled" | "Disabled";
export type WarningFilter =
  "All" | "MissingMandatory" | "OptionalOnly" | "IncompatibleFabric";

interface SearchFilterBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  sideFilter: SideFilter;
  onSideFilterChange: (side: SideFilter) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (status: StatusFilter) => void;
  warningFilter: WarningFilter;
  onWarningFilterChange: (warning: WarningFilter) => void;
  incompatibleFabricCount: number;
  restorableCount: number;
  restoring: boolean;
  onRestore: () => void;
}

const SIDE_OPTIONS: SideFilter[] = ["All", "Client", "Server", "Both"];
const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "All", label: "Status: All" },
  { value: "Enabled", label: "Enabled Only" },
  { value: "Disabled", label: "Disabled Only" },
];
const WARNING_OPTIONS: { value: WarningFilter; label: string }[] = [
  { value: "All", label: "Warnings: All" },
  { value: "MissingMandatory", label: "Missing Mandatory Only" },
  { value: "OptionalOnly", label: "Optional Dependencies Only" },
  { value: "IncompatibleFabric", label: "Incompatible Fabric Only" },
];

function SearchFilterBar({
  query,
  onQueryChange,
  sideFilter,
  onSideFilterChange,
  statusFilter,
  onStatusFilterChange,
  warningFilter,
  onWarningFilterChange,
  incompatibleFabricCount,
  restorableCount,
  restoring,
  onRestore,
}: SearchFilterBarProps): React.JSX.Element {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <div className="relative w-72">
        <Search
          size={14}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search name or description…"
          className="w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm outline-none focus:border-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500 dark:focus:border-gray-500"
        />
      </div>
      <select
        value={sideFilter}
        onChange={(e) => onSideFilterChange(e.target.value as SideFilter)}
        aria-label="Filter by side"
        className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 shadow-sm outline-none hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
      >
        {SIDE_OPTIONS.map((side) => (
          <option key={side} value={side}>
            {side === "All" ? "Side: All" : side}
          </option>
        ))}
      </select>
      <select
        value={statusFilter}
        onChange={(e) => onStatusFilterChange(e.target.value as StatusFilter)}
        aria-label="Filter by status"
        className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 shadow-sm outline-none hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
      >
        {STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <select
        value={warningFilter}
        onChange={(e) => onWarningFilterChange(e.target.value as WarningFilter)}
        aria-label="Filter by warnings"
        className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 shadow-sm outline-none hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
      >
        {WARNING_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={incompatibleFabricCount === 0}
        aria-pressed={warningFilter === "IncompatibleFabric"}
        onClick={() =>
          onWarningFilterChange(
            warningFilter === "IncompatibleFabric"
              ? "All"
              : "IncompatibleFabric",
          )
        }
        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-sm shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${warningFilter === "IncompatibleFabric" ? "border-amber-500/50 bg-amber-950/40 text-amber-200" : "border-amber-800/40 text-amber-300 hover:bg-amber-950/30"}`}
        title="Show Fabric mods that need Sinytra Connector on Forge/NeoForge"
      >
        Incompatible Fabric ({incompatibleFabricCount})
      </button>
      <button
        type="button"
        onClick={onRestore}
        disabled={restoring || restorableCount === 0}
        title={
          restorableCount === 0
            ? "No trashed mods available to restore"
            : `Restore ${restorableCount} trashed item${restorableCount === 1 ? "" : "s"}`
        }
        className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
      >
        <History size={14} />
        Restore Items{restorableCount > 0 ? ` (${restorableCount})` : ""}
      </button>
    </div>
  );
}

export default SearchFilterBar;
