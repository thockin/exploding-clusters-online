import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import stylistic from "@stylistic/eslint-plugin";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "prototype/**",
  ]),
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.ts'],
    plugins: {
      stylistic,
    },
    rules: {
      'stylistic/indent': ['error', 2, { 'SwitchCase': 1 }],
    },
  },
]);

export default eslintConfig;