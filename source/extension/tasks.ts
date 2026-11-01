import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { applyOperations } from "../shared/apply.ts";
import type {
  _ACCEPTED_Proposal__Task_,
  _ACTIVATE_Transition__Task_,
  _ACTIVE_Task__Doctor_,
  _Author_Doctor_,
  _CANCEL_Transition__Task_,
  _COMPLETE_Transition__Task_,
  _Document_Doctor_,
  _DRAFT_Id__Node_,
  _DRAFT_Task__Doctor_,
  _FINAL_Proposal__Task_,
  _Holder_Text_,
  _Id_Document_,
  _Id_Proposal_,
  _Id_Task_,
  _Operation_Change_,
  _PARK_Transition__Task_,
  _Proposal_Task_,
  _PROPOSED_Proposal__Task_,
  _Ref_Change_,
  _Reason_Task_,
  _Ref_Node_,
  _RESUME_Transition__Task_,
  _REVISING_Proposal__Task_,
  _Stamp_Doctor_,
  _Task_Doctor_,
  _Text_Doctor_,
  _Version_Document_,
  _Version_Proposal_,
  _WORKING_Task__Doctor_,
} from "../shared/domain.next.ts";
import { mintId } from "../shared/id.ts";
import type { _NonEmpty_ } from "../shared/list.ts";
import { parse, parseOwn, type _Result_Parse_ } from "../shared/parse.ts";
import { realize } from "../shared/proposals.ts";
import {
  changeIdSchema,
  nodeIdSchema,
  numberBriefSchema,
  proposalIdSchema,
  taskIdSchema,
  taskSchema,
  timeSchema,
} from "../shared/schema.ts";
import { indexNodes, textOfNode, type _Index_Document_ } from "../shared/tree.ts";
import { makeChange } from "./changes.ts";
import { exclusively, readDocument, writeJson } from "./documents.ts";
import { loadVersion, nodeKey, storeVersion, textKey } from "./store.ts";

// where tasks are kept, and where the documents they're about are
export interface _Place_Tasks_ {
  data: string;
  fileOf: (document: _Id_Document_) => Array<string>;
}

export type _Outcome_Task_<__Value__> = _DONE_Outcome__Task_<__Value__> | _REFUSED_Outcome__Task_;

interface __BASE_Outcome__Task_<__OutcomeKind__ extends string> {
  kind: __OutcomeKind__;
}

export interface _DONE_Outcome__Task_<__Value__> extends __BASE_Outcome__Task_<"done"> {
  value: __Value__;
}

export interface _REFUSED_Outcome__Task_ extends __BASE_Outcome__Task_<"refused"> {
  issues: _NonEmpty_<string>;
}

// what a proposal says: which document, the version of it the agent was
// shown, and the operations that would change it
export interface _Payload_Proposal_ {
  document: _Id_Document_;
  base: _Version_Document_;
  operations: _NonEmpty_<_Operation_Change_<_DRAFT_Id__Node_>>;
}

export interface _Shown_Document_ {
  document: _Document_Doctor_;
  base: _Version_Document_;
}

const done = <__Value__>(value: __Value__): _Outcome_Task_<__Value__> => ({ kind: "done", value });
const refuse = (issue: string): _REFUSED_Outcome__Task_ => ({ kind: "refused", issues: [issue] });
const stamp = (by: _Author_Doctor_): _Stamp_Doctor_ => ({ by, at: parseOwn(timeSchema, new Date().toISOString()) });
const mintNode = () => mintId(nodeIdSchema, randomBytes(10));
const taskFile = (place: _Place_Tasks_, id: _Id_Task_) => join(place.data, "tasks", `${id}.json`);

export async function readTask(place: _Place_Tasks_, id: _Id_Task_): Promise<_Result_Parse_<_Task_Doctor_>> {
  try {
    return parse(taskSchema, JSON.parse(await readFile(taskFile(place, id), "utf8")));
  } catch (someError) {
    return { kind: "rejected", issues: [`couldn't read task ${id}: ${String(someError)}`] };
  }
}

export async function listTasks(place: _Place_Tasks_): Promise<Array<_Task_Doctor_>> {
  const names = await readdir(join(place.data, "tasks")).catch(() => []);
  const read = await Promise.all(
    names.filter((name) => name.endsWith(".json")).map(async (name) => {
      const result = parse(taskSchema, JSON.parse(await readFile(join(place.data, "tasks", name), "utf8")));
      return result.kind === "parsed" ? [result.value] : [];
    }),
  );
  return read.flat().toSorted((first, second) => (first.created.at < second.created.at ? -1 : 1));
}

// Changes a task under its file's lock: the change gets the task as it is
// now, and gives back the task as it should be, with what to answer.
function updateTask<__Value__>(
  place: _Place_Tasks_,
  id: _Id_Task_,
  change: (task: _Task_Doctor_) => Promise<_Outcome_Task_<{ task: _Task_Doctor_; value: __Value__ }>>,
): Promise<_Outcome_Task_<__Value__>> {
  return exclusively(taskFile(place, id), async () => {
    const read = await readTask(place, id);
    if (read.kind === "rejected") return { kind: "refused", issues: read.issues };
    const outcome = await change(read.value);
    if (outcome.kind === "refused") return outcome;
    await writeJson(taskFile(place, id), outcome.value.task);
    return done(outcome.value.value);
  });
}

const activate: _ACTIVATE_Transition__Task_ = (task, activated) => ({
  ...task,
  state: "working",
  activated,
  proposals: [],
  applied: [],
  reviews: [],
});

const stated = (text: string): _Reason_Task_ => ({ kind: "stated", text: { text, overlay: [] } });

const isFinal = (proposal: _Proposal_Task_): proposal is _FINAL_Proposal__Task_ =>
  proposal.state === "accepted" || proposal.state === "rejected" || proposal.state === "withdrawn";

// a task's proposals as it ends or is set aside: what's still open withdrawn
function closeProposals(
  proposals: Array<_Proposal_Task_>,
  withdrawn: _Stamp_Doctor_,
  reason: _Reason_Task_,
): Array<_FINAL_Proposal__Task_> {
  return proposals.map((proposal) =>
    isFinal(proposal)
      ? proposal
      : { state: "withdrawn", id: proposal.id, document: proposal.document, rounds: proposal.rounds, withdrawn, reason },
  );
}

const park: _PARK_Transition__Task_ = (task, parked) => ({
  kind: task.kind,
  formatVersion: task.formatVersion,
  state: "parked",
  id: task.id,
  created: task.created,
  roles: task.roles,
  reviewTiming: task.reviewTiming,
  brief: task.brief,
  activated: task.activated,
  applied: task.applied,
  reviews: task.reviews,
  proposals: closeProposals(task.proposals, parked, stated("the task was parked")),
  parked,
});

const complete: _COMPLETE_Transition__Task_ = (task, completed) => ({
  kind: task.kind,
  formatVersion: task.formatVersion,
  state: "completed",
  id: task.id,
  created: task.created,
  roles: task.roles,
  reviewTiming: task.reviewTiming,
  brief: task.brief,
  activated: task.activated,
  applied: task.applied,
  reviews: task.reviews,
  proposals: task.proposals,
  completed,
});

const cancel: _CANCEL_Transition__Task_ = (task, canceled, reason) => ({
  kind: task.kind,
  formatVersion: task.formatVersion,
  state: "canceled",
  id: task.id,
  created: task.created,
  roles: task.roles,
  reviewTiming: task.reviewTiming,
  brief: task.brief,
  activated: task.activated,
  applied: task.applied,
  reviews: task.reviews,
  proposals: closeProposals(task.proposals, canceled, reason),
  canceled,
  reason,
});

const resume: _RESUME_Transition__Task_ = (task, activated) => ({
  kind: task.kind,
  formatVersion: task.formatVersion,
  state: "working",
  id: task.id,
  created: task.created,
  roles: task.roles,
  reviewTiming: task.reviewTiming,
  brief: task.brief,
  activated,
  applied: task.applied,
  reviews: task.reviews,
  proposals: task.proposals,
});

// the task being worked on, if there is one: there's never more than one
export async function activeTask(place: _Place_Tasks_): Promise<Array<_ACTIVE_Task__Doctor_>> {
  return (await listTasks(place)).filter(isActive);
}

// The agent's turn: the active task is being worked on, and nothing proposed
// for it is waiting for review. It's the human's turn otherwise.
export function agentsTurn(tasks: Array<_Task_Doctor_>): Array<_WORKING_Task__Doctor_> {
  return tasks.filter(
    (task): task is _WORKING_Task__Doctor_ =>
      task.state === "working" && task.proposals.every((proposal) => proposal.state !== "proposed"),
  );
}

export function parkTask(place: _Place_Tasks_, id: _Id_Task_): Promise<_Outcome_Task_<_Id_Task_>> {
  return updateTask(place, id, async (task) => {
    if (!isActive(task)) return refuse(`task ${id} is ${task.state}, so there's nothing to park`);
    return done({ task: park(task, stamp("human")), value: task.id });
  });
}

// parks whichever task is active but the one about to be, so there's only
// ever one
async function parkOthers(place: _Place_Tasks_, id: _Id_Task_): Promise<Array<_Id_Task_>> {
  const parked: Array<_Id_Task_> = [];
  for (const task of await activeTask(place)) {
    if (task.id === id) continue;
    const outcome = await parkTask(place, task.id);
    if (outcome.kind === "done") parked.push(outcome.value);
  }
  return parked;
}

// Ends a task as done. A proposal still waiting for review has to be decided
// first; one the agent is revising is withdrawn.
export function completeTask(place: _Place_Tasks_, id: _Id_Task_): Promise<_Outcome_Task_<_Id_Task_>> {
  return updateTask(place, id, async (task) => {
    if (task.state === "parked") return done({ task: complete(task, stamp("human")), value: task.id });
    if (!isActive(task)) return refuse(`task ${id} is ${task.state}, so it can't be completed`);
    const waiting = task.proposals.filter((proposal) => proposal.state === "proposed").map((proposal) => proposal.id);
    if (waiting.length > 0) {
      return refuse(`proposal ${waiting.join(", ")} is still waiting for review: accept or reject it before completing the task`);
    }
    const completed = stamp("human");
    const proposals = closeProposals(task.proposals, completed, stated("the task was completed"));
    return done({ task: complete({ ...task, proposals }, completed), value: task.id });
  });
}

export function cancelTask(place: _Place_Tasks_, id: _Id_Task_, reason: _Reason_Task_): Promise<_Outcome_Task_<_Id_Task_>> {
  return updateTask(place, id, async (task) => {
    if (task.state !== "parked" && !isActive(task)) return refuse(`task ${id} is ${task.state}, so it can't be canceled`);
    return done({ task: cancel(task, stamp("human"), reason), value: task.id });
  });
}

export interface _Activated_Task_ {
  task: _WORKING_Task__Doctor_;
  parked: Array<_Id_Task_>;
}

// Makes a draft or a parked task the one being worked on, parking any other.
export async function makeActive(place: _Place_Tasks_, id: _Id_Task_): Promise<_Outcome_Task_<_Activated_Task_>> {
  const parked = await parkOthers(place, id);
  const outcome = await updateTask(place, id, async (task) => {
    if (task.state === "draft") {
      const working = activate(task, stamp("human"));
      return done({ task: working, value: working });
    }
    if (task.state === "parked") {
      const working = resume(task, stamp("human"));
      return done({ task: working, value: working });
    }
    return refuse(`task ${id} is ${task.state}, so it can't be made the active one`);
  });
  return outcome.kind === "done" ? done({ task: outcome.value, parked }) : outcome;
}

// A task you make is the agent's to work on and yours to review, each
// proposal before it changes anything; it becomes the active one.
export async function createTask(
  place: _Place_Tasks_,
  instruction: _Text_Doctor_,
  scope: Array<_Ref_Node_>,
): Promise<_Activated_Task_> {
  const created = stamp("human");
  const draft: _DRAFT_Task__Doctor_ = {
    kind: "task",
    formatVersion: 1,
    state: "draft",
    id: mintId(taskIdSchema, randomBytes(10)),
    created,
    roles: { worker: "agent", reviewer: "human" },
    reviewTiming: "before",
    brief: { versions: [{ number: parseOwn(numberBriefSchema, 1), written: created, instruction, scope }] },
  };
  const parked = await parkOthers(place, draft.id);
  const working = activate(draft, created);
  await exclusively(taskFile(place, working.id), () => writeJson(taskFile(place, working.id), working));
  return { task: working, parked };
}

// a document as the agent is shown it, its version stored so a proposal made
// from it can be checked against it later
export async function show(place: _Place_Tasks_, id: _Id_Document_): Promise<_Outcome_Task_<_Shown_Document_>> {
  const [file] = place.fileOf(id);
  if (file === undefined) return refuse(`there's no document ${id} in the workspace`);
  const read = await readDocument(file);
  if (read.kind === "rejected") return { kind: "refused", issues: read.issues };
  return done({ document: read.value, base: await storeVersion(place.data, read.value) });
}

const isActive = (task: _Task_Doctor_): task is _ACTIVE_Task__Doctor_ => task.state === "working" || task.state === "reviewing";

const scopedDocuments = (task: _Task_Doctor_) =>
  new Set(task.brief.versions.flatMap((version) => version.scope.map((ref) => ref.document)));

// A proposal is checked against the version it was made from: its operations
// have to apply to what the agent was shown. One that follows a request for
// changes on the same document is that proposal's next round.
export function propose(
  place: _Place_Tasks_,
  id: _Id_Task_,
  payload: _Payload_Proposal_,
  author: _Author_Doctor_,
): Promise<_Outcome_Task_<_Id_Proposal_>> {
  return updateTask(place, id, async (task) => {
    if (task.state !== "working") return refuse(`task ${id} is ${task.state}, so it takes no proposals`);
    if (!scopedDocuments(task).has(payload.document)) return refuse(`document ${payload.document} isn't in task ${id}'s scope`);
    const base = await loadVersion(place.data, payload.base);
    if (base.kind === "rejected") return refuse(`version ${payload.base} isn't one doctor showed; read the document again`);
    if (base.value.id !== payload.document) return refuse(`version ${payload.base} is of another document`);
    const tried = applyOperations(base.value, realize(payload.operations, mintNode), {
      document: payload.document,
      id: mintId(changeIdSchema, randomBytes(10)),
    });
    if (tried.kind === "refused") return refuse(`the operations don't apply to the version they were made from: ${tried.issue}`);
    const latest = task.brief.versions.at(-1) ?? task.brief.versions[0];
    const version: _Version_Proposal_ = {
      written: stamp(author),
      base: payload.base,
      answering: latest.number,
      operations: payload.operations,
    };
    const revising = task.proposals.find(
      (each): each is _REVISING_Proposal__Task_ => each.state === "revising" && each.document === payload.document,
    );
    const proposal: _PROPOSED_Proposal__Task_ =
      revising === undefined
        ? {
            state: "proposed",
            id: mintId(proposalIdSchema, randomBytes(10)),
            document: payload.document,
            rounds: [{ kind: "standing", version }],
          }
        : { state: "proposed", id: revising.id, document: revising.document, rounds: [...revising.rounds, { kind: "standing", version }] };
    const proposals = revising === undefined ? [...task.proposals, proposal] : task.proposals.map((each) => (each.id === proposal.id ? proposal : each));
    return done({ task: { ...task, proposals }, value: proposal.id });
  });
}

export function submit(place: _Place_Tasks_, id: _Id_Task_): Promise<_Outcome_Task_<_Id_Task_>> {
  return updateTask(place, id, async (task) => {
    if (task.state !== "working") return refuse(`task ${id} is ${task.state}, so there's nothing to submit`);
    return done({ task: { ...task, state: "reviewing" }, value: task.id });
  });
}

function textAt(document: _Document_Doctor_, index: _Index_Document_, holder: _Holder_Text_): Array<_Text_Doctor_> {
  if (holder.kind === "title") return [document.content.title];
  const node = index.get(holder.node)?.node;
  return node === undefined ? [] : textOfNode(node);
}

// What each operation needs to still hold, between the version it was made
// from and the document now: the text it writes or styles, the node it edits,
// the subtree it deletes or moves, all unchanged since.
function fitIssues(
  base: _Document_Doctor_,
  current: _Document_Doctor_,
  operations: ReadonlyArray<_Operation_Change_<_DRAFT_Id__Node_>>,
): Array<string> {
  const was = indexNodes(base.content);
  const now = indexNodes(current.content);
  const name = (holder: _Holder_Text_) => (holder.kind === "title" ? "the title" : `node ${holder.node}`);
  return operations.flatMap((operation): Array<string> => {
    switch (operation.kind) {
      case "write":
      case "style": {
        const [before] = textAt(base, was, operation.holder);
        const [after] = textAt(current, now, operation.holder);
        if (before === undefined || after === undefined) return [`${name(operation.holder)} isn't there any more`];
        return textKey(before) === textKey(after) ? [] : [`${name(operation.holder)} has changed since the proposal was made`];
      }
      case "edit":
      case "delete":
      case "move": {
        const before = was.get(operation.node)?.node;
        const after = now.get(operation.node)?.node;
        if (before === undefined || after === undefined) return [`node ${operation.node} isn't there any more`];
        return nodeKey(before) === nodeKey(after) ? [] : [`node ${operation.node} has changed since the proposal was made`];
      }
      case "insert":
        return [];
    }
  });
}

const replace = (proposals: Array<_Proposal_Task_>, proposal: _Proposal_Task_) =>
  proposals.map((each) => (each.id === proposal.id ? proposal : each));

function waitingProposal(task: _Task_Doctor_, id: _Id_Proposal_): Array<_PROPOSED_Proposal__Task_> {
  if (!isActive(task)) return [];
  return task.proposals.filter((each): each is _PROPOSED_Proposal__Task_ => each.id === id && each.state === "proposed");
}

export interface _Accepted_Task_ {
  file: string;
  document: _Document_Doctor_;
}

// Accepting checks the proposal still fits the document, then applies it as a
// change from that proposal.
export function accept(place: _Place_Tasks_, id: _Id_Task_, proposalId: _Id_Proposal_): Promise<_Outcome_Task_<_Accepted_Task_>> {
  return updateTask(place, id, async (task) => {
    const [proposal] = waitingProposal(task, proposalId);
    if (proposal === undefined || !isActive(task)) return refuse(`proposal ${proposalId} isn't waiting for review`);
    const { version } = proposal.rounds[proposal.rounds.length - 1] ?? proposal.rounds[0];
    const [file] = place.fileOf(proposal.document);
    if (file === undefined) return refuse(`there's no document ${proposal.document} in the workspace`);
    const base = await loadVersion(place.data, version.base);
    const current = await readDocument(file);
    if (base.kind === "rejected") return { kind: "refused", issues: base.issues };
    if (current.kind === "rejected") return { kind: "refused", issues: current.issues };
    const [conflict, ...more] = fitIssues(base.value, current.value, version.operations);
    if (conflict !== undefined) return { kind: "refused", issues: [conflict, ...more] };
    const [first, ...rest] = realize(version.operations, mintNode);
    if (first === undefined) return refuse("the proposal has no operations");
    const applied = await makeChange({
      file,
      data: place.data,
      author: "human",
      source: { kind: "proposal", task: task.id, proposal: proposal.id },
      operations: [first, ...rest],
    });
    if (applied.kind === "refused") return applied;
    const [change] = applied.change;
    if (change === undefined) return refuse("the proposal changes nothing in the document as it is now");
    const accepted: _ACCEPTED_Proposal__Task_ = {
      state: "accepted",
      id: proposal.id,
      document: proposal.document,
      rounds: proposal.rounds,
      accepted: stamp("human"),
      change,
    };
    const applies: Array<_Ref_Change_> = [...task.applied, change];
    return done({
      task: { ...task, proposals: replace(task.proposals, accepted), applied: applies },
      value: { file, document: applied.document },
    });
  });
}

export function reject(
  place: _Place_Tasks_,
  id: _Id_Task_,
  proposalId: _Id_Proposal_,
  reason: _Text_Doctor_,
): Promise<_Outcome_Task_<_Id_Proposal_>> {
  return updateTask(place, id, async (task) => {
    const [proposal] = waitingProposal(task, proposalId);
    if (proposal === undefined || !isActive(task)) return refuse(`proposal ${proposalId} isn't waiting for review`);
    const rejected: _Proposal_Task_ = {
      state: "rejected",
      id: proposal.id,
      document: proposal.document,
      rounds: proposal.rounds,
      rejected: stamp("human"),
      reason: reason.text === "" ? { kind: "unstated" } : { kind: "stated", text: reason },
    };
    return done({ task: { ...task, proposals: replace(task.proposals, rejected) }, value: proposal.id });
  });
}

// Asking for changes turns the proposal's standing round into a requested
// one, and hands the task back to the agent if it was in review.
export function requestChanges(
  place: _Place_Tasks_,
  id: _Id_Task_,
  proposalId: _Id_Proposal_,
  feedback: _Text_Doctor_,
): Promise<_Outcome_Task_<_Id_Proposal_>> {
  return updateTask(place, id, async (task) => {
    const [proposal] = waitingProposal(task, proposalId);
    if (proposal === undefined || !isActive(task)) return refuse(`proposal ${proposalId} isn't waiting for review`);
    const earlier = proposal.rounds.slice(0, -1).filter((round) => round.kind === "requested");
    const { version } = proposal.rounds[proposal.rounds.length - 1] ?? proposal.rounds[0];
    const revising: _REVISING_Proposal__Task_ = {
      state: "revising",
      id: proposal.id,
      document: proposal.document,
      rounds: [...earlier, { kind: "requested", version, request: { made: stamp("human"), feedback } }],
    };
    const proposals = replace(task.proposals, revising);
    return done({ task: { ...task, state: "working", proposals }, value: proposal.id });
  });
}
