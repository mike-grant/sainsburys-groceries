# sainsburys-groceries

Bun TypeScript CLI + agent skill for automating [Sainsbury's Groceries](https://www.sainsburys.co.uk/gol-ui/):
previous orders, delivery slot booking, basket management, and amending your upcoming order.

## How it talks to Sainsbury's

All automation rides a **real browser network stack**. Akamai (their WAF) denies:

- non-browser TLS fingerprints — plain `fetch` from Bun/Node/curl gets `403 Access Denied` at the edge
- default `HeadlessChrome` user agents — even real headless Chromium is denied until the UA is normalised

So the CLI loads the groceries SPA in a Chromium-compatible browser (local headless by
default, or a **remote CDP browser via `--ws`** — a Playwright server, or LightPanda on
`:9222`) and executes API calls as in-page `fetch()` with session cookies included.
No browser? Use `--http`, but expect edge blocks on most networks.

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
