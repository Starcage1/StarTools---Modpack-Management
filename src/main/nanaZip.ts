import { execFileSync } from "child_process";
import { existsSync, statSync } from "fs";
import { join } from "path";

const NANA_ZIP_ALIAS = "NanaZipG.exe";
/** Store-installed NanaZip aliases are launchable by name, but not browseable as files. */
export function normalizeNanaZipPath(value: string): string {
  const trimmed = value.trim();
  if (/\\WindowsApps\\NanaZipG\.exe$/i.test(trimmed))
    return NANA_ZIP_ALIAS;
  return trimmed;
}

function isNanaZipAlias(value: string): boolean {
  return /^NanaZipG\.exe$/i.test(value);
}

function isFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

function resolvePathEntries(names: string[]): string[] {
  if (process.platform !== "win32") return [];
  const paths: string[] = [];
  for (const name of names) {
    try {
      const result = execFileSync("where.exe", [name], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      });
      for (const entry of result.split(/\r?\n/).map((value) => value.trim())) {
        if (entry && isFile(entry)) paths.push(entry);
      }
    } catch {
      // Try the next executable name in PATH.
    }
  }
  return paths;
}

function installedNanaZipCandidates(): string[] {
  if (process.platform !== "win32") return [];
  const localAppData = process.env["LOCALAPPDATA"] ?? "";
  const programFiles = process.env["ProgramFiles"] ?? "C:\\Program Files";
  const programFilesX86 =
    process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const candidates = [
    join(localAppData, "Microsoft", "WindowsApps", "NanaZipG.exe"),
    join(programFiles, "NanaZip", "bin", "NanaZipG.exe"),
    join(programFiles, "NanaZip", "NanaZipG.exe"),
    join(programFilesX86, "NanaZip", "bin", "NanaZipG.exe"),
    join(programFilesX86, "NanaZip", "NanaZipG.exe"),
    ...resolvePathEntries(["NanaZipG.exe", "nanazipg.exe"]),
  ];
  return [
    ...new Set(
      candidates
        .filter(
          (candidate, index) =>
            candidates.indexOf(candidate) === index &&
            (isNanaZipAlias(candidate) || isFile(candidate)),
        )
        .map(normalizeNanaZipPath),
    ),
  ];
}
function installedSevenZipCandidates(): string[] {
  if (process.platform !== "win32") return [];
  const programFiles = process.env["ProgramFiles"] ?? "C:\\Program Files";
  const programFilesX86 =
    process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const direct = [
    ...resolvePathEntries(["7zFM.exe"]),
    join(programFiles, "7-Zip", "7zFM.exe"),
    join(programFilesX86, "7-Zip", "7zFM.exe"),
  ];
  return direct.filter(
    (candidate, index) =>
      direct.indexOf(candidate) === index &&
      isFile(candidate),
  );
}

/** Find NanaZip's executable for the settings UI, without substituting 7-Zip. */
export function detectNanaZipPath(): string | null {
  return installedNanaZipCandidates()[0] ?? null;
}

/** Resolve GUI-only archive openers in the requested preference order. */
export function resolveArchiveGuiCandidates(configuredPath?: string): string[] {
  const configured = configuredPath?.trim()
    ? normalizeNanaZipPath(configuredPath)
    : "";
  const configuredCandidates: string[] = [];
  if (configured && isFile(configured)) {
    if (/NanaZip\.exe$/i.test(configured)) {
      const siblingGui = join(
        configured.slice(0, -"NanaZip.exe".length),
        "NanaZipG.exe",
      );
      if (isFile(siblingGui)) configuredCandidates.push(siblingGui);
    } else if (/NanaZipG\.exe$/i.test(configured)) {
      configuredCandidates.push(configured);
    }
  } else if (configured && isNanaZipAlias(configured)) {
    configuredCandidates.push(configured);
  }
  return [
    ...new Set([
      ...configuredCandidates,
      ...installedNanaZipCandidates(),
      ...installedSevenZipCandidates(),
    ]),
  ];
}
