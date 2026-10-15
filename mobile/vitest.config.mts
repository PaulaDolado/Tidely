import { defineConfig } from "vitest/config";

// Tests unitarios de la lógica pura de la app (utils, sync) en Node: no arrancan React Native ni Expo. Lo que dependa
// de un módulo nativo (SQLite, expo-crypto, la API...) se sustituye con vi.mock en el propio test. Metro no los ve: no
// los importa nadie desde index.ts.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
