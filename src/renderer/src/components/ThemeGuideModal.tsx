import { useState } from "react";
import { BookOpen, Braces, FolderOpen, Palette, X } from "lucide-react";

type GuideTab =
  | "Getting Started"
  | "Color Variables"
  | "Asset Customization"
  | "Example theme.json";

const COLOR_VARIABLES = [
  ["--bg-app", "Deepest background canvas", "Darkest surface"],
  ["--bg-surface", "Table rows, card backgrounds", "5-10% lighter than canvas"],
  [
    "--bg-elevated",
    "Hover states, active tabs, buttons",
    "Noticeable contrast",
  ],
  [
    "--border-subtle",
    "Subtle dividing lines and borders",
    "Low opacity (e.g. rgba(..., 0.08))",
  ],
  [
    "--text-main",
    "Headers, mod names, primary text",
    "High contrast (e.g. #ffffff)",
  ],
  [
    "--text-muted",
    "Versions, IDs, secondary details",
    "Medium contrast (e.g. #a1a1aa)",
  ],
  [
    "--accent",
    "Selected borders, active switches",
    "Accent color (e.g. #06b6d4)",
  ],
];

function GuideContent({ tab }: { tab: GuideTab }): React.JSX.Element {
  const textClass = "text-sm leading-6 text-zinc-300";
  const codeClass =
    "rounded bg-zinc-950 px-1.5 py-0.5 font-mono text-xs text-cyan-200";
  const preClass =
    "overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs leading-6 text-cyan-100";

  if (tab === "Getting Started") {
    return (
      <div className={textClass}>
        <h3 className="font-semibold text-zinc-100">Where do themes live?</h3>
        <p className="mt-1">
          All custom themes are stored in your user data directory:
        </p>
        <p className="mt-2">
          <code className={codeClass}>
            %appdata%/startools-modpack-manager/themes/
          </code>{" "}
          (Click <strong>Open Themes Folder</strong> above).
        </p>
        <h3 className="mt-6 font-semibold text-zinc-100">How it works:</h3>
        <ol className="mt-2 list-inside list-decimal space-y-2">
          <li>
            Create a new folder inside the{" "}
            <code className={codeClass}>themes</code> directory (e.g.,{" "}
            <code className={codeClass}>themes/cozy-forest/</code>).
          </li>
          <li>
            Inside that folder, create a{" "}
            <code className={codeClass}>theme.json</code> file.
          </li>
          <li>
            (Optional) Add a <code className={codeClass}>style.css</code> file
            for custom UI adjustments and an{" "}
            <code className={codeClass}>assets/</code> folder for images.
          </li>
          <li>
            Open <strong>Settings -&gt; Appearance</strong> and select your
            theme from the dropdown.
          </li>
        </ol>
      </div>
    );
  }

  if (tab === "Color Variables") {
    return (
      <div className={textClass}>
        <p>
          Themes use standard CSS variables applied globally to the application.
          You can customize any of the following:
        </p>
        <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full min-w-[560px] border-collapse text-left text-xs">
            <thead className="bg-zinc-950 text-zinc-400">
              <tr>
                {["Variable", "Description", "Recommended Tone"].map(
                  (heading) => (
                    <th
                      key={heading}
                      className="border-b border-zinc-800 px-3 py-2 font-semibold"
                    >
                      {heading}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {COLOR_VARIABLES.map(([variable, description, tone]) => (
                <tr
                  key={variable}
                  className="odd:bg-zinc-900 even:bg-zinc-950/40"
                >
                  <td className="border-b border-zinc-800/70 px-3 py-2">
                    <code className={codeClass}>{variable}</code>
                  </td>
                  <td className="border-b border-zinc-800/70 px-3 py-2">
                    {description}
                  </td>
                  <td className="border-b border-zinc-800/70 px-3 py-2">
                    {tone}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (tab === "Asset Customization") {
    return (
      <div className={textClass}>
        <h3 className="font-semibold text-zinc-100">Custom Images:</h3>
        <p className="mt-1">
          You can place images inside your theme&apos;s{" "}
          <code className={codeClass}>assets/</code> directory:
        </p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>
            <code className={codeClass}>assets/banner.png</code>: Renders as a
            decorative background banner in the header.
          </li>
          <li>
            <code className={codeClass}>assets/mascot.png</code>: A small avatar
            icon placed in the status or creator card.
          </li>
        </ul>
        <h3 className="mt-6 font-semibold text-zinc-100">
          Custom CSS (<code className={codeClass}>style.css</code>):
        </h3>
        <p className="mt-1">
          If you want to tweak fonts, rounded corners, or borders beyond colors,
          add a <code className={codeClass}>style.css</code> file next to your{" "}
          <code className={codeClass}>theme.json</code>. It will be injected
          dynamically:
        </p>
        <pre className={`${preClass} mt-3`}>
          <code>{`/* Example: Rounded cards & glowing table borders */
.instance-card {
  border-radius: 16px !important;
}
table tr:hover {
  outline: 1px solid var(--accent);
}`}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className={textClass}>
      <p>
        Copy and paste this template into{" "}
        <code className={codeClass}>themes/my-theme/theme.json</code> to get
        started:
      </p>
      <pre className={`${preClass} mt-4`}>
        <code>{`{
  "id": "neon-cyber",
  "name": "Neon Cyber (Beta)",
  "author": "YourName",
  "colors": {
    "--bg-app": "#0a0b10",
    "--bg-surface": "#12141f",
    "--bg-elevated": "#1c2033",
    "--border-subtle": "rgba(34, 211, 238, 0.15)",
    "--text-main": "#f8fafc",
    "--text-muted": "#94a3b8",
    "--accent": "#22d3ee"
  }
}`}</code>
      </pre>
    </div>
  );
}

const TABS: { id: GuideTab; icon: typeof BookOpen }[] = [
  { id: "Getting Started", icon: BookOpen },
  { id: "Color Variables", icon: Palette },
  { id: "Asset Customization", icon: FolderOpen },
  { id: "Example theme.json", icon: Braces },
];

interface ThemeGuideModalProps {
  onClose: () => void;
  onOpenThemesFolder: () => Promise<unknown>;
  onError: (message: string) => void;
}

export default function ThemeGuideModal({
  onClose,
  onOpenThemesFolder,
  onError,
}: ThemeGuideModalProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<GuideTab>("Getting Started");
  const [openingFolder, setOpeningFolder] = useState(false);

  const openFolder = async (): Promise<void> => {
    setOpeningFolder(true);
    try {
      await onOpenThemesFolder();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setOpeningFolder(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Theme styling guide"
        className="flex h-[520px] max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl"
      >
        <nav
          aria-label="Theme guide sections"
          className="flex w-48 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950/50 p-3"
        >
          <p className="mb-3 px-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            Theme Guide
          </p>
          <div className="space-y-1">
            {TABS.map(({ id, icon: Icon }) => (
              <button
                type="button"
                key={id}
                onClick={() => setActiveTab(id)}
                className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition ${activeTab === id ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"}`}
              >
                <Icon size={14} />
                {id}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void openFolder()}
            disabled={openingFolder}
            className="mt-auto flex items-center justify-center gap-2 rounded-md border border-zinc-700 px-2 py-2 text-[11px] font-medium text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-50"
          >
            <FolderOpen size={13} />
            {openingFolder ? "Opening…" : "Open Themes Folder"}
          </button>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800 px-5">
            <h2 className="text-sm font-semibold">{activeTab}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close theme guide"
              className="rounded-md p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-100"
            >
              <X size={16} />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <GuideContent tab={activeTab} />
            <p className="mt-5 rounded-lg border border-cyan-500/15 bg-cyan-950/20 p-3 text-xs leading-5 text-cyan-100/80">
              Theme customization is in beta. This guide is a starter reference
              and will grow as the theme system develops.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
