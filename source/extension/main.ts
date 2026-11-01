import * as vscode from "vscode";
import { parseOwn } from "../shared/parse.ts";
import { endpointUrlSchema } from "../shared/protocol.ts";
import { registerDashboardSerializer, showDashboard } from "./dashboard.ts";
import { registerDocumentEditor } from "./documentEditor.ts";
import { mintToken, startEndpoint } from "./endpoint.ts";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const tokens = { human: mintToken(), agent: mintToken() };
  const running = await startEndpoint(tokens);
  context.subscriptions.push({ dispose: () => void running.close() });

  const local = `http://127.0.0.1:${running.port}/`;
  const external = await vscode.env.asExternalUri(vscode.Uri.parse(local));
  const endpoint = parseOwn(endpointUrlSchema, external.toString(true));

  // every new terminal can find the endpoint, and calls it as the agent
  const environment = context.environmentVariableCollection;
  environment.persistent = false;
  environment.replace("DOCTOR_ENDPOINT", local);
  environment.replace("DOCTOR_TOKEN", tokens.agent);

  context.subscriptions.push(
    registerDocumentEditor(context.extensionUri, endpoint, tokens),
    registerDashboardSerializer(context.extensionUri, endpoint, tokens),
    vscode.commands.registerCommand("doctor.openDashboard", () =>
      showDashboard(context.extensionUri, endpoint, tokens, vscode.ViewColumn.Active),
    ),
  );
}
