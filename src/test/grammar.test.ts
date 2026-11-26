import * as assert from "assert";
import * as oniguruma from "vscode-oniguruma";
import * as textmate from "vscode-textmate";
import { parse, KEYWORDS, TokenType } from "../parser";
import { readRepoFile, readRepoJson } from "./repo";

// The grammar colors lines in VS Code; the parser decides what is right. These
// tests color many lines both ways, with VS Code's own TextMate engine, and
// require the same type for every character that is not whitespace.

const GRAMMAR = "syntaxes/structured-english.tmLanguage.json";
const SCOPE = "source.structured-english";

// The grammar's scope for each parser token type.
const SCOPES: ReadonlyMap<string, TokenType> = new Map([
  ["keyword.control.structured-english", "keyword"],
  ["keyword.operator.wordlike.structured-english", "operator"],
  ["variable.parameter.structured-english", "argument"],
  ["entity.name.function.structured-english", "step"],
  ["string.other.literal.structured-english", "literal"],
  ["comment.line.structured-english", "comment"],
]);

async function loadGrammar(): Promise<textmate.IGrammar> {
  const wasm = readRepoFile("node_modules/vscode-oniguruma/release/onig.wasm");
  await oniguruma.loadWASM(wasm);
  const registry = new textmate.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
      createOnigString: (text) => new oniguruma.OnigString(text),
    }),
    loadGrammar: (scopeName) =>
      Promise.resolve(
        scopeName === SCOPE
          ? textmate.parseRawGrammar(
              readRepoFile(GRAMMAR).toString("utf8"),
              GRAMMAR,
            )
          : null,
      ),
  });
  const grammar = await registry.loadGrammar(SCOPE);
  assert.ok(grammar, `${GRAMMAR} did not load`);
  return grammar;
}

/** One letter per character: its token type's initial, "-" for none, "_" for whitespace. */
type Picture = string;

const draw = (
  line: string,
  typeAt: (column: number) => string | undefined,
): Picture =>
  Array.from(line, (char, column) =>
    char.trim() === "" ? "_" : (typeAt(column)?.charAt(0) ?? "-"),
  ).join("");

/** How the parser colors each line of `source`. */
function parserPictures(source: string): Picture[] {
  const { tokens } = parse(source);
  return source.split("\n").map((line, index) =>
    draw(line, (column) => {
      const t = tokens.find(
        (t) =>
          t.line === index && t.start <= column && column < t.start + t.length,
      );
      return t?.type;
    }),
  );
}

/** How the grammar colors each line of `source`. */
function grammarPictures(
  grammar: textmate.IGrammar,
  source: string,
): Picture[] {
  const { pictures } = source.split("\n").reduce<{
    state: textmate.StateStack;
    pictures: Picture[];
  }>(
    ({ state, pictures }, line) => {
      const { tokens, ruleStack } = grammar.tokenizeLine(line, state);
      const picture = draw(line, (column) => {
        const t = tokens.find(
          (t) => t.startIndex <= column && column < t.endIndex,
        );
        return t?.scopes
          .map((scope) => SCOPES.get(scope))
          .filter((type) => type !== undefined)
          .at(-1);
      });
      return { state: ruleStack, pictures: [...pictures, picture] };
    },
    { state: textmate.INITIAL, pictures: [] },
  );
  return pictures;
}

/** A small deterministic random generator, so failures can be reproduced. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const spellings = (name: string): string[] => [
  name,
  name.replaceAll(" ", ""),
  name.replaceAll(" ", "  "),
  name.replaceAll(" ", "\t"),
  name.toLowerCase(),
  name.charAt(0) + name.slice(1).toLowerCase(),
];

// Pieces of lines that the parser treats in different ways.
const FRAGMENTS: readonly string[] = [
  ...KEYWORDS.flatMap((k) => spellings(k.name)),
  ...["AND", "OR", "NOT", "EACH", "IN", "THEN", "DO"].flatMap((op) => [
    op,
    op.toLowerCase(),
    `${op}S`,
  ]),
  ...["END", "IFFY", "ELSEWHERE", "FOREVER", "é", "Ünïcode"],
  ...["`vim`", "`a b`", "``", "`open", '"quoted text"', '""', '"open'],
  ...[
    "https://example.com/a?b=c.",
    "http://x.y)",
    "https://",
    "(https://a.b/c)",
  ],
  ...[
    "/dev/kvm",
    "~/.vimrc",
    "./run.sh",
    "../up",
    "a/b",
    "/",
    "~",
    "x/y/z",
    ".../z",
  ],
  ...[
    "#",
    "*",
    "//",
    "/*",
    "-",
    ".",
    ",",
    ":",
    "!",
    "(",
    ")",
    "@",
    "%",
    "+",
    "=",
  ],
  ...["Install", "vim", "the", "package", "x", "42"],
];
const SEPARATORS: readonly string[] = [" ", " ", " ", "", "\t", "  "];
const INDENTS: readonly string[] = ["", "", "    ", "\t", "  "];

function fuzzLines(count: number, seed: number): string[] {
  const next = random(seed);
  const pick = <T>(items: readonly T[]): T =>
    items[Math.floor(next() * items.length)];
  return Array.from({ length: count }, () => {
    const pieces = Array.from({ length: 1 + Math.floor(next() * 6) }, () => [
      pick(FRAGMENTS),
      pick(SEPARATORS),
    ]).flat();
    return pick(INDENTS) + pieces.join("") + pick(["", "", " ", "\t"]);
  });
}

suite("grammar", () => {
  let grammar: textmate.IGrammar;
  suiteSetup(async () => {
    grammar = await loadGrammar();
  });

  const agree = (source: string): void => {
    const expected = parserPictures(source);
    const actual = grammarPictures(grammar, source);
    source.split("\n").forEach((line, i) => {
      assert.strictEqual(
        actual.at(i),
        expected.at(i),
        `line ${JSON.stringify(line)}\n  parser:  ${String(expected.at(i))}\n  grammar: ${String(actual.at(i))}`,
      );
    });
  };

  test("is contributed for the language with its scope name", () => {
    interface Manifest {
      contributes: {
        grammars: { language: string; scopeName: string; path: string }[];
      };
    }
    const [contributed] = (readRepoJson("package.json") as Manifest).contributes
      .grammars;
    assert.deepStrictEqual(contributed, {
      language: "structured-english",
      scopeName: SCOPE,
      path: `./${GRAMMAR}`,
    });
    assert.strictEqual(
      (readRepoJson(GRAMMAR) as { scopeName: string }).scopeName,
      SCOPE,
    );
  });

  test("colors the README example and the test fixture like the parser", () => {
    agree(
      [
        "# Make sure vim is set up",
        "IF vim is not installed",
        "    Install the vim package with dnf",
        "ELSE",
        "    Update vim with dnf",
        "END IF",
      ].join("\n"),
    );
    agree(
      readRepoFile("src/test/fixtures/workspace/example.se").toString("utf8"),
    );
  });

  test("colors every keyword, in every spelling, like the parser", () => {
    for (const fragment of FRAGMENTS) {
      for (const line of [
        fragment,
        `${fragment} x`,
        `  ${fragment}\tAND "y" ~/z`,
        `${fragment}x`,
      ]) {
        agree(line);
      }
    }
  });

  test("colors tricky lines like the parser", () => {
    agree(
      [
        "ELSE if x",
        "ELSE IFx",
        "ELSEif",
        "ENDIF",
        "END  WHILE",
        "IF a AND NOT b",
        "IF `a AND b`",
        'Run "x AND y" THEN stop',
        "See https://example.com/docs, then /etc/hosts.",
        "Edit a/b but not /c/d/ or ~/e",
        "* a comment, IF anything",
        "// another",
        "#IF",
        "/dev/kvm exists",
        // The parser's \w and \b are ASCII; a non-ASCII letter is not part of a word.
        "Open café/menu and naïve/x",
        "IF éAND ü/y",
        "   ",
        "",
      ].join("\n"),
    );
  });

  test("colors thousands of random lines like the parser", () => {
    for (const line of fuzzLines(5000, 20261126)) {
      agree(line);
    }
  });
});
