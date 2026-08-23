#!/usr/bin/env node
// Runtime-agnostic launcher.
//
// - Under Node (>=22.18): runs the TypeScript directly via type-stripping and
//   loads impers in-process (single process, no sidecar).
// - Under Bun (`bun sainsburys` or `bunx --bun sainsburys`): koffi's NAPI
//   bindings crash inside Bun, so src/index.ts automatically spawns a Node
//   sidecar for the impersonated-TLS transport instead. Node must be on PATH.
import("../src/index.ts");
