import { Loader2, X } from "lucide-react";
import type { InstanceInfo } from "../../../shared/types";

interface InstanceInfoModalProps {
  info: InstanceInfo | null;
  loading: boolean;
  appVersion: string;
  onClose: () => void;
}

function InstanceInfoModal({
  info,
  loading,
  appVersion,
  onClose,
}: InstanceInfoModalProps): React.JSX.Element {
  const rows: { label: string; value: string }[] = info
    ? [
        { label: "Instance", value: info.instanceName },
        { label: "Minecraft", value: info.minecraftVersion },
        { label: "Loader", value: info.modLoader },
        { label: "Loader version", value: info.loaderVersion },
        { label: "Enabled mods", value: String(info.enabledCount) },
        { label: "Disabled mods", value: String(info.disabledCount) },
        { label: "Source", value: info.sourceFile || "none found" },
        {
          label: "StarTools - Modpack Manager",
          value: `v${appVersion || "0.5.0"}`,
        },
      ]
    : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Modpack info"
        className="w-80 rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2.5 dark:border-gray-700">
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Modpack Info
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modpack info"
            className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-4 py-3">
          {loading && (
            <div className="flex items-center gap-2 py-4 text-sm text-gray-500 dark:text-gray-400">
              <Loader2 size={16} className="animate-spin" /> Reading instance…
            </div>
          )}
          {!loading && !info && (
            <div className="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
              No instance information found.
            </div>
          )}
          {!loading && info && (
            <dl className="divide-y divide-gray-100 text-sm dark:divide-gray-800">
              {rows.map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between gap-4 py-1.5"
                >
                  <dt className="shrink-0 text-xs uppercase tracking-wide text-gray-400">
                    {row.label}
                  </dt>
                  <dd
                    className="truncate font-medium text-gray-800 dark:text-gray-200"
                    title={row.value}
                  >
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </div>
  );
}

export default InstanceInfoModal;
