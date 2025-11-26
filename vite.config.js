import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  root: ".",
  resolve: {
    alias: {
      buffer: "buffer",
    },
  },
  define: {
    global: "window",
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: path.resolve(__dirname, "index.html"),
    },
  },
  server: {
    port: 5173,
  },
});