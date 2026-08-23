#!/usr/bin/env node
// Runtime-agnostic launcher.
//
// Prefers the compiled build (dist/) — required for installed packages,
// because Node refuses to type-strip .ts files inside node_modules.
// Falls back to src/ (type-stripping) for dev clones running Node >= 22.18.
// koonjs is a napi-rs native module that works under both Node and Bun —
// no sidecar, no runtime split.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const target = existsSync(here + "../dist/index.js")
  ? "../dist/index.js"
  : "../src/index.ts";

await import(target);
