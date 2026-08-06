# Framer editable UI (portal transfer)

## Goal

Owner edits **form, text, fonts, buttons, add/remove blocks** in Framer (and with the agent), not only colors.

## Rule

| Layer | Who edits | How |
|-------|-----------|-----|
| Page chrome (Desktop, Top Bar, footer) | Owner / Framer | Native layers |
| Page title (H1) | Owner / Framer | Native **Text** — never replace with code |
| Static copy, decorative buttons | Owner / Framer | Native Text / Button / Stack |
| Live data (login, KPIs, tables) | Code components | Small widgets + **property controls** |

**Never** put the whole page inside one opaque React tree if the owner must redesign freely.

## Edit modes

### A — Framer layers (full freedom)

Add / delete / restyle Text, frames, images, native buttons. Agent uses `updateXmlForNode` **only** on those nodes; never `deleteNode` on design without permission.

### B — Property panel on code components

Every visible string, font size, gap, and **Show X** toggle is a control. Hiding a button = uncheck control (same as remove from product UI without breaking code).

### C — Agent session

Owner says “change label / remove Refresh / bigger title”. Agent updates either native XML or control defaults — **does not wipe hero**.

## Component split (target)

| Code file | Responsibility |
|-----------|----------------|
| `AstCabinetSignIn` | Modal login only (on demand) |
| `AstCabinetPage` | Dashboard body: KPIs + processes + action buttons (all labels controllable) |
| `AstNodeChainPage` | Journal body under native title |
| Future `AstTokenization*` | Wizard steps under native title |

## Agent hard rules

1. Title stays Framer Text.  
2. Code sits **under** title in Sections.  
3. No full-page login.  
4. Prefer new controls over hard-coded English.  
5. No `deleteNode` on owner design.

## Public demo

HTTPS `PUBLIC_EDGE` for Framer; refresh with `bash scripts/framer-api-tunnel.sh` when tunnel URL changes.
