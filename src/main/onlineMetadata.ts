import { createHash } from "crypto";
import { stat, readFile } from "fs/promises";
import type { OnlineFetchProgress, OnlineFetchResult } from "../shared/types";
import { fetchModrinthDataBySha } from "./modrinth";

const MAX_FILES = 500;
const MAX_JAR_BYTES = 512 * 1024 * 1024;
const HASH_CONCURRENCY = 2;

interface HashedFile {
  filePath: string;
  sha1: string;
}

async function isReadableJar(filePath: string): Promise<boolean> {
  if (!filePath.toLowerCase().endsWith(".jar")) return false;
  try {
    const stats = await stat(filePath);
    return stats.isFile() && stats.size <= MAX_JAR_BYTES;
  } catch {
    return false;
  }
}

async function hashJars(
  modPaths: string[],
  onProgress?: (progress: OnlineFetchProgress) => void,
): Promise<HashedFile[]> {
  const paths: string[] = [];
  for (const path of [...new Set(modPaths)].slice(0, MAX_FILES)) {
    if (typeof path === "string" && (await isReadableJar(path)))
      paths.push(path);
  }

  const output: HashedFile[] = [];
  let cursor = 0;
  let completed = 0;
  onProgress?.({ stage: "hashing", current: 0, total: paths.length });
  const workers = Array.from(
    { length: Math.min(HASH_CONCURRENCY, paths.length) },
    async () => {
      while (true) {
        const index = cursor++;
        if (index >= paths.length) return;
        const filePath = paths[index];
        try {
          const bytes = await readFile(filePath);
          output[index] = {
            filePath,
            sha1: createHash("sha1").update(bytes).digest("hex"),
          };
        } catch (error) {
          console.warn(
            `[OnlineMetadata] Skipping unreadable jar "${filePath}":`,
            error,
          );
        } finally {
          completed += 1;
          onProgress?.({
            stage: "hashing",
            current: completed,
            total: paths.length,
          });
        }
      }
    },
  );
  await Promise.all(workers);
  return output.filter((file): file is HashedFile => Boolean(file));
}

/** Hash each jar once, then query Modrinth using the corresponding SHA-1 values. */
export async function fetchOnlineMetadata(
  modPaths: string[],
  onProgress?: (progress: OnlineFetchProgress) => void,
): Promise<OnlineFetchResult> {
  if (!Array.isArray(modPaths)) throw new Error("Invalid mod path list");
  const files = await hashJars(modPaths, onProgress);
  if (files.length === 0) {
    return { data: {} };
  }

  const pathsBySha = new Map<string, string[]>();
  for (const file of files) {
    const paths = pathsBySha.get(file.sha1);
    if (paths) paths.push(file.filePath);
    else pathsBySha.set(file.sha1, [file.filePath]);
  }

  const data = await fetchModrinthDataBySha(pathsBySha, onProgress);
  return { data };
}
