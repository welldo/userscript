# GitHub DeepWiki Redirect

Adds a menu command on GitHub repository pages to quickly open the corresponding [DeepWiki](https://deepwiki.com) page.

## Install & Use

- Create a new Tampermonkey script and paste the userscript; save.
- Navigate to any GitHub repository page (e.g. `https://github.com/user/repo`).
- Click the Tampermonkey icon and select **"Open in DeepWiki"** from the menu.
- A new tab will open at `https://deepwiki.com/user/repo`.

## Requirements

- Requires `GM_registerMenuCommand` and `GM_openInTab` (supported by Tampermonkey / Violentmonkey).
