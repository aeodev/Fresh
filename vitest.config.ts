import { defineConfig } from "vitest/config";

// Unit tests cover the pure logic (RBAC, chunking, retrieval, event parsing,
// turn selection, gating). They run in Node and need no Cloudflare bindings.
export default defineConfig({ test: { include: ["tests/**/*.test.ts"], environment: "node" } });
