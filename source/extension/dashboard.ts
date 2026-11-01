import * as vscode from "vscode";
import type { _Url_Endpoint_ } from "../shared/protocol.ts";
import type { _Tokens_Endpoint_ } from "./endpoint.ts";
import { renderWebview, webviewOptions } from "./webview.ts";

export const dashboardViewType = "doctor.dashboard";

function fill(
  panel: vscode.WebviewPanel,
  extensionUri: vscode.Uri,
  endpoint: _Url_Endpoint_,
  tokens: _Tokens_Endpoint_,
): void {
  panel.webview.options = webviewOptions(extensionUri);
  panel.webview.html = renderWebview(panel.webview, extensionUri, {
    kind: "dashboard",
    endpoint,
    token: tokens.human,
  });
}

export function showDashboard(
  extensionUri: vscode.Uri,
  endpoint: _Url_Endpoint_,
  tokens: _Tokens_Endpoint_,
  column: vscode.ViewColumn,
): void {
  const panel = vscode.window.createWebviewPanel(dashboardViewType, "tasks", column, webviewOptions(extensionUri));
  fill(panel, extensionUri, endpoint, tokens);
}

export function registerDashboardSerializer(
  extensionUri: vscode.Uri,
  endpoint: _Url_Endpoint_,
  tokens: _Tokens_Endpoint_,
): vscode.Disposable {
  return vscode.window.registerWebviewPanelSerializer(dashboardViewType, {
    deserializeWebviewPanel: async (panel) => fill(panel, extensionUri, endpoint, tokens),
  });
}
