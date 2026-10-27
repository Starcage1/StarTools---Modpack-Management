import { useMemo, useState } from "react";
import { Clipboard, Download, LoaderCircle, X } from "lucide-react";
import type {
  ParsedMod,
  RegistryEntry,
  RegistryScanResult,
} from "../../../shared/types";

type Format = "md" | "csv" | "json";
type Options = { modlist: boolean; duplicates: boolean; warnings: boolean };

interface ExportModalProps {
  instancePath: string;
  mods: ParsedMod[];
  loader: string;
  minecraftVersion: string;
  crossModOnly: boolean;
  ignoreVanillaBackports: boolean;
  onClose: () => void;
  onNotify: (message: string) => void;
  onError: (message: string) => void;
}

function registryEntries(scan: RegistryScanResult): RegistryEntry[] {
  return [
    ...scan.items,
    ...scan.blocks,
    ...scan.biomes,
    ...scan.dimensions,
    ...scan.mobs,
  ];
}

function duplicateRows(
  entries: RegistryEntry[],
  crossModOnly: boolean,
  ignoreVanillaBackports: boolean,
): Array<{ collision: string; types: string[]; entries: RegistryEntry[] }> {
  const groups = new Map<
    string,
    { collision: string; types: Set<string>; entries: RegistryEntry[] }
  >();
  const buckets = new Map<
    string,
    { type: string; key: string; entries: RegistryEntry[] }
  >();
  for (const entry of entries) {
    const nameKey = entry.displayName.trim().toLocaleLowerCase();
    const idKey = entry.id.split(":").slice(1).join(":").toLocaleLowerCase();
    for (const [type, key] of [
      ["Same name", nameKey],
      ["Same ID", idKey],
    ]) {
      const bucket = buckets.get(`${type}:${key}`) ?? {
        type,
        key,
        entries: [],
      };
      bucket.entries.push(entry);
      buckets.set(`${type}:${key}`, bucket);
    }
  }
  for (const bucket of buckets.values()) {
    const uniqueEntries = [
      ...new Map(bucket.entries.map((entry) => [entry.id, entry])).values(),
    ];
    const namespaces = new Set(
      uniqueEntries.map((entry) => entry.namespace.toLocaleLowerCase()),
    );
    if (uniqueEntries.length < 2 || (crossModOnly && namespaces.size < 2))
      continue;
    const knownBackports = new Set([
      "vanillabackport",
      "futuremc",
      "backported_mobs",
      "minecraft_backport",
    ]);
    if (
      ignoreVanillaBackports &&
      namespaces.has("minecraft") &&
      [...namespaces].every(
        (value) => value === "minecraft" || knownBackports.has(value),
      )
    )
      continue;
    const ids = uniqueEntries.map((entry) => entry.id).sort();
    const groupKey = ids.join("\0");
    const group = groups.get(groupKey) ?? {
      collision: bucket.key,
      types: new Set<string>(),
      entries: uniqueEntries,
    };
    group.types.add(bucket.type);
    if (bucket.type === "Same name")
      group.collision = uniqueEntries[0]?.displayName ?? bucket.key;
    groups.set(groupKey, group);
  }
  return [...groups.values()].map((group) => ({
    collision: group.collision,
    types: [...group.types],
    entries: group.entries,
  }));
}

function csv(value: unknown): string {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export default function ExportModal({
  instancePath,
  mods,
  loader,
  minecraftVersion,
  crossModOnly,
  ignoreVanillaBackports,
  onClose,
  onNotify,
  onError,
}: ExportModalProps): React.JSX.Element {
  const [options, setOptions] = useState<Options>({
    modlist: true,
    duplicates: true,
    warnings: true,
  });
  const [format, setFormat] = useState<Format>("md");
  const [busy, setBusy] = useState(false);
  const instanceName =
    instancePath.split(/[\\/]/).filter(Boolean).at(-1) ?? instancePath;
  const warnings = useMemo(
    () => ({
      incompatible: mods.filter((mod) => mod.enabled && mod.incompatibleFabric),
      missing: mods.flatMap((mod) =>
        mod.enabled
          ? mod.dependencies
              .filter(
                (dependency) => dependency.mandatory && !dependency.satisfied,
              )
              .map((dependency) => ({
                mod: mod.name,
                dependency: dependency.modId,
              }))
          : [],
      ),
    }),
    [mods],
  );

  const toggle = (key: keyof Options): void =>
    setOptions((current) => ({ ...current, [key]: !current[key] }));

  const build = async (): Promise<string> => {
    let collisions: ReturnType<typeof duplicateRows> = [];
    let registry: RegistryScanResult | null = null;
    const metadata = await window.api.getInstanceInfo(instancePath);
    if (options.duplicates) {
      registry = await window.api.scanRegistries(instancePath);
      collisions = duplicateRows(
        registryEntries(registry),
        crossModOnly,
        ignoreVanillaBackports,
      );
    }
    const instanceMetadata = {
      name: metadata.instanceName || instanceName,
      path: instancePath,
      loader: metadata.modLoader || loader,
      loaderVersion: metadata.loaderVersion,
      minecraftVersion:
        registry?.minecraftVersion ??
        metadata.minecraftVersion ??
        minecraftVersion,
      totalMods: metadata.enabledCount + metadata.disabledCount,
    };
    const payload = {
      instance: options.modlist ? instanceMetadata : null,
      mods: options.modlist
        ? mods.map((mod, index) => ({
            number: index + 1,
            name: mod.name,
            id: mod.modId,
            version: mod.version,
            side: mod.side,
            status: mod.enabled ? "Enabled" : "Disabled",
            authors: mod.authors,
          }))
        : [],
      duplicateGroups: options.duplicates
        ? collisions.map((group) => ({
            collision: group.collision,
            types: group.types,
            entries: group.entries.map((entry) => ({
              name: entry.displayName,
              namespace: entry.namespace,
              id: entry.id,
              type: entry.type,
            })),
          }))
        : [],
      warnings: options.warnings
        ? {
            incompatibleMods: warnings.incompatible.map((mod) => ({
              name: mod.name,
              id: mod.modId,
              fileName: mod.fileName,
            })),
            missingDependencies: warnings.missing,
          }
        : null,
    };
    if (format === "json") return JSON.stringify(payload, null, 2);
    if (format === "csv") {
      const rows = [
        "S.No,Mod Name,ID,Version,Side,Status,Authors",
        ...payload.mods.map((mod) =>
          [
            mod.number,
            mod.name,
            mod.id,
            mod.version,
            mod.side,
            mod.status,
            mod.authors,
          ]
            .map(csv)
            .join(","),
        ),
      ];
      if (options.duplicates)
        rows.push(
          "",
          "Duplicate Collision,Collision Type,Namespace,Registry ID,Registry Type",
          ...collisions.flatMap((group) =>
            group.entries.map((entry) =>
              [
                group.collision,
                group.types.join(" + "),
                entry.namespace,
                entry.id,
                entry.type,
              ]
                .map(csv)
                .join(","),
            ),
          ),
        );
      if (options.warnings)
        rows.push(
          "",
          "Warning Type,Mod,Dependency or File",
          ...warnings.incompatible.map((mod) =>
            ["Incompatible Fabric mod", mod.name, mod.fileName]
              .map(csv)
              .join(","),
          ),
          ...warnings.missing.map((item) =>
            ["Missing dependency", item.mod, item.dependency]
              .map(csv)
              .join(","),
          ),
        );
      return rows.join("\n");
    }
    const sections = [`# ${instanceName} Modpack Report`];
    if (options.modlist)
      sections.push(
        `- **Path:** ${instanceMetadata.path}\n- **Loader:** ${instanceMetadata.loader} ${instanceMetadata.loaderVersion}\n- **Minecraft:** ${instanceMetadata.minecraftVersion}\n- **Total mods:** ${instanceMetadata.totalMods}`,
      );
    if (options.modlist)
      sections.push(
        `## Modlist\n\n| S.No | Mod Name | ID | Version | Side | Status | Authors |\n|---:|---|---|---|---|---|---|\n${payload.mods.map((mod) => `| ${mod.number} | ${mod.name} | \`${mod.id}\` | ${mod.version} | ${mod.side} | ${mod.status} | ${mod.authors || "—"} |`).join("\n")}`,
      );
    if (options.duplicates)
      sections.push(
        `## Registry Collisions\n\n${collisions.length ? collisions.map((group) => `- **${group.collision}** (${group.types.join(", ")}): ${group.entries.map((entry) => `\`${entry.namespace}\` — \`${entry.id}\``).join("; ")}`).join("\n") : "No collisions detected."}`,
      );
    if (options.warnings)
      sections.push(
        `## Incompatible Mods & Missing Dependencies\n\n### Incompatible Fabric Mods\n${warnings.incompatible.length ? warnings.incompatible.map((mod) => `- ${mod.name} (\`${mod.modId}\`, ${mod.fileName})`).join("\n") : "None."}\n\n### Missing Mandatory Dependencies\n${warnings.missing.length ? warnings.missing.map((item) => `- ${item.mod} requires \`${item.dependency}\``).join("\n") : "None."}`,
      );
    return sections.join("\n\n");
  };

  const createReport = async (action: "copy" | "save"): Promise<void> => {
    if (!options.modlist && !options.duplicates && !options.warnings) {
      onError("Select at least one report section.");
      return;
    }
    setBusy(true);
    try {
      const content = await build();
      if (action === "copy") {
        await window.api.copyText(content);
        onNotify("Copied!");
        onClose();
      } else {
        const path = await window.api.saveModpackReport(format, content);
        if (path) {
          onNotify(`Report saved to ${path}`);
          onClose();
        }
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      onMouseDown={(event) =>
        event.target === event.currentTarget && !busy && onClose()
      }
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Export Modpack Report"
        className="w-full max-w-xl overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-100 shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Export Modpack Report</h2>
            <p className="mt-1 text-xs text-zinc-400">
              Choose what to include in the report.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close export modal"
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
          >
            <X size={17} />
          </button>
        </header>
        <div className="space-y-4 p-5">
          {(
            [
              ["modlist", "Modlist & Metadata"],
              ["duplicates", "Registry Collision & Duplicate Report"],
              ["warnings", "Incompatible Mods & Missing Dependencies Summary"],
            ] as Array<[keyof Options, string]>
          ).map(([key, label]) => (
            <label
              key={key}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-3 text-sm"
            >
              <input
                type="checkbox"
                checked={options[key]}
                onChange={() => toggle(key)}
                className="size-4 accent-cyan-500"
              />
              <span>{label}</span>
            </label>
          ))}
          <label className="block text-xs text-zinc-400">
            Format
            <select
              value={format}
              onChange={(event) => setFormat(event.target.value as Format)}
              className="mt-1.5 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            >
              <option value="md">Markdown</option>
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
            </select>
          </label>
        </div>
        <footer className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-4">
          <button
            type="button"
            onClick={() => void createReport("copy")}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800 disabled:opacity-50"
          >
            {busy ? (
              <LoaderCircle size={15} className="animate-spin" />
            ) : (
              <Clipboard size={15} />
            )}
            Copy to Clipboard
          </button>
          <button
            type="button"
            onClick={() => void createReport("save")}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md bg-cyan-600 px-3 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
          >
            {busy ? (
              <LoaderCircle size={15} className="animate-spin" />
            ) : (
              <Download size={15} />
            )}
            Save File…
          </button>
        </footer>
      </section>
    </div>
  );
}
