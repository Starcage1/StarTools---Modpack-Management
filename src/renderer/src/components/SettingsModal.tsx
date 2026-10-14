import { useEffect, useState, type ReactNode } from "react";
import {
  ChevronDown,
  FolderOpen,
  Info,
  Palette,
  Plug,
  RefreshCw,
  Settings2,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  APP_ICON_SIZE_PX,
  TABLE_FONT_PX,
  type AppFontFamily,
  type AppSettings,
  type CustomTheme,
  type TableFontSetting,
} from "../../../shared/types";
import BetaBadge from "./BetaBadge";

interface SettingsModalProps {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  onBrowseNanaZip: () => Promise<void>;
  onDetectNanaZip: () => Promise<void>;
  onBrowseVSCode: () => Promise<void>;
  onDetectVSCode: () => Promise<void>;
  customThemes: CustomTheme[];
  onOpenThemesFolder: () => Promise<void>;
  onRefreshThemes: () => Promise<void>;
  onClose: () => void;
}

type Tab = "appearance" | "instances" | "integrations" | "safety";

const NAV: { id: Tab; label: string; icon: typeof Palette }[] = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "instances", label: "Instances & General", icon: Settings2 },
  { id: "integrations", label: "Integrations & APIs", icon: Plug },
  { id: "safety", label: "Safety & Confirmations", icon: ShieldCheck },
];

const FONT_FAMILY_OPTIONS: { value: AppFontFamily; label: string }[] = [
  { value: "sans", label: "Default Sans" },
  { value: "mono", label: "Developer Mono" },
  { value: "serif", label: "Serif" },
];

function Accordion({
  title,
  description,
  children,
  defaultOpen = true,
}: {
  title: string;
  description: string;
  children: ReactNode;
  defaultOpen?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900/60">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold">{title}</span>
          <span title={description}>
            <Info size={14} className="shrink-0 text-gray-400" />
          </span>
        </span>
        <ChevronDown
          size={15}
          className={`shrink-0 text-gray-500 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="space-y-4 border-t border-gray-200 px-4 py-4 dark:border-gray-700">
          {children}
        </div>
      )}
    </section>
  );
}

function SettingLabel({
  title,
  help,
}: {
  title: string;
  help?: string;
}): React.JSX.Element {
  return (
    <div>
      <p className="text-sm font-medium">{title}</p>
      {help && (
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          {help}
        </p>
      )}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-indigo-600" : "bg-gray-300 dark:bg-gray-700"}`}
    >
      <span
        className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : "translate-x-0.5"}`}
      />
    </button>
  );
}

function SettingsModal({
  settings,
  onChange,
  onBrowseNanaZip,
  onDetectNanaZip,
  onBrowseVSCode,
  onDetectVSCode,
  customThemes,
  onOpenThemesFolder,
  onRefreshThemes,
  onClose,
}: SettingsModalProps): React.JSX.Element {
  const [tab, setTab] = useState<Tab>("appearance");
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const selectClass =
    "mt-1.5 w-full rounded-md border border-gray-300 bg-white px-2.5 py-2 text-sm text-gray-800 outline-none focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";
  const tabInfo = {
    appearance: [
      "Appearance",
      "Choose the theme and typography used throughout the workspace.",
    ],
    instances: [
      "Instances & General",
      "Choose how StarTools opens and how instance views are arranged.",
    ],
    integrations: [
      "Integrations & APIs",
      "Connect metadata providers and configure external tools.",
    ],
    safety: [
      "Safety & Confirmations",
      "Control confirmations shown before moving mods or associated configs.",
    ],
  } satisfies Record<Tab, [string, string]>;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="flex h-[600px] max-h-[calc(100vh-2rem)] w-full max-w-4xl overflow-hidden rounded-xl border border-gray-200 bg-[var(--bg-surface)] text-[var(--text-main)] shadow-2xl dark:border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        <aside className="flex w-60 shrink-0 flex-col border-r border-gray-200 bg-gray-50/70 p-3 dark:border-gray-700 dark:bg-gray-950/50">
          <div className="flex items-center justify-between px-2 py-2">
            <span className="text-sm font-semibold">Settings</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close settings"
              className="rounded-md p-1 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-800"
            >
              <X size={16} />
            </button>
          </div>
          <nav aria-label="Settings sections" className="mt-3 space-y-1">
            {NAV.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-current={tab === id ? "page" : undefined}
                onClick={() => setTab(id)}
                className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left text-sm transition-colors ${tab === id ? "bg-gray-200 font-medium text-gray-900 dark:bg-gray-800 dark:text-gray-100" : "text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-gray-200"}`}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </nav>
          <p className="mt-auto px-2 pb-1 text-[11px] text-gray-400">
            StarTools - Modpack Manager settings
          </p>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="shrink-0 border-b border-gray-200 px-6 py-5 dark:border-gray-700">
            <h2 className="text-lg font-semibold">{tabInfo[tab][0]}</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {tabInfo[tab][1]}
            </p>
          </header>
          <div className="settings-scroll flex-1 space-y-3 overflow-y-auto px-6 py-5">
            {tab === "appearance" && (
              <>
                <Accordion
                  title="Theme"
                  description="Switch between built-in themes or a locally installed community theme."
                >
                  <div>
                    <SettingLabel title="Color theme" />
                    <select
                      id="theme-setting"
                      value={
                        settings.customThemeId
                          ? `custom:${settings.customThemeId}`
                          : settings.theme
                      }
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value.startsWith("custom:"))
                          onChange({ customThemeId: value.slice(7) });
                        else
                          onChange({
                            customThemeId: undefined,
                            theme: value as AppSettings["theme"],
                          });
                      }}
                      className={selectClass}
                    >
                      <option value="dark">Obsidian (Dark)</option>
                      <option value="light">Warm Oat (Light)</option>
                      {customThemes.map((theme) => (
                        <option key={theme.id} value={`custom:${theme.id}`}>
                          {theme.name} (Beta)
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="rounded-md border border-gray-200 p-3 dark:border-gray-700">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">Custom Themes</p>
                      <BetaBadge />
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      {customThemes.length
                        ? `Detected: ${customThemes.map((theme) => theme.name).join(", ")}`
                        : "Add a theme folder with theme.json to customize colors and optional artwork."}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => void onOpenThemesFolder()}
                        className="rounded-md border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
                      >
                        Open Themes Folder
                      </button>
                      <button
                        type="button"
                        onClick={() => void onRefreshThemes()}
                        className="rounded-md border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
                      >
                        Refresh
                      </button>
                    </div>
                  </div>
                </Accordion>
                <Accordion
                  title="Typography"
                  description="Choose a standard text scale and the application font family."
                >
                  <div>
                    <SettingLabel title="Text and icon scale" />
                    <select
                      value={settings.tableFont}
                      onChange={(e) =>
                        onChange({
                          tableFont: e.target.value as TableFontSetting,
                        })
                      }
                      className={selectClass}
                    >
                      {(Object.keys(TABLE_FONT_PX) as TableFontSetting[]).map(
                        (value) => (
                          <option key={value} value={value}>
                            {value[0].toUpperCase() + value.slice(1)} (Text{" "}
                            {TABLE_FONT_PX[value]}px · Icon{" "}
                            {APP_ICON_SIZE_PX[value]}px)
                          </option>
                        ),
                      )}
                    </select>
                  </div>
                  <div>
                    <SettingLabel title="Font style" />
                    <select
                      value={settings.fontFamily}
                      onChange={(e) =>
                        onChange({
                          fontFamily: e.target.value as AppFontFamily,
                        })
                      }
                      className={selectClass}
                    >
                      {FONT_FAMILY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </Accordion>
              </>
            )}

            {tab === "instances" && (
              <>
                <Accordion
                  title="Startup"
                  description="Choose whether the app opens to Home or the last instance workspace."
                >
                  <SettingLabel
                    title="Default Landing Screen"
                    help="This setting applies the next time StarTools starts."
                  />
                  <div className="mt-2 space-y-2">
                    {(
                      [
                        { value: "home", label: "Always show Home Screen" },
                        {
                          value: "last-instance",
                          label: "Auto-open last used instance",
                        },
                      ] as const
                    ).map((option) => (
                      <label
                        key={option.value}
                        className="flex cursor-pointer items-center gap-2 rounded-md border border-gray-200 px-3 py-2.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                      >
                        <input
                          type="radio"
                          name="landing-screen"
                          checked={settings.landingScreen === option.value}
                          onChange={() =>
                            onChange({ landingScreen: option.value })
                          }
                          className="accent-indigo-500"
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                </Accordion>
                <Accordion
                  title="Modlist layout"
                  description="Choose where disabled mods appear in the modlist."
                >
                  <SettingLabel title="Disabled mod placement" />
                  <div className="mt-2 space-y-2">
                    {(
                      [
                        { value: "end", label: "Show at bottom (Default)" },
                        { value: "start", label: "Show at top" },
                      ] as const
                    ).map((option) => (
                      <label
                        key={option.value}
                        className="flex cursor-pointer items-center gap-2 rounded-md border border-gray-200 px-3 py-2.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                      >
                        <input
                          type="radio"
                          name="disabled-placement"
                          checked={settings.disabledPlacement === option.value}
                          onChange={() =>
                            onChange({ disabledPlacement: option.value })
                          }
                          className="accent-indigo-500"
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                </Accordion>
              </>
            )}

            {tab === "integrations" && (
              <>
                <Accordion
                  title="External applications"
                  description="Set executable paths for archive and config-file integrations."
                >
                  <div>
                    <SettingLabel title="NanaZip executable path" />
                    <input
                      value={settings.nanaZipPath ?? ""}
                      onChange={(e) =>
                        onChange({ nanaZipPath: e.target.value || undefined })
                      }
                      placeholder="Auto-detected when available"
                      className={selectClass}
                      spellCheck={false}
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => void onBrowseNanaZip()}
                        className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
                      >
                        <FolderOpen size={14} />
                        Browse…
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDetectNanaZip()}
                        className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
                      >
                        <RefreshCw size={14} />
                        Find NanaZip
                      </button>
                    </div>
                  </div>
                  <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
                    <SettingLabel title="Visual Studio Code executable path" />
                    <input
                      value={settings.vsCodePath ?? ""}
                      onChange={(e) =>
                        onChange({ vsCodePath: e.target.value || undefined })
                      }
                      placeholder="Auto-detected when available"
                      className={selectClass}
                      spellCheck={false}
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => void onBrowseVSCode()}
                        className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
                      >
                        <FolderOpen size={14} />
                        Browse…
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDetectVSCode()}
                        className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
                      >
                        <RefreshCw size={14} />
                        Find VS Code
                      </button>
                    </div>
                  </div>
                </Accordion>
              </>
            )}

            {tab === "safety" && (
              <Accordion
                title="Deletion and trash"
                description="Choose which operations require an explicit confirmation before they stage files in the app trash."
              >
                <div className="flex items-center justify-between gap-4">
                  <SettingLabel
                    title="Confirm Trashing Mods"
                    help="Show a confirmation before moving a mod jar to the app's restorable trash."
                  />
                  <Toggle
                    checked={settings.confirmTrashMods}
                    onChange={(confirmTrashMods) =>
                      onChange({ confirmTrashMods })
                    }
                    label="Confirm trashing mods"
                  />
                </div>
                <div className="flex items-center justify-between gap-4 border-t border-gray-200 pt-4 dark:border-gray-700">
                  <SettingLabel
                    title="Confirm deletion of associated configs"
                    help="Ask which automatically or manually mapped config files should also be staged when a mod is trashed."
                  />
                  <Toggle
                    checked={settings.promptDeleteAssociatedConfigs}
                    onChange={(promptDeleteAssociatedConfigs) =>
                      onChange({ promptDeleteAssociatedConfigs })
                    }
                    label="Confirm deletion of associated configs"
                  />
                </div>
              </Accordion>
            )}
          </div>
          <footer className="flex shrink-0 justify-end border-t border-gray-200 px-6 py-3 dark:border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
            >
              Done
            </button>
          </footer>
        </main>
      </div>
    </div>
  );
}

export default SettingsModal;
