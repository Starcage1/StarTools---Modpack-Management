import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { detectNanaZipPath, normalizeNanaZipPath } from "./nanaZip";
import { detectVSCodePath } from "./vsCode";
import {
  DEFAULT_SETTINGS,
  type AppFontFamily,
  type AppSettings,
  type DisabledPlacement,
  type IncompatibleFabricPlacement,
  type TableFontSetting,
  type ThemeSetting,
  type StartupWindowMode,
  type SearchInputDebounceMs,
  type SyncBufferSizeKb,
} from "../shared/types";

function userDataDir(): string | null {
  try {
    // Escape hatch for tests / portable setups.
    const env = process.env["MODPACKTOOL_USERDATA"];
    if (env) return env;
    return app.getPath("userData");
  } catch {
    // No Electron runtime (e.g. plain-node tests).
    return null;
  }
}

function settingsPath(): string | null {
  const dir = userDataDir();
  return dir ? join(dir, "app_settings.json") : null;
}

function isTheme(value: unknown): value is ThemeSetting {
  return value === "light" || value === "dark";
}

function isTableFont(value: unknown): value is TableFontSetting {
  return value === "small" || value === "medium" || value === "large";
}

function normalizeTableFont(value: unknown): TableFontSetting | undefined {
  if (isTableFont(value)) return value;
  if (value === "compact") return "small";
  if (value === "normal") return "medium";
  return undefined;
}

function isPlacement(value: unknown): value is DisabledPlacement {
  return value === "end" || value === "start";
}

function isIncompatibleFabricPlacement(
  value: unknown,
): value is IncompatibleFabricPlacement {
  return value === "end" || value === "start" || value === "alphabetical";
}

function isFontFamily(value: unknown): value is AppFontFamily {
  return value === "sans" || value === "mono" || value === "serif";
}

function isLandingScreen(
  value: unknown,
): value is AppSettings["landingScreen"] {
  return value === "home" || value === "last-instance";
}

function isStartupWindowMode(value: unknown): value is StartupWindowMode {
  return (
    value === "windowed" || value === "maximized" || value === "fullscreen"
  );
}

function isSearchInputDebounceMs(
  value: unknown,
): value is SearchInputDebounceMs {
  return value === 100 || value === 150 || value === 250;
}

function isSyncBufferSizeKb(value: unknown): value is SyncBufferSizeKb {
  return value === 512 || value === 1024 || value === 2048;
}

function sanitize(raw: unknown): AppSettings {
  const obj = (
    typeof raw === "object" && raw !== null ? raw : {}
  ) as Partial<AppSettings>;
  const nanaZipPath =
    typeof obj.nanaZipPath === "string" && obj.nanaZipPath.trim().length > 0
      ? normalizeNanaZipPath(obj.nanaZipPath)
      : undefined;
  const vsCodePath =
    typeof obj.vsCodePath === "string" && obj.vsCodePath.trim().length > 0
      ? obj.vsCodePath.trim()
      : undefined;
  const customThemeId =
    typeof obj.customThemeId === "string" &&
    /^[a-z0-9_-]{1,64}$/i.test(obj.customThemeId)
      ? obj.customThemeId
      : undefined;
  return {
    theme: isTheme(obj.theme) ? obj.theme : DEFAULT_SETTINGS.theme,
    tableFont: normalizeTableFont(obj.tableFont) ?? DEFAULT_SETTINGS.tableFont,
    disabledPlacement: isPlacement(obj.disabledPlacement)
      ? obj.disabledPlacement
      : DEFAULT_SETTINGS.disabledPlacement,
    incompatibleFabricPlacement: isIncompatibleFabricPlacement(
      obj.incompatibleFabricPlacement,
    )
      ? obj.incompatibleFabricPlacement
      : DEFAULT_SETTINGS.incompatibleFabricPlacement,
    fontFamily: isFontFamily(obj.fontFamily)
      ? obj.fontFamily
      : DEFAULT_SETTINGS.fontFamily,
    landingScreen: isLandingScreen(obj.landingScreen)
      ? obj.landingScreen
      : DEFAULT_SETTINGS.landingScreen,
    startupWindowMode: isStartupWindowMode(obj.startupWindowMode)
      ? obj.startupWindowMode
      : DEFAULT_SETTINGS.startupWindowMode,
    confirmTrashMods:
      typeof obj.confirmTrashMods === "boolean"
        ? obj.confirmTrashMods
        : DEFAULT_SETTINGS.confirmTrashMods,
    promptDeleteAssociatedConfigs:
      typeof obj.promptDeleteAssociatedConfigs === "boolean"
        ? obj.promptDeleteAssociatedConfigs
        : DEFAULT_SETTINGS.promptDeleteAssociatedConfigs,
    crossModOnlyCollisions:
      typeof obj.crossModOnlyCollisions === "boolean"
        ? obj.crossModOnlyCollisions
        : DEFAULT_SETTINGS.crossModOnlyCollisions,
    ignoreVanillaBackportDuplicates:
      typeof obj.ignoreVanillaBackportDuplicates === "boolean"
        ? obj.ignoreVanillaBackportDuplicates
        : DEFAULT_SETTINGS.ignoreVanillaBackportDuplicates,
    syncPort:
      typeof obj.syncPort === "number" &&
      Number.isInteger(obj.syncPort) &&
      obj.syncPort >= 1024 &&
      obj.syncPort <= 65535
        ? obj.syncPort
        : DEFAULT_SETTINGS.syncPort,
    autoDetectRadmin:
      typeof obj.autoDetectRadmin === "boolean"
        ? obj.autoDetectRadmin
        : DEFAULT_SETTINGS.autoDetectRadmin,
    syncBufferSizeKb: isSyncBufferSizeKb(obj.syncBufferSizeKb)
      ? obj.syncBufferSizeKb
      : DEFAULT_SETTINGS.syncBufferSizeKb,
    searchInputDebounceMs: isSearchInputDebounceMs(obj.searchInputDebounceMs)
      ? obj.searchInputDebounceMs
      : DEFAULT_SETTINGS.searchInputDebounceMs,
    ...(nanaZipPath !== undefined ? { nanaZipPath } : {}),
    ...(vsCodePath !== undefined ? { vsCodePath } : {}),
    ...(customThemeId !== undefined ? { customThemeId } : {}),
  };
}

/** Load UI preferences (defaults when missing/corrupt/unavailable). Never throws. */
export function getSettings(): AppSettings {
  try {
    const path = settingsPath();
    const saved =
      path && existsSync(path)
        ? sanitize(JSON.parse(readFileSync(path, "utf8")))
        : { ...DEFAULT_SETTINGS };
    return {
      ...saved,
      nanaZipPath: saved.nanaZipPath ?? detectNanaZipPath() ?? undefined,
      vsCodePath: saved.vsCodePath ?? detectVSCodePath() ?? undefined,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Merge a partial update into the stored preferences and persist.
 * Returns the effective settings. Throws when unwritable.
 */
export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const path = settingsPath();
  if (!path) throw new Error("User data directory is unavailable");
  const next = sanitize({ ...getSettings(), ...patch });
  const dir = userDataDir();
  if (!dir) throw new Error("User data directory is unavailable");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2), "utf8");
  return next;
}
