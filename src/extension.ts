/**
 * VS Code extension for Structured English: the imperative shell around the
 * parser. Highlighting, bold keywords, error squiggles, matching keywords,
 * auto-indent and comment toggling all come from the parser.
 */
import * as vscode from "vscode";
import {
  parse,
  matchingKeywords,
  COMMENT_PREFIXES,
  INDENT_AFTER,
  OUTDENT,
  Token,
  TokenType,
  ParseError,
  ParseResult,
} from "./parser";

const LANGUAGE = "structured-english";

// Parser token type -> standard VS Code semantic token type, which every theme colors.
// Operators share the keyword color. A step is an action, like a function call.
const TOKEN_TYPES: Readonly<Record<TokenType, string>> = Object.freeze({
  keyword: "keyword",
  operator: "keyword",
  argument: "parameter",
  step: "function",
  literal: "string",
  comment: "comment",
});
const legend = new vscode.SemanticTokensLegend([
  ...new Set(Object.values(TOKEN_TYPES)),
]);

type Parser = (document: vscode.TextDocument) => ParseResult;

/**
 * A parser that remembers its result for each document version: diagnostics,
 * semantic tokens and keyword highlights all need the same parse.
 */
function cachedParser(): Parser {
  const parses = new WeakMap<
    vscode.TextDocument,
    { version: number; result: ParseResult }
  >();
  return (document) => {
    const cached = parses.get(document);
    if (cached?.version === document.version) {
      return cached.result;
    }
    const result = parse(document.getText());
    parses.set(document, { version: document.version, result });
    return result;
  };
}
const isKeyword = (t: Token): boolean => TOKEN_TYPES[t.type] === "keyword";
const rangeOf = (t: Token | ParseError): vscode.Range =>
  new vscode.Range(t.line, t.start, t.line, t.start + t.length);

export const languageConfiguration: vscode.LanguageConfiguration =
  Object.freeze({
    comments: { lineComment: COMMENT_PREFIXES[0] },
    indentationRules: {
      increaseIndentPattern: INDENT_AFTER,
      decreaseIndentPattern: OUTDENT,
    },
  });

const highlighter = (parse: Parser): vscode.DocumentSemanticTokensProvider => ({
  provideDocumentSemanticTokens(document) {
    const builder = new vscode.SemanticTokensBuilder(legend);
    parse(document).tokens.forEach((t) => {
      builder.push(rangeOf(t), TOKEN_TYPES[t.type]);
    });
    return builder.build();
  },
});

const matcher = (parse: Parser): vscode.DocumentHighlightProvider => ({
  provideDocumentHighlights(document, position) {
    return matchingKeywords(
      parse(document),
      position.line,
      position.character,
    ).map((t) => new vscode.DocumentHighlight(rangeOf(t)));
  },
});

function toDiagnostic(e: ParseError): vscode.Diagnostic {
  const diagnostic = new vscode.Diagnostic(
    rangeOf(e),
    e.message,
    vscode.DiagnosticSeverity.Error,
  );
  return Object.assign(diagnostic, {
    source: "Structured English",
    code: e.rule,
  });
}

export function activate(context: vscode.ExtensionContext): void {
  const parse = cachedParser();
  const diagnostics = vscode.languages.createDiagnosticCollection(LANGUAGE);
  const bold = vscode.window.createTextEditorDecorationType({
    fontWeight: "bold",
  });
  const refresh = (document: vscode.TextDocument): void => {
    if (document.languageId !== LANGUAGE) {
      return;
    }
    const { tokens, errors } = parse(document);
    diagnostics.set(document.uri, errors.map(toDiagnostic));
    const keywords = tokens.filter(isKeyword).map(rangeOf);
    vscode.window.visibleTextEditors
      .filter((editor) => editor.document === document)
      .forEach((editor) => {
        editor.setDecorations(bold, keywords);
      });
  };
  context.subscriptions.push(
    diagnostics,
    bold,
    vscode.languages.registerDocumentSemanticTokensProvider(
      { language: LANGUAGE },
      highlighter(parse),
      legend,
    ),
    vscode.languages.registerDocumentHighlightProvider(
      { language: LANGUAGE },
      matcher(parse),
    ),
    vscode.languages.setLanguageConfiguration(LANGUAGE, languageConfiguration),
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((event) => {
      refresh(event.document);
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      diagnostics.delete(document.uri);
    }),
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      editors.forEach((e) => {
        refresh(e.document);
      });
    }),
  );
  vscode.workspace.textDocuments.forEach(refresh);
}
