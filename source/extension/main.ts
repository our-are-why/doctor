import { chmod, mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import * as v from "valibot";
import * as vscode from "vscode";
import type { _Author_Doctor_, _Id_Document_, _Id_Task_, _Reason_Task_, _Task_Doctor_ } from "../shared/domain.next.ts";
import { parse, parseOwn } from "../shared/parse.ts";
import {
  endpointUrlSchema,
  tokenSchema,
  type _CHANGE_Message__Client_,
  type _Message_Server_,
  type _Open_Proposal_,
  type _REVIEW_Message__Client_,
  type _TASK_Message__Client_,
  type _Token_Endpoint_,
} from "../shared/protocol.ts";
import { createDocument, makeChange } from "./changes.ts";
import { registerDashboardSerializer, showDashboard } from "./dashboard.ts";
import { documentViewType, registerDocumentEditor, textViewType } from "./documentEditor.ts";
import { documentSuffix, newDocument, readDocument } from "./documents.ts";
import { presence, serveAgent, wake } from "./agent.ts";
import { mintToken, startEndpoint, type _Connect_Endpoint_, type _Serve_Endpoint_ } from "./endpoint.ts";
import {
  accept,
  cancelTask,
  completeTask,
  createTask,
  agentsTurn,
  listTasks,
  makeActive,
  parkTask,
  reject,
  requestChanges,
  type _Place_Tasks_,
} from "./tasks.ts";

type _Send_Session_ = (message: _Message_Server_) => void;

function folderOf(file: string): vscode.WorkspaceFolder | undefined {
  return file.endsWith(documentSuffix) ? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(file)) : undefined;
}

const dataFolderSchema = v.pipe(v.string(), v.minLength(1));

// where doctor keeps a workspace folder's history and versions: .doctor at
// its root, unless the doctor.dataFolder setting says otherwise
function dataFolderOf(folder: vscode.WorkspaceFolder): string {
  const setting = parse(dataFolderSchema, vscode.workspace.getConfiguration("doctor", folder.uri).get("dataFolder"));
  return resolve(folder.uri.fsPath, setting.kind === "parsed" ? setting.value : ".doctor");
}

const outsideIssue = `only ${documentSuffix} files in the workspace can be opened`;

const viewers = new Map<string, Set<_Send_Session_>>();

// which file each document is in, found across the workspace and kept
// current as files come and go
const documentFiles = new Map<_Id_Document_, string>();

async function indexFile(file: string): Promise<void> {
  const result = await readDocument(file);
  if (result.kind === "parsed") documentFiles.set(result.value.id, file);
}

function forgetFile(file: string): void {
  for (const [id, known] of documentFiles) if (known === file) documentFiles.delete(id);
}

async function indexDocuments(): Promise<vscode.Disposable> {
  const found = await vscode.workspace.findFiles(`**/*${documentSuffix}`, "**/{node_modules,.doctor}/**");
  await Promise.all(found.map((uri) => indexFile(uri.fsPath)));
  const watcher = vscode.workspace.createFileSystemWatcher(`**/*${documentSuffix}`);
  watcher.onDidCreate((uri) => void indexFile(uri.fsPath));
  watcher.onDidChange((uri) => void indexFile(uri.fsPath));
  watcher.onDidDelete((uri) => forgetFile(uri.fsPath));
  return watcher;
}

// tasks live in the first workspace folder's data folder
function tasksPlace(): Array<_Place_Tasks_> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder === undefined) return [];
  return [{ data: dataFolderOf(folder), fileOf: (id) => [documentFiles.get(id) ?? ""].filter((file) => file !== "") }];
}

// the sessions showing the task list
const watchers = new Set<_Send_Session_>();

// the proposals of the active task waiting for review on a file; only the
// active task has any
function openProposals(tasks: Array<_Task_Doctor_>, file: string): Array<_Open_Proposal_> {
  const documents = [...documentFiles].filter(([, known]) => known === file).map(([id]) => id);
  return tasks.flatMap((task) => {
    if (task.state !== "working" && task.state !== "reviewing") return [];
    const latest = task.brief.versions[task.brief.versions.length - 1] ?? task.brief.versions[0];
    return task.proposals.flatMap((proposal): Array<_Open_Proposal_> => {
      if (proposal.state !== "proposed" || !documents.includes(proposal.document)) return [];
      const { version } = proposal.rounds[proposal.rounds.length - 1] ?? proposal.rounds[0];
      return [{ task: task.id, instruction: latest.instruction.text, proposal: proposal.id, operations: version.operations }];
    });
  });
}

const agentPrompt =
  "Work on doctor's tasks: run `doctor help` once, then run `doctor wait`, do the step it gives you, and run `doctor wait` again.";

// the agent's turn last told about, so a turn nobody's waiting for is told once
let reminded = "";

function remind(tasks: Array<_Task_Doctor_>): void {
  const [task] = agentsTurn(tasks);
  if (task === undefined) return;
  const turn = [task.id, ...task.proposals.map((proposal) => `${proposal.id}:${proposal.state}:${proposal.rounds.length}`)].join(" ");
  if (turn === reminded || presence() !== "away") return;
  reminded = turn;
  void vscode.window
    .showInformationMessage(`doctor: task ${task.id} is the agent's turn, and no agent is waiting for it.`, "Copy what to tell your agent")
    .then((picked) => {
      if (picked !== undefined) void vscode.env.clipboard.writeText(agentPrompt);
    });
}

// tells every view what changed in the tasks, and any agent waiting its turn
async function announce(problems: Array<string>, to: Array<_Send_Session_>): Promise<void> {
  const [place] = tasksPlace();
  if (place === undefined) return;
  const tasks = await listTasks(place);
  for (const send of watchers) send({ kind: "tasks", tasks, problems: to.includes(send) ? problems : [] });
  for (const [file, sends] of viewers) {
    for (const send of sends) {
      send({ kind: "proposals", file, open: openProposals(tasks, file), problems: to.includes(send) ? problems : [] });
    }
  }
  wake();
  remind(tasks);
}

const serve: _Serve_Endpoint_ = async (caller, request) => {
  const [place] = tasksPlace();
  if (place === undefined) return { status: 404, body: { issues: ["doctor needs a workspace folder"] } };
  const answer = await serveAgent(place, caller, request);
  if (request.method === "POST") void announce([], []);
  return answer;
};

async function makeTask(message: _TASK_Message__Client_, send: _Send_Session_): Promise<void> {
  const [place] = tasksPlace();
  const read = await readDocument(message.file);
  if (place === undefined || read.kind === "rejected") return;
  const nodes = message.scope.length > 0 ? message.scope : read.value.content.children.map((block) => block.id);
  await createTask(
    place,
    { text: message.instruction, overlay: [] },
    nodes.map((node) => ({ document: read.value.id, node })),
  );
  await announce([], [send]);
}

async function activateTask(task: _Id_Task_, send: _Send_Session_): Promise<void> {
  const [place] = tasksPlace();
  if (place === undefined) return;
  const outcome = await makeActive(place, task);
  return announce(outcome.kind === "refused" ? outcome.issues : [], [send]);
}

async function parkActive(task: _Id_Task_, send: _Send_Session_): Promise<void> {
  const [place] = tasksPlace();
  if (place === undefined) return;
  const outcome = await parkTask(place, task);
  return announce(outcome.kind === "refused" ? outcome.issues : [], [send]);
}

async function finishTask(task: _Id_Task_, send: _Send_Session_): Promise<void> {
  const [place] = tasksPlace();
  if (place === undefined) return;
  const outcome = await completeTask(place, task);
  return announce(outcome.kind === "refused" ? outcome.issues : [], [send]);
}

async function dropTask(task: _Id_Task_, send: _Send_Session_): Promise<void> {
  const [place] = tasksPlace();
  if (place === undefined) return;
  const written = await vscode.window.showInputBox({
    title: `doctor: cancel task ${task}`,
    prompt: "Why cancel it? Leave this empty to give no reason, or press Escape to keep the task.",
    ignoreFocusOut: true,
  });
  if (written === undefined) return;
  const reason: _Reason_Task_ =
    written.trim() === "" ? { kind: "unstated" } : { kind: "stated", text: { text: written.trim(), overlay: [] } };
  const outcome = await cancelTask(place, task, reason);
  return announce(outcome.kind === "refused" ? outcome.issues : [], [send]);
}

async function reviewProposal(message: _REVIEW_Message__Client_, send: _Send_Session_): Promise<void> {
  const [place] = tasksPlace();
  if (place === undefined) return;
  const { verdict } = message;
  if (verdict.kind === "accept") {
    const outcome = await accept(place, message.task, message.proposal);
    if (outcome.kind === "refused") return announce(outcome.issues, [send]);
    for (const viewer of viewers.get(outcome.value.file) ?? []) {
      viewer({ kind: "updated", file: outcome.value.file, document: outcome.value.document });
    }
    return announce([], [send]);
  }
  if (verdict.kind === "reject") {
    const outcome = await reject(place, message.task, message.proposal, { text: verdict.reason, overlay: [] });
    return announce(outcome.kind === "refused" ? outcome.issues : [], [send]);
  }
  const outcome = await requestChanges(place, message.task, message.proposal, { text: verdict.feedback, overlay: [] });
  return announce(outcome.kind === "refused" ? outcome.issues : [], [send]);
}

// the doctor command, on every new terminal's path: VS Code's own Node
// running the bundled CLI, so there's nothing to install
async function installCommand(context: vscode.ExtensionContext): Promise<string> {
  const bin = join(context.globalStorageUri.fsPath, "bin");
  await mkdir(bin, { recursive: true });
  const launcher = join(bin, "doctor");
  const cli = join(context.extensionPath, "cli.js");
  await writeFile(launcher, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(cli)} "$@"\n`);
  await chmod(launcher, 0o755);
  return bin;
}

async function open(file: string, send: _Send_Session_): Promise<void> {
  const result = await readDocument(file);
  if (result.kind === "parsed") documentFiles.set(result.value.id, file);
  send(
    result.kind === "parsed"
      ? { kind: "opened", file, document: result.value }
      : { kind: "unreadable", file, issues: result.issues },
  );
  const [place] = tasksPlace();
  if (place !== undefined) send({ kind: "proposals", file, open: openProposals(await listTasks(place), file), problems: [] });
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
    data: dataFolderOf(folder),
    author: caller,
    source: { kind: "inline" },
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
        case "task":
          if (caller === "human") void makeTask(message, send);
          return;
        case "review":
          if (caller === "human") void reviewProposal(message, send);
          return;
        case "watch":
          watchers.add(send);
          void announce([], []);
          return;
        case "activate":
          if (caller === "human") void activateTask(message.task, send);
          return;
        case "park":
          if (caller === "human") void parkActive(message.task, send);
          return;
        case "complete":
          if (caller === "human") void finishTask(message.task, send);
          return;
        case "cancel":
          if (caller === "human") void dropTask(message.task, send);
          return;
      }
    },
    close: () => {
      for (const file of opened) viewers.get(file)?.delete(send);
      watchers.delete(send);
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
  await createDocument(file, dataFolderOf(into), newDocument(basename(file, documentSuffix)), "human");
  await vscode.commands.executeCommand("vscode.openWith", vscode.Uri.file(file), textViewType);
}

const portSchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65_535));

// The agent's token and the endpoint's port, kept with the workspace so a
// reloaded window's endpoint comes back where its terminals were told it
// is. The token's no more open there than in every terminal's environment.
function agentToken(context: vscode.ExtensionContext): _Token_Endpoint_ {
  const kept = parse(tokenSchema, context.workspaceState.get("doctor.agentToken"));
  return kept.kind === "parsed" ? kept.value : mintToken();
}

function keptPorts(context: vscode.ExtensionContext): Array<number> {
  const kept = parse(portSchema, context.workspaceState.get("doctor.port"));
  return kept.kind === "parsed" ? [kept.value] : [];
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const tokens = { human: mintToken(), agent: agentToken(context) };
  const running = await startEndpoint(tokens, connect, serve, keptPorts(context));
  context.subscriptions.push({ dispose: () => void running.close() });
  await context.workspaceState.update("doctor.agentToken", tokens.agent);
  await context.workspaceState.update("doctor.port", running.port);

  const local = `http://127.0.0.1:${running.port}/`;
  const external = await vscode.env.asExternalUri(vscode.Uri.parse(local));
  const endpoint = parseOwn(endpointUrlSchema, external.toString(true));

  // every new terminal can find the endpoint, and calls it as the agent
  const environment = context.environmentVariableCollection;
  environment.persistent = false;
  environment.replace("DOCTOR_ENDPOINT", local);
  environment.replace("DOCTOR_TOKEN", tokens.agent);
  environment.prepend("PATH", `${await installCommand(context)}:`);
  context.subscriptions.push(await indexDocuments());

  context.subscriptions.push(
    registerDocumentEditor(documentViewType, "document", context.extensionUri, endpoint, tokens),
    registerDocumentEditor(textViewType, "text", context.extensionUri, endpoint, tokens),
    registerDashboardSerializer(context.extensionUri, endpoint, tokens),
    vscode.commands.registerCommand("doctor.openDashboard", () =>
      showDashboard(context.extensionUri, endpoint, tokens, vscode.ViewColumn.Active),
    ),
    vscode.commands.registerCommand("doctor.newDocument", newDocumentCommand),
  );
}
