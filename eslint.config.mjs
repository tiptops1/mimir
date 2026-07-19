import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // French UI copy contains many apostrophes/quotes in JSX text.
      "react/no-unescaped-entities": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated Prisma client (if output to repo)
    "src/generated/**",
    // Stray git worktrees under .claude/worktrees/ carry their own copies of
    // generated/build output — the src/generated/** ignore above only
    // matches the root path, not nested worktree copies.
    ".claude/worktrees/**",
    // Vendored pixel-agents monorepo (C5 Le Bureau) — has its own lint setup.
    "vendor/**",
    // Built webview bundle assembled by scripts/bureau-build.ts.
    "public/bureau/**",
  ]),
]);

export default eslintConfig;
