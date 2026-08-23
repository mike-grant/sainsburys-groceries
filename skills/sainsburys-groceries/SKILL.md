---
name: sainsburys-groceries
description: Automate Sainsbury's Groceries from the CLI - retrieve previous orders, book/cancel delivery slots, search products, manage the basket and amend the upcoming order. Use when the user asks about their Sainsbury's orders, delivery slots, or shopping basket. Requires Node (>=22.18) or Bun. No browser needed after one-time auth (impersonated-TLS transport); remote CDP via --ws incl. LightPanda supported.
license: MIT
---

# Sainsbury's Groceries CLI

This skill is instructions only — the CLI is a separate one-time setup.

## First run (bootstrap)

If `sainsburys` is not on PATH, run the bundled installer once:

```bash
bash "<this-skill-dir>/scripts/bootstrap.sh"
```

It installs the CLI globally via npm (`npm i -g github:mike-grant/sainsburys-groceries`).
Requires Node.js >= 22.18. After that, all commands are plain `sainsburys <command>`.

**Already cloned the repo?** You can skip the installer and run in place:

```bash
node <repo>/src/index.ts <command>   # or: bun <repo>/src/index.ts <command>
```

Add `--json` to any command for machine-readable output.

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

- **Auth first**: if a command fails with a session error, ask the user to complete
  `sainsburys login` before anything else; verify with `whoami`.
- **Amend semantics**: with a booked delivery slot, adding items amends the *upcoming order* (that is how Sainsbury's models it pre-checkout). Without a booked slot, items go to the plain basket. The CLI reports which happened (`-> next-delivery` vs `-> basket`). Never place/charge orders; checkout is intentionally out of scope.
- **Anonymous endpoints return HTTP 200 with guest payloads** (`user_id: -1002`) — never treat status alone as success; use `whoami`/payload checks.
- **Transport**: default = koonjs impersonated-TLS (Rust/BoringSSL, native under both Node and Bun, no browser, ~1s/command). `--ws <url>` switches to a remote CDP browser (Playwright server or LightPanda); `--browser` forces local Chromium; `--http` is raw fetch (Akamai-blocked on most networks). Only `login` needs a visible browser (MFA).
- **Ambiguity**: when adding items by name, prefer showing the user top matches (`search`) before `add` if multiple plausible products exist.
- Slot booking via UI click-through is experimental; use `--dry-run` first.
