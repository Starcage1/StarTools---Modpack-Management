import { CloudDownload, FolderOpen, Loader2, RefreshCw } from "lucide-react";
import type { OnlineFetchProgress } from "../../../shared/types";

interface FolderSelectorProps {
  instancePath: string | null;
  loading: boolean;
  fetchingOnline: boolean;
  fetchProgress: OnlineFetchProgress | null;
  onSelect: () => void;
  onRefresh: () => void;
  onFetchOnline: () => void;
}

function FolderSelector({
  instancePath,
  loading,
  fetchingOnline,
  fetchProgress,
  onSelect,
  onRefresh,
  onFetchOnline,
}: FolderSelectorProps): React.JSX.Element {
  const busy = loading || fetchingOnline;
  const buttonClass =
    "inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700";
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onSelect}
          disabled={busy}
          className={buttonClass}
        >
          {loading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <FolderOpen size={16} />
          )}
          {loading ? "Scanning…" : "Select Instance Folder"}
        </button>
        <button
          type="button"
          onClick={onRefresh}
          disabled={busy || !instancePath}
          title="Re-scan the current instance folder"
          aria-label="Refresh mod list"
          className={buttonClass}
        >
          <RefreshCw
            size={16}
            className={loading ? "animate-spin" : undefined}
          />
          Refresh
        </button>
        <button
          type="button"
          onClick={onFetchOnline}
          disabled={busy || !instancePath}
          title="Look up mod files on Modrinth using SHA-1 file hashes"
          aria-label="Fetch Modrinth data"
          className={buttonClass}
        >
          {fetchingOnline ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <CloudDownload size={16} />
          )}
          {fetchingOnline
            ? fetchProgress?.stage === "hashing"
              ? `Hashing (${fetchProgress.current}/${fetchProgress.total})…`
              : fetchProgress?.stage === "lookup"
                ? "Modrinth lookup…"
                : "Fetching…"
            : "Fetch Modrinth Data"}
        </button>
      </div>
    </div>
  );
}

export default FolderSelector;
