// vscode-oniguruma's typings name two WebAssembly types, which come from the DOM
// lib; this project's lib is ES2022 and @types/node does not declare them. The
// grammar tests only pass the engine a wasm buffer, so opaque types suffice.
// Delete this file if @types/node starts declaring the WebAssembly namespace.
declare namespace WebAssembly {
  type ImportValue = unknown;
  type WebAssemblyInstantiatedSource = unknown;
}
