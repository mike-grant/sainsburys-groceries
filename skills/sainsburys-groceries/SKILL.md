---
name: sainsburys-groceries
description: Automate Sainsbury's Groceries from the CLI - retrieve previous orders, book/cancel delivery slots, search products, manage the basket and amend the upcoming order. Use when the user asks about their Sainsbury's orders, delivery slots, or shopping basket. Requires Bun + Node. No browser needed after one-time auth (impersonated-TLS transport); remote CDP via --ws incl. LightPanda supported.
---

# Sainsbury's Groceries CLI

Run everything through `bun <repo>/src/index.ts` (or `bun run cli` in the repo). Add `--json` for machine-readable output on every command.

## Authentication (one-time)

Session cookies are stored at `~/.sainsburys/session.json`. Three ways to auth:

1. **Interactive login** (handles MFA; user completes login in a visible window):
   `sainsburys login`
2. **Remote browser**: `sainsburys login --ws ws://<host>:9222` (user completes login in that remote browser)
3. **Paste devtools cookies** (no browser):
   `sainsburys import-cookie-header "WC_AUTHENTICATION_...=...; JSESSIONID=..." -t <wcauthtoken>`
   Or env vars: `SAINSBURYS_COOKIE="..." SAINSBURYS_WCAUTHTOKEN="..."`.

Check health: `sainsburys whoami` or `sainsburys doctor api`.

## Commands

| Task | Command |
|---|---|
| Previous/upcoming orders | `sainsburys orders list [-n 10]` |
| Latest/next order | `sainsburys orders latest` |
| Search products | `sainsburys search "oat milk" -n 5` |
| View basket | `sainsburys basket view` |
| Add to basket | `sainsburys basket add "<query or uid>" -q 2` |
| Remove item | `sainsburys basket remove <item_uid>` |
| Amend upcoming order | `sainsburys amend add "<query or uid>" -q 2` |
| Current slot reservation | `sainsburys slots reservation` |
| List slots | `sainsburys slots list` |
| Book slot | `sainsburys slots book <slotIdOrRegex> [--dry-run]` |
| Cancel slot | `sainsburys slots cancel` |
| Test LightPanda/CDP | `sainsburys doctor lightpanda [--ws ws://127.0.0.1:9222]` |

Global flags: `--json`, `-v`, `--ws <url>` (remote CDP endpoint), `--headed`, `--http` (direct fetch; usually Akamai-blocked), `--session <path>`.

## Behavioural notes for agents

- **Amend semantics**: with a booked delivery slot, adding items amends the *upcoming order* (that is how Sainsbury's models it pre-checkout). Without a booked slot, items go to the plain basket. The CLI reports which happened (`-> next-delivery` vs `-> basket`). Never place/charge orders; checkout is intentionally out of scope.
- **Anonymous endpoints return HTTP 200 with empty payloads** — never treat status alone as success; use `whoami`/payload checks.
- **Transport**: default = impersonated-TLS sidecar (`impers` via Node, no browser, ~1s/command). `--ws <url>` switches to a remote CDP browser (Playwright server or LightPanda); `--browser` forces local Chromium; `--http` is raw fetch (Akamai-blocked on most networks). Only `login` needs a visible browser (MFA).
- **Amend semantics**: with a booked delivery slot, adding items amends the *upcoming order* (that is how Sainsbury's models it pre-checkout). Without a booked slot, items go to the plain basket. The CLI reports which happened (`-> next-delivery` vs `-> basket`). Never place/charge orders; checkout is intentionally out of scope.
- **Ambiguity**: when adding items by name, prefer showing the user top matches (`search`) before `add` if multiple plausible products exist.
- Slot booking via UI click-through is experimental; use `--dry-run` first.

## Setup

```bash
bun install          # deps
bun src/index.ts --help
```

Optional local-browser binary is auto-discovered from the Playwright cache; override with `SAINSBURYS_CHROMIUM_PATH`.
