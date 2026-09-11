import { defineConfig } from "vite";

// Served behind Home Assistant Ingress under a dynamic prefix, so every URL the bundle emits must be
// relative to the page (base "./"), and the app talks to the API with relative paths as well.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8099",
      "/ws": { target: "ws://127.0.0.1:8099", ws: true },
      "/status": "http://127.0.0.1:8099",
    },
  },
});
