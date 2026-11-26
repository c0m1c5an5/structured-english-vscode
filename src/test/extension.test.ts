import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";

const EXTENSION_ID = "c0m1c5an5.structured-english-vscode";
const LANGUAGE = "structured-english";

async function open(
  content: string,
  language = LANGUAGE,
): Promise<vscode.TextEditor> {
  const doc = await vscode.workspace.openTextDocument({ language, content });
  return vscode.window.showTextDocument(doc);
}

async function replaceAll(
  editor: vscode.TextEditor,
  content: string,
): Promise<void> {
  const doc = editor.document;
  const whole = new vscode.Range(
    doc.positionAt(0),
    doc.positionAt(doc.getText().length),
  );
  assert.ok(
    await editor.edit((edit) => {
      edit.replace(whole, content);
    }),
  );
}

/** Resolves with the document's diagnostics once `done` accepts them. */
function waitForDiagnostics(
  uri: vscode.Uri,
  done: (diagnostics: vscode.Diagnostic[]) => boolean,
  timeoutMs = 10_000,
): Promise<vscode.Diagnostic[]> {
  return new Promise((resolve, reject) => {
    const check = (): boolean => {
      const current = vscode.languages.getDiagnostics(uri);
      if (!done(current)) {
        return false;
      }
      clearTimeout(timer);
      sub.dispose();
      resolve(current);
      return true;
    };
    const timer = setTimeout(() => {
      sub.dispose();
      reject(
        new Error(
          `Timeout waiting for diagnostics: ${JSON.stringify(vscode.languages.getDiagnostics(uri))}`,
        ),
      );
    }, timeoutMs);
    const sub = vscode.languages.onDidChangeDiagnostics((e) => {
      if (e.uris.some((u) => u.toString() === uri.toString())) {
        check();
      }
    });
    check();
  });
}

/** Polls `condition` until it holds or `timeoutMs` passes; resolves with its last value. */
async function eventually(
  condition: () => boolean,
  timeoutMs = 10_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  return condition();
}

interface SyntaxToken {
  /** The text of the token. */
  c: string;
  /** Its TextMate scopes, outermost first, separated by spaces. */
  t: string;
}

/**
 * How VS Code's TextMate engine colors a file: [text, innermost scope] for each
 * token that is not whitespace. Uses the internal command that VS Code's own
 * grammar tests use.
 */
async function syntaxTokens(uri: vscode.Uri): Promise<[string, string][]> {
  const tokens = await vscode.commands.executeCommand<SyntaxToken[]>(
    "_workbench.captureSyntaxTokens",
    uri,
  );
  return tokens
    .filter((token) => token.c.trim() !== "")
    .map((token) => [token.c.trim(), token.t.split(" ").at(-1) ?? ""]);
}

suite("Structured English extension", () => {
  // Opening a Structured English file must activate the extension by itself.
  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `Extension ${EXTENSION_ID} not found`);
    assert.ok(!ext.isActive, "extension is active before any .se file is open");
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "test workspace folder is open");
    await vscode.workspace.openTextDocument(
      path.join(folder.uri.fsPath, "example.se"),
    );
    assert.ok(
      await eventually(() => ext.isActive),
      "opening a .se file did not activate the extension",
    );
  });

  teardown(() =>
    vscode.commands.executeCommand("workbench.action.closeAllEditors"),
  );

  test("opens .se files as Structured English", async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "test workspace folder is open");
    const doc = await vscode.workspace.openTextDocument(
      path.join(folder.uri.fsPath, "example.se"),
    );
    assert.strictEqual(doc.languageId, LANGUAGE);
    // The sample file is well formed.
    await vscode.window.showTextDocument(doc);
    assert.deepStrictEqual(vscode.languages.getDiagnostics(doc.uri), []);
  });

  test("reports parser errors as diagnostics", async () => {
    const { document } = await open(
      "IF vim is not installed\n    Install vim\n",
    );
    const [diagnostic] = await waitForDiagnostics(
      document.uri,
      (d) => d.length > 0,
    );
    assert.strictEqual(diagnostic.code, "unclosed-block");
    assert.strictEqual(diagnostic.source, "Structured English");
    assert.strictEqual(diagnostic.severity, vscode.DiagnosticSeverity.Error);
    assert.strictEqual(
      diagnostic.message,
      "IF is not closed before the end of the file; add END IF",
    );
    assert.ok(diagnostic.range.isEqual(new vscode.Range(0, 0, 0, 2)));
  });

  test("updates diagnostics as the document changes", async () => {
    const editor = await open("WHILE x\n    y\n");
    await waitForDiagnostics(editor.document.uri, (d) => d.length === 1);
    await replaceAll(editor, "WHILE x\n    y\nEND WHILE\n");
    await waitForDiagnostics(editor.document.uri, (d) => d.length === 0);
    await replaceAll(editor, "END WHILE\n");
    const [diagnostic] = await waitForDiagnostics(
      editor.document.uri,
      (d) => d.length === 1,
    );
    assert.strictEqual(diagnostic.code, "unexpected-keyword");
  });

  test("leaves documents in other languages alone", async () => {
    const { document } = await open("IF a\n", "plaintext");
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
    assert.deepStrictEqual(vscode.languages.getDiagnostics(document.uri), []);
  });

  test("colors .se files with the grammar", async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "test workspace folder is open");
    const uri = vscode.Uri.file(path.join(folder.uri.fsPath, "example.se"));
    const tokens = await syntaxTokens(uri);
    const scope = (name: string): string => `${name}.structured-english`;
    assert.deepStrictEqual(tokens.slice(0, 3), [
      ["# Make sure vim is set up", scope("comment.line")],
      ["IF", scope("keyword.control")],
      ["vim is not installed", scope("variable.parameter")],
    ]);
    assert.deepStrictEqual(tokens.slice(-10), [
      ["FOR", scope("keyword.control")],
      ["EACH", scope("keyword.operator.wordlike")],
      ["file", scope("variable.parameter")],
      ["IN", scope("keyword.operator.wordlike")],
      ["~/.vimrc", scope("string.other.literal")],
      ["AND", scope("keyword.operator.wordlike")],
      ["~/.viminfo", scope("string.other.literal")],
      ["Copy the file to", scope("entity.name.function")],
      ['"backup"', scope("string.other.literal")],
      ["END FOR", scope("keyword.control")],
    ]);
  });

  test("highlights matching block keywords", async () => {
    const { document } = await open("IF a\n    x\nELSE\n    y\nEND IF\n");
    const highlights = await vscode.commands.executeCommand<
      vscode.DocumentHighlight[]
    >(
      "vscode.executeDocumentHighlights",
      document.uri,
      new vscode.Position(0, 1),
    );
    assert.deepStrictEqual(
      highlights.map((h) => h.range.start.line),
      [0, 2, 4],
    );
  });

  test("toggles line comments with #", async () => {
    const editor = await open("Install vim\n");
    editor.selection = new vscode.Selection(0, 0, 0, 0);
    await vscode.commands.executeCommand("editor.action.commentLine");
    assert.strictEqual(editor.document.lineAt(0).text, "# Install vim");
  });

  test("indents after a block opener", async () => {
    const editor = await open("IF a");
    editor.selection = new vscode.Selection(0, 4, 0, 4);
    await vscode.commands.executeCommand("type", { text: "\n" });
    assert.match(editor.document.lineAt(1).text, /^\s+$/);
  });
});
