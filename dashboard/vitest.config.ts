import { defineConfig } from "vitest/config";

// Tests unitarios de la lógica pura del dashboard (utils y helpers sin render): entorno Node, sin jsdom. Va aparte de
// vite.config.ts para que los plugins del build (React, Tailwind) no entren en los tests ni los tests en el build.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
