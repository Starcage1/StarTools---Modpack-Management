import { useState } from "react";
import { Plus, RotateCcw, X } from "lucide-react";
import type { CatOverrideEntry } from "../../../shared/types";
import {
  isCustomCategory,
  mergeCategories,
} from "../../../shared/categoryMerge";

interface CategoryEditorProps {
  modName: string;
  modId: string;
  /** Modrinth categories (empty when never fetched or unmatched). */
  scanned: string[];
  entry: CatOverrideEntry;
  busy: boolean;
  onClose: () => void;
  onMutate: (modId: string, entry: CatOverrideEntry) => Promise<void>;
}

function CategoryEditor({
  modName,
  modId,
  scanned,
  entry,
  busy,
  onClose,
  onMutate,
}: CategoryEditorProps): React.JSX.Element {
  const [draft, setDraft] = useState("");

  const effective = mergeCategories(scanned, entry);
  const removed = entry.removed;

  const mutate = (next: CatOverrideEntry): void => {
    void onMutate(modId, next);
  };

  const addDraft = (): void => {
    const name = draft.trim();
    if (!name) return;
    const known = new Set(effective.map((c) => c.toLowerCase()));
    if (known.has(name.toLowerCase())) {
      setDraft("");
      return;
    }
    mutate({ added: [...entry.added, name], removed: entry.removed });
    setDraft("");
  };

  const removeCategory = (name: string): void => {
    if (isCustomCategory(name, scanned, entry)) {
      mutate({
        added: entry.added.filter(
          (a) => a.toLowerCase() !== name.toLowerCase(),
        ),
        removed: entry.removed,
      });
    } else {
      if (entry.removed.some((r) => r.toLowerCase() === name.toLowerCase()))
        return;
      mutate({ added: entry.added, removed: [...entry.removed, name] });
    }
  };

  const restoreCategory = (name: string): void => {
    mutate({
      added: entry.added,
      removed: entry.removed.filter((r) => r !== name),
    });
  };

  const rowClass =
    "flex items-center gap-2 rounded border border-gray-200 px-2 py-1.5 dark:border-gray-700";

  return (
    <div className="fixed bottom-0 right-0 top-0 z-30 flex w-80 flex-col border-l border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
      <div className="flex items-start justify-between gap-2 border-b border-gray-200 px-3 py-2.5 dark:border-gray-700">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-gray-400">
            Categories
          </div>
          <div
            className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100"
            title={modId}
          >
            {modName}
          </div>
          <div className="font-mono text-[11px] text-gray-400">{modId}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close category editor"
          className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {scanned.length === 0 && effective.length === 0 && (
          <div className="mb-3 rounded-md border border-dashed border-gray-300 px-2 py-2 text-xs text-gray-400 dark:border-gray-600">
            No Modrinth categories — fetch online data or add custom categories
            below.
          </div>
        )}

        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">
          Categories ({effective.length})
        </div>
        <div className="mb-3 space-y-1">
          {effective.length === 0 && (
            <div className="text-xs text-gray-400">No categories.</div>
          )}
          {effective.map((name) => {
            const custom = isCustomCategory(name, scanned, entry);
            return (
              <div
                key={name}
                className={rowClass}
                title={custom ? "Added by you" : "From Modrinth"}
              >
                <span className="min-w-0 flex-1 truncate text-xs text-gray-700 dark:text-gray-300">
                  {name}
                </span>
                {custom ? (
                  <span className="shrink-0 rounded bg-green-100 px-1 py-px font-mono text-[10px] text-green-700 dark:bg-green-950 dark:text-green-400">
                    [Custom]
                  </span>
                ) : (
                  <span className="shrink-0 rounded bg-gray-100 px-1 py-px font-mono text-[10px] text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                    [Modrinth]
                  </span>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => removeCategory(name)}
                  aria-label={`Remove ${name}`}
                  className="shrink-0 rounded px-1 text-gray-400 hover:bg-gray-100 hover:text-red-600 disabled:opacity-60 dark:hover:bg-gray-700 dark:hover:text-red-400"
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
        </div>

        {removed.length > 0 && (
          <>
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">
              Removed ({removed.length})
            </div>
            <div className="mb-3 space-y-1">
              {removed.map((name) => (
                <div key={name} className={`${rowClass} opacity-60`}>
                  <span className="min-w-0 flex-1 truncate text-xs text-red-400 line-through dark:text-red-400">
                    {name}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => restoreCategory(name)}
                    className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-100 hover:text-green-600 disabled:opacity-60 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-green-400"
                  >
                    <RotateCcw size={11} /> Restore
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">
          Add custom
        </div>
        <div className="flex gap-1.5">
          <input
            type="text"
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addDraft();
            }}
            placeholder="e.g. favorites"
            className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-gray-400 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-gray-500"
          />
          <button
            type="button"
            disabled={busy || draft.trim().length === 0}
            onClick={addDraft}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <Plus size={14} /> Add
          </button>
        </div>
      </div>
    </div>
  );
}

export default CategoryEditor;
