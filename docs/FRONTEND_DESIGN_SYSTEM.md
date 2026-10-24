# Frontend Design System

## Brand

| Token | Hex | Use |
|---|---|---|
| `espresso` | `#110B08` | Marketing background, sidebar, primary text on ember |
| `cocoa` | `#302019` | Elevated dark surfaces, active nav |
| `cream` | `#F4E8D9` | Text on dark, security section background |
| `ember` | `#F07837` | Accent: CTAs, focus rings, highlights, chart bars (dark) |
| `ember-600` | `#D4612A` | CTA hover; focus ring on light; chart bars on light |
| `ember-700` | `#A9471A` | **Accent text on light surfaces** |
| `warm-50…900` | `#FBF8F4` … `#1B130F` | Neutral warm grays |

### Measured contrast (WCAG 2.x)

| Pair | Ratio | Rule |
|---|---|---|
| ember on espresso | 6.93 | OK for text |
| cream on espresso | 16.17 | body text |
| warm-400 on espresso | 8.46 | secondary text |
| warm-500 on dark surface | 5.76 | tertiary text |
| espresso on ember (buttons) | 6.93 | primary buttons |
| **ember on light bg** | **2.66** | **never for text**; fills and borders only |
| ember-700 on light / white | 5.50 / 5.83 | accent text on light |
| muted `#6E625A` on white | 5.90 | secondary text (light theme) |
| success / danger / warning text | 5.04 / 6.54 / 5.93 | status text on white |

## Semantic tokens (workspace)

Defined as CSS variables in `src/app/globals.css` (light default, `.dark` override) and exposed
to Tailwind via `@theme inline`: `bg`, `surface`, `surface-2`, `border`, `text`, `muted`,
`accent`, `accent-text`, `success(-bg)`, `warning(-bg)`, `danger(-bg)`, `info(-bg)`,
`--chart-1`, `--chart-2`, `--chart-grid`. Components only use semantic classes
(`bg-surface`, `text-muted`), so dark mode is one class on `<html>`.

## Typography

| Role | Family | Notes |
|---|---|---|
| Display | **Fraunces** (variable: `opsz`, `SOFT`) | Editorial serif; italic for emphasis; `clamp()` sizes up to ~8rem |
| UI | **Geist** | All interface text |
| Numbers / code | **Geist Mono** | Mono details; `.tabular` (tabular-nums) for figures |

All fonts are SIL OFL, self-hosted by `next/font` at build time (no runtime Google requests),
with `display: swap` and size-adjusted fallbacks (measured CLS ≈ 0).

## Motion

- Easing: `--ease-out-expo` `cubic-bezier(0.16,1,0.3,1)` for entrances; `--ease-in-out-quart` for loops.
- Entrances: 1.0–1.3 s expo-out, 60–90 ms stagger. Hovers: 200–500 ms.
- Only `transform` and `opacity` are animated (compositor-friendly).
- `prefers-reduced-motion: reduce`: GSAP does not register, the 3D tier is static, CSS transitions drop to 0.01 ms, and counters show final values.
- Decorative only: the cursor follower (fine pointers; native cursor kept) and magnetic CTAs (≤10 px).

## Components (`src/components/ui`, shadcn/ui pattern: owned source on Radix)

`Button` (cva variants: primary, secondary, ghost, danger, link; sizes sm, md, lg, icon),
`Card`/`CardHeader`/`CardTitle`/`CardBody`, `Badge` (tones: neutral, success, warning,
danger, info, accent), `Skeleton` (shimmer), `Input`, `Select` (native, for accessibility),
`Label`, `PageHeader`, `Dialog` (Radix: focus trap, Esc, focus return).

Dashboard vocabulary (`components/dashboard/states.tsx`): `StatePanel`, `EmptyState`,
`ErrorState` (one message per `ApiError` kind, with retry only for transient kinds), and
`InlineError` (`role="alert"`).

## Data display rules

- Money: `Intl.NumberFormat("en-IN", { style: "currency" })` from decimal **strings**, with lakh/crore grouping for INR.
- One currency at a time (radiogroup switcher); never summed across currencies.
- Units shown per unit of measure.
- Missing months shown as "No published data" / chart gaps.
- Every chart has an accessible summary and a table equivalent (Sales page).

## Accessibility checklist

- Skip link on every layout.
- One visible focus ring style.
- Landmarks: `header`, `nav` with labels, `main#main`.
- Tables have captions, `scope` attributes, and `aria-sort` on sortable headers.
- Radiogroup and tablist with arrow-key support (currency switcher, demo).
- Dialogs via Radix.
- Live regions for results and errors.
- Reveal animations never hide content from keyboard users.
- No two visible controls share one accessible name (a test caught a duplicate "Range" control, now fixed).
