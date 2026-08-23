#!/usr/bin/env node
// Runtime-agnostic launcher: runs the TypeScript via type-stripping under
// Node (>=22.18), or directly under Bun (`bun sainsburys`). The koonjs
// transport is a napi-rs native module that works on both — no sidecar.
import("../src/index.ts");
