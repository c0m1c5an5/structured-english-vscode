import * as assert from "assert";
import { parse, matchingKeywords, KEYWORDS, Node, Token } from "../parser";

const src = (...lines: string[]): string => lines.join("\n");
const rules = (source: string): string[] =>
  parse(source).errors.map((e) => e.rule);

/** [type, text] for each token, so tests read like the source they check. */
function pieces(source: string): [string, string][] {
  const lines = source.split(/\r\n|\r|\n/);
  return parse(source).tokens.map((t) => [
    t.type,
    lines[t.line].slice(t.start, t.start + t.length),
  ]);
}

/** The lines of the keywords matched with the cursor at `line`, `character`. */
const matchedLines = (
  source: string,
  line: number,
  character: number,
): number[] =>
  matchingKeywords(parse(source), line, character).map((t) => t.line);

/** The line each node starts on. */
const startLines = (nodes: Node[]): number[] =>
  nodes.map((n) => (n.type === "step" ? n.line : n.branches[0].line));

const sample = src(
  "# sample",
  "IF a AND `b`",
  "  x",
  "ELSE",
  "  y",
  "END IF",
  "END FOR",
);

suite("parser: block structure", () => {
  test("accepts every kind of block when well formed", () => {
    const blocks = [
      src("IF a", "  x", "ELSE IF b", "  y", "ELSE", "  z", "END IF"),
      src(
        "CASE colour",
        "  x",
        "WHEN red",
        "  y",
        "OTHERWISE",
        "  z",
        "END CASE",
      ),
      src("FOR EACH file IN the folder", "  x", "END FOR"),
      src("WHILE the queue is not empty", "  x", "END WHILE"),
      src("REPEAT", "  x", "UNTIL done"),
    ];
    for (const source of blocks) {
      assert.deepStrictEqual(parse(source).errors, [], source);
    }
  });

  test("builds a tree of nested blocks and steps", () => {
    const { tree } = parse(
      src(
        "IF a",
        "  WHILE b",
        "    step x",
        "  END WHILE",
        "  step y",
        "END IF",
      ),
    );
    assert.deepStrictEqual(tree, {
      type: "document",
      body: [
        {
          type: "block",
          kind: "IF",
          branches: [
            {
              keyword: "IF",
              line: 0,
              argument: "a",
              body: [
                {
                  type: "block",
                  kind: "WHILE",
                  branches: [
                    {
                      keyword: "WHILE",
                      line: 1,
                      argument: "b",
                      body: [{ type: "step", line: 2, text: "step x" }],
                    },
                  ],
                  end: { keyword: "END WHILE", line: 3, argument: "" },
                },
                { type: "step", line: 4, text: "step y" },
              ],
            },
          ],
          end: { keyword: "END IF", line: 5, argument: "" },
        },
      ],
    });
  });

  test("names branches by keyword, whatever the spacing", () => {
    const [block] = parse(
      src("IF a", "  x", "ELSEIF b", "  y", "ELSE", "  z", "ENDIF"),
    ).tree.body;
    assert.ok(block.type === "block");
    assert.deepStrictEqual(
      block.branches.map((b) => [b.keyword, b.argument]),
      [
        ["IF", "a"],
        ["ELSE IF", "b"],
        ["ELSE", ""],
      ],
    );
    assert.strictEqual(block.end?.keyword, "END IF");
  });

  test("leaves `end` null for a block that is never closed", () => {
    const [outer] = parse(src("IF a", "  WHILE b", "    x", "END IF")).tree
      .body;
    assert.ok(outer.type === "block");
    const [inner] = outer.branches[0].body;
    assert.ok(inner.type === "block");
    assert.strictEqual(inner.end, null);
    assert.strictEqual(outer.end?.line, 3);
  });

  test("counts blank and comment lines but skips them for structure and indentation", () => {
    const { tree, errors } = parse(
      src(
        "",
        "# intro",
        "IF a",
        "",
        "    x",
        "        # deep comment",
        "// another",
        "    y",
        "END IF",
      ),
    );
    assert.deepStrictEqual(errors, []);
    const [block] = tree.body;
    assert.ok(block.type === "block");
    assert.deepStrictEqual(startLines(block.branches[0].body), [4, 7]);
    assert.strictEqual(block.end?.line, 8);
  });

  test("accepts \\r\\n and \\r line endings", () => {
    assert.deepStrictEqual(rules("IF a\r\n  x\r\nEND IF"), []);
    assert.deepStrictEqual(rules("IF a\r  x\rEND IF"), []);
    assert.deepStrictEqual(startLines(parse("x\ry").tree.body), [0, 1]);
  });

  test("handles empty and blank documents", () => {
    for (const source of ["", "   ", "\n\n\t\n"]) {
      assert.deepStrictEqual(parse(source), {
        tree: { type: "document", body: [] },
        tokens: [],
        errors: [],
      });
    }
  });
});

suite("parser: errors", () => {
  test("unclosed block at the end of the file", () => {
    assert.deepStrictEqual(parse(src("WHILE x", "  step")).errors, [
      {
        line: 0,
        start: 0,
        length: 5,
        rule: "unclosed-block",
        message:
          "WHILE is not closed before the end of the file; add END WHILE",
      },
    ]);
    assert.match(parse(src("REPEAT", "  x")).errors[0].message, /add UNTIL$/);
  });

  test("inner block left open when the outer one closes", () => {
    assert.deepStrictEqual(
      parse(src("IF a", "  WHILE b", "    x", "END IF")).errors,
      [
        {
          line: 1,
          start: 2,
          length: 5,
          rule: "unclosed-block",
          message: "WHILE is not closed before END IF on line 4; add END WHILE",
        },
      ],
    );
  });

  test("closer or branch with no matching opener", () => {
    assert.deepStrictEqual(parse("END FOR").errors, [
      {
        line: 0,
        start: 0,
        length: 7,
        rule: "unexpected-keyword",
        message: "END FOR has no matching FOR above it",
      },
    ]);
    assert.deepStrictEqual(rules("ELSE"), ["unexpected-keyword"]);
    // A branch of another kind of block does not belong to the IF around it.
    assert.deepStrictEqual(
      rules(src("IF a", "  x", "WHEN b", "  y", "END IF")),
      ["unexpected-keyword"],
    );
  });

  test("keyword missing the text it needs", () => {
    assert.deepStrictEqual(parse(src("IF", "  x", "END IF")).errors, [
      {
        line: 0,
        start: 2,
        length: 1,
        rule: "missing-text",
        message: "IF needs a condition",
      },
    ]);
    const messages = (source: string): string[] =>
      parse(source).errors.map((e) => e.message);
    assert.deepStrictEqual(
      messages(src("CASE", "  x", "WHEN", "  y", "END CASE")),
      ["CASE needs the value to check", "WHEN needs a value"],
    );
    assert.deepStrictEqual(messages(src("FOR", "  x", "END FOR")), [
      "FOR needs what to loop over",
    ]);
    assert.deepStrictEqual(messages(src("REPEAT", "  x", "UNTIL")), [
      "UNTIL needs a condition",
    ]);
  });

  test("text after a keyword that takes none", () => {
    assert.deepStrictEqual(parse(src("IF a", "  x", "END IF now")).errors, [
      {
        line: 2,
        start: 7,
        length: 3,
        rule: "unexpected-text",
        message: "END IF takes nothing after it",
      },
    ]);
    assert.deepStrictEqual(
      parse(src("REPEAT forever", "  x", "UNTIL done")).errors.map((e) => [
        e.start,
        e.length,
      ]),
      [[7, 7]],
    );
  });

  test("branch after the last branch", () => {
    assert.deepStrictEqual(
      parse(src("IF a", "  x", "ELSE", "  y", "ELSE IF b", "  z", "END IF"))
        .errors,
      [
        {
          line: 4,
          start: 0,
          length: 7,
          rule: "branch-after-last",
          message: "ELSE IF cannot come after ELSE on line 3",
        },
      ],
    );
    assert.deepStrictEqual(
      rules(src("IF a", "  x", "ELSE", "  y", "ELSE", "  z", "END IF")),
      ["branch-after-last"],
    );
    assert.deepStrictEqual(
      rules(
        src("CASE c", "  x", "OTHERWISE", "  y", "WHEN d", "  z", "END CASE"),
      ),
      ["branch-after-last"],
    );
  });

  test("body not indented deeper than its opener", () => {
    assert.deepStrictEqual(parse(src("IF a", "x", "END IF")).errors, [
      {
        line: 1,
        start: 0,
        length: 1,
        rule: "indent",
        message:
          "the body of IF on line 1 must be indented deeper than column 1",
      },
    ]);
    // Deeper means the opener's indentation plus more, so a tab and spaces do not mix.
    assert.deepStrictEqual(
      parse(src("\tIF a", "    x", "\tEND IF")).errors.map((e) => e.message),
      ["the body of IF on line 1 must be indented deeper than column 2"],
    );
  });

  test("body lines indented differently from the first", () => {
    assert.deepStrictEqual(
      parse(src("IF a", "  x", "    y", "END IF")).errors,
      [
        {
          line: 2,
          start: 4,
          length: 1,
          rule: "indent",
          message: "expected column 3, like line 2",
        },
      ],
    );
    assert.deepStrictEqual(
      parse(src("IF a", "\tx", "    y", "END IF")).errors.map((e) => e.message),
      ["expected column 2, like line 2"],
    );
    assert.deepStrictEqual(
      parse(src("x", "  y")).errors.map((e) => e.message),
      ["expected column 1, like line 1"],
    );
  });

  test("branch or closer not lined up with its opener", () => {
    assert.deepStrictEqual(parse(src("IF a", "  x", " END IF")).errors, [
      {
        line: 2,
        start: 1,
        length: 6,
        rule: "indent",
        message: "END IF must line up with IF on line 1 (column 1)",
      },
    ]);
    // The body's indentation is fixed by its first line, across branches.
    assert.deepStrictEqual(
      parse(src("  IF a", "    x", "ELSE", "    y", "  END IF")).errors.map(
        (e) => [e.line, e.message],
      ),
      [[2, "ELSE must line up with IF on line 1 (column 3)"]],
    );
  });

  test("errors come sorted by position", () => {
    // END FOR is found first, the unclosed WHILE above it only at the end of the file.
    assert.deepStrictEqual(
      parse(src("WHILE a", "  x", "END FOR")).errors.map((e) => [
        e.line,
        e.rule,
      ]),
      [
        [0, "unclosed-block"],
        [2, "unexpected-keyword"],
      ],
    );
    // On one line, by column: the missing condition is found first, the unclosed block last.
    assert.deepStrictEqual(
      parse("IF").errors.map((e) => [e.start, e.rule]),
      [
        [0, "unclosed-block"],
        [2, "missing-text"],
      ],
    );
  });
});

suite("parser: tokens", () => {
  test("keyword, then its argument with operators and literals", () => {
    assert.deepStrictEqual(pieces('IF vim is NOT "installed"'), [
      ["keyword", "IF"],
      ["argument", "vim is "],
      ["operator", "NOT"],
      ["argument", " "],
      ["literal", '"installed"'],
    ]);
  });

  test("keywords alone, and with their argument", () => {
    assert.deepStrictEqual(pieces(src("REPEAT", "  x", "UNTIL done")), [
      ["keyword", "REPEAT"],
      ["step", "x"],
      ["keyword", "UNTIL"],
      ["argument", "done"],
    ]);
    assert.deepStrictEqual(pieces("IF\ta"), [
      ["keyword", "IF"],
      ["argument", "a"],
    ]);
    assert.deepStrictEqual(
      pieces(src("IF a", "  x", "ELSE  IF b", "  y", "END IF"))[3],
      ["keyword", "ELSE  IF"],
    );
  });

  test("positions count from the start of the raw line", () => {
    assert.deepStrictEqual(parse(src("x", "", "    Copy `a b`")).tokens[1], {
      line: 2,
      start: 4,
      length: 5,
      type: "step",
    });
  });

  test("code, quoted text and paths in a step", () => {
    assert.deepStrictEqual(pieces("Copy `a b` to ~/backup."), [
      ["step", "Copy "],
      ["literal", "`a b`"],
      ["step", " to "],
      ["literal", "~/backup"],
      ["step", "."],
    ]);
    assert.deepStrictEqual(pieces("Run ./build.sh and ../x/y on /dev/kvm"), [
      ["step", "Run "],
      ["literal", "./build.sh"],
      ["step", " and "],
      ["literal", "../x/y"],
      ["step", " on "],
      ["literal", "/dev/kvm"],
    ]);
  });

  test("URLs stop before trailing punctuation", () => {
    assert.deepStrictEqual(pieces("See https://example.com/a?b=1)."), [
      ["step", "See "],
      ["literal", "https://example.com/a?b=1"],
      ["step", ")."],
    ]);
  });

  test("slashes inside words and unclosed quotes are prose", () => {
    assert.deepStrictEqual(pieces("Use and/or 1/2 here"), [
      ["step", "Use and/or 1/2 here"],
    ]);
    assert.deepStrictEqual(pieces('Say "hi'), [["step", 'Say "hi']]);
  });

  test("operators are whole words in capitals, and not inside literals", () => {
    assert.deepStrictEqual(pieces("Do X AND Y, ANDROID and OR"), [
      ["step", "Do X "],
      ["operator", "AND"],
      ["step", " Y, ANDROID and "],
      ["operator", "OR"],
    ]);
    assert.deepStrictEqual(pieces('Say "A AND B"'), [
      ["step", "Say "],
      ["literal", '"A AND B"'],
    ]);
    assert.deepStrictEqual(
      pieces("FOR EACH f IN x").map(([type]) => type),
      ["keyword", "operator", "argument", "operator", "argument"],
    );
  });

  test("a comment is one token, whatever it contains", () => {
    const comments = src('  # note AND "x"', "* IF", "// END IF");
    assert.deepStrictEqual(pieces(comments), [
      ["comment", '# note AND "x"'],
      ["comment", "* IF"],
      ["comment", "// END IF"],
    ]);
    assert.strictEqual(parse(comments).tokens[0].start, 2);
  });
});

suite("parser: keywords", () => {
  test("are recognised with any spacing between words", () => {
    assert.deepStrictEqual(
      rules(
        src("IF a", "  x", "ELSE  IF b", "  y", "ELSEIF c", "  z", "END\tIF"),
      ),
      [],
    );
  });

  test("count only in capitals and as whole words", () => {
    for (const line of [
      "if this is prose",
      "Else",
      "EndIf",
      "IFFY",
      "ELSEWHERE",
      "ENDING",
    ]) {
      const { tokens, errors } = parse(line);
      assert.deepStrictEqual(errors, [], line);
      assert.deepStrictEqual(
        tokens.map((t) => t.type),
        ["step"],
        line,
      );
    }
  });
});

suite("parser: matching keywords", () => {
  test("from any keyword of a block, all of its keywords", () => {
    const source = src(
      "IF a",
      "  x",
      "ELSE IF b",
      "  y",
      "ELSE",
      "  z",
      "END IF",
    );
    for (const line of [0, 2, 4, 6]) {
      assert.deepStrictEqual(
        matchedLines(source, line, 0),
        [0, 2, 4, 6],
        `line ${line}`,
      );
    }
  });

  test("returns the keyword tokens themselves", () => {
    const expected: Token[] = [
      { line: 0, start: 0, length: 6, type: "keyword" },
      { line: 2, start: 0, length: 5, type: "keyword" },
    ];
    assert.deepStrictEqual(
      matchingKeywords(parse(src("REPEAT", "  x", "UNTIL y")), 0, 0),
      expected,
    );
  });

  test("only with the cursor on or right after the keyword", () => {
    const source = src("IF a", "  WHILE b", "    x", "  END WHILE", "END IF");
    assert.deepStrictEqual(matchedLines(source, 0, 2), [0, 4]);
    assert.deepStrictEqual(matchedLines(source, 0, 3), []);
    assert.deepStrictEqual(matchedLines(source, 1, 1), []);
    assert.deepStrictEqual(matchedLines(source, 1, 2), [1, 3]);
    assert.deepStrictEqual(matchedLines(source, 2, 4), []);
  });

  test("finds blocks nested in later branches", () => {
    const source = src(
      "IF a",
      "  x",
      "ELSE",
      "  WHILE b",
      "    y",
      "  END WHILE",
      "END IF",
    );
    assert.deepStrictEqual(matchedLines(source, 3, 2), [3, 5]);
    assert.deepStrictEqual(matchedLines(source, 6, 0), [0, 2, 6]);
  });

  test("handles unclosed blocks and stray closers", () => {
    assert.deepStrictEqual(
      matchedLines(src("IF a", "  x", "ELSE", "  y"), 0, 0),
      [0, 2],
    );
    assert.deepStrictEqual(matchedLines("END FOR", 0, 0), []);
  });
});

suite("parser: purity", () => {
  test("parse gives equal results for equal input", () => {
    assert.deepStrictEqual(parse(sample), parse(sample));
  });

  test("matchingKeywords leaves the parse result unchanged", () => {
    const result = parse(sample);
    const before = structuredClone(result);
    matchingKeywords(result, 1, 0);
    assert.deepStrictEqual(result, before);
  });

  test("every block has exactly one opener and one closer", () => {
    for (const block of new Set(KEYWORDS.map((k) => k.block))) {
      const roles = KEYWORDS.filter((k) => k.block === block).map(
        (k) => k.role,
      );
      assert.strictEqual(roles.filter((r) => r === "open").length, 1, block);
      assert.strictEqual(roles.filter((r) => r === "close").length, 1, block);
    }
  });

  test("the language definition is frozen", () => {
    assert.ok(
      Object.isFrozen(KEYWORDS) && KEYWORDS.every((k) => Object.isFrozen(k)),
    );
  });
});
