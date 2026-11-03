import { randomBytes } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { applyOperations } from "../shared/apply.ts";
import type {
  _About_Summary_,
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
  _Id_Request_,
  _Id_Task_,
  _Operation_Change_,
  _PARK_Transition__Task_,
  _Proposal_Task_,
  _Passage_Feedback_,
  _Past_Round__Proposal_,
  _PROPOSED_Proposal__Task_,
  _REJECTED_Proposal__Task_,
  _Reason_Task_,
  _Ref_Change_,
  _Ref_Node_,
  _Request_Task_,
  _RESUME_Transition__Task_,
  _REVISING_Proposal__Task_,
  _Stamp_Doctor_,
  _STANDING_Round__Proposal_,
  _Summary_Task_,
  _Target_Request_,
  _Task_Doctor_,
  _Text_Doctor_,
  _Version_Document_,
  _Version_Brief_,
  _Version_Proposal_,
  _WORKING_Task__Doctor_,
} from "../shared/domain.next.ts";
import { mintId } from "../shared/id.ts";
import type { _NonEmpty_ } from "../shared/list.ts";
import { parse, parseOwn, type _Result_Parse_ } from "../shared/parse.ts";
import { latestBrief, progressOf } from "../shared/brief.ts";
import { realize } from "../shared/proposals.ts";
import type { _Listed_Document_ } from "../shared/protocol.ts";
import {
  changeIdSchema,
  nodeIdSchema,
  numberBriefSchema,
  proposalIdSchema,
  requestIdSchema,
  taskIdSchema,
  taskSchema,
  timeSchema,
} from "../shared/schema.ts";
import { indexNodes, textOfNode, type _Index_Document_ } from "../shared/tree.ts";
import { makeChange } from "./changes.ts";
import { exclusively, readDocument, writeJson } from "./documents.ts";
import { loadVersion, nodeKey, storeVersion, textKey } from "./store.ts";

// where tasks are kept, where the documents they're about are, and which
// documents the project has
export interface _Place_Tasks_ {
  data: string;
  fileOf: (document: _Id_Document_) => Array<string>;
  catalog: () => Array<_Listed_Document_>;
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
// shown, the requests it answers, the operations that would change it, why,
// and, revising it, what that changed; empty when it doesn't say
export interface _Payload_Proposal_ {
  document: _Id_Document_;
  base: _Version_Document_;
  answers: Array<_Id_Request_>;
  operations: _NonEmpty_<_Operation_Change_<_DRAFT_Id__Node_>>;
  rationale: string;
  changes: string;
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
  submissions: [],
  summaries: [],
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
  submissions: task.submissions,
  summaries: task.summaries,
  proposals: task.proposals,
  parked,
  was: task.state,
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
  submissions: task.submissions,
  summaries: task.summaries,
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
  submissions: task.submissions,
  summaries: task.summaries,
  proposals: closeProposals(task.proposals, canceled, reason),
  canceled,
  reason,
});

const resume: _RESUME_Transition__Task_ = (task, activated) => ({
  kind: task.kind,
  formatVersion: task.formatVersion,
  state: task.was,
  id: task.id,
  created: task.created,
  roles: task.roles,
  reviewTiming: task.reviewTiming,
  brief: task.brief,
  activated,
  applied: task.applied,
  reviews: task.reviews,
  submissions: task.submissions,
  summaries: task.summaries,
  proposals: task.proposals,
});

// the task being worked on, if there is one: there's never more than one
export async function activeTask(place: _Place_Tasks_): Promise<Array<_ACTIVE_Task__Doctor_>> {
  return (await listTasks(place)).filter(isActive);
}

// The agent's turn: the active task is being worked on, and either some of
// what it proposed was sent back to be revised, or none of it is waiting for
// review. It's the human's turn otherwise.
export function agentsTurn(tasks: Array<_Task_Doctor_>): Array<_WORKING_Task__Doctor_> {
  return tasks.filter(
    (task): task is _WORKING_Task__Doctor_ =>
      task.state === "working" &&
      (task.proposals.some((proposal) => proposal.state === "revising") ||
        task.proposals.every((proposal) => proposal.state !== "proposed") ||
        newRequests(task).length > 0),
  );
}

// the requests made since the agent last handed the task over, steering it;
// none before it ever has, as it's at work on all of them
export function newRequests(task: _Task_Doctor_): Array<_Request_Task_> {
  if (task.state !== "working" && task.state !== "reviewing") return [];
  if (task.submissions.length === 0) return [];
  return latestBrief(task).requests.filter((request) => progressOf(task, request) === "in progress");
}

// A request added to the active task steers it: its brief's next version,
// with the request added; one in review goes back to working, as the agent
// has something new to answer while what's proposed waits for review.
export function steer(
  place: _Place_Tasks_,
  id: _Id_Task_,
  text: _Text_Doctor_,
  targets: Array<_Target_Request_>,
): Promise<_Outcome_Task_<_Id_Request_>> {
  return updateTask(place, id, async (task) => {
    if (!isActive(task)) return refuse(`task ${id} is ${task.state}, so it can't take a request`);
    const latest = latestBrief(task);
    const request = requestOf(text, targets, stamp("human"));
    const requests: _NonEmpty_<_Request_Task_> = [...latest.requests, request];
    const versions: _NonEmpty_<_Version_Brief_> = [
      ...task.brief.versions,
      { number: parseOwn(numberBriefSchema, latest.number + 1), written: request.made, requests },
    ];
    return done({ task: { ...task, state: "working", brief: { versions } }, value: request.id });
  });
}

// A task in review completes once everything proposed for it is decided:
// accepted or rejected, none of it sent back to be revised. Completing
// applies what was accepted; what no longer fits goes back for review, with
// why, and the task stays open.
async function settle(
  place: _Place_Tasks_,
  task: _ACTIVE_Task__Doctor_,
  at: _Stamp_Doctor_,
): Promise<{ task: _Task_Doctor_; issues: Array<string> }> {
  if (task.state !== "reviewing" || !task.proposals.every(isFinal)) return { task, issues: [] };
  const merged = await merge(place, task);
  const finals = merged.proposals.filter(isFinal);
  const next = { ...task, proposals: merged.proposals, applied: merged.applied };
  return finals.length === merged.proposals.length
    ? { task: complete({ ...next, proposals: finals }, at), issues: merged.issues }
    : { task: next, issues: merged.issues };
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

// Ends a task as done, applying what was accepted in it. A proposal still
// waiting for review has to be decided first; one the agent is revising is
// withdrawn. One accepted that no longer fits goes back for review, and the
// task stays open, unless it's parked, where it can't be reviewed, so it's
// withdrawn too.
export function completeTask(place: _Place_Tasks_, id: _Id_Task_): Promise<_Outcome_Task_<_Settled_Task_>> {
  return updateTask(place, id, async (task) => {
    if (task.state === "parked") {
      const completed = stamp("human");
      const merged = await merge(place, { ...task, proposals: closeProposals(task.proposals, completed, stated("the task was completed")) });
      const proposals = closeProposals(merged.proposals, completed, stated("it no longer fit the document"));
      return done({ task: complete({ ...task, proposals, applied: merged.applied }, completed), value: { issues: merged.issues } });
    }
    if (!isActive(task)) return refuse(`task ${id} is ${task.state}, so it can't be completed`);
    const waiting = task.proposals.filter((proposal) => proposal.state === "proposed").map((proposal) => proposal.id);
    if (waiting.length > 0) {
      return refuse(`proposal ${waiting.join(", ")} is still waiting for review: accept or reject it before completing the task`);
    }
    const completed = stamp("human");
    const merged = await merge(place, { ...task, proposals: closeProposals(task.proposals, completed, stated("the task was completed")) });
    const finals = merged.proposals.filter(isFinal);
    if (finals.length !== merged.proposals.length) {
      return done({ task: { ...task, proposals: merged.proposals, applied: merged.applied }, value: { issues: merged.issues } });
    }
    return done({ task: complete({ ...task, proposals: finals, applied: merged.applied }, completed), value: { issues: merged.issues } });
  });
}

export function cancelTask(place: _Place_Tasks_, id: _Id_Task_, reason: _Reason_Task_): Promise<_Outcome_Task_<_Id_Task_>> {
  return updateTask(place, id, async (task) => {
    if (task.state !== "parked" && !isActive(task)) return refuse(`task ${id} is ${task.state}, so it can't be canceled`);
    return done({ task: cancel(task, stamp("human"), reason), value: task.id });
  });
}

export interface _Activated_Task_ {
  task: _ACTIVE_Task__Doctor_;
  parked: Array<_Id_Task_>;
}

// Makes a draft or a parked task the active one, parking any other: a draft
// to be worked on, a parked task as it was when it was parked.
export async function makeActive(place: _Place_Tasks_, id: _Id_Task_): Promise<_Outcome_Task_<_Activated_Task_>> {
  const parked = await parkOthers(place, id);
  const outcome = await updateTask(place, id, async (task) => {
    if (task.state === "draft") {
      const working = activate(task, stamp("human"));
      return done({ task: working, value: working });
    }
    if (task.state === "parked") {
      const resumed = resume(task, stamp("human"));
      return done({ task: resumed, value: resumed });
    }
    return refuse(`task ${id} is ${task.state}, so it can't be made the active one`);
  });
  return outcome.kind === "done" ? done({ task: outcome.value, parked }) : outcome;
}

// A task you make is the agent's to work on and yours to review, each
// proposal before it changes anything; it becomes the active one.
const requestOf = (text: _Text_Doctor_, targets: Array<_Target_Request_>, made: _Stamp_Doctor_): _Request_Task_ => ({
  id: mintId(requestIdSchema, randomBytes(10)),
  made,
  text,
  targets,
});

function draftOf(text: _Text_Doctor_, targets: Array<_Target_Request_>): _DRAFT_Task__Doctor_ {
  const created = stamp("human");
  return {
    kind: "task",
    formatVersion: 1,
    state: "draft",
    id: mintId(taskIdSchema, randomBytes(10)),
    created,
    roles: { worker: "agent", reviewer: "human" },
    reviewTiming: "before",
    brief: { versions: [{ number: parseOwn(numberBriefSchema, 1), written: created, requests: [requestOf(text, targets, created)] }] },
  };
}

export async function createTask(
  place: _Place_Tasks_,
  text: _Text_Doctor_,
  targets: Array<_Target_Request_>,
): Promise<_Activated_Task_> {
  const draft = draftOf(text, targets);
  const parked = await parkOthers(place, draft.id);
  const working = activate(draft, draft.created);
  await exclusively(taskFile(place, working.id), () => writeJson(taskFile(place, working.id), working));
  return { task: working, parked };
}

// A draft, made from its first request, to add more to before it's started.
// Until then the agent never sees it, so its brief is changed in place.
export async function createDraft(
  place: _Place_Tasks_,
  text: _Text_Doctor_,
  targets: Array<_Target_Request_>,
): Promise<_DRAFT_Task__Doctor_> {
  const draft = draftOf(text, targets);
  await exclusively(taskFile(place, draft.id), () => writeJson(taskFile(place, draft.id), draft));
  return draft;
}

export function addRequest(
  place: _Place_Tasks_,
  id: _Id_Task_,
  text: _Text_Doctor_,
  targets: Array<_Target_Request_>,
): Promise<_Outcome_Task_<_Id_Request_>> {
  return updateTask(place, id, async (task) => {
    if (task.state !== "draft") return refuse(`task ${id} is ${task.state}: requests are added to drafts`);
    const [version] = task.brief.versions;
    const request = requestOf(text, targets, stamp("human"));
    const requests: _NonEmpty_<_Request_Task_> = [...version.requests, request];
    return done({ task: { ...task, brief: { versions: [{ ...version, requests }] } }, value: request.id });
  });
}

export function dropRequest(place: _Place_Tasks_, id: _Id_Task_, request: _Id_Request_): Promise<_Outcome_Task_<_Id_Request_>> {
  return updateTask(place, id, async (task) => {
    if (task.state !== "draft") return refuse(`task ${id} is ${task.state}: requests are taken out of drafts`);
    const [version] = task.brief.versions;
    const [first, ...rest] = version.requests.filter((each) => each.id !== request);
    if (first === undefined) return refuse("a draft keeps at least one request: discard the draft instead");
    return done({ task: { ...task, brief: { versions: [{ ...version, requests: [first, ...rest] }] } }, value: request });
  });
}

// A draft was never started, so discarding it leaves nothing behind.
export function discardDraft(place: _Place_Tasks_, id: _Id_Task_): Promise<_Outcome_Task_<_Id_Task_>> {
  return exclusively(taskFile(place, id), async () => {
    const read = await readTask(place, id);
    if (read.kind === "rejected") return { kind: "refused", issues: read.issues };
    if (read.value.state !== "draft") return refuse(`task ${id} is ${read.value.state}: only a draft can be discarded`);
    await rm(taskFile(place, id));
    return done(id);
  });
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
    const latest = latestBrief(task);
    const known = new Set<string>(latest.requests.map((request) => request.id));
    const unknown = payload.answers.filter((answered) => !known.has(answered));
    if (unknown.length > 0) return refuse(`task ${id} has no request ${unknown.join(", ")}`);
    const base = await loadVersion(place.data, payload.base);
    if (base.kind === "rejected") return refuse(`version ${payload.base} isn't one doctor showed; read the document again`);
    if (base.value.id !== payload.document) return refuse(`version ${payload.base} is of another document`);
    const realized = realize(payload.operations, mintNode);
    const tried = applyOperations(base.value, realized, {
      document: payload.document,
      id: mintId(changeIdSchema, randomBytes(10)),
    });
    if (tried.kind === "refused") return refuse(`the operations don't apply to the version they were made from: ${tried.issue}`);
    const revising = task.proposals.find(
      (each): each is _REVISING_Proposal__Task_ => each.state === "revising" && each.document === payload.document,
    );
    // why it's this change, as the round before had it unless it's said again
    const before = revising?.rounds[revising.rounds.length - 1]?.version.rationale ?? { text: "", overlay: [] };
    const version: _Version_Proposal_ = {
      written: stamp(author),
      base: payload.base,
      answering: latest.number,
      answers: payload.answers,
      operations: payload.operations,
      rationale: payload.rationale.trim() === "" ? before : { text: payload.rationale.trim(), overlay: [] },
      changes: { text: revising === undefined ? "" : payload.changes.trim(), overlay: [] },
    };
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

// The agent hands the task over once it's proposed everything the task
// needs, with a note on what it did, or why nothing needed changing, and it
// completes at once if nothing's left to review. What was sent back for
// changes is revised first.
export function submit(
  place: _Place_Tasks_,
  id: _Id_Task_,
  summary: { text: string; headline: string },
  note: string,
): Promise<_Outcome_Task_<{ state: _Task_Doctor_["state"]; issues: Array<string> }>> {
  return updateTask(place, id, async (task) => {
    if (task.state !== "working") return refuse(`task ${id} is ${task.state}, so there's nothing to submit`);
    const revising = task.proposals.filter((proposal) => proposal.state === "revising").map((proposal) => proposal.id);
    if (revising.length > 0) {
      return refuse(`proposal ${revising.join(", ")} was sent back for changes: revise it with doctor propose, then submit`);
    }
    const now = stamp("agent");
    const submission = { submitted: now, note: { text: note, overlay: [] }, answering: latestBrief(task).number };
    // where the task stands as a whole, only when it says so; a note on one
    // hand-over is about a round, so it's kept with the hand-over alone
    const summaries = summary.text === "" ? task.summaries : summarized(task.summaries, { kind: "task" }, summary, now);
    const submitted = await settle(place, { ...task, state: "reviewing", submissions: [...task.submissions, submission], summaries }, now);
    return done({ task: submitted.task, value: { state: submitted.task.state, issues: submitted.issues } });
  });
}

// a task's summaries with the one about what's given rewritten, its
// headline with it
function summarized(
  summaries: Array<_Summary_Task_>,
  about: _About_Summary_,
  said: { text: string; headline: string },
  written: _Stamp_Doctor_,
): Array<_Summary_Task_> {
  const same = (other: _About_Summary_) => (other.kind === "task" ? about.kind === "task" : about.kind === "document" && other.document === about.document);
  const summary = { about, written, text: { text: said.text, overlay: [] }, headline: { text: said.headline, overlay: [] } };
  return [...summaries.filter((each) => !same(each.about)), summary];
}

// The agent's view of where the active task stands, as a whole or in one of
// the workspace's documents, rewritten whenever it changes, not only on
// handing the task over.
export function summarize(
  place: _Place_Tasks_,
  id: _Id_Task_,
  about: _About_Summary_,
  text: string,
  headline: string,
): Promise<_Outcome_Task_<_Id_Task_>> {
  return updateTask(place, id, async (task) => {
    if (!isActive(task)) return refuse(`task ${id} is ${task.state}, so it takes no summary`);
    if (text.trim() === "") return refuse("a summary says where things stand");
    if (about.kind === "document" && place.fileOf(about.document).length === 0) return refuse(`there's no document ${about.document} in the workspace`);
    const said = { text: text.trim(), headline: headline.trim() };
    return done({ task: { ...task, summaries: summarized(task.summaries, about, said, stamp("agent")) }, value: task.id });
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

// A decision holds only until its task ends, so while it's active, a
// rejected proposal, or an accepted one, which hasn't applied yet, can be
// reconsidered.
function decidedProposal(task: _Task_Doctor_, id: _Id_Proposal_): Array<_ACCEPTED_Proposal__Task_ | _REJECTED_Proposal__Task_> {
  if (!isActive(task)) return [];
  return task.proposals.filter(
    (each): each is _ACCEPTED_Proposal__Task_ | _REJECTED_Proposal__Task_ =>
      each.id === id && (each.state === "rejected" || (each.state === "accepted" && each.change.length === 0)),
  );
}

// Reconsidering a decided proposal puts it back to wait for review, its
// rounds as they were.
export function reopen(place: _Place_Tasks_, id: _Id_Task_, proposalId: _Id_Proposal_): Promise<_Outcome_Task_<_Id_Proposal_>> {
  return updateTask(place, id, async (task) => {
    const [proposal] = decidedProposal(task, proposalId);
    if (proposal === undefined || !isActive(task)) return refuse(`proposal ${proposalId} isn't one of the active task's decided proposals`);
    const reopened: _PROPOSED_Proposal__Task_ = { state: "proposed", id: proposal.id, document: proposal.document, rounds: proposal.rounds };
    return done({ task: { ...task, proposals: replace(task.proposals, reopened) }, value: proposal.id });
  });
}

// Whether a proposal still fits its document as it is now: what it changes
// unchanged since the version it was made from.
async function misfits(place: _Place_Tasks_, proposal: _PROPOSED_Proposal__Task_ | _ACCEPTED_Proposal__Task_): Promise<Array<string>> {
  const { version } = proposal.rounds[proposal.rounds.length - 1] ?? proposal.rounds[0];
  const [file] = place.fileOf(proposal.document);
  if (file === undefined) return [`there's no document ${proposal.document} in the workspace`];
  const base = await loadVersion(place.data, version.base);
  const current = await readDocument(file);
  if (base.kind === "rejected") return base.issues;
  if (current.kind === "rejected") return current.issues;
  return fitIssues(base.value, current.value, version.operations);
}

// An accepted proposal applied to its document as it is now, as a change
// from that proposal, if it still fits.
async function applyProposal(
  place: _Place_Tasks_,
  task: _Id_Task_,
  proposal: _ACCEPTED_Proposal__Task_,
): Promise<_Outcome_Task_<{ file: string; document: _Document_Doctor_; change: _Ref_Change_ }>> {
  const [misfit, ...more] = await misfits(place, proposal);
  if (misfit !== undefined) return { kind: "refused", issues: [misfit, ...more] };
  const [file] = place.fileOf(proposal.document);
  if (file === undefined) return refuse(`there's no document ${proposal.document} in the workspace`);
  const { version } = proposal.rounds[proposal.rounds.length - 1] ?? proposal.rounds[0];
  const [first, ...rest] = realize(version.operations, mintNode);
  if (first === undefined) return refuse("the proposal has no operations");
  const applied = await makeChange({
    file,
    data: place.data,
    author: "human",
    source: { kind: "proposal", task, proposal: proposal.id },
    operations: [first, ...rest],
  });
  if (applied.kind === "refused") return applied;
  const [change] = applied.change;
  if (change === undefined) return refuse("the proposal changes nothing in the document as it is now");
  return done({ file, document: applied.document, change });
}

// who's told when completing a task changes a document, so what shows it
// can show it as it is now
let mergedListeners: Array<(file: string, document: _Document_Doctor_) => void> = [];

export function whenMerged(listener: (file: string, document: _Document_Doctor_) => void): void {
  mergedListeners = [listener];
}

// A task's accepted proposals not applied yet, applied in the order they
// were accepted: one that no longer fits goes back to wait for review, with
// why.
async function merge(
  place: _Place_Tasks_,
  task: { id: _Id_Task_; proposals: Array<_Proposal_Task_>; applied: Array<_Ref_Change_> },
): Promise<{ proposals: Array<_Proposal_Task_>; applied: Array<_Ref_Change_>; issues: Array<string> }> {
  let { proposals, applied } = task;
  const issues: Array<string> = [];
  const pending = task.proposals
    .filter((proposal): proposal is _ACCEPTED_Proposal__Task_ => proposal.state === "accepted" && proposal.change.length === 0)
    .toSorted((first, second) => first.accepted.at.localeCompare(second.accepted.at));
  for (const proposal of pending) {
    const outcome = await applyProposal(place, task.id, proposal);
    if (outcome.kind === "refused") {
      issues.push(`proposal ${proposal.id} no longer fits, so it's back for review: ${outcome.issues.join("; ")}`);
      proposals = replace(proposals, { state: "proposed", id: proposal.id, document: proposal.document, rounds: proposal.rounds });
      continue;
    }
    proposals = replace(proposals, { ...proposal, change: [outcome.value.change] });
    applied = [...applied, outcome.value.change];
    for (const listener of mergedListeners) listener(outcome.value.file, outcome.value.document);
  }
  return { proposals, applied, issues };
}

// what's said once a decision's made: what kept the task from completing,
// or completing from applying all it accepted
export interface _Settled_Task_ {
  issues: Array<string>;
}

// Accepting decides for a proposal, if it still fits the document: it
// applies when the task completes, and until then the decision can be
// changed.
export function accept(place: _Place_Tasks_, id: _Id_Task_, proposalId: _Id_Proposal_): Promise<_Outcome_Task_<_Settled_Task_>> {
  return updateTask(place, id, async (task) => {
    const [proposal] = waitingProposal(task, proposalId);
    if (proposal === undefined || !isActive(task)) return refuse(`proposal ${proposalId} isn't waiting for review`);
    const [misfit, ...more] = await misfits(place, proposal);
    if (misfit !== undefined) return { kind: "refused", issues: [misfit, ...more] };
    const accepted: _ACCEPTED_Proposal__Task_ = {
      state: "accepted",
      id: proposal.id,
      document: proposal.document,
      rounds: proposal.rounds,
      accepted: stamp("human"),
      change: [],
    };
    const settledTask = await settle(place, { ...task, proposals: replace(task.proposals, accepted) }, stamp("human"));
    return done({ task: settledTask.task, value: { issues: settledTask.issues } });
  });
}

export function reject(
  place: _Place_Tasks_,
  id: _Id_Task_,
  proposalId: _Id_Proposal_,
  reason: _Text_Doctor_,
): Promise<_Outcome_Task_<_Settled_Task_>> {
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
    const settledTask = await settle(place, { ...task, proposals: replace(task.proposals, rejected) }, stamp("human"));
    return done({ task: settledTask.task, value: { issues: settledTask.issues } });
  });
}

const isPast = (round: { kind: string }): round is _Past_Round__Proposal_ => round.kind === "requested" || round.kind === "edited";

// Your own edit to a proposal waiting for review, or accepted and not yet
// applied, is a round of its own, written by you, decided as the proposal
// was: its standing round becomes an edited one, and your edit, checked
// against the version the proposal was made from, its standing round. Edits
// one after another are one round, the last made over the one before, so
// what's changed since the agent's round is one round's.
export function editProposal(
  place: _Place_Tasks_,
  id: _Id_Task_,
  proposalId: _Id_Proposal_,
  operations: _NonEmpty_<_Operation_Change_<_DRAFT_Id__Node_>>,
): Promise<_Outcome_Task_<_Id_Proposal_>> {
  return updateTask(place, id, async (task) => {
    const [proposal] = [...waitingProposal(task, proposalId), ...decidedProposal(task, proposalId)].filter(
      (each): each is _PROPOSED_Proposal__Task_ | _ACCEPTED_Proposal__Task_ => each.state === "proposed" || each.state === "accepted",
    );
    if (proposal === undefined || !isActive(task)) return refuse(`proposal ${proposalId} isn't waiting for review or accepted`);
    const last = proposal.rounds[proposal.rounds.length - 1] ?? proposal.rounds[0];
    const base = await loadVersion(place.data, last.version.base);
    if (base.kind === "rejected") return { kind: "refused", issues: base.issues };
    const tried = applyOperations(base.value, realize(operations, mintNode), {
      document: proposal.document,
      id: mintId(changeIdSchema, randomBytes(10)),
    });
    if (tried.kind === "refused") return refuse(`the edit doesn't apply to the version the proposal was made from: ${tried.issue}`);
    const earlier = proposal.rounds.slice(0, -1).filter(isPast);
    const yours: _STANDING_Round__Proposal_ = {
      kind: "standing",
      version: { ...last.version, written: stamp("human"), operations, changes: { text: "", overlay: [] } },
    };
    const rounds: [...Array<_Past_Round__Proposal_>, _STANDING_Round__Proposal_] =
      last.version.written.by === "human" ? [...earlier, yours] : [...earlier, { kind: "edited", version: last.version }, yours];
    const edited: _PROPOSED_Proposal__Task_ | _ACCEPTED_Proposal__Task_ = { ...proposal, rounds };
    return done({ task: { ...task, proposals: replace(task.proposals, edited) }, value: proposal.id });
  });
}

// Asking for changes, on a proposal waiting for review or one decided and
// reconsidered, turns its standing round into a requested one, and hands
// the task back to the agent if it was in review.
export function requestChanges(
  place: _Place_Tasks_,
  id: _Id_Task_,
  proposalId: _Id_Proposal_,
  feedback: _Text_Doctor_,
  passages: Array<_Passage_Feedback_>,
): Promise<_Outcome_Task_<_Id_Proposal_>> {
  return updateTask(place, id, async (task) => {
    const [proposal] = [...waitingProposal(task, proposalId), ...decidedProposal(task, proposalId)];
    if (proposal === undefined || !isActive(task)) return refuse(`proposal ${proposalId} isn't waiting for review or decided`);
    const earlier = proposal.rounds.slice(0, -1).filter(isPast);
    const { version } = proposal.rounds[proposal.rounds.length - 1] ?? proposal.rounds[0];
    const revising: _REVISING_Proposal__Task_ = {
      state: "revising",
      id: proposal.id,
      document: proposal.document,
      rounds: [...earlier, { kind: "requested", version, request: { made: stamp("human"), feedback, passages } }],
    };
    const proposals = replace(task.proposals, revising);
    return done({ task: { ...task, state: "working", proposals }, value: proposal.id });
  });
}
