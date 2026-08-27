---
name: sainsburys-groceries
description: Automate Sainsbury's Groceries from the CLI - retrieve previous orders, book/cancel delivery slots, search products, manage the basket and amend the upcoming order. Use when the user asks about their Sainsbury's orders, delivery slots, or shopping basket. Requires Node (>=20) or Bun. No browser needed after one-time auth (impersonated-TLS transport); remote CDP via --ws incl. LightPanda supported.
license: MIT
---

# Sainsbury's Groceries CLI

This skill is instructions only — the CLI is a separate one-time setup.

## First run (bootstrap)

If `sainsburys` is not on PATH, either run the bundled installer once:

```bash
bash "<this-skill-dir>/scripts/bootstrap.sh"
```

or install directly (`npm i -g sainsburys-groceries-cli`), or use npx
without installing at all by prefixing commands: `npx -y sainsburys-groceries-cli <command>`.

Requires Node.js >= 20. After setup, all commands are plain `sainsburys <command>`.

**Already cloned the repo?** You can skip the installer and run in place:

```bash
node <repo>/src/index.ts <command>   # or: bun <repo>/src/index.ts <command>
```

Add `--json` to any command for machine-readable output.

## Authentication (one-time)

Session cookies are stored at `~/.sainsburys/session.json`. Four ways to auth:

1. **Headless credential login** (servers/CI/agents — no window needed):
   ```bash
   SAINSBURYS_USERNAME=you@example.com SAINSBURYS_PASSWORD='...' sainsburys login
   # if Sainsbury's sends an MFA code, add: --mfa <code>
   # for Hermes/non-interactive use: --mfa-file /tmp/sainsburys-mfa
   ```
   Credentials are read from env only, never argv. On failure a screenshot is
   saved to `~/.sainsburys/login-debug.png`.
2. **Interactive login** (visible browser window; user completes login + MFA):
   `sainsburys login`
3. **Remote browser**: `sainsburys login --ws ws://<host>:9222`
4. **Paste devtools cookies** (no browser):
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

Global flags: `--json`, `-v`, `--ws <url>` (remote CDP endpoint), `--cdp-only`, `--headed`, `--http` (direct fetch; usually Akamai-blocked), `--session <path>`.

On Raspberry Pi, set `SAINSBURYS_CDP_ONLY=1` and `SAINSBURYS_WS=ws://127.0.0.1:9222` (or pass `--cdp-only --ws ...`) to force every API command through the CDP browser and avoid the optional native `koonjs` transport. For agent-driven MFA, use `login --mfa-file <path>`; the command emits `MFA_REQUIRED` and resumes when the file contains the one-time code.

### MFA protocol for agents (do not restart login)

MFA is a continuation of the already-running login process. Starting `login`
again will submit the credentials again and can invalidate the first code or
generate a new challenge.

1. Choose a new, empty code-file path and start exactly one login process. Keep
   it running; for a shell agent, run it in the background and retain its log:
   ```bash
   MFA_FILE=/tmp/sainsburys-mfa.$$
   rm -f "$MFA_FILE"
   SAINSBURYS_USERNAME=... SAINSBURYS_PASSWORD=... \
     sainsburys --cdp-only --ws "$SAINSBURYS_WS" login --mfa-file "$MFA_FILE" \
     > /tmp/sainsburys-login.log 2>&1 &
   ```
2. Watch the login output for `MFA_REQUIRED`. Only then ask the user for the
   code. Do not ask the user to run `login` again.
3. When the user supplies the code, write it to the same file. This releases
   the waiting process, which submits the code in the existing browser page,
   captures the authenticated cookies, and saves `session.json`:
   ```bash
   printf '%s\n' '<code from user>' > "$MFA_FILE"
   ```
4. Wait for `Session saved to ...`, then verify with `whoami`. Reuse the saved
   session and CDP endpoint for subsequent commands.

If the login process exits or times out before the code is supplied, report
that the MFA challenge expired and begin a new login deliberately. Never start
a second login while the first one is waiting for its code.

## Behavioural notes for agents

- **Auth first**: if a command fails with a session error, ask the user to complete
  `sainsburys login` before anything else; verify with `whoami`.
- **Amend semantics**: with a booked delivery slot, adding items amends the *upcoming order* (that is how Sainsbury's models it pre-checkout). Without a booked slot, items go to the plain basket. The CLI reports which happened (`-> next-delivery` vs `-> basket`). Never place/charge orders; checkout is intentionally out of scope.
- **Anonymous endpoints return HTTP 200 with guest payloads** (`user_id: -1002`) — never treat status alone as success; use `whoami`/payload checks.
- **Transport**: default = koonjs impersonated-TLS (Rust/BoringSSL, native under both Node and Bun, no browser, ~1s/command). `--ws <url>` switches to a remote CDP browser (Playwright server or LightPanda); `--browser` forces local Chromium; `--http` is raw fetch (Akamai-blocked on most networks). Only `login` needs a visible browser (MFA).
- **Ambiguity**: when adding items by name, prefer showing the user top matches (`search`) before `add` if multiple plausible products exist.
- Slot booking via UI click-through is experimental; use `--dry-run` first.
