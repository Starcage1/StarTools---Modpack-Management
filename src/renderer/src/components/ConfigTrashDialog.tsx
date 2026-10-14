import type { ConfigMappingMatch, ParsedMod } from "../../../shared/types";

interface ConfigTrashDialogProps {
  mod: ParsedMod;
  matches: ConfigMappingMatch[];
  selected: Set<string>;
  onToggle: (filePath: string) => void;
  onModOnly: () => void;
  onModAndConfigs: () => void;
  onCancel: () => void;
  busy: boolean;
}

function ConfigTrashDialog({
  mod,
  matches,
  selected,
  onToggle,
  onModOnly,
  onModAndConfigs,
  onCancel,
  busy,
}: ConfigTrashDialogProps): React.JSX.Element {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="config-trash-title"
        className="w-full max-w-xl rounded-lg border border-gray-200 bg-white p-4 shadow-xl dark:border-gray-700 dark:bg-gray-900"
        onClick={(event) => event.stopPropagation()}
      >
        <h2
          id="config-trash-title"
          className="text-base font-semibold text-gray-900 dark:text-gray-100"
        >
          Delete associated configs for <code>{mod.modId}</code>?
        </h2>
        <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
          Automatic detection matches names heuristically and can occasionally
          flag shared or similarly named files. Please review before proceeding.
        </p>
        <div className="mt-3 max-h-64 overflow-auto rounded border border-gray-200 dark:border-gray-700">
          {matches.map((match) => (
            <label
              key={match.filePath}
              className="flex cursor-pointer items-start gap-2 border-b border-gray-100 px-3 py-2 last:border-b-0 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800"
            >
              <input
                type="checkbox"
                checked={selected.has(match.filePath)}
                onChange={() => onToggle(match.filePath)}
                className="mt-0.5 accent-sky-600"
              />
              <span className="min-w-0 flex-1 break-all font-mono text-xs text-gray-700 dark:text-gray-200">
                {match.filePath}
                {match.type === "directory" ? "/" : ""}
              </span>
              <span className="shrink-0 text-[10px] uppercase text-gray-400">
                {match.source}
              </span>
            </label>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 dark:border-gray-600 dark:text-gray-200"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onModOnly}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 dark:border-gray-600 dark:text-gray-200"
          >
            Delete Mod Only
          </button>
          <button
            type="button"
            disabled={busy || selected.size === 0}
            onClick={onModAndConfigs}
            className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Moving to Trash…" : "Delete Mod & Selected Configs"}
          </button>
        </div>
      </section>
    </div>
  );
}

export default ConfigTrashDialog;
