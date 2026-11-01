import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import type { _Config_Webview_ } from "../shared/protocol.ts";

export function webviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
  return { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, "webview")] };
}

export function renderWebview(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  config: _Config_Webview_,
): string {
  const asset = (name: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "webview", name)).toString();
  const endpoint = new URL(config.endpoint);
  const socketOrigin = `${endpoint.protocol === "https:" ? "wss:" : "ws:"}//${endpoint.host}`;
  const nonce = randomBytes(16).toString("base64");
  // Monaco writes style elements of its own, and runs its worker from a
  // blob made of a script it fetches
  const monaco = config.kind === "text";
  const policy = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src ${webview.cspSource}${monaco ? " 'unsafe-inline'" : ""}`,
    `font-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} data:`,
    `connect-src ${endpoint.origin} ${socketOrigin}${monaco ? ` ${webview.cspSource}` : ""}`,
    ...(monaco ? ["worker-src blob:"] : []),
  ].join("; ");
  // a JSON script block isn't run; < is escaped so the data can't close it
  const configJson = JSON.stringify(config).replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${policy}" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="${asset(`${config.kind}.css`)}" />
    <title>doctor</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="application/json" id="doctor-config">${configJson}</script>
    <script type="module" nonce="${nonce}" src="${asset(`${config.kind}.js`)}"></script>
  </body>
</html>`;
}
