import * as vscode from "vscode";
import type { _Url_Endpoint_ } from "../shared/protocol.ts";
import type { _Tokens_Endpoint_ } from "./endpoint.ts";
import { renderWebview, webviewOptions } from "./webview.ts";

export const documentViewType = "doctor.document";
export const textViewType = "doctor.text";

export function registerDocumentEditor(
  viewType: string,
  kind: "document" | "text",
  extensionUri: vscode.Uri,
  endpoint: _Url_Endpoint_,
  tokens: _Tokens_Endpoint_,
): vscode.Disposable {
  const provider: vscode.CustomReadonlyEditorProvider = {
    openCustomDocument: (uri) => ({ uri, dispose: () => {} }),
    resolveCustomEditor: (document, panel) => {
      panel.webview.options = webviewOptions(extensionUri);
      panel.webview.html = renderWebview(panel.webview, extensionUri, {
        kind,
        endpoint,
        token: tokens.human,
        file: document.uri.fsPath,
      });
    },
  };
  return vscode.window.registerCustomEditorProvider(viewType, provider);
}
