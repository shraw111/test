import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error plain ESM script without types
import { startPreviewServer } from "./scripts/serve-preview.mjs";

// Serves the preview origin (preview/dist) on its own port alongside the app,
// so `npm run dev` is one command. Separate port = separate origin.
function previewOrigin(): Plugin {
  let started = false;
  const start = async () => {
    if (started || process.env.VITE_PREVIEW_URL) return;
    started = true;
    await startPreviewServer();
  };
  return {
    name: "preview-origin",
    configureServer: start,
    configurePreviewServer: start,
  };
}

export default defineConfig({
  plugins: [react(), previewOrigin()],
  server: { port: 5180, strictPort: true },
  preview: { port: 5180, strictPort: true },
  worker: { format: "es" },
});
