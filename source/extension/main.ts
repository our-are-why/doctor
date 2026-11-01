import { basename } from "node:path";
import * as vscode from "vscode";
import { parseOwn } from "../shared/parse.ts";
import { endpointUrlSchema, type _Message_Server_ } from "../shared/protocol.ts";
import { registerDashboardSerializer, showDashboard } from "./dashboard.ts";
import { documentViewType, registerDocumentEditor } from "./documentEditor.ts";
import { documentSuffix, newDocument, readDocument, writeDocument } from "./documents.ts";
import { mintToken, startEndpoint, type _Handler_Endpoint_ } from "./endpoint.ts";

function isOpenable(file: string): boolean {
  return file.endsWith(documentSuffix) && vscode.workspace.getWorkspaceFolder(vscode.Uri.file(file)) !== undefined;
}

async function open(file: string, reply: (message: _Message_Server_) => void): Promise<void> {
  if (!isOpenable(file)) {
    reply({ kind: "unreadable", file, issues: [`only ${documentSuffix} files in the workspace can be opened`] });
    return;
  }
  const result = await readDocument(file);
  reply(
    result.kind === "parsed"
      ? { kind: "opened", file, document: result.value }
      : { kind: "unreadable", file, issues: result.issues },
  );
}

const handle: _Handler_Endpoint_ = (_caller, message, reply) => {
  switch (message.kind) {
    case "open":
      void open(message.file, reply);
      return;
  }
};

async function createDocument(): Promise<void> {
  const options: vscode.SaveDialogOptions = {
    title: "New doctor document",
    saveLabel: "Create",
    filters: { "doctor documents": ["doctor.json"] },
  };
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder) options.defaultUri = vscode.Uri.joinPath(folder.uri, `untitled${documentSuffix}`);
  const chosen = await vscode.window.showSaveDialog(options);
  if (!chosen) return;
  const file = chosen.fsPath.endsWith(documentSuffix)
    ? chosen.fsPath
    : `${chosen.fsPath.replace(/\.json$/, "")}${documentSuffix}`;
  await writeDocument(file, newDocument(basename(file, documentSuffix)));
  await vscode.commands.executeCommand("vscode.openWith", vscode.Uri.file(file), documentViewType);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const tokens = { human: mintToken(), agent: mintToken() };
  const running = await startEndpoint(tokens, handle);
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
    vscode.commands.registerCommand("doctor.newDocument", createDocument),
  );
}
