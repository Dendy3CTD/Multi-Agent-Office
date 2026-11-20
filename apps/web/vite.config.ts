import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Proxy only the documented MAO Hybrid API to avoid browser CORS and keep the
// legacy MAO `/v1` service out of this app.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const apiOrigin = env.VITE_MAO_API_ORIGIN ?? process.env.VITE_MAO_API_ORIGIN ?? "http://127.0.0.1:8765";
  return ({
  plugins: [react()],
  base: "/",
  define: { "import.meta.env.VITE_MAO_TASK_WRITES_ENABLED": "false" },
  build: { rollupOptions: { output: { manualChunks(id) {
    if (id.includes("/node_modules/three/examples/jsm/")) return "three-addons";
    if (id.includes("/node_modules/three/")) return "three-core";
  } } } },
  server: { host: "127.0.0.1", port: 3333, strictPort: true, proxy: { "/mao-api": { target: apiOrigin, changeOrigin: true, rewrite: path => path.replace(/^\/mao-api/, "") } } },
  preview: { host: "127.0.0.1", port: 4333, strictPort: true },
  });
});
