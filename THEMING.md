# StarTools - Modpack Manager Theming Guide

## Tab 1: Getting Started

**Where do themes live?**

All custom themes are stored in your user data directory:
`%appdata%/startools-modpack-manager/themes/` (Click **Open Themes Folder** above).

**How it works:**

1. Create a new folder inside the `themes` directory (e.g., `themes/cozy-forest/`).
2. Inside that folder, create a `theme.json` file.
3. (Optional) Add a `style.css` file for custom UI adjustments and an `assets/` folder for images.
4. Open **Settings -> Appearance** and select your theme from the dropdown.

## Tab 2: Color Variables

Themes use standard CSS variables applied globally to the application. You can customize any of the following:

| Variable          | Description                        | Recommended Tone                     |
| :---------------- | :--------------------------------- | :----------------------------------- |
| `--bg-app`        | Deepest background canvas          | Darkest surface                      |
| `--bg-surface`    | Table rows, card backgrounds       | 5-10% lighter than canvas            |
| `--bg-elevated`   | Hover states, active tabs, buttons | Noticeable contrast                  |
| `--border-subtle` | Subtle dividing lines and borders  | Low opacity (e.g. `rgba(..., 0.08)`) |
| `--text-main`     | Headers, mod names, primary text   | High contrast (e.g. `#ffffff`)       |
| `--text-muted`    | Versions, IDs, secondary details   | Medium contrast (e.g. `#a1a1aa`)     |
| `--accent`        | Selected borders, active switches  | Accent color (e.g. `#06b6d4`)        |

## Tab 3: Asset Customization & CSS

**Custom Images:**

You can place images inside your theme's `assets/` directory:

- `assets/banner.png`: Renders as a decorative background banner in the header.
- `assets/mascot.png`: A small avatar icon placed in the status or creator card.

**Custom CSS (`style.css`):**

If you want to tweak fonts, rounded corners, or borders beyond colors, add a `style.css` file next to your `theme.json`. It will be injected dynamically:

```css
/* Example: Rounded cards & glowing table borders */
.instance-card {
  border-radius: 16px !important;
}
table tr:hover {
  outline: 1px solid var(--accent);
}
```

## Tab 4: Example `theme.json`

Copy and paste this template into `themes/my-theme/theme.json` to get started:

```json
{
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
}
```
