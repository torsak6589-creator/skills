# Export VDO Presentation — for `KST Procurement Review Aug 2569.dc.html`

A dependency-free module that adds an **"Export VDO"** control to a Claude
Design deck. It plays the deck through every slide and downloads the result as
a video file — `.mp4` on browsers whose `MediaRecorder` supports the MP4/H.264
codec, otherwise `.webm`.

> **Why this is a portable module, not an in-place edit.** This Claude Code Web
> session could not authenticate to the Claude Design project
> (`/design-login` needs an interactive terminal) and the project files
> (`KST Procurement Review Aug 2569.dc.html`, `deck-stage.js`, `support.js`)
> were never seeded into the workspace. Rather than guess at private
> `deck-stage.js` internals, this module **discovers** the deck's slides and
> navigation at runtime, so it drops into the deck unchanged. To integrate it,
> paste the snippet below into the deck (see **Wiring**).

## Wiring

Add the script to the deck's `.dc.html`, just before `</body>`:

```html
<!-- Export VDO Presentation -->
<script>
  // Optional overrides — set BEFORE the module loads.
  window.KST_VDO_CONFIG = {
    perSlideMs: 4500,        // hold time per slide while recording
    fps: 30,
    fileName: "KST-Procurement-Review-Aug-2569",
    // slideSelector: ".dc-artboard",  // set if auto-detection misses
    // stageSelector: "#deck-stage",
    // captureMode: "display",         // 'display' | 'canvas' | 'auto'
  };
</script>
<script src="deck-export-vdo.js"></script>
```

If the deck bundles all assets inline, paste the contents of
`deck-export-vdo.js` inside a `<script>` tag instead of linking the file.

That's it — a floating **● Export VDO** button appears bottom-right.

## How it captures

Two strategies, chosen automatically (`captureMode: "auto"`):

1. **`display`** — `getDisplayMedia` (tab capture). Highest fidelity: records
   exactly what is painted, including web fonts, images, gradients, and CSS
   transitions. The browser asks the viewer to pick a surface once; they should
   choose **this tab**. On Chromium, `preferCurrentTab` pre-selects it.
2. **`canvas`** — serializes each slide to an SVG `<foreignObject>`, paints it
   onto a `<canvas>`, and records `canvas.captureStream()`. No permission
   prompt, but it **cannot paint cross-origin images** and covers less CSS. Used
   automatically when display capture is blocked or cancelled.

Force one with `captureMode: "display"` or `"canvas"`.

## Auto-detection

The module looks for the deck's navigation in this order:

1. A deck-stage global (`window.deck` / `window.stage` / …) exposing a
   `goTo`/`showSlide`/`select`-style method and a slide count.
2. Slide DOM elements (`[data-slide]`, `.dc-artboard`, `.artboard`, `.slide`,
   …), navigated by scroll-into-view + active-class toggling + arrow-key events.

If it can't find the slides, it says so and asks you to set `slideSelector`.
Inspect the deck in devtools, find the repeating slide element, and set:

```js
window.KST_VDO_CONFIG = { slideSelector: "YOUR_SLIDE_SELECTOR" };
```

## Config reference

| Key | Default | Meaning |
|---|---|---|
| `perSlideMs` | `4500` | Hold time per slide (ms) |
| `leadInMs` / `leadOutMs` | `800` / `1200` | Extra hold on first / last slide |
| `fps` | `30` | Capture frame rate |
| `captureMode` | `"auto"` | `"auto"` \| `"display"` \| `"canvas"` |
| `stageSelector` | auto | Deck container element |
| `slideSelector` | auto | Per-slide element |
| `fileName` | `KST-Procurement-Review-Aug-2569` | Download name (no extension) |
| `videoBitsPerSecond` | `8_000_000` | Recording bitrate |
| `mimeCandidates` | mp4 → webm list | First supported codec wins |
| `mountButton` | `true` | Auto-mount the floating button |

Programmatic trigger (e.g. from your own button):

```js
window.KSTExportVDO();
```

## Browser support & limits

- `MediaRecorder` MP4/H.264 output is currently Chromium/Safari-dependent;
  elsewhere the file is `.webm` (VP9/VP8). The extension is chosen from the
  actual recorded MIME type.
- **Sandboxed iframes** (including some embed contexts) may block
  `getDisplayMedia` via permissions policy. The canvas fallback still works
  there, minus cross-origin images.
- Keep the tab foregrounded during a `display` recording — background tabs
  throttle timers and animation.

## Verify before shipping

This module was authored without access to the live deck, so confirm in the
real `.dc.html`:

1. The button appears and, on click, the deck steps through **all** slides.
2. Auto-detection found every slide (watch the "slide i / N" status). If N is
   wrong, set `slideSelector`.
3. The downloaded file plays start-to-finish with the expected slides.
