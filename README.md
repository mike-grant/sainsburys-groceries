# sainsburys-groceries

Runtime-agnostic (Node & Bun) TypeScript CLI + agent skill for automating
[Sainsbury's Groceries](https://www.sainsburys.co.uk/gol-ui/): previous orders,
delivery slot booking, basket management, and amending your upcoming order.

## Runtimes: Node & Bun

One transport, no split. [`koonjs`](https://github.com/scrape-hub/koon) (Rust +
BoringSSL via napi-rs) reproduces Chrome's TLS/HTTP-2 fingerprints and runs
natively under **both** Node and Bun — single process either way, ~0.8s/command.

| Invocation | Notes |
|---|---|
| `node src/index.ts ...` / installed bin | in-process |
| `bun src/index.ts ...` / `bunx --bun sainsburys` | in-process |

Requirements: Node >= 22.18 or Bun >= 1.1.

## Installing in containers

No browser is needed in the image — auth cookies come in via mount or env:

```dockerfile
# any node:*-slim base works; koonjs ships napi prebuilds for linux x64/arm64
RUN npm i -g sainsburys-groceries-cli
```

Auth options inside the container:

```bash
# 1) mount a session file prepared on your Mac (one-time `sainsburys login`)
docker run -v ~/.sainsburys:/home/shopper/.sainsburys:ro ...

# 2) env vars (CI-friendly)
docker run -e SAINSBURYS_COOKIE="WC_AUTHENTICATION_...=...; JSESSIONID=..." \
           -e SAINSBURYS_WCAUTHTOKEN="..." ...
```

Set `TZ=Europe/London` for sane slot times. Sessions/cookies are gitignored
and dockerignored.

## How it talks to Sainsbury's

Akamai (their WAF) denies non-browser TLS fingerprints — plain `fetch` from Bun/Node/curl
gets `403 Access Denied` at the edge — and also denies `HeadlessChrome` user agents.

The CLI therefore offers these transports:

| Transport | Flag | Browser needed | Notes |
|---|---|---|---|
| **koonjs** (default) | — | **No** | Rust/BoringSSL Chrome JA3+H2 impersonation, cookie jar; native under Node & Bun |
| remote CDP page | `--ws ws://host:9222` | Remote only | In-page `fetch()` on a warmed groceries SPA page in any CDP browser incl. LightPanda |
| local Chromium page | `--browser` (+`--headed`) | Yes, local | Same as above with auto-discovered Playwright Chromium |
| raw fetch | `--http` | No | Usually edge-denied; kept for tolerant networks/proxies |

Only `login` needs a visible browser (you type credentials + MFA). Everything else is
plain authenticated REST over an impersonated TLS session.

## Install

```bash
bun install
bun src/index.ts --help        # or: bun link && sainsburys --help
```

## Authenticate (one-time)

```bash
sainsburys login                 # visible local window; complete MFA yourself
sainsburys login --ws ws://host:9222   # same, in a remote CDP browser
# or, no browser:
sainsburys import-cookie-header "WC_AUTHENTICATION_...=...; JSESSIONID=..." -t <wcauthtoken>
# or env: SAINSBURYS_COOKIE / SAINSBURYS_WCAUTHTOKEN
```

Session persists to `~/.sainsburys/session.json` (chmod 600). Check with `whoami`.

## Commands

| Task | Command |
|---|---|
| orders history | `orders list [-n 10]` / `orders latest` |
| search | `search "oat milk" -n 5 [--json]` |
| basket | `basket view` · `basket add "milk" -q 2` · `basket remove <item_uid>` |
| amend upcoming order | `amend add "<query or uid>" -q 2` |
| slots | `slots reservation` · `slots list [-p POSTCODE]` · `slots book <id\|regex> [--dry-run]` · `slots cancel` |
| diagnostics | `doctor api` · `doctor lightpanda [--ws ws://127.0.0.1:9222]` |

Global flags: `--json -v --ws <url> --headed --http --session <path>`.

## Amend semantics

With a booked slot, adding items amends the **upcoming order** (Sainsbury's models
pre-checkout amendments this way); without one, items go to the plain basket. The CLI
prints which target was used (`-> next-delivery` / `-> basket`). Checkout/payment is
intentionally out of scope.

## LightPanda

LightPanda exposes a CDP server (`lightpanda serve`, default `ws://127.0.0.1:9222`);
the CLI accepts any such endpoint via `--ws`. Test acceptance end-to-end:

```bash
bunx lightpanda serve &    # or docker run -p 9222:9222 lightpanda/browser:latest
sainsburys doctor lightpanda
```

Known caveats (see lightpanda-io/browser issues): `/json/list` may be missing,
Playwright-over-Bun WebSocket instability, no screenshots/PDF rendering.

## Agent skill

```bash
./scripts/install-skill.sh   # symlinks into ~/.claude/skills and ~/.agents/skills
```

## Tests

```bash
bun test          # offline unit tests
bun run typecheck # tsc --noEmit
```

Unofficial, undocumented APIs — for personal use with your own account. Endpoints can
change without notice; `doctor api` helps diagnose.
