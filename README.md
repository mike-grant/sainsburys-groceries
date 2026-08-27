# sainsburys-groceries

[![skills.sh installs](https://skills.sh/b/mike-grant/sainsburys-groceries)](https://skills.sh/mike-grant/sainsburys-groceries)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Runtime-agnostic (Node & Bun) TypeScript CLI + agent skill for automating
[Sainsbury's Groceries](https://www.sainsburys.co.uk/gol-ui/): previous orders,
delivery slot booking, basket management, and amending your upcoming order.
No browser required after one-time login.

> **Personal-use tool.** Talks to Sainsbury's unofficial internal API with your
> own account. Nothing here places orders or charges you — checkout is
> intentionally out of scope.

## Install the agent skill (one command)

Works with Claude Code, Codex, Cursor, Copilot, Windsurf, Gemini CLI, Cline,
OpenCode, Goose and more:

```bash
npx skills add mike-grant/sainsburys-groceries
```

Prefer manual? Symlink it yourself:

```bash
git clone https://github.com/mike-grant/sainsburys-groceries
./sainsburys-groceries/scripts/install-skill.sh   # links into ~/.claude/skills, ~/.agents/skills
```

Then just ask your agent: *"what did I order from Sainsbury's last week?"* or
*"add oat milk and eggs to my Sainsbury's basket"* — the SKILL.md teaches it the
exact commands and safety semantics.

## Install the CLI

```bash
npm i -g sainsburys-groceries-cli     # Node >= 20
# or zero-install per command:
npx -y sainsburys-groceries-cli search "oat milk"
# or run straight from a clone:
bun src/index.ts --help               # Bun >= 1.1
node src/index.ts --help              # same file, same features
```

## Authenticate (one-time)

```bash
sainsburys login                 # visible local window; complete MFA yourself
sainsburys login --ws ws://host:9222   # same, in a remote CDP browser
SAINSBURYS_CDP_ONLY=1 SAINSBURYS_WS=ws://127.0.0.1:9222 sainsburys whoami # Pi-safe CDP-only mode

# headless / CI — CLI fills the form itself; creds via env only (never argv):
SAINSBURYS_USERNAME=you@example.com SAINSBURYS_PASSWORD='...' sainsburys login
SAINSBURYS_USERNAME=... SAINSBURYS_PASSWORD=... sainsburys login --mfa 123456  # pre-supply OTP
# Agent-friendly MFA handoff: the process prints MFA_REQUIRED, then waits for the file
SAINSBURYS_USERNAME=... SAINSBURYS_PASSWORD=... sainsburys login --ws ws://127.0.0.1:9222 --mfa-file /tmp/sainsburys-mfa

# or, no browser at all:
sainsburys import-cookie-header "WC_AUTHENTICATION_...=...; JSESSIONID=..." -t <wcauthtoken>
# or env: SAINSBURYS_COOKIE / SAINSBURYS_WCAUTHTOKEN
```

Headless credential mode pauses for the SMS/app OTP if `--mfa` isn't given and a
terminal is attached. For Hermes or another non-interactive agent, pass
`--mfa-file <path>`: it prints `MFA_REQUIRED`, polls that file, and continues as
soon as the user/agent writes the code. On failure it saves a screenshot to
`~/.sainsburys/login-debug.png` for diagnosis.

Session persists to `~/.sainsburys/session.json` (chmod 600). Verify with
`sainsburys whoami`, re-login roughly weekly when it expires.

## Commands

| Task | Command |
|---|---|
| view one order in full | `orders view <orderId>` or `orders view latest` |
| search order history | `orders find "mushy peas" --pages 3` |
| orders history | `orders list [-n 10]` / `orders latest` |
| search | `search "oat milk" -n 5 [--json]` |
| basket | `basket view` · `basket add "milk" -q 2` · `basket remove <item_uid>` |
| amend upcoming order | `amend add "<query or uid>" -q 2` |
| slots | `slots reservation` · `slots list [-p POSTCODE]` · `slots book <id\|regex> [--dry-run]` · `slots cancel` |
| diagnostics | `doctor api` · `doctor lightpanda [--ws ws://127.0.0.1:9222]` |

Global flags: `--json -v --ws <url> --cdp-only --headed --browser --http --session <path>`.

## Amend semantics

With a booked slot, adding items amends the **upcoming order** (Sainsbury's models
pre-checkout amendments this way); without one, items go to the plain basket. The CLI
prints which target was used (`-> next-delivery` / `-> basket`). Checkout/payment is
intentionally out of scope.

## How it talks to Sainsbury's

Akamai (their WAF) denies non-browser TLS fingerprints — plain `fetch` from
Bun/Node/curl gets `403 Access Denied` at the edge — and also denies
`HeadlessChrome` user agents.

| Transport | Flag | Browser needed | Notes |
|---|---|---|---|
| **koonjs** (default) | — | **No** | Rust/BoringSSL Chrome JA3+H2 impersonation via napi-rs; native under Node & Bun |
| remote CDP page | `--ws ws://host:9222` | Remote only | In-page `fetch()` on a warmed groceries SPA page in any CDP browser incl. LightPanda |
| local Chromium page | `--browser` (+`--headed`) | Yes, local | Same as above with auto-discovered Playwright Chromium |
| raw fetch | `--http` | No | Usually edge-denied; kept for tolerant networks/proxies |

On Raspberry Pi, use `--cdp-only` with a Chromium-compatible CDP endpoint. This
prevents the CLI from trying to load the optional native `koonjs` module.

### Agent MFA handoff

The MFA code is entered into the already-running login process. Do not invoke
`login` a second time after the code arrives, because that can create a new
challenge. Start one process with a new empty file, keep it running, and have
the agent ask you for the code when it sees `MFA_REQUIRED`:

```bash
MFA_FILE=/tmp/sainsburys-mfa.$$
rm -f "$MFA_FILE"
SAINSBURYS_USERNAME=... SAINSBURYS_PASSWORD=... \
  sainsburys --cdp-only --ws "$SAINSBURYS_WS" login --mfa-file "$MFA_FILE" \
  > /tmp/sainsburys-login.log 2>&1 &
# after the agent receives the MFA code from you:
printf '%s\n' '<code>' > "$MFA_FILE"
```

The waiting process submits the code in the existing browser page, saves the
session, and subsequent CDP commands reuse it. Verify with `sainsburys --cdp-only whoami`.

In the normal mode only `login` needs a visible browser; everything else is plain
authenticated REST over an impersonated TLS session (~0.8s per command). In
`--cdp-only` mode, all commands intentionally use the CDP browser's session.

### Runtimes

One transport, no split — [`koonjs`](https://github.com/scrape-hub/koon) runs
natively under both runtimes:

| Invocation | Notes |
|---|---|
| `node src/index.ts ...` / installed bin | in-process (Node >= 20 type-stripping) |
| `bun src/index.ts ...` / `bunx --bun sainsburys` | in-process |

### Containers

No browser in the image; auth comes in via mount or env:

```dockerfile
# any node:*-slim base works; koonjs ships napi prebuilds for linux x64/arm64
RUN npm i -g sainsburys-groceries-cli
```

```bash
docker run -v ~/.sainsburys:/home/shopper/.sainsburys:ro ...          # mounted session
docker run -e SAINSBURYS_COOKIE="..." -e SAINSBURYS_WCAUTHTOKEN="..." # or env
```

Set `TZ=Europe/London` for sane slot times. Sessions/cookies are gitignored
and dockerignored.

## LightPanda

LightPanda exposes a CDP server (`lightpanda serve`, default `ws://127.0.0.1:9222`);
the CLI accepts any such endpoint via `--ws`. Test acceptance end-to-end:

```bash
bunx lightpanda serve &    # or docker run -p 9222:9222 lightpanda/browser:latest
sainsburys doctor lightpanda
```

Known caveats (see lightpanda-io/browser issues): `/json/list` may be missing,
Playwright-over-Bun WebSocket instability, no screenshots/PDF rendering.

## Tests

```bash
bun test           # offline unit tests
bun run typecheck  # tsc --noEmit
```

## Disclaimer

Unofficial, undocumented APIs — for personal use with your own account only.
Endpoints can change without notice; `doctor api` helps diagnose. Not
affiliated with Sainsbury's Supermarkets Ltd.
