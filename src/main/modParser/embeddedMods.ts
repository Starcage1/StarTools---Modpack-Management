import AdmZip from "adm-zip";
import { parse as parseToml } from "smol-toml";

const NESTED_JAR_PATH = /^META-INF\/(?:jarjar|jars)\/[^/]+\.jar$/i;
const MAX_NESTED_JAR_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_NESTED_JAR_BYTES = 128 * 1024 * 1024;
const MAX_NESTED_JARS = 64;

function addId(ids: Set<string>, value: unknown): void {
  if (typeof value === "string" && /^[a-z0-9_.-]+$/i.test(value.trim()))
    ids.add(value.trim().toLowerCase());
}

function readNestedMetadata(zip: AdmZip, ids: Set<string>): void {
  const fabric = zip.getEntry("fabric.mod.json");
  if (fabric && !fabric.isDirectory) {
    try {
      const value = JSON.parse(fabric.getData().toString("utf8")) as {
        id?: unknown;
      };
      addId(ids, value.id);
    } catch {
      // Ignore malformed optional metadata in an embedded jar.
    }
  }

  for (const entryName of [
    "META-INF/neoforge.mods.toml",
    "META-INF/mods.toml",
  ]) {
    const entry = zip.getEntry(entryName);
    if (!entry || entry.isDirectory) continue;
    try {
      const parsed = parseToml(entry.getData().toString("utf8")) as {
        mods?: Array<{ modId?: unknown }>;
      };
      for (const mod of parsed.mods ?? []) addId(ids, mod.modId);
    } catch {
      // Try the next known metadata format.
    }
  }
}

/** IDs declared by libraries bundled inside this mod JAR. */
export function readEmbeddedModIds(container: AdmZip): string[] {
  const ids = new Set<string>();
  const metadata = container.getEntry("META-INF/jarjar/metadata.json");
  if (metadata && !metadata.isDirectory) {
    try {
      const parsed = JSON.parse(metadata.getData().toString("utf8")) as {
        jars?: Array<{ identifier?: { artifact?: unknown } }>;
      };
      for (const jar of parsed.jars ?? [])
        addId(ids, jar.identifier?.artifact);
    } catch {
      // Nested JAR inspection below remains available if the index is malformed.
    }
  }

  let totalNestedBytes = 0;
  const nestedEntries = container
    .getEntries()
    .filter((item) => !item.isDirectory && NESTED_JAR_PATH.test(item.entryName))
    .slice(0, MAX_NESTED_JARS);
  for (const entry of nestedEntries) {
    try {
      const bytes = entry.getData();
      if (
        !bytes.length ||
        bytes.length > MAX_NESTED_JAR_BYTES ||
        totalNestedBytes + bytes.length > MAX_TOTAL_NESTED_JAR_BYTES
      )
        continue;
      totalNestedBytes += bytes.length;
      readNestedMetadata(new AdmZip(bytes), ids);
    } catch {
      // A damaged optional embedded library must not fail the parent mod scan.
    }
  }
  return [...ids];
}
