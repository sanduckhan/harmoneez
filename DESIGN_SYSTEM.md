# Harmoneez Design System

## Aesthetic Direction: Analog Studio

Inspired by vintage recording consoles, VU meters, and rack-mounted gear — warm and characterful, not cold and clinical. The interface should feel like a modern tool built by musicians for musicians, with the warmth of analog equipment rendered in crisp digital form.

---

## Color Palette

### Backgrounds (darkest to lightest)
| Token | Hex | Usage |
|-------|-----|-------|
| `--bg-deep` | `#06060a` | Page background |
| `--bg-panel` | `#0d0d14` | Cards, panels, containers |
| `--bg-surface` | `#141420` | Inputs, nested elements |
| `--bg-elevated` | `#1a1a2a` | Hover states, elevated surfaces |

### Borders
| Token | Hex | Usage |
|-------|-----|-------|
| `--border` | `#1e1e30` | Default borders, dividers |
| `--border-highlight` | `#2a2a40` | Hover borders, active states |

### Text
| Token | Hex | Usage |
|-------|-----|-------|
| `--text-primary` | `#e8e6f0` | Headings, primary content |
| `--text-secondary` | `#8b87a0` | Labels, descriptions |
| `--text-muted` | `#4a4660` | Hints, disabled text, metadata |

### Accent: Amber (Primary)
The warm amber is the signature color — it references VU meter needles, tube glow, and studio indicator lights.

| Token | Hex | Usage |
|-------|-----|-------|
| `--amber` | `#f5a623` | Primary actions, active states, emphasis |
| `--amber-glow` | `#f5a62340` | Box shadows, hover glows |
| `--amber-dim` | `#c4841c` | Partially active states |
| `--amber-bright` | `#ffc04d` | Highlights, important values |

### Accent: Teal (Secondary)
Used for status indicators and success states — like a "signal present" LED.

| Token | Hex | Usage |
|-------|-----|-------|
| `--teal` | `#2dd4a8` | Status LEDs, success indicators |
| `--teal-glow` | `#2dd4a830` | LED glow effect |

### Accent: Red (Error)
| Token | Hex | Usage |
|-------|-----|-------|
| `--red` | `#ef4444` | Error states, warnings |
| `--red-glow` | `#ef444430` | Error backgrounds |

---

## Typography

### Font Stack
| Role | Font | Fallback |
|------|------|----------|
| **Brand/Logo** | Instrument Serif | Georgia, serif |
| **Data/Technical** | JetBrains Mono | ui-monospace, Consolas, monospace |
| **Body/UI** | DM Sans | system-ui, sans-serif |

### Usage Rules
- **Instrument Serif**: Logo only. Never use for body text or labels.
- **JetBrains Mono (font-mono)**: Time codes, key names, step counters, status text, section labels, button text (uppercase). This is the workhorse font.
- **DM Sans**: Body text, descriptions, paragraphs. Rarely seen in the current UI since most text is technical/data.

### Label Style
Section labels follow a consistent pattern:
```
text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)]
```
Example: `KEY`, `PITCH CORRECT`, `HARMONY VOL`, `SECTION`, `WAVEFORM`

### Data Values
Technical values (time, percentages, key names) are always monospace with tabular numerals:
```
font-mono text-sm tabular-nums text-[var(--amber)]
```

---

## Components

### Panel
The base container. Mimics a rack-mounted gear panel.
```
rounded-lg border border-[var(--border)] bg-[var(--bg-panel)]
```
Panels with a header strip:
```
Header: px-4 py-2 border-b border-[var(--border)] bg-[var(--bg-surface)]
Body: p-4
```

### Channel Strip Settings
Multi-column settings use a grid with 1px gap borders (like mixer channel strips):
```
grid grid-cols-4 gap-px bg-[var(--border)] rounded-lg overflow-hidden border border-[var(--border)]
Each cell: bg-[var(--bg-panel)] p-4
```

### LED Status Indicator
A small colored dot with glow, used to show state:
```
Active:   w-2 h-2 rounded-full bg-[var(--teal)] shadow-[0_0_6px_var(--teal)]
Inactive: w-2 h-2 rounded-full bg-[var(--text-muted)]
Warning:  w-2 h-2 rounded-full bg-[var(--amber)] shadow-[0_0_6px_var(--amber)]
Error:    w-2 h-2 rounded-full bg-[var(--red)]
```

### Toggle Switch
Custom on/off toggle (not a checkbox):
```
Container: w-12 h-6 rounded-full
On:  bg-[var(--amber)] shadow-[0_0_10px_var(--amber-glow)]
Off: bg-[var(--bg-surface)] border border-[var(--border-highlight)]
Thumb: w-5 h-5 rounded-full, slides left/right
```

### Buttons

**Primary (Generate, Export):**
```
bg-[var(--amber)] text-[var(--bg-deep)] font-mono uppercase tracking-widest font-bold
Hover: shadow-[0_0_30px_var(--amber-glow)] brightness-110
```

**Secondary (Play, settings):**
```
bg-[var(--bg-surface)] border border-[var(--border-highlight)] text-[var(--text-secondary)]
Hover: border-[var(--amber)]/50 shadow-[0_0_12px_var(--amber-glow)]
```

**Ghost (New Session, Select All):**
```
text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]
Hover: text-[var(--amber)]
```

### Play/Pause Icons
Built with CSS borders (no icon library):
```
Play:  w-0 h-0 border-l-[8px] border-l-[var(--amber)] border-y-[5px] border-y-transparent
Pause: w-3 h-3 border-l-2 border-r-2 border-[var(--amber)]
```

### Interval Card
Cards for each harmony variant in the results grid:
```
Default:  border-[var(--border)] bg-[var(--bg-panel)]
Playing:  border-[var(--amber)] bg-[var(--amber-glow)] shadow-[0_0_20px_var(--amber-glow)]
Selected: ring-1 ring-[var(--amber)]/50
```

### Mode Toggle (MIX / SOLO)
Segmented control inside interval cards:
```
Container: bg-[var(--bg-surface)] border border-[var(--border)] text-[10px] font-mono
Active:    bg-[var(--amber)] text-[var(--bg-deep)] font-semibold
Inactive:  text-[var(--text-muted)]
```

### Progress Bar
Segmented (one segment per pipeline step), not continuous:
```
Completed: bg-[var(--amber)] shadow-[0_0_4px_var(--amber-glow)]
Current:   bg-[var(--amber-dim)]
Pending:   bg-[var(--border)]
```

### Range Slider
Custom styled — amber thumb with glow:
```
Track: h-1 bg-[var(--border)]
Thumb: w-3.5 h-3.5 rounded-full bg-[var(--amber)] shadow-[0_0_8px_var(--amber-glow)]
```

---

## Layout

### Page Structure
```
max-w-4xl mx-auto px-4 py-10
```
Narrow, focused layout. Not full-width — this is a single-task tool.

### Spacing
- Between major sections: `space-y-6`
- Between panels within a section: `space-y-4`
- Within panels: `p-4`

### Dividers
Gradient fade dividers between major sections:
```
h-px bg-gradient-to-r from-transparent via-[var(--border-highlight)] to-transparent
```

---

## Textures & Effects

### Noise Grain
Subtle analog noise overlay on the entire page:
```css
body::after {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9999;
  opacity: 0.025;
  background-image: url("data:image/svg+xml,...feTurbulence...");
}
```

### Ambient Glow
Subtle amber glow at the top of the page:
```
fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[200px]
bg-[var(--amber)] opacity-[0.02] blur-[100px]
```

### Corner Accents
Rack-gear inspired corner marks on the upload zone:
```
absolute w-4 h-4 border-l border-t border-[var(--border-highlight)] rounded-tl opacity-40
```

---

## Animations (Motion library)

### Page Enter
Elements stagger in with `initial={{ opacity: 0, y: 10-20 }}`:
- Header: delay 0
- Upload zone: delay 0.2
- Work area sections: delay 0

### Result Cards
Stagger: `delay: index * 0.05` for the interval cards grid

### Processing Pulse
Amber dot pulses during processing:
```
animate={{ opacity: [1, 0.3, 1] }}
transition={{ repeat: Infinity, duration: 1.5 }}
```

### Loading Spinner
Simple rotating ring:
```
animate={{ rotate: 360 }}
transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
w-5 h-5 border-2 border-[var(--amber)] border-t-transparent rounded-full
```

### VU Meter Needle (Upload Zone)
Spring animation responding to drag state:
```
animate={dragging ? { rotate: 30 } : { rotate: -30 }}
transition={{ type: 'spring', stiffness: 200 }}
```

---

## Waveform (WaveSurfer.js)

| Property | Value |
|----------|-------|
| `waveColor` | `#4a4660` (--text-muted) |
| `progressColor` | `#f5a623` (--amber) |
| `cursorColor` | `#f5a623` (--amber) |
| `cursorWidth` | `1` |
| `height` | `100` |
| `barWidth` | `2` |
| `barGap` | `1` |
| `barRadius` | `1` |
| Region selection color | `rgba(245, 166, 35, 0.12)` |

---

## Don'ts

- No purple. The old purple-on-gray was generic. Amber is our identity.
- No emoji in the UI (the VU meter icon replaces the old microphone emoji).
- No generic gray backgrounds (`bg-gray-800`, `bg-gray-900`). Use the CSS variable tokens.
- No system fonts or Inter/Roboto. DM Sans for body, JetBrains Mono for data, Instrument Serif for brand.
- No continuous progress bars. Use segmented bars that show distinct pipeline steps.
- No heavy borders or box shadows on panels. Borders are `1px` and subtle.
- No text larger than the logo. The UI is information-dense, not billboard-style.
