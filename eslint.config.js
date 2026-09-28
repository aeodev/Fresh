import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", ".wrangler", "scripts", "sidebar-app/dist", "sidebar-app/app/scripts", "sidebar-app/server"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["ui/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Data loading here is `useEffect(() => { load().catch(setError) })`. The heuristic cannot see that
      // setState only runs after an await, so it reports every fetch. The pattern is intentional.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  { rules: { "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }] } },
);
