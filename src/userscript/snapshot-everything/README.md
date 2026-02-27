# Snapshot Everything

Take a high-fidelity snapshot of any DOM element on any site.

## Install & Use

1. Install via Tampermonkey / Violentmonkey, or click the direct install link below.
2. Open the Tampermonkey menu on any page and click **Take Snapshot** (or the localized label).

## Workflow

### 1. Inspecting

Move the mouse over the page — a highlight overlay follows the hovered element, showing its tag name, class, and dimensions.

Click to **select** the element.

### 2. Selected

Once an element is selected, a floating action bar appears with the following controls:

| Control | Description |
|---|---|
| **P \[input\] px** | Padding around the captured area. Adjusts in real time — the overlay expands to visualize the padding. |
| **Snapshot** | Capture and download the selected element immediately (PNG). |
| **Preview** | Capture and show a full-screen preview with loading spinner. From the preview you can **Download** or **Close**. |
| **Cancel** | Exit without capturing. |

### Keyboard & Mouse

| Shortcut | Action |
|---|---|
| **Click** (on page element) | Re-select a different element |
| **Alt + Scroll Up** (Option on macOS) | Select the parent element |
| **Alt + Scroll Down** | Select the first child element |
| **Escape** | Close preview if open, otherwise cancel and exit |

## Output

- Format: **PNG**
- Scale: **2×** device pixels
- Filename: `SnapshotEverything_YYYY-MM-DD_HH-MM-SS.png`
- Padding area is filled with the element's effective background color (walks up the DOM tree, falls back to system theme).
