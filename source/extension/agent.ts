import type {
  _ACTIVE_Task__Doctor_,
  _Author_Doctor_,
  _Id_Document_,
  _Id_Node_,
  _Node_Document_,
  _Proposal_Task_,
  _Reason_Task_,
  _Task_Doctor_,
  _WORKING_Task__Doctor_,
} from "../shared/domain.next.ts";
import { parse } from "../shared/parse.ts";
import { proposalPayloadSchema } from "../shared/protocol.ts";
import { documentIdSchema } from "../shared/schema.ts";
import { indexNodes } from "../shared/tree.ts";
import type { _Answer_Endpoint_, _Request_Endpoint_ } from "./endpoint.ts";
import { activeTask, agentsTurn, listTasks, propose, show, submit, type _Place_Tasks_ } from "./tasks.ts";

const answer = (status: number, body: unknown): _Answer_Endpoint_ => ({ status, body });
const issues = (status: number, list: Array<string>) => answer(status, { issues: list });

const reasonOf = (reason: _Reason_Task_) => (reason.kind === "stated" ? { reason: reason.text.text } : {});

// what the agent needs of a proposal: where it stands, what was asked of it
// if it's being revised, and why if it was turned down
function proposalSummary(proposal: _Proposal_Task_) {
  const last = proposal.rounds[proposal.rounds.length - 1] ?? proposal.rounds[0];
  return {
    proposal: proposal.id,
    document: proposal.document,
    state: proposal.state,
    ...(last.kind === "requested" ? { feedback: last.request.feedback.text } : {}),
    ...(proposal.state === "rejected" || proposal.state === "withdrawn" ? reasonOf(proposal.reason) : {}),
  };
}

function scopeOf(task: _Task_Doctor_): Map<_Id_Document_, Array<_Id_Node_>> {
  const latest = task.brief.versions[task.brief.versions.length - 1] ?? task.brief.versions[0];
  const documents = new Map<_Id_Document_, Array<_Id_Node_>>();
  for (const ref of latest.scope) documents.set(ref.document, [...(documents.get(ref.document) ?? []), ref.node]);
  return documents;
}

// the active task as the agent sees it: its documents as they are now, each
// with its version to propose against
async function taskView(place: _Place_Tasks_, task: _ACTIVE_Task__Doctor_) {
  const latest = task.brief.versions[task.brief.versions.length - 1] ?? task.brief.versions[0];
  const documents = await Promise.all(
    [...scopeOf(task)].map(async ([id, nodes]) => {
      const shown = await show(place, id);
      if (shown.kind === "refused") return { document: id, issues: shown.issues };
      const index = indexNodes(shown.value.document.content);
      const scope = nodes.flatMap((node): Array<_Node_Document_> => {
        const entry = index.get(node);
        return entry === undefined ? [] : [entry.node];
      });
      return { document: id, title: shown.value.document.content.title.text, base: shown.value.base, scope };
    }),
  );
  return {
    task: task.id,
    state: task.state,
    instruction: latest.instruction.text,
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
    return "propose every change the task needs with `doctor propose` (`doctor help` shows how), one proposal per independent change; then `doctor submit` to hand them over, and `doctor wait`";
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
let sleepers: Array<() => void> = [];

// a wait answers within this long, well inside how long an HTTP client waits
// for an answer; the CLI asks again
const longestWait = 50_000;

// an agent given its turn is taken to be working on it for this long, unless
// it comes back to wait sooner
const workingFor = 15 * 60_000;

export type _Presence_Agent_ = "waiting" | "working" | "away";

export function presence(): _Presence_Agent_ {
  if (waiting > 0) return "waiting";
  const [given] = handedOut;
  return given !== undefined && Date.now() - given < workingFor ? "working" : "away";
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
  if (route === "GET /wait") {
    const wanted = Number.parseInt(request.search.get("for") ?? "", 10);
    return answer(200, await waitForTurn(place, Number.isFinite(wanted) && wanted >= 0 ? wanted : longestWait));
  }
  if (request.method === "GET" && request.path.startsWith("/document")) {
    const named = request.path.slice("/document/".length);
    const [fallback] = task === undefined ? [] : [...scopeOf(task).keys()];
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
