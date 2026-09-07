import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // GitHub Pages sirve un "project site" (no un `<user>.github.io` propio) bajo un subpath
  // (`https://<user>.github.io/<repo>/`), así que los assets del build necesitan saberlo para no
  // pedir `/assets/...` (raíz) en vez de `/Life-Organizer/assets/...` — ver
  // .github/workflows/deploy-pages.yml, que es quien fija `VITE_BASE_PATH` en el build de CI.
  // El resto de destinos (Vercel/Render/preview local) sirven desde la raíz, de ahí el default "/".
  base: process.env.VITE_BASE_PATH || "/",
  server: {
    port: 5173,
  },
});
