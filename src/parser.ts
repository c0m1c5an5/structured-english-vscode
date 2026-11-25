/**
 * Parser for Structured English pseudocode.
 *
 *     IF vim is not installed
 *         Install the vim package with dnf
 *     ELSE
 *         Update vim with dnf
 *     END IF
 */

// --- Types -------------------------------------------------------------------

export type Role = "open" | "branch" | "close" | "step" | "comment";

export interface Keyword {
  readonly name: string;
  readonly role: Role;
  readonly block: string;
  readonly needs: string;
  readonly last: boolean;
}

export type TokenType =
  "keyword" | "operator" | "argument" | "step" | "literal" | "comment";

interface Span {
  line: number;
  start: number;
  length: number;
}

export interface Token extends Span {
  type: TokenType;
}

export interface ParseError extends Span {
  rule: string;
  message: string;
}

export interface Step {
  type: "step";
  line: number;
  text: string;
}

export interface BlockEnd {
  keyword: string;
  line: number;
  argument: string;
}

export interface Branch extends BlockEnd {
  body: Node[];
}

export interface Block {
  type: "block";
  kind: string;
  branches: Branch[];
  end: BlockEnd | null;
}

export type Node = Step | Block;

export interface Document {
  type: "document";
  body: Node[];
}

export interface ParseResult {
  tree: Document;
  tokens: Token[];
  errors: ParseError[];
}

/** A non-blank source line; `keyword` is STEP or COMMENT for those lines. */
interface Line {
  readonly index: number;
  readonly indent: string;
  readonly start: number;
  readonly text: string;
  readonly word: string;
  readonly keyword: Keyword;
}

// --- The language: keywords are defined here --------------------------------
// INDENT_AFTER and OUTDENT repeat the keyword names as regex literals; a test keeps
// them in step with KEYWORDS.

type KeywordSpec = Pick<Keyword, "name" | "role" | "block"> & Partial<Keyword>;

const keyword = (spec: KeywordSpec): Keyword =>
  Object.freeze({ needs: "", last: false, ...spec });

// name:  a space also matches no space, so "END IF" accepts "ENDIF"
// role:  open, branch or close
// block: the keyword that opens the block it belongs to
// needs: what must follow the keyword; '' means nothing may follow
// last:  a branch that must come last in its block
export const KEYWORDS: readonly Keyword[] = Object.freeze([
  keyword({ name: "IF", role: "open", block: "IF", needs: "a condition" }),
  keyword({
    name: "ELSE IF",
    role: "branch",
    block: "IF",
    needs: "a condition",
  }),
  keyword({ name: "ELSE", role: "branch", block: "IF", last: true }),
  keyword({ name: "END IF", role: "close", block: "IF" }),
  keyword({
    name: "CASE",
    role: "open",
    block: "CASE",
    needs: "the value to check",
  }),
  keyword({ name: "WHEN", role: "branch", block: "CASE", needs: "a value" }),
  keyword({ name: "OTHERWISE", role: "branch", block: "CASE", last: true }),
  keyword({ name: "END CASE", role: "close", block: "CASE" }),
  keyword({
    name: "FOR",
    role: "open",
    block: "FOR",
    needs: "what to loop over",
  }),
  keyword({ name: "END FOR", role: "close", block: "FOR" }),
  keyword({
    name: "WHILE",
    role: "open",
    block: "WHILE",
    needs: "a condition",
  }),
  keyword({ name: "END WHILE", role: "close", block: "WHILE" }),
  keyword({ name: "REPEAT", role: "open", block: "REPEAT" }),
  keyword({
    name: "UNTIL",
    role: "close",
    block: "REPEAT",
    needs: "a condition",
  }),
]);
const STEP = keyword({ name: "", role: "step", block: "" });
const COMMENT = keyword({ name: "", role: "comment", block: "" });
export const COMMENT_PREFIXES: readonly string[] = Object.freeze([
  "#",
  "*",
  "//",
]); // the first is used to toggle comments
// Literal values inside a step or condition, so they stand out from the prose, and
// operators: words that join or qualify conditions and steps (like keywords, only in
// capitals). One regex literal, so eslint-plugin-regexp checks it for ReDoS.
// Alternatives, in order:
//   `code` | "quoted text" | URLs | paths: /dev/kvm, ~/.vimrc | AND OR NOT EACH IN THEN DO
// `literal` marks a literal; any other match is an operator.
const INLINE =
  /(?<literal>`[^`]*`|"[^"]*"|https?:\/\/[^\s"`<>]*[^\s"`<>.,;:!?)]|(?<![\w/.~])(?:~|\.{1,2})?\/[\w.~@%+=:/-]*[\w~@%+=/-])|\b(?:AND|OR|NOT|EACH|IN|THEN|DO)\b/g;
const CLOSER: ReadonlyMap<string, string> = new Map(
  KEYWORDS.filter((k) => k.role === "close").map((k) => [k.block, k.name]),
);

// Lines after which an editor indents (a block opener or a branch), and lines it
// outdents (a branch or a closer). Regex literals, because editors take regexes;
// a test checks that they agree with KEYWORDS.
export const INDENT_AFTER =
  /^\s*(?:IF|ELSE\s*IF|ELSE|CASE|WHEN|OTHERWISE|FOR|WHILE|REPEAT)(?:\s|$)/;
export const OUTDENT =
  /^\s*(?:ELSE\s*IF|ELSE|END\s*IF|WHEN|OTHERWISE|END\s*CASE|END\s*FOR|END\s*WHILE|UNTIL)(?:\s|$)/;

const BY_LENGTH: readonly Keyword[] = Object.freeze(
  // longest first: "ELSE IF" before "ELSE"
  [...KEYWORDS].sort((a, b) => b.name.length - a.name.length),
);

/** The position in `text` after any whitespace that starts at `at`. */
const skipSpace = (text: string, at: number): number =>
  text.length - text.slice(at).trimStart().length;

/**
 * The start of `text` that spells keyword `name` in any case, followed by a space
 * or the end; otherwise null. A space in `name` matches any run of whitespace,
 * including none, so "END IF" accepts "ENDIF".
 */
function keywordAt(text: string, name: string): string | null {
  const end = name.split("").reduce<number | null>((at, char) => {
    if (at === null) {
      return null;
    }
    if (char === " ") {
      return skipSpace(text, at);
    }
    return text.charAt(at).toUpperCase() === char ? at + 1 : null;
  }, 0);
  // charAt past the end is "", so this accepts both a space and the end of the text.
  return end !== null && text.charAt(end).trim() === ""
    ? text.slice(0, end)
    : null;
}

// --- Lines -------------------------------------------------------------------

function parseLine(raw: string, index: number): Line | null {
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const indent = raw.slice(0, raw.length - raw.trimStart().length);
  const line = (word: string, kw: Keyword): Line =>
    Object.freeze({
      index,
      indent,
      start: indent.length,
      text,
      word,
      keyword: kw,
    });
  if (COMMENT_PREFIXES.some((prefix) => text.startsWith(prefix))) {
    return line("", COMMENT);
  }
  const found = BY_LENGTH.flatMap((kw) => {
    const word = keywordAt(text, kw.name);
    return word === null ? [] : [{ kw, word }];
  }).at(0);
  if (!found) {
    return line("", STEP);
  }
  return line(
    found.word,
    found.word === found.word.toUpperCase() ? found.kw : STEP,
  );
}

/** The text after a line's keyword, e.g. the condition of an IF. */
const argumentOf = (line: Line): string =>
  line.text.slice(line.word.length).trim();

const ref = (line: Line): string =>
  `${line.keyword.name} on line ${line.index + 1}`;

/** A span `offset` characters into a line's text; by default its first word. */
function span(line: Line, offset = 0, length = 0): Span {
  return {
    line: line.index,
    start: line.start + offset,
    length: length || (line.word || line.text.split(/\s/)[0]).length,
  };
}

const error = (
  line: Line,
  rule: string,
  message: string,
  offset?: number,
  length?: number,
): ParseError => ({
  ...span(line, offset, length),
  rule,
  message,
});
const token = (
  line: Line,
  type: TokenType,
  offset?: number,
  length?: number,
): Token => ({
  ...span(line, offset, length),
  type,
});

// --- Tokens for highlighting -------------------------------------------------

/** Tokens for `text` at `offset` in a line: `base`, with the literals and operators in it. */
function inline(
  line: Line,
  offset: number,
  text: string,
  base: TokenType,
): Token[] {
  const piece = (type: TokenType, from: number, to: number): Token[] =>
    to > from ? [token(line, type, offset + from, to - from)] : [];
  const { at, tokens } = [...text.matchAll(INLINE)].reduce<{
    at: number;
    tokens: Token[];
  }>(
    (done, m) => {
      const end = m.index + m[0].length;
      const type = m.groups?.literal ? "literal" : "operator";
      return {
        at: end,
        tokens: [
          ...done.tokens,
          ...piece(base, done.at, m.index),
          ...piece(type, m.index, end),
        ],
      };
    },
    { at: 0, tokens: [] },
  );
  return [...tokens, ...piece(base, at, text.length)];
}

/** keyword, operator, argument, step, literal and comment tokens, in document order. */
function tokensOf(line: Line): Token[] {
  const { role } = line.keyword;
  if (role === "comment") {
    return [token(line, role, 0, line.text.length)];
  }
  if (role === "step") {
    return inline(line, 0, line.text, "step");
  }
  const argument = argumentOf(line);
  return [
    token(line, "keyword"),
    ...inline(line, line.text.length - argument.length, argument, "argument"),
  ];
}

// --- Structure ---------------------------------------------------------------
// The stack holds one frame per open block, with the whole file at the bottom:
//   opener: the line that opened the block (TOP for the file)
//   body:   the first line of the body, which fixes its indentation
//   last:   the ELSE or OTHERWISE line, once seen
//   branches: [{ keyword, line, argument, body: [node] }]

interface Frame {
  readonly opener: Line;
  readonly body: Line | null;
  readonly last: Line | null;
  readonly branches: Branch[];
}

type Stack = readonly Frame[];
type Visited = [Stack, ParseError[]];

const TOP: Line = Object.freeze({
  index: -1,
  indent: "",
  start: 0,
  text: "-",
  word: "",
  keyword: STEP,
});
const ROOT: Frame = Object.freeze({
  opener: TOP,
  body: null,
  last: null,
  branches: [{ keyword: "", line: -1, argument: "", body: [] }],
});

const top = (stack: Stack): Frame => stack[stack.length - 1];
const replaceTop = (stack: Stack, frame: Frame): Stack => [
  ...stack.slice(0, -1),
  frame,
];
const branchOf = (line: Line): Branch => ({
  keyword: line.keyword.name,
  line: line.index,
  argument: argumentOf(line),
  body: [],
});

/** Add a node to the body of the innermost block's current branch. */
function append(stack: Stack, node: Node): Stack {
  const frame = top(stack);
  const current = frame.branches[frame.branches.length - 1];
  const branches = [
    ...frame.branches.slice(0, -1),
    { ...current, body: [...current.body, node] },
  ];
  return replaceTop(stack, { ...frame, branches });
}

/** Turn the innermost frame into a block node; `end` is null if it was never closed. */
function closeTop(stack: Stack, end: BlockEnd | null): Stack {
  const { opener, branches } = top(stack);
  return append(stack.slice(0, -1), {
    type: "block",
    kind: opener.keyword.block,
    branches,
    end,
  });
}

const closeAbove = (stack: Stack, depth: number): Stack =>
  stack.length > depth + 1 ? closeAbove(closeTop(stack, null), depth) : stack;

function unclosed(frame: Frame, before: string): ParseError {
  const { keyword: kw } = frame.opener;
  return error(
    frame.opener,
    "unclosed-block",
    `${kw.name} is not closed before ${before}; add ${CLOSER.get(kw.block) ?? "its closer"}`,
  );
}

const deeper = (inner: string, outer: string): boolean =>
  inner.length > outer.length && inner.startsWith(outer);

/** Index of the last element matching `predicate`, or -1 (Array.findLastIndex is ES2023). */
function findLastIndex<T>(
  items: readonly T[],
  predicate: (item: T) => boolean,
): number {
  return items.reduce((found, item, i) => (predicate(item) ? i : found), -1);
}

/** Check the indentation of a step or opener inside the innermost block. */
function place(stack: Stack, line: Line): Visited {
  const frame = top(stack);
  if (!frame.body) {
    const ok = frame.opener === TOP || deeper(line.indent, frame.opener.indent);
    const why = `the body of ${ref(frame.opener)} must be indented deeper than column ${frame.opener.start + 1}`;
    return [
      replaceTop(stack, { ...frame, body: line }),
      ok ? [] : [error(line, "indent", why)],
    ];
  }
  const ok = line.indent === frame.body.indent;
  return [
    stack,
    ok
      ? []
      : [
          error(
            line,
            "indent",
            `expected column ${frame.body.start + 1}, like line ${frame.body.index + 1}`,
          ),
        ],
  ];
}

function align(frame: Frame, line: Line): ParseError[] {
  if (line.indent === frame.opener.indent) {
    return [];
  }
  return [
    error(
      line,
      "indent",
      `${line.keyword.name} must line up with ${ref(frame.opener)} (column ${frame.opener.start + 1})`,
    ),
  ];
}

function checkArgument(line: Line): ParseError[] {
  const { keyword: kw } = line;
  const argument = argumentOf(line);
  if (kw.role === "step" || Boolean(argument) === Boolean(kw.needs)) {
    return [];
  }
  if (kw.needs) {
    return [
      error(
        line,
        "missing-text",
        `${kw.name} needs ${kw.needs}`,
        line.word.length,
        1,
      ),
    ];
  }
  return [
    error(
      line,
      "unexpected-text",
      `${kw.name} takes nothing after it`,
      line.text.length - argument.length,
      argument.length,
    ),
  ];
}

/** Check one line against the open blocks; return the new stack and errors. */
function visit(stack: Stack, line: Line): Visited {
  const { keyword: kw } = line;
  if (kw.role === "step" || kw.role === "open") {
    const [placed, errors] = place(stack, line);
    const next =
      kw.role === "open"
        ? [
            ...placed,
            {
              opener: line,
              body: null,
              last: null,
              branches: [branchOf(line)],
            },
          ]
        : append(placed, { type: "step", line: line.index, text: line.text });
    return [next, [...errors, ...checkArgument(line)]];
  }

  // The file frame at the bottom never matches: its opener's block is "".
  const depth = findLastIndex(
    stack,
    (frame) => frame.opener.keyword.block === kw.block,
  );
  if (depth < 0) {
    return [
      stack,
      [
        error(
          line,
          "unexpected-keyword",
          `${kw.name} has no matching ${kw.block} above it`,
        ),
      ],
    ];
  }
  const inner = stack
    .slice(depth + 1)
    .reverse()
    .map((frame) => unclosed(frame, ref(line)));
  const next = closeAbove(stack, depth);
  const frame = top(next);
  const errors = [...inner, ...align(frame, line), ...checkArgument(line)];
  if (kw.role === "close") {
    return [
      closeTop(next, {
        keyword: kw.name,
        line: line.index,
        argument: argumentOf(line),
      }),
      errors,
    ];
  }
  const late = frame.last
    ? [
        error(
          line,
          "branch-after-last",
          `${kw.name} cannot come after ${ref(frame.last)}`,
        ),
      ]
    : [];
  const last = frame.last || (kw.last ? line : null);
  return [
    replaceTop(next, {
      ...frame,
      last,
      branches: [...frame.branches, branchOf(line)],
    }),
    [...errors, ...late],
  ];
}

// --- Entry point -------------------------------------------------------------

/**
 * tree:   { type: 'document', body: [node] }, where a node is
 *         { type: 'step', line, text } or
 *         { type: 'block', kind, branches: [{ keyword, line, argument, body }], end }
 * tokens: [{ line, start, length, type }], type is keyword, operator, argument, step,
 *         literal or comment
 * errors: [{ line, start, length, rule, message }]
 */
export function parse(source: string): ParseResult {
  const lines = source
    .split(/\r\n|\r|\n/)
    .map(parseLine)
    .filter((line): line is Line => line !== null);
  const code = lines.filter((line) => line.keyword.role !== "comment");
  const [stack, found] = code.reduce<Visited>(
    ([s, e], line) => {
      const [next, errors] = visit(s, line);
      return [next, [...e, ...errors]];
    },
    [[ROOT], []],
  );
  const atEnd = stack
    .slice(1)
    .reverse()
    .map((frame) => unclosed(frame, "the end of the file"));
  const errors = [...found, ...atEnd].sort(
    (a, b) => a.line - b.line || a.start - b.start,
  );
  return {
    tree: {
      type: "document",
      body: top(closeAbove(stack, 0)).branches[0].body,
    },
    tokens: lines.flatMap(tokensOf),
    errors,
  };
}

// --- Queries on a parse result -----------------------------------------------

const keywordLines = (block: Block): number[] => [
  ...block.branches.map((b) => b.line),
  ...(block.end ? [block.end.line] : []),
];

/** The block whose opener, branch or closer is on `line`, searching `nodes` and below. */
function blockAt(nodes: Node[], line: number): Block | null {
  const blocks = nodes.filter((node): node is Block => node.type === "block");
  return (
    blocks.find((block) => keywordLines(block).includes(line)) ??
    blocks
      .map((block) =>
        blockAt(
          block.branches.flatMap((b) => b.body),
          line,
        ),
      )
      .find(Boolean) ??
    null
  );
}

/**
 * When the cursor is on a block keyword, the keyword tokens of the whole block
 * (IF, ELSE IF, ELSE, END IF); otherwise none.
 */
export function matchingKeywords(
  { tree, tokens }: ParseResult,
  line: number,
  character: number,
): Token[] {
  const keywordOn = (n: number): Token | undefined =>
    tokens.find((t) => t.line === n && t.type === "keyword");
  const here = keywordOn(line);
  if (!here || character < here.start || character > here.start + here.length) {
    return [];
  }
  const block = blockAt(tree.body, line);
  return block
    ? keywordLines(block)
        .map(keywordOn)
        .filter((t): t is Token => t !== undefined)
    : [];
}
