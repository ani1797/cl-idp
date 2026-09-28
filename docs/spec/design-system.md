# Canada Life IDP Platform — Design System

This document is the source-of-truth summary for the visual design system
implemented in `apps/web`. The authoritative visual references are the
screen renders in `docs/assets/references/` (HTML + PNG, exported from the
Stitch "TEST" project). This file exists so engineers can find the token
mapping without opening a design tool.

Superseded assets from the earlier, generic indigo/navy mockups are kept
for history in `docs/assets/references-old/` — do not design against them.

## Brand colors

| Role | Hex | Tailwind token |
|---|---|---|
| Primary — Shiraz Maroon | `#A20A29` | `bg-primary` / `bg-brand-maroon` |
| Primary (pressed) | `#79001A` | `bg-brand-maroon-dark` |
| Secondary — Deep Teal | `#007F7F` | `bg-secondary` / `bg-brand-teal` |
| Secondary (pressed) | `#006565` | `bg-brand-teal-dark` |
| Tertiary — Gold | `#B08824` | `bg-brand-gold` |
| Canvas | `#FCF9EF` | `bg-background` |
| Card / panel | `#FFFFFF` | `bg-card` |
| Error | `#BA1A1A` | `bg-destructive` |

## Confidence bands

Always pair colour with an icon and a text label (WCAG 2.1 AA — never
colour alone). Implemented in `components/brand/confidence-badge.tsx`.

| Band | Range | Token |
|---|---|---|
| Passed | ≥ 95% | `confidence-pass` |
| Review / warning | 70–94% | `confidence-warn` |
| Critical | < 70% | `confidence-critical` |

## Typography

- Headlines: **Public Sans**, weight 600 (`font-heading`).
- Body / UI: **Source Sans 3**, weight 400, 14–16px (`font-sans`, the default).
- `text-label-caps`: Public Sans 700, 12px, uppercase, `0.05em` tracking —
  used for eyebrow labels, badges, and table headers.
- Numeric columns use `tabular-figures`.

## Shape & spacing

- 8px default corner radius platform-wide. `rounded-lg` in this codebase
  **is** 8px (the radius scale was remapped so shadcn's default class lands
  on the platform radius) — do not reach for `rounded-xl` expecting 8px.
- 4px spacing base. `p-gutter` = 16px, `p-margin` = 24px.
- 1440px max content width: `max-w-(--container-app)`, already applied by
  the app shell.

## Elevation

Tonal layering — white cards on the off-white canvas, 1px hairline
borders. Soft shadows are reserved for modals, dropdowns, and sticky
footers (e.g. the review workbench's action bar) — not for ordinary cards.

## Icons

Material Symbols Outlined, self-hosted as a static instance (opsz 24,
wght 400, FILL 0, GRAD 0) via `next/font/local` — see
`app/fonts/material-symbols-outlined.woff2` and `components/ui/icon.tsx`.
Never import `lucide-react`; it has been removed from the dependency tree.

## Chrome

- Persistent top bar: wordmark, environment badge, global search (visual
  only in this demo — no backend endpoint), EN|FR toggle (visual only, no
  translations wired up), notifications, user + role menu.
- Left rail: primary/secondary nav with a **4px solid `border-left` in
  `--color-primary`** marking the active item — see `components/app-shell.tsx`
  and `lib/navigation.ts`.
- Breadcrumbs with `/` separators, teal hover, derived from the pathname.

## Dark mode

The design system itself is LIGHT-only. The `.dark` block in
`app/globals.css` is a **derived** approximation (Material-3 tonal
inversion of the brand hues), not a designed variant — treat any dark-mode
visual bug as lower priority than a light-mode one, and re-derive it from
the light tokens rather than hand-tuning it further away from them.

## Where things live

| Concern | File |
|---|---|
| All colour/spacing/radius/typography tokens | `apps/web/app/globals.css` |
| Fonts | `apps/web/app/layout.tsx` |
| Icon abstraction | `apps/web/components/ui/icon.tsx` |
| Confidence badge + OCR overlay styles | `apps/web/components/brand/confidence-badge.tsx` |
| Environment badge, KPI card, section header | `apps/web/components/brand/primitives.tsx` |
| Wordmark | `apps/web/components/brand/wordmark.tsx` |
| App shell (top bar, nav, breadcrumbs) | `apps/web/components/app-shell.tsx` |
| Nav model + breadcrumb derivation | `apps/web/lib/navigation.ts` |
