import type {
  _ACTIVE_Task__Doctor_,
  _Author_Doctor_,
  _Id_Document_,
  _Proposal_Task_,
  _Reason_Task_,
  _Target_Request_,
  _Task_Doctor_,
  _WORKING_Task__Doctor_,
} from "../shared/domain.next.ts";
import { latestBrief, nameOf } from "../shared/brief.ts";
import { parse } from "../shared/parse.ts";
import { proposalPayloadSchema } from "../shared/protocol.ts";
import { documentIdSchema } from "../shared/schema.ts";
import { sliceOf } from "../shared/text.ts";
import { indexNodes, textOfNode, type _Index_Document_ } from "../shared/tree.ts";
import type { _Answer_Endpoint_, _Request_Endpoint_ } from "./endpoint.ts";
import {
  activeTask,
  agentsTurn,
  listTasks,
  propose,
  show,
  submit,
  type _Place_Tasks_,
  type _Shown_Document_,
} from "./tasks.ts";

const answer = (status: number, body: unknown): _Answer_Endpoint_ => ({ status, body });
const issues = (status: number, list: Array<string>) => answer(status, { issues: list });

const reasonOf = (reason: _Reason_Task_) => (reason.kind === "stated" ? { reason: reason.text.text } : {});

// what the agent needs of a proposal: where it stands, the requests it
// answers, what was asked of it if it's being revised, and why if it was
// turned down
function proposalSummary(proposal: _Proposal_Task_) {
  const last = proposal.rounds[proposal.rounds.length - 1] ?? proposal.rounds[0];
  return {
    proposal: proposal.id,
    document: proposal.document,
    state: proposal.state,
    answers: last.version.answers,
    ...(last.kind === "requested" ? { feedback: last.request.feedback.text } : {}),
    ...(proposal.state === "rejected" || proposal.state === "withdrawn" ? reasonOf(proposal.reason) : {}),
  };
}

interface _Seen_Document_ {
  shown: _Shown_Document_;
  index: _Index_Document_;
}

// A target as it is now: a whole document's blocks, a node, or a passage's
// words, or what's wrong if it can't be found.
function targetView(target: _Target_Request_, seen: Map<_Id_Document_, Array<_Seen_Document_>>) {
  const [document] = seen.get(target.document) ?? [];
  if (document === undefined) return { ...target, issues: [`there's no document ${target.document} to show`] };
  const { content } = document.shown.document;
  switch (target.kind) {
    case "document":
      return { kind: target.kind, document: target.document, blocks: content.children };
    case "node": {
      const entry = document.index.get(target.node);
      return entry === undefined
        ? { ...target, issues: [`node ${target.node} isn't in the document any more`] }
        : { kind: target.kind, document: target.document, node: entry.node };
    }
    case "passage": {
      const { holder } = target;
      const entry = holder.kind === "node" ? document.index.get(holder.node) : undefined;
      const [held] = holder.kind === "title" ? [content.title] : entry === undefined ? [] : textOfNode(entry.node);
      return held === undefined
        ? { ...target, issues: [`the text this passage was in isn't in the document any more`] }
        : { ...target, words: sliceOf(held.text, target.range.from, target.range.to) };
    }
  }
}

// The active task as the agent sees it: its requests, each target shown as
// it is now, and each document they target with the version to propose
// against. A request without targets reaches every document, which
// `doctor documents` lists.
async function taskView(place: _Place_Tasks_, task: _ACTIVE_Task__Doctor_) {
  const latest = latestBrief(task);
  const targeted = [...new Set(latest.requests.flatMap((request) => request.targets.map((target) => target.document)))];
  const seen = new Map<_Id_Document_, Array<_Seen_Document_>>();
  const documents = await Promise.all(
    targeted.map(async (id) => {
      const shown = await show(place, id);
      if (shown.kind === "refused") return { document: id, issues: shown.issues };
      seen.set(id, [{ shown: shown.value, index: indexNodes(shown.value.document.content) }]);
      return { document: id, title: shown.value.document.content.title.text, base: shown.value.base };
    }),
  );
  return {
    task: task.id,
    state: task.state,
    name: nameOf(task),
    requests: latest.requests.map((request) => ({
      request: request.id,
      text: request.text.text,
      targets: request.targets.map((target) => targetView(target, seen)),
    })),
    documents,
    proposals: task.proposals.map(proposalSummary),
  };
}

function nextStep(task: _WORKING_Task__Doctor_): string {
  const revising = task.proposals.filter((proposal) => proposal.state === "revising").map((proposal) => proposal.id);
  if (revising.length > 0) {
    return `revise proposal ${revising.join(", ")} as its feedback asks, with \`doctor propose\` for its document against the base shown here; once nothing's left to revise, \`doctor submit\`, then \`doctor wait\``;
  }
  if (task.proposals.length === 0) {
    return "answer the task's requests with `doctor propose` (`doctor help` shows how), one proposal per independent change, each naming the requests it answers; a request without targets reaches every document, which `doctor documents` lists; then `doctor submit` to hand them over, and `doctor wait`";
  }
  return "every proposal is decided: propose more with `doctor propose` against the base shown here if the task needs it; then `doctor submit`, and `doctor wait`";
}

// what an agent is waiting on while it's the human's turn
function holdUp(tasks: Array<_Task_Doctor_>): string {
  const [task] = tasks.filter((each) => each.state === "working" || each.state === "reviewing");
  if (task === undefined) return "no task is active";
  if (task.state === "reviewing") return `task ${task.id} is being reviewed`;
  const waiting = task.proposals.filter((proposal) => proposal.state === "proposed").map((proposal) => proposal.id);
  return `proposal ${waiting.join(", ")} is waiting for review`;
}

// Agents waiting for their turn: how many are waiting now, when one was last
// given its turn, and what wakes the waits to look again.
let waiting = 0;
let handedOut: Array<number> = [];
let lastWaited: Array<number> = [];
let sleepers: Array<() => void> = [];

// a wait answers within this long, well inside how long an HTTP client waits
// for an answer; the CLI asks again
const longestWait = 50_000;

// an agent given its turn is taken to be working on it for this long, unless
// it comes back to wait sooner
const workingFor = 15 * 60_000;

// an agent whose wait ended without a turn is still taken to be waiting for
// this long: the CLI asks again at once, and between two of its requests
// nobody is waiting for a moment
const between = 5_000;

export type _Presence_Agent_ = "waiting" | "working" | "away";

export function presence(): _Presence_Agent_ {
  const [waited] = lastWaited;
  if (waiting > 0 || (waited !== undefined && Date.now() - waited < between)) return "waiting";
  const [given] = handedOut;
  return given !== undefined && Date.now() - given < workingFor ? "working" : "away";
}

// Whoever wants to know when the agent's presence changes, told only when
// what presence() answers is different, rechecked once the times above run
// out.
let listeners: Array<() => void> = [];
let told: _Presence_Agent_ = "away";

export function whenPresenceChanges(listener: () => void): void {
  listeners = [listener];
}

function presenceMayHaveChanged(): void {
  const now = presence();
  if (now === told) return;
  told = now;
  for (const listener of listeners) listener();
}

// every wait looks again at whose turn it is: called whenever the tasks change
export function wake(): void {
  const woken = sleepers;
  sleepers = [];
  for (const sleeper of woken) sleeper();
}

const nap = (ms: number, woken: Promise<void>) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    void woken.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });

// Answers as soon as it's the agent's turn, with the task and the next step,
// or with whose turn it still is once the wait is up. A wake is listened for
// before the tasks are read, so a change while they're read isn't missed.
async function waitForTurn(place: _Place_Tasks_, wanted: number) {
  const until = Date.now() + Math.min(wanted, longestWait);
  waiting += 1;
  handedOut = [];
  presenceMayHaveChanged();
  try {
    for (;;) {
      const woken = new Promise<void>((resolve) => sleepers.push(resolve));
      const tasks = await listTasks(place);
      const [task] = agentsTurn(tasks);
      if (task !== undefined) {
        handedOut = [Date.now()];
        return { turn: "agent", ...(await taskView(place, task)), next: nextStep(task) };
      }
      const left = until - Date.now();
      if (left <= 0) return { turn: "human", waiting: holdUp(tasks), next: "nothing for you yet: run `doctor wait` again" };
      await nap(left, woken);
    }
  } finally {
    waiting -= 1;
    // handed its turn, the agent is working until that runs out; otherwise
    // it has a moment to ask again before it counts as away
    lastWaited = handedOut.length === 0 ? [Date.now()] : [];
    setTimeout(presenceMayHaveChanged, (handedOut.length === 0 ? between : workingFor) + 100);
    presenceMayHaveChanged();
  }
}

// The agent's side of the endpoint: the active task, its documents as they
// are now, proposals for them, waiting for its turn, and handing the task
// back.
export async function serveAgent(
  place: _Place_Tasks_,
  caller: _Author_Doctor_,
  request: _Request_Endpoint_,
): Promise<_Answer_Endpoint_> {
  const route = `${request.method} ${request.path}`;
  const [task] = await activeTask(place);
  if (route === "GET /task") {
    if (task === undefined) return issues(404, ["there's no active task"]);
    return answer(200, await taskView(place, task));
  }
  if (route === "GET /documents") return answer(200, { documents: place.catalog() });
  if (route === "GET /wait") {
    const wanted = Number.parseInt(request.search.get("for") ?? "", 10);
    return answer(200, await waitForTurn(place, Number.isFinite(wanted) && wanted >= 0 ? wanted : longestWait));
  }
  if (request.method === "GET" && request.path.startsWith("/document")) {
    const named = request.path.slice("/document/".length);
    const [fallback] = task === undefined ? [] : latestBrief(task).requests.flatMap((request) => request.targets.map((target) => target.document));
    const id = parse(documentIdSchema, named === "" ? fallback : named);
    if (id.kind === "rejected") return issues(400, ["name a document, or have an active task with one in its scope"]);
    const shown = await show(place, id.value);
    if (shown.kind === "refused") return issues(404, shown.issues);
    return answer(200, { base: shown.value.base, document: shown.value.document });
  }
  if (route === "POST /propose") {
    if (task === undefined) return issues(404, ["there's no active task to propose for"]);
    const payload = parse(proposalPayloadSchema, request.body);
    if (payload.kind === "rejected") return issues(400, payload.issues);
    const outcome = await propose(place, task.id, payload.value, caller);
    if (outcome.kind === "refused") return issues(409, outcome.issues);
    return answer(200, { task: task.id, proposal: outcome.value, state: "proposed" });
  }
  if (route === "POST /submit") {
    if (task === undefined) return issues(404, ["there's no active task to submit"]);
    const outcome = await submit(place, task.id);
    if (outcome.kind === "refused") return issues(409, outcome.issues);
    return answer(200, { task: task.id, state: outcome.value });
  }
  return issues(404, [`there's no route ${route}`]);
}
