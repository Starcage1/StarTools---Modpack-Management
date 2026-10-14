\# 🎨 StarTools — Theme \& Customization Guide (Beta)



StarTools features a modular, CSS-variable-based theming engine. You can customize colors, inject custom CSS overrides, and add custom artwork (such as header banners and companion mascots) without touching the source code.



&#x20;\[!NOTE]  

&#x20;The theme engine is currently in Beta. Built-in themes include Obsidian (Default Dark) and Warm Oat (Minimalist Light). Community themes are loaded dynamically from your local application data directory.



\---



\## 📂 Where Themes Live



All custom themes are stored in your user data directory



```text

%appdata%startools-modpack-managerthemes

```



\### Quick Access

1\. Open StarTools.

2\. Click Style Guide (top-right header) or go to Settings ➔ Appearance.

3\. Click the Open Themes Folder button to jump directly to the folder in Windows Explorer.



\---



\## 📦 How to Install a Theme



1\. Download or unpack the theme folder (e.g., `cozy-forest`).

2\. Move the entire folder into your `themes` directory

&#x20;  ```text

&#x20;  themes

&#x20;  └── cozy-forest

&#x20;      ├── theme.json

&#x20;      ├── style.css         (optional)

&#x20;      └── assets           (optional)

&#x20;          └── banner.png

&#x20;  ```

3\. Restart StarTools (or reopen the Settings modal).

4\. Go to Settings ➔ Appearance ➔ Custom Themes and select your theme from the dropdown.



\---



\## 🛠️ Theme Folder Structure



Every theme requires a folder containing at least a valid `theme.json` manifest



```text

themestheme-id

├── theme.json          # Required Theme metadata \& core CSS variables

├── style.css           # Optional Custom CSS overrides (fonts, borders, animations)

└── assets             # Optional Image assets used by the theme

&#x20;   ├── banner.png      # Optional Header banner image

&#x20;   └── mascot.png      # Optional Small avatarmascot icon

```



\---



\## ⚙️ Creating a Theme Step-by-Step



\### 1. The Manifest (`theme.json`)



Create a `theme.json` file inside your theme's folder. This file defines your theme metadata and base color palette



```json

{

&#x20; id cyber-neon,

&#x20; name Cyber Neon,

&#x20; author YourName,

&#x20; version 1.0.0,

&#x20; description High-contrast dark theme with vivid magenta accents.,

&#x20; colors {

&#x20;   --bg-app #0a0a12,

&#x20;   --bg-surface #121124,

&#x20;   --bg-elevated #1c1936,

&#x20;   --border-subtle rgba(236, 72, 153, 0.2),

&#x20;   --text-main #fdf4ff,

&#x20;   --text-muted #d946ef,

&#x20;   --accent #ec4899

&#x20; },

&#x20; assets {

&#x20;   headerBanner banner.png,

&#x20;   mascot mascot.png

&#x20; }

}

```



\---



\### 2. Supported Color Variables



StarTools uses standard CSS variables across all components. Your `theme.json` colors object maps directly to these variables



&#x20;CSS Variable  Element Target  Recommended Usage 

&#x20;---  ---  --- 

&#x20;`--bg-app`  Window canvas  Deepest background surface (behind cards and tables) 

&#x20;`--bg-surface`  Tables, Mod Cards, Sidebar  Surface level (5%–10% lighterdifferent than canvas) 

&#x20;`--bg-elevated`  Hover rows, Active tabs, Modals  Elevated interactive elements 

&#x20;`--border-subtle`  Card borders, table dividers  Low-contrast borders (e.g. `rgba(255, 255, 255, 0.08)`) 

&#x20;`--text-main`  Headers, Mod Names, Primary text  High-contrast readable text 

&#x20;`--text-muted`  Versions, Mod IDs, Descriptions  Lower-contrast secondary details 

&#x20;`--accent`  Active pill indicators, checkmarks  Brand accent color 



\---



\### 3. Custom CSS Overrides (`style.css`)



If you want to modify fonts, change border radii, or add subtle glows beyond color variables, add an optional `style.css` file next to your `theme.json`.



StarTools injects this stylesheet dynamically when the theme is activated



```css

&#x20;Example Customizing table row interactions 

trhover {

&#x20; background-color var(--bg-elevated) !important;

&#x20; box-shadow inset 2px 0 0 var(--accent);

}



&#x20;Example Softer rounded cards 

.instance-card {

&#x20; border-radius 14px !important;

&#x20; transition transform 0.15s ease;

}



.instance-cardhover {

&#x20; transform translateY(-2px);

}

```



&#x20;\[!TIP]  

&#x20;Use `!important` sparingly on rules if Tailwind's default utility classes take precedence.



\---



\### 4. Custom Assets (`assets`)



You can bundle optional images inside an `assets` subfolder

\- `headerBanner` (`assetsbanner.png`) Displays as a subtle background banner across the workspace navigation header. Recommended aspect ratio `163` (e.g., `1200x225px`, PNG or WEBP).

\- `mascot` (`assetsmascot.png`) Displays as a small icon in the home screen footer  status chip. Recommended size `64x64px` or `128x128px` transparent PNG.



\---



\## 📋 Ready-to-Use Templates



\### Template A Minimalist Theme (JSON Only)

Save as `themesnordic-frosttheme.json`



```json

{

&#x20; id nordic-frost,

&#x20; name Nordic Frost,

&#x20; author Community,

&#x20; colors {

&#x20;   --bg-app #242933,

&#x20;   --bg-surface #2e3440,

&#x20;   --bg-elevated #3b4252,

&#x20;   --border-subtle rgba(216, 222, 233, 0.1),

&#x20;   --text-main #eceff4,

&#x20;   --text-muted #88c0d0,

&#x20;   --accent #81a1c1

&#x20; }

}

```



\### Template B Warm Paper  Retro Theme (Light)

Save as `themesretro-papertheme.json`



```json

{

&#x20; id retro-paper,

&#x20; name Retro Paper,

&#x20; author Community,

&#x20; colors {

&#x20;   --bg-app #f4efe6,

&#x20;   --bg-surface #faf7f2,

&#x20;   --bg-elevated #e8e1d5,

&#x20;   --border-subtle #ded5c5,

&#x20;   --text-main #2b2621,

&#x20;   --text-muted #7a7065,

&#x20;   --accent #c25e00

&#x20; }

}

```



\---



\## 📤 Sharing Your Theme



Made a cool theme

1\. Zip your theme's folder

&#x20;  ```text

&#x20;  my-theme.zip

&#x20;  └── my-theme

&#x20;      ├── theme.json

&#x20;      └── style.css

&#x20;  ```

2\. Open an issue or discussion on the \[GitHub Repository](httpsgithub.comstarcagestartools-modpack-managerissues) with the tag `\[Theme]` and share your screenshot and zip!

