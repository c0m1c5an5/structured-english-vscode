import { defineConfig } from "@vscode/test-cli";
import { fileURLToPath } from "url";
import os from "os";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  files: "out/test/**/*.test.js",
  workspaceFolder: path.join(__dirname, "src/test/fixtures/workspace"),
  // MacOS has a 103 character socker path limit, so we shorten the path.
  launchArgs: [`--user-data-dir=${path.join(os.tmpdir(), "vsc-se-test")}`],
  mocha: {
    timeout: 120_000,
  },
});
