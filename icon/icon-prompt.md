# mikoshidb.net — Favicon Design Prompt

## Context

**mikoshidb.net** is a fictional terminal interface for **Mikoshi** — Arasaka Corporation's soul-prison server from the _Cyberpunk 2077_ universe. Mikoshi is a cyberspace construct deep in the Net where digitised human consciousnesses (engrams) are stored. The aesthetic is cold, corporate, and Japanese-gothic: Arasaka's brutal precision meets the neon decay of the Net.

---

## Design Language

| Element          | Value                                            |
| ---------------- | ------------------------------------------------ |
| Background       | Near-black `#06060f` — deep digital void         |
| Primary accent   | Arasaka red `#c8001e` — danger, authority, blood |
| Secondary accent | Cyan `#00d4ff` — the Net, data streams, ICE      |
| Typography       | Monospace / Courier — terminal readout aesthetic |
| Geometry         | Sharp, rectilinear, no organic curves            |
| Mood             | Corporate surveillance + cyberspace horror       |

---

## Icon Concept

A **stylised torii gate** rendered in geometric blocks (no curves), centred in a dark square canvas:

- The torii reads as both a **Japanese gate** (Arasaka's identity) and a **portal into cyberspace** (Mikoshi's function — crossing over into digital death)
- **Arasaka red** pillars and crossbeams, with a slight bloom/glow
- A **cyan horizontal scanline** beneath the gate — the surface of the Net
- Subtle **hexagonal border** in dim red — Mikoshi's containment geometry
- A faint **data stream** descending through the gate's centre — engrams falling in
- Corner **data brackets** `⌐ ¬` in cyan — terminal UI chrome
- Optional footer text: `MIKOSHI` in small spaced monospace red lettering

---

## Generation Instructions

When prompting an LLM or image model:

```
Generate a favicon/icon SVG (512x512 viewBox) for mikoshidb.net.

Theme: Cyberpunk corporate terminal — Arasaka Corporation's Mikoshi soul-server.
Style: Geometric, dark, cold. No gradients on main shapes. Sharp edges only.

Design:
- Dark near-black background (#06060f)
- Centred torii gate shape in Arasaka red (#c8001e), drawn as rectangles/polygons only (no curves)
  - Two vertical pillars, one wide horizontal top beam (slightly trapezoid), one lower horizontal beam
- Faint hexagonal border in dim red (#8b0000, low opacity)
- Thin cyan (#00d4ff) horizontal line beneath the gate base, with a soft glow filter
- Faint grid lines in the background (cyan, very low opacity ~0.1)
- Corner bracket decorations in cyan (⌐ shape, 4 corners)
- Small vertical data stream (stacked cyan rectangles, varying opacity) through gate centre
- Optional: the word "MIKOSHI" in small spaced monospace text at the bottom, in red

Do not use: organic curves, gradients on structural elements, bright white, logos, photography references.
Output: valid SVG only, no explanation.
```

---

## Files

| File          | Purpose                                |
| ------------- | -------------------------------------- |
| `icon.svg`    | Master scalable icon (512×512 viewBox) |
| `favicon.ico` | Multi-resolution ICO (16/32/48/256px)  |

Place `favicon.ico` in the web root. Reference `icon.svg` in `<head>` for high-res contexts:

```html
<link rel="icon" type="image/x-icon" href="/favicon.ico" />
<link rel="icon" type="image/svg+xml" href="/icon.svg" />
<link rel="apple-touch-icon" href="/icon.svg" />
```
