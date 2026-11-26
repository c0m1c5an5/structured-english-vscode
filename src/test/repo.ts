import * as fs from "fs";
import * as path from "path";

/** Where the repository root is: tests are compiled to out/test. */
const ROOT = path.join(__dirname, "..", "..");

/** A file of the repository, such as language-configuration.json, as bytes. */
export function readRepoFile(name: string): Buffer {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test-only; names are constants in the tests
  return fs.readFileSync(path.join(ROOT, name));
}

/** A JSON file of the repository, parsed. */
export const readRepoJson = (name: string): unknown =>
  JSON.parse(readRepoFile(name).toString("utf8"));
