import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_API_TARGET || "http://127.0.0.1:5052";

  return {
    plugins: [react(), {
      name: "versioned-offline-shell",
      writeBundle(options, bundle) {
        const assets = ["/index.html", "/manifest.webmanifest", ...Object.keys(bundle).filter(name => /\.(js|css|woff2?)$/.test(name)).map(name => `/${name}`)];
        const version = createHash("sha256").update(JSON.stringify(assets)).digest("hex").slice(0, 16);
        const source = readFileSync(resolve("public/sw.js"), "utf8").replace('/* BUILD_ASSETS */ []', JSON.stringify(assets)).replace("development", version);
        writeFileSync(resolve(options.dir || "dist", "sw.js"), source);
      },
    }],
    server: {
      host: "127.0.0.1",
      port: 5173,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (id.includes("react-leaflet") || id.includes("/leaflet/")) return "maps";
            if (id.includes("/gsap/")) return "animation";
            if (id.includes("react-markdown") || id.includes("remark-")) return "markdown";
            return undefined;
          },
        },
      },
    },
  };
});
