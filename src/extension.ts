/**
 * VS Code extension for Structured English: the imperative shell around the
 * parser. Error squiggles and matching keywords come from the parser. Colors come from the grammar in syntaxes/, and comment toggling and
 * auto-indent from language-configuration.json; tests keep both in step with
 * the parser.
 */
import * as vscode from "vscode";
import {
  parse,
  matchingKeywords,
  Token,
  ParseError,
  ParseResult,
} from "./parser";

const LANGUAGE = "structured-english";

type Parser = (document: vscode.TextDocument) => ParseResult;

/**
 * A parser that remembers its result for each document version: diagnostics
 * and keyword highlights need the same parse.
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
const rangeOf = (t: Token | ParseError): vscode.Range =>
  new vscode.Range(t.line, t.start, t.line, t.start + t.length);

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
  const refresh = (document: vscode.TextDocument): void => {
    if (document.languageId !== LANGUAGE) {
      return;
    }
    diagnostics.set(document.uri, parse(document).errors.map(toDiagnostic));
  };
  context.subscriptions.push(
    diagnostics,
    vscode.languages.registerDocumentHighlightProvider(
      { language: LANGUAGE },
      matcher(parse),
    ),
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((event) => {
      refresh(event.document);
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      diagnostics.delete(document.uri);
    }),
  );
  vscode.workspace.textDocuments.forEach(refresh);
}
