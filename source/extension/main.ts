import { chmod, mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import * as v from "valibot";
import * as vscode from "vscode";
import type {
  _Author_Doctor_,
  _Document_Doctor_,
  _Id_Document_,
  _Id_Task_,
  _Reason_Task_,
  _Target_Request_,
  _Task_Doctor_,
} from "../shared/domain.next.ts";
import { latestBrief, nameOf } from "../shared/brief.ts";
import { parse, parseOwn } from "../shared/parse.ts";
import {
  endpointUrlSchema,
  focusDraftingSchema,
  tokenSchema,
  type _Active_Status_,
  type _CHANGE_Message__Client_,
  type _FORGET_Message__Client_,
  type _Focus_Drafting_,
  type _REQUEST_Message__Client_,
  type _View_Drafting_,
  type _Listed_Document_,
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
import { presence, serveAgent, wake, whenPresenceChanges } from "./agent.ts";
import { mintToken, startEndpoint, type _Connect_Endpoint_, type _Serve_Endpoint_ } from "./endpoint.ts";
import {
  accept,
  addRequest,
  cancelTask,
  completeTask,
  createDraft,
  createTask,
  discardDraft,
  dropRequest,
  agentsTurn,
  listTasks,
  makeActive,
  parkTask,
  readTask,
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

interface _Known_Document_ {
  file: string;
  title: string;
}

// which file each document is in, and its title, found across the
// workspace and kept current as files come and go
const documentFiles = new Map<_Id_Document_, _Known_Document_>();

const know = (document: _Document_Doctor_, file: string) =>
  documentFiles.set(document.id, { file, title: document.content.title.text });

async function indexFile(file: string): Promise<void> {
  const result = await readDocument(file);
  if (result.kind === "parsed") know(result.value, file);
}

function forgetFile(file: string): void {
  for (const [id, known] of documentFiles) if (known.file === file) documentFiles.delete(id);
}

function listedDocuments(): Array<_Listed_Document_> {
  return [...documentFiles]
    .map(([document, known]) => ({ document, title: known.title, path: vscode.workspace.asRelativePath(known.file) }))
    .toSorted((first, second) => first.title.localeCompare(second.title) || first.path.localeCompare(second.path));
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
  return [
    {
      data: dataFolderOf(folder),
      fileOf: (id) => [documentFiles.get(id)?.file ?? ""].filter((file) => file !== ""),
      catalog: listedDocuments,
    },
  ];
}

// the sessions showing the task list
const watchers = new Set<_Send_Session_>();

const documentsIn = (file: string) => [...documentFiles].filter(([, known]) => known.file === file).map(([id]) => id);

const unknownIn = (targets: Array<_Target_Request_>) => [
  ...new Set(targets.filter((target) => !documentFiles.has(target.document)).map((target) => target.document)),
];

// What's being drafted, if anything: where requests made in any editor go.
// It's kept with the workspace, so it lasts across reloads.
let drafting: Array<_Focus_Drafting_> = [];
let memories: Array<vscode.Memento> = [];

function draftOn(next: Array<_Focus_Drafting_>): void {
  drafting = next;
  for (const memory of memories) void memory.update("doctor.drafting", next);
}

const draftingTask = (task: _Id_Task_) => drafting.some((focus) => focus.kind === "draft" && focus.task === task);

// what's being drafted as an editor of this file shows it
function draftingIn(tasks: Array<_Task_Doctor_>, file: string): Array<_View_Drafting_> {
  const documents = documentsIn(file);
  return drafting.flatMap((focus): Array<_View_Drafting_> => {
    if (focus.kind === "new") return [focus];
    return tasks
      .filter((task) => task.state === "draft" && task.id === focus.task)
      .map((task) => {
        const { requests } = latestBrief(task);
        const here = requests.flatMap((request) => {
          const targets = request.targets.filter((target) => documents.includes(target.document));
          return targets.length === 0 ? [] : [{ request: request.id, text: request.text.text, targets }];
        });
        return { kind: "draft", task: task.id, name: nameOf(task), count: requests.length, here };
      });
  });
}

// The proposals of the active task waiting for review on a file; only the
// active task has any. Each is headed by the requests it answers, or the
// task's name when it names none.
function openProposals(tasks: Array<_Task_Doctor_>, file: string): Array<_Open_Proposal_> {
  const documents = documentsIn(file);
  return tasks.flatMap((task) => {
    if (task.state !== "working" && task.state !== "reviewing") return [];
    const { requests } = latestBrief(task);
    return task.proposals.flatMap((proposal): Array<_Open_Proposal_> => {
      if (proposal.state !== "proposed" || !documents.includes(proposal.document)) return [];
      const { version } = proposal.rounds[proposal.rounds.length - 1] ?? proposal.rounds[0];
      const answered = requests.filter((request) => version.answers.includes(request.id)).map((request) => request.text.text);
      const instruction = answered.length > 0 ? answered.join(" · ") : nameOf(task);
      return [{ task: task.id, instruction, proposal: proposal.id, operations: version.operations }];
    });
  });
}

const agentPrompt =
  "Work on doctor's tasks: run `doctor help` once, then run `doctor wait`, do the step it gives you, and run `doctor wait` again.";

// the active task as an editor's bar shows it: whose turn it is, and where
// the agent is
function statusOf(tasks: Array<_Task_Doctor_>): Array<_Active_Status_> {
  const agents = agentsTurn(tasks).map((task) => task.id);
  return tasks.flatMap((task): Array<_Active_Status_> =>
    task.state === "working" || task.state === "reviewing"
      ? [{ task: task.id, name: nameOf(task), state: task.state, turn: agents.includes(task.id) ? "agent" : "human", agent: presence() }]
      : [],
  );
}

// tells every view what changed in the tasks, and any agent waiting its turn
async function announce(problems: Array<string>, to: Array<_Send_Session_>): Promise<void> {
  const [place] = tasksPlace();
  if (place === undefined) return;
  const tasks = await listTasks(place);
  // a draft started, discarded or gone elsewhere is no longer being drafted
  const lost = drafting.some((focus) => focus.kind === "draft" && !tasks.some((task) => task.id === focus.task && task.state === "draft"));
  if (lost) draftOn([]);
  const documents = listedDocuments();
  for (const send of watchers) send({ kind: "tasks", tasks, documents, drafting, problems: to.includes(send) ? problems : [] });
  for (const [file, sends] of viewers) {
    for (const send of sends) {
      send({ kind: "proposals", file, open: openProposals(tasks, file), problems: to.includes(send) ? problems : [] });
      send({ kind: "focus", file, drafting: draftingIn(tasks, file) });
      send({ kind: "status", file, active: statusOf(tasks) });
    }
  }
  wake();
}

// tells every editor the agent's presence changed, and nothing else
async function tellStatus(): Promise<void> {
  const [place] = tasksPlace();
  if (place === undefined) return;
  const active = statusOf(await listTasks(place));
  for (const [file, sends] of viewers) for (const send of sends) send({ kind: "status", file, active });
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
  if (place === undefined) return;
  const unknown = unknownIn(message.targets);
  if (unknown.length > 0) return announce([`there's no document ${unknown.join(", ")} in the workspace`], [send]);
  await createTask(place, { text: message.text, overlay: [] }, message.targets);
  await announce([], [send]);
}

// A request for the task being drafted: the first makes the draft, and each
// one after adds to it.
async function addToDraft(message: _REQUEST_Message__Client_, send: _Send_Session_): Promise<void> {
  const [place] = tasksPlace();
  const [focus] = drafting;
  if (place === undefined) return;
  if (focus === undefined) return announce(["no task is being drafted: start drafting one first"], [send]);
  const unknown = unknownIn(message.targets);
  if (unknown.length > 0) return announce([`there's no document ${unknown.join(", ")} in the workspace`], [send]);
  const text = { text: message.text, overlay: [] };
  if (focus.kind === "new") {
    const draft = await createDraft(place, text, message.targets);
    draftOn([{ kind: "draft", task: draft.id }]);
    return announce([], [send]);
  }
  const outcome = await addRequest(place, focus.task, text, message.targets);
  return announce(outcome.kind === "refused" ? outcome.issues : [], [send]);
}

async function forgetRequest(message: _FORGET_Message__Client_, send: _Send_Session_): Promise<void> {
  const [place] = tasksPlace();
  if (place === undefined) return;
  const outcome = await dropRequest(place, message.task, message.request);
  return announce(outcome.kind === "refused" ? outcome.issues : [], [send]);
}

async function focusDraft(task: _Id_Task_, send: _Send_Session_): Promise<void> {
  const [place] = tasksPlace();
  if (place === undefined) return;
  const read = await readTask(place, task);
  if (read.kind === "rejected") return announce(read.issues, [send]);
  if (read.value.state !== "draft") return announce([`task ${task} is ${read.value.state}: only a draft can be drafted`], [send]);
  draftOn([{ kind: "draft", task }]);
  return announce([], [send]);
}

async function discard(task: _Id_Task_, send: _Send_Session_): Promise<void> {
  const [place] = tasksPlace();
  if (place === undefined) return;
  const outcome = await discardDraft(place, task);
  if (outcome.kind === "done" && draftingTask(task)) draftOn([]);
  return announce(outcome.kind === "refused" ? outcome.issues : [], [send]);
}

// a task of one request for whole documents, picked in the Explorer: the one
// clicked, or every one selected
async function newTaskForFiles(clicked: unknown, selected: unknown): Promise<void> {
  const [place] = tasksPlace();
  if (place === undefined) return;
  const uris = Array.isArray(selected) ? selected : [clicked];
  const files = uris.flatMap((uri) => (uri instanceof vscode.Uri && uri.fsPath.endsWith(documentSuffix) ? [uri.fsPath] : []));
  const read = await Promise.all(files.map((file) => readDocument(file)));
  const targets = read.flatMap((result): Array<_Target_Request_> => (result.kind === "parsed" ? [{ kind: "document", document: result.value.id }] : []));
  if (targets.length === 0) {
    void vscode.window.showWarningMessage(`doctor: pick one or more readable *${documentSuffix} files for the task`);
    return;
  }
  const instruction = await vscode.window.showInputBox({
    title: "doctor: quick task",
    prompt: targets.length === 1 ? "What should change in this document?" : `What should change in these ${targets.length} documents?`,
    ignoreFocusOut: true,
  });
  if (instruction === undefined || instruction.trim() === "") return;
  await createTask(place, { text: instruction.trim(), overlay: [] }, targets);
  await announce([], []);
}

async function activateTask(task: _Id_Task_, send: _Send_Session_): Promise<void> {
  const [place] = tasksPlace();
  if (place === undefined) return;
  const outcome = await makeActive(place, task);
  if (outcome.kind === "done" && draftingTask(task)) draftOn([]);
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
  if (result.kind === "parsed") know(result.value, file);
  send(
    result.kind === "parsed"
      ? { kind: "opened", file, document: result.value }
      : { kind: "unreadable", file, issues: result.issues },
  );
  const [place] = tasksPlace();
  if (place === undefined) return;
  const tasks = await listTasks(place);
  send({ kind: "proposals", file, open: openProposals(tasks, file), problems: [] });
  send({ kind: "focus", file, drafting: draftingIn(tasks, file) });
  send({ kind: "status", file, active: statusOf(tasks) });
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
        case "drafting":
          if (caller === "human") {
            draftOn([{ kind: "new" }]);
            void announce([], [send]);
          }
          return;
        case "request":
          if (caller === "human") void addToDraft(message, send);
          return;
        case "forget":
          if (caller === "human") void forgetRequest(message, send);
          return;
        case "focus":
          if (caller === "human") void focusDraft(message.task, send);
          return;
        case "unfocus":
          if (caller === "human") {
            draftOn([]);
            void announce([], [send]);
          }
          return;
        case "discard":
          if (caller === "human") void discard(message.task, send);
          return;
        case "copyPrompt":
          if (caller === "human") void vscode.env.clipboard.writeText(agentPrompt);
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
  memories = [context.workspaceState];
  whenPresenceChanges(() => void tellStatus());
  const kept = parse(v.array(focusDraftingSchema), context.workspaceState.get("doctor.drafting"));
  drafting = kept.kind === "parsed" ? kept.value : [];
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
    vscode.commands.registerCommand("doctor.newTaskForFiles", newTaskForFiles),
  );
}
