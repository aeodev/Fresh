import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The UI is a plain React SPA. `vite build` writes dist/client, which the
// Worker serves as static assets; every /api/* request goes to the Worker.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist/client", emptyOutDir: true },
  server: { proxy: { "/api": "http://localhost:8787" } },
});
