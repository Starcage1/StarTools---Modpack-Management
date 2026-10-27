# StarTools — Modpack Manager (v0.6.0 Beta)

Hey! StarTools is a personal desktop companion tool I put together to make creating, auditing, and tweaking Minecraft modpacks a lot less annoying than digging through file explorer windows. 

I built it primarily for my own modpack development workflow, but I'm sharing it in case other pack makers find it useful.

---

> ⚠️ **A quick heads-up before using:**  
> This is a **personal hobby project**, not an enterprise product or commercial software. It's in active beta (`v0.6.0`), developed in my spare time, so expect occasional rough edges or quirks. Feel free to try it out, but **please always back up your instances and saves first!**

---

## 🛠️ Why I Built This

Most launchers treat your modpack as just a flat list of files or launch targets. When you're actively building or tweaking a pack, you often have to:
- Wonder why a mod is complaining about a missing dependency.
- Manually hunt down and edit 15 different `.toml` and `.json` configs in Notepad.
- Lose track of which configs belong to a mod you just removed.
- Accidentally break your pack and have no clean way to roll back recent changes.

StarTools brings all of that into one lightweight workspace.

---

## 💡 What It Can Do

- **Instance Switcher:** Keep up to 5 instances saved (ATLauncher, Prism, or custom folders) without selecting folders every time.
- **Mod Auditing:**
  - Flags missing or optional dependencies with warning badges.
  - Detects environments (`Client`, `Server`, or `Both`).
  - Fetches project icons, links, and tags from Modrinth using file hashes.
- **Built-in Config Editor:**
  - Embedded Monaco code editor (same engine as VS Code).
  - Syntax highlighting for `.toml`, `.json`, `.json5`, `.cfg`, and `.yaml`.
  - Multiple tabs, line numbers, and quick `Ctrl+S` saving.
- **Mod-to-Config Linker:**
  - Suggests config files that match a mod's ID.
  - Option to clean up associated configs when moving a mod to trash.
- **Snapshots & Rollbacks (Beta):**
  - Take quick snapshots before testing new mods.
  - Saves your enabled/disabled mod states and zips the `config/` folder so you can roll back with one click.
- **Packs Tab:**
  - Quick view to enable, disable, and inspect Shaderpacks, Resource Packs, and Datapacks.
- **Themes & UI Customization:**
  - Ships with **Obsidian (Dark)** and **Warm Oat (Light)**.
  - Supports custom community themes via `theme.json` and custom CSS (see [THEMING.md](./THEMING.md)).
- **Safety First:**
  - Non-destructive actions: trashed files are staged in a local `trash_staging/` folder rather than permanently deleted right away.

---

## 📦 How to Run

Check out the **[Releases](../../releases)** tab for the pre-built Windows files:

- **Portable (`StarTools - Modpack Manager-0.6.0-win64x-portable.exe`):** Recommended. No installation needed—just drop it anywhere and run it.
- **Installer (`StarTools - Modpack Manager-0.6.0-win64x-setup.exe`):** Standard Windows installer if you prefer start menu shortcuts.
- Platform: Windows 10 / 11 (64-bit) only. (Linux/macOS builds are not currently supported).

### ℹ️ Note on Windows SmartScreen
Because I don't pay hundreds of dollars a year for a corporate Microsoft code-signing certificate, Windows SmartScreen will show a blue *"Windows protected your PC (Unknown Publisher)"* popup when you run it.  
This is standard for free, unsigned open-source tools: just click **"More info"** → **"Run anyway"**.

---

## 🔒 Privacy & Network

- **Mod Lookups:** When you click *"Fetch Online Data"*, StarTools calculates anonymous **SHA-1 hashes** of your `.jar` files and checks them against the public [Modrinth API](https://docs.modrinth.com/).
- **Zero File Uploads:** No local files, personal data, instance paths, or configs are ever uploaded anywhere.

---

## 🐛 Feedback & Bug Reports

Found a bug or have an idea to make pack building smoother? Feel free to open an issue in the **[Issues](../../issues)** tab. Since this is an independent hobby project, I work on it whenever I have free time, but constructive feedback is always appreciated!

---

## 📄 License

Distributed under the [MIT License](./LICENSE).

Made by **Star Cage**.
