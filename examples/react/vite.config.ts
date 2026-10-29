import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

function builtPackage(relativePath: string): string {
  return fileURLToPath(new URL(`../../.tmp/build/packages/${relativePath}`, import.meta.url));
}

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@boardloom\/core$/, replacement: builtPackage("core/dist/index.js") },
      {
        find: /^@boardloom\/view-dom\/styles\.css$/,
        replacement: builtPackage("view-dom/styles.css"),
      },
      { find: /^@boardloom\/view-dom$/, replacement: builtPackage("view-dom/dist/index.js") },
      { find: /^@boardloom\/react$/, replacement: builtPackage("react/dist/index.js") },
    ],
  },
  build: {
    outDir: fileURLToPath(new URL("../../.tmp/examples/react", import.meta.url)),
    emptyOutDir: true,
  },
});
