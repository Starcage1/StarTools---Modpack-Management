import { app } from "electron";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from "fs";
import { extname, join } from "path";
import type { CustomTheme, CustomThemeColors } from "../shared/types";

const COLOR_KEYS = [
  "--bg-app",
  "--bg-surface",
  "--bg-elevated",
  "--border-subtle",
  "--text-main",
  "--text-muted",
] as const;
const MAX_CSS_BYTES = 256 * 1024;
const MAX_ASSET_BYTES = 2 * 1024 * 1024;

function themesPath(): string {
  const path = join(app.getPath("userData"), "themes");
  mkdirSync(path, { recursive: true });
  const stats = lstatSync(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("Themes storage path is not a regular folder");
  }
  return path;
}

function readAsset(folder: string, value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("..") ||
    value.includes("/") ||
    value.includes("\\")
  )
    return undefined;
  const assetPath = join(folder, value);
  const stats = lstatSync(assetPath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_ASSET_BYTES)
    return undefined;
  const extension = extname(value).toLowerCase();
  const mime =
    extension === ".png"
      ? "image/png"
      : extension === ".jpg" || extension === ".jpeg"
        ? "image/jpeg"
        : extension === ".webp"
          ? "image/webp"
          : null;
  if (!mime) return undefined;
  return `data:${mime};base64,${readFileSync(assetPath).toString("base64")}`;
}

function safeCss(folder: string): string | undefined {
  const path = join(folder, "style.css");
  if (!existsSync(path)) return undefined;
  const stats = lstatSync(path);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_CSS_BYTES)
    return undefined;
  const css = readFileSync(path, "utf8");
  // Local themes may style the UI but cannot load remote/local resources or escape the app.
  if (/@import|url\s*\(|expression\s*\(|javascript:/i.test(css))
    return undefined;
  return css;
}

export function listAvailableThemes(): CustomTheme[] {
  const root = themesPath();
  const themes: CustomTheme[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const folder = join(root, entry.name);
    const manifestPath = join(folder, "theme.json");
    try {
      if (
        !lstatSync(folder).isDirectory() ||
        lstatSync(folder).isSymbolicLink()
      )
        continue;
      const manifestStats = lstatSync(manifestPath);
      if (!manifestStats.isFile() || manifestStats.isSymbolicLink()) continue;
      const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (!manifest || typeof manifest !== "object") continue;
      const value = manifest as Record<string, unknown>;
      if (typeof value.id !== "string" || !/^[a-z0-9_-]{1,64}$/i.test(value.id))
        continue;
      if (typeof value.name !== "string" || !value.name.trim()) continue;
      const rawColors =
        value.colors && typeof value.colors === "object"
          ? (value.colors as Record<string, unknown>)
          : {};
      const colors: CustomThemeColors = {};
      for (const key of COLOR_KEYS) {
        const color = rawColors[key];
        if (
          typeof color === "string" &&
          color.length <= 64 &&
          /^[#(),.%\w\s-]+$/.test(color)
        )
          colors[key] = color;
      }
      const theme: CustomTheme = {
        id: value.id,
        name: value.name.trim().slice(0, 100),
        author:
          typeof value.author === "string"
            ? value.author.slice(0, 100)
            : "Community",
        colors,
        styleCss: safeCss(folder),
      };
      if (value.assets && typeof value.assets === "object") {
        const assets = value.assets as Record<string, unknown>;
        try {
          theme.headerBannerDataUri = readAsset(folder, assets.headerBanner);
        } catch {
          /* optional asset */
        }
        try {
          theme.mascotDataUri = readAsset(folder, assets.mascot);
        } catch {
          /* optional asset */
        }
      }
      themes.push(theme);
    } catch {
      // Ignore malformed or incomplete theme folders.
    }
  }
  return themes.sort((a, b) => a.name.localeCompare(b.name));
}

export function openThemesFolder(): string {
  return themesPath();
}
