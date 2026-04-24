import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    proxy: {
      "/image-proxy": "https://api.gettaskagent.com",
      "/meshy-assets": {
        target: "https://assets.meshy.ai",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/meshy-assets/, ""),
      },
    },
    host: "::",
    port: 2000,
    // Required for SharedArrayBuffer used by web-ifc multi-threaded WASM
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(
    Boolean
  ),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Tell Vite to treat .wasm files as static assets (served as-is)
  assetsInclude: ["**/*.wasm"],
  optimizeDeps: {
    // Exclude ThatOpen packages from pre-bundling — they ship ESM workers
    // that Vite's CJS transform would break
    exclude: [
      "@thatopen/components",
      "@thatopen/components-front",
      "@thatopen/fragments",
      "web-ifc",
    ],
  },
}));

