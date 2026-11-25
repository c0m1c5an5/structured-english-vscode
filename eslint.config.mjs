import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import regexp from "eslint-plugin-regexp";
import security from "eslint-plugin-security";
import prettier from "eslint-config-prettier";

// Every security rule, as an error rather than the recommended config's warning.
const allSecurityRulesAsErrors = Object.fromEntries(
  Object.keys(security.rules).map((rule) => [`security/${rule}`, "error"]),
);

export default defineConfig([
  {
    ignores: ["dist/**", "out/**", ".vscode-test/**"],
  },
  {
    files: ["**/*.ts"],

    extends: [
      tseslint.configs.strictTypeChecked,
      regexp.configs["flat/recommended"],
      // Last, to turn off the rules that would fight Prettier's formatting.
      prettier,
    ],

    plugins: { security },

    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },

    rules: {
      ...allSecurityRulesAsErrors,

      // The document text is untrusted and is matched on every keystroke, so a
      // regular expression that can backtrack badly is an error. The preset
      // already has no-super-linear-backtracking; this adds the scanning case.
      "regexp/no-super-linear-move": "error",
      // regexp/no-super-linear-* analyse patterns exactly; safe-regex's star-height
      // heuristic only adds false positives on top of them.
      "security/detect-unsafe-regex": "off",

      "@typescript-eslint/naming-convention": [
        "error",
        {
          selector: "import",
          format: ["camelCase", "PascalCase"],
        },
      ],
      // Numbers in messages ("line 3") are safe; other types still need String().
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],
      // Prettier leaves braces alone, so this stays on (eslint-config-prettier turns it off).
      curly: "error",
      eqeqeq: "error",
    },
  },
]);
