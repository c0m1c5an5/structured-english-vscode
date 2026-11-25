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

/** The semantic token types of a document, decoded through its legend, in order. */
async function tokenTypes(doc: vscode.TextDocument): Promise<string[]> {
  const legend =
    await vscode.commands.executeCommand<vscode.SemanticTokensLegend>(
      "vscode.provideDocumentSemanticTokensLegend",
      doc.uri,
    );
  const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>(
    "vscode.provideDocumentSemanticTokens",
    doc.uri,
  );
  // Each token is 5 integers; the 4th is the index of its type in the legend.
  return Array.from(
    { length: tokens.data.length / 5 },
    (_, i) => legend.tokenTypes[tokens.data[i * 5 + 3]],
  );
}

suite("Structured English extension", () => {
  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `Extension ${EXTENSION_ID} not found`);
    await ext.activate();
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
    assert.strictEqual((await tokenTypes(doc))[0], "comment");
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

  test("provides semantic tokens with standard types", async () => {
    const { document } = await open('IF a AND "b"\n    Run ~/x.sh\nEND IF\n');
    assert.deepStrictEqual(await tokenTypes(document), [
      "keyword",
      "parameter",
      "keyword",
      "parameter",
      "string", // IF a AND "b"
      "function",
      "string", // Run ~/x.sh
      "keyword", // END IF
    ]);
  });

  test("semantic tokens follow edits", async () => {
    const editor = await open("x\n");
    assert.deepStrictEqual(await tokenTypes(editor.document), ["function"]);
    await replaceAll(editor, "# note\n");
    assert.deepStrictEqual(await tokenTypes(editor.document), ["comment"]);
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
