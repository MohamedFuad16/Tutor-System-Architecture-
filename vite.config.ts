import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { defineConfig, type Plugin } from "vite";

const deferredPreloadChunks = [
  /vendor-mermaid/,
  /vendor-pdf/,
  /vendor-charts/,
  /vendor-shiki/,
];

// pdf.js needs its cMaps (CJK character maps) and standard fonts served as
// static files or Japanese/Chinese/Korean PDFs render without any text. This
// serves them from node_modules in dev and copies them into dist on build.
const pdfjsAssetsPlugin = (): Plugin => {
  const require = createRequire(import.meta.url);
  const pdfjsRoot = path.dirname(
    require.resolve("pdfjs-dist/package.json"),
  );
  const assetDirs = ["cmaps", "standard_fonts"] as const;
  let outDir = "dist";

  return {
    name: "pdfjs-static-assets",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || "").split("?")[0];
        const match = url.match(/^\/pdfjs-assets\/(cmaps|standard_fonts)\/(.+)$/);
        if (!match) return next();
        const filePath = path.join(
          pdfjsRoot,
          match[1],
          path.normalize(match[2]).replace(/^(\.\.[/\\])+/, ""),
        );
        if (!filePath.startsWith(path.join(pdfjsRoot, match[1]))) {
          res.statusCode = 403;
          return res.end();
        }
        fs.readFile(filePath, (error, data) => {
          if (error) {
            res.statusCode = 404;
            return res.end();
          }
          res.setHeader("Content-Type", "application/octet-stream");
          res.setHeader("Cache-Control", "public, max-age=86400");
          res.end(data);
        });
      });
    },
    closeBundle() {
      for (const dir of assetDirs) {
        const source = path.join(pdfjsRoot, dir);
        const target = path.join(process.cwd(), outDir, "pdfjs-assets", dir);
        if (!fs.existsSync(source)) continue;
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.cpSync(source, target, { recursive: true });
      }
    },
  };
};

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), pdfjsAssetsPlugin()],
    resolve: {
      alias: {
        "@": path.resolve(process.cwd(), "./src"),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== "true",
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === "true" ? null : {},
    },
    build: {
      chunkSizeWarningLimit: 3000,
      modulePreload: {
        resolveDependencies: (_filename, deps) =>
          deps.filter(
            (dependency) =>
              !deferredPreloadChunks.some((pattern) =>
                pattern.test(dependency),
              ),
          ),
      },
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (!id.includes("node_modules")) return undefined;
            if (
              id.includes("/react/") ||
              id.includes("/react-dom/") ||
              id.includes("/scheduler/")
            ) {
              return "vendor-react";
            }
            if (id.includes("react-pdf") || id.includes("pdfjs-dist")) {
              return "vendor-pdf";
            }
            if (id.includes("mermaid")) return "vendor-mermaid";
            if (id.includes("shiki") || id.includes("@shikijs")) {
              return "vendor-shiki";
            }
            if (
              id.includes("react-markdown") ||
              id.includes("remark-") ||
              id.includes("micromark") ||
              id.includes("unified") ||
              id.includes("mdast") ||
              id.includes("hast") ||
              id.includes("vfile")
            ) {
              return "vendor-markdown";
            }
            if (id.includes("motion")) return "vendor-motion";
            if (id.includes("dexie")) return "vendor-dexie";
            if (id.includes("recharts") || id.includes("/d3")) {
              return "vendor-charts";
            }
            return undefined;
          },
        },
      },
    },
  };
});
