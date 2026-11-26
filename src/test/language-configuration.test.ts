import * as assert from "assert";
import { KEYWORDS, COMMENT_PREFIXES } from "../parser";
import { readRepoJson } from "./repo";

interface LanguageConfiguration {
  comments: { lineComment: string };
  indentationRules: {
    increaseIndentPattern: string;
    decreaseIndentPattern: string;
  };
}

const config = readRepoJson(
  "language-configuration.json",
) as LanguageConfiguration;

// The patterns as regex literals, so they can be tested here. The first test keeps
// them identical to language-configuration.json, which VS Code reads.
const INDENT_AFTER =
  /^\s*(?:IF|ELSE\s*IF|ELSE|CASE|WHEN|OTHERWISE|FOR|WHILE|REPEAT)(?:\s|$)/;
const OUTDENT =
  /^\s*(?:ELSE\s*IF|ELSE|END\s*IF|WHEN|OTHERWISE|END\s*CASE|END\s*FOR|END\s*WHILE|UNTIL)(?:\s|$)/;

suite("language configuration", () => {
  test("indentation patterns match the literals tested here", () => {
    assert.strictEqual(
      config.indentationRules.increaseIndentPattern,
      INDENT_AFTER.source,
    );
    assert.strictEqual(
      config.indentationRules.decreaseIndentPattern,
      OUTDENT.source,
    );
  });

  test("indentation patterns agree with KEYWORDS", () => {
    for (const k of KEYWORDS) {
      for (const spelling of [
        k.name,
        k.name.replaceAll(" ", ""),
        k.name.replaceAll(" ", "  "),
      ]) {
        for (const line of [spelling, `  ${spelling} x`]) {
          const where = `${k.name} as ${JSON.stringify(line)}`;
          assert.strictEqual(
            INDENT_AFTER.test(line),
            k.role === "open" || k.role === "branch",
            `increaseIndentPattern, ${where}`,
          );
          assert.strictEqual(
            OUTDENT.test(line),
            k.role === "branch" || k.role === "close",
            `decreaseIndentPattern, ${where}`,
          );
        }
      }
    }
    for (const line of ["IFFY", "if x", "Install IF", "ENDING", "# IF"]) {
      assert.ok(
        !INDENT_AFTER.test(line) && !OUTDENT.test(line),
        JSON.stringify(line),
      );
    }
  });

  test("comment toggling uses a prefix the parser treats as a comment", () => {
    assert.strictEqual(config.comments.lineComment, COMMENT_PREFIXES[0]);
  });
});
