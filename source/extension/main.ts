import { basename } from "node:path";
import * as vscode from "vscode";
import type { _Author_Doctor_ } from "../shared/domain.next.ts";
import { parseOwn } from "../shared/parse.ts";
import {
  endpointUrlSchema,
  type _CHANGE_Message__Client_,
  type _Message_Server_,
} from "../shared/protocol.ts";
import { createDocument, makeChange } from "./changes.ts";
import { registerDashboardSerializer, showDashboard } from "./dashboard.ts";
import { documentViewType, registerDocumentEditor } from "./documentEditor.ts";
import { documentSuffix, newDocument, readDocument } from "./documents.ts";
import { mintToken, startEndpoint, type _Connect_Endpoint_ } from "./endpoint.ts";

type _Send_Session_ = (message: _Message_Server_) => void;

function folderOf(file: string): vscode.WorkspaceFolder | undefined {
  return file.endsWith(documentSuffix) ? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(file)) : undefined;
}

const outsideIssue = `only ${documentSuffix} files in the workspace can be opened`;

const viewers = new Map<string, Set<_Send_Session_>>();

async function open(file: string, send: _Send_Session_): Promise<void> {
  const result = await readDocument(file);
  send(
    result.kind === "parsed"
      ? { kind: "opened", file, document: result.value }
      : { kind: "unreadable", file, issues: result.issues },
  );
}

async function change(caller: _Author_Doctor_, message: _CHANGE_Message__Client_, send: _Send_Session_) {
  const { file } = message;
  const folder = folderOf(file);
  if (folder === undefined) {
    send({ kind: "refused", file, issues: [outsideIssue] });
    return;
  }
  if (caller !== "human") {
    send({ kind: "refused", file, issues: ["changes in place come from the document editor"] });
    return;
  }
  const outcome = await makeChange({
    file,
    folder: folder.uri.fsPath,
    author: caller,
    operations: message.operations,
  });
  switch (outcome.kind) {
    case "applied":
      send({ kind: "applied", file, document: outcome.document });
      for (const viewer of viewers.get(file) ?? []) {
        if (viewer !== send) viewer({ kind: "updated", file, document: outcome.document });
      }
      return;
    case "refused":
      send({ kind: "refused", file, issues: outcome.issues });
      return;
  }
}

const connect: _Connect_Endpoint_ = (caller, send) => {
  const opened = new Set<string>();
  return {
    receive: (message) => {
      switch (message.kind) {
        case "open":
          if (folderOf(message.file) === undefined) {
            send({ kind: "unreadable", file: message.file, issues: [outsideIssue] });
            return;
          }
          opened.add(message.file);
          viewers.set(message.file, (viewers.get(message.file) ?? new Set()).add(send));
          void open(message.file, send);
          return;
        case "change":
          void change(caller, message, send);
          return;
      }
    },
    close: () => {
      for (const file of opened) viewers.get(file)?.delete(send);
    },
  };
};

async function newDocumentCommand(): Promise<void> {
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
  const into = folderOf(file);
  if (into === undefined) {
    void vscode.window.showErrorMessage(`doctor documents live in the workspace, as *${documentSuffix} files`);
    return;
  }
  await createDocument(file, into.uri.fsPath, newDocument(basename(file, documentSuffix)), "human");
  await vscode.commands.executeCommand("vscode.openWith", vscode.Uri.file(file), documentViewType);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const tokens = { human: mintToken(), agent: mintToken() };
  const running = await startEndpoint(tokens, connect);
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
    vscode.commands.registerCommand("doctor.newDocument", newDocumentCommand),
  );
}
