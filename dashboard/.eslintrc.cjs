/** @type {import('eslint').Linter.Config} */
// Configuración propia del dashboard (React + Vite, navegador): `root: true` evita que herede la del
// backend de la raíz (entorno Node/Jest, sin el plugin de hooks) — esa herencia era la que hacía
// fallar los `eslint-disable react-hooks/exhaustive-deps` con "regla no encontrada".
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
  plugins: ["@typescript-eslint", "react-hooks"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended", "plugin:react-hooks/recommended"],
  env: {
    browser: true,
    es2020: true,
  },
  rules: {
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "no-console": "off",
  },
  ignorePatterns: ["dist/", "node_modules/", "src-tauri/"],
};
