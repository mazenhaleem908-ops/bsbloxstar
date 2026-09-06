import path from "node:path";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

// Standalone BloxStar build (Vercel target). No external build wrappers.
export default defineConfig({
  server: { port: 8080, host: true, strictPort: true },
  preview: { port: 8080, host: true },
  resolve: {
    alias: [
      { find: /^@\/lib\//, replacement: path.resolve(import.meta.dirname, "lib") + "/" },
      { find: /^@\//, replacement: path.resolve(import.meta.dirname, "src") + "/" },
    ],
    dedupe: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-query"],
  },
  plugins: [
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tailwindcss(),
    // Redirect TanStack Start's bundled server entry to src/server.ts (SSR error wrapper).
    tanstackStart({ server: { entry: "server" } }),
    nitro({ preset: "vercel" }),
    viteReact(),
  ],
});
