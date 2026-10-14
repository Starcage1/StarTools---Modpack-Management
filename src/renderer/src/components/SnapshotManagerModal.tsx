import { useEffect, useState } from "react";
import { Camera, RotateCcw, Trash2, X } from "lucide-react";
import type { SnapshotEntry } from "../../../shared/types";
import BetaBadge from "./BetaBadge";

interface Props {
  instancePath: string;
  onClose: () => void;
  onRestored: () => void;
}

function SnapshotManagerModal({
  instancePath,
  onClose,
  onRestored,
}: Props): React.JSX.Element {
  const [snapshots, setSnapshots] = useState<SnapshotEntry[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reload = (): void => {
    void window.api
      .listSnapshots(instancePath)
      .then(setSnapshots)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      );
  };
  useEffect(reload, [instancePath]);
  const create = async (): Promise<void> => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await window.api.createSnapshot(instancePath, name.trim());
      setName("");
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const rollback = async (entry: SnapshotEntry): Promise<void> => {
    if (
      !window.confirm(
        `Restore “${entry.name}”? This will change matching mod enabled states and overwrite files present in the snapshot's config archive.`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.api.rollbackSnapshot(instancePath, entry.id);
      onRestored();
      setError(
        `Restored ${result.movedMods} mod state(s) and ${result.restoredConfigFiles} config file(s).`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (entry: SnapshotEntry): Promise<void> => {
    if (
      !window.confirm(
        `Delete snapshot “${entry.name}”? This removes only its saved archive and metadata.`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await window.api.deleteSnapshot(instancePath, entry.id);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-label="Snapshots"
        className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-700">
          <div className="flex items-center gap-2 font-semibold">
            <Camera size={17} />
            Snapshots
            <BetaBadge />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close snapshots"
            className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X size={17} />
          </button>
        </header>
        <div className="space-y-4 overflow-y-auto p-5">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="Snapshot name"
              className="min-w-0 flex-1 rounded-md border border-gray-300 bg-transparent px-3 py-2 text-sm dark:border-gray-700"
            />
            <button
              disabled={busy || !name.trim()}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Save Snapshot
            </button>
          </form>
          {error && (
            <p
              role="status"
              className="rounded-md bg-gray-100 px-3 py-2 text-sm text-gray-700 dark:bg-gray-800 dark:text-gray-200"
            >
              {error}
            </p>
          )}
          {snapshots.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">
              No snapshots yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {snapshots.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 p-3 dark:border-gray-700"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{entry.name}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {new Date(entry.timestamp).toLocaleString()} ·{" "}
                      {entry.modState.length} mod states
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void rollback(entry)}
                      className="inline-flex items-center gap-1 rounded border border-gray-300 px-2.5 py-1.5 text-xs hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
                    >
                      <RotateCcw size={13} />
                      Rollback
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void remove(entry)}
                      title="Delete snapshot"
                      className="rounded border border-gray-300 p-1.5 text-gray-500 hover:text-red-500 disabled:opacity-50 dark:border-gray-700"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

export default SnapshotManagerModal;
