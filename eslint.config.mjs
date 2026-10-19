// Lint de Hilván: lo recomendado de ESLint más unas reglas contra el código descuidado (funciones demasiado enrevesadas,
// código duplicado, console olvidado, ciclos de import). Lo que ahora es aviso pasa a error cuando el código esté limpio.
import js from "@eslint/js";
import globals from "globals";
import sonarjs from "eslint-plugin-sonarjs";
import importPlugin from "eslint-plugin-import-x";

export default [
  { ignores: ["node_modules/", "**/.wrangler/"] },
  js.configs.recommended,
  // el campo corre en el navegador (dentro del panel); el servidor, en Workers (fetch, Request, crypto…)
  { files: ["plugin/**/*.js"], languageOptions: { sourceType: "script", globals: globals.browser } },
  { files: ["worker/**/*.js"], languageOptions: { globals: globals.serviceworker } },
  { files: ["test/**/*.mjs", "scripts/**/*.mjs", "*.mjs"], languageOptions: { globals: globals.node } },
  {
    plugins: { sonarjs, import: importPlugin },
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
      "sonarjs/cognitive-complexity": ["error", 15],
      "sonarjs/no-identical-functions": "error",
      "sonarjs/no-duplicate-string": ["warn", { threshold: 5 }],
      "import/no-cycle": ["error", { maxDepth: 6 }],
    },
  },
  {
    // las pruebas y los scripts de la CI escriben por consola y repiten textos a propósito
    files: ["test/**", "scripts/**"],
    rules: { "no-console": "off", "sonarjs/no-duplicate-string": "off", "sonarjs/cognitive-complexity": "off" },
  },
];
