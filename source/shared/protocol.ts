import * as v from "valibot";
import type { _Proof_, _Role_ } from "./brand.ts";
import type {
  _Author_Doctor_,
  _Document_Doctor_,
  _DRAFT_Id__Node_,
  _Holder_Text_,
  _Id_Document_,
  _Id_Node_,
  _Id_Proposal_,
  _Id_Request_,
  _Id_Task_,
  _Operation_Change_,
  _Target_Request_,
  _Task_Doctor_,
} from "./domain.next.ts";
import type { _NonEmpty_ } from "./list.ts";
import {
  authorSchema,
  documentIdSchema,
  documentSchema,
  holderSchema,
  nodeIdSchema,
  operationsSchema,
  proposalIdSchema,
  proposalOperationsSchema,
  requestIdSchema,
  requestTargetSchema,
  taskIdSchema,
  taskSchema,
  versionSchema,
} from "./schema.ts";

export type _Token_Endpoint_ = _Role_<string, "EndpointToken">;
export type _Url_Endpoint_ = _Proof_<string, "EndpointUrl">;

// 32 random bytes, in base64url
export const tokenSchema: v.GenericSchema<unknown, _Token_Endpoint_> = v.custom<_Token_Endpoint_>(
  (input) => typeof input === "string" && /^[A-Za-z0-9_-]{43}$/.test(input),
);

export const endpointUrlSchema: v.GenericSchema<unknown, _Url_Endpoint_> = v.custom<_Url_Endpoint_>(
  (input) => typeof input === "string" && /^https?:\/\/\S+\/$/.test(input),
);

const issuesSchema: v.GenericSchema<unknown, _NonEmpty_<string>> = v.tupleWithRest([v.string()], v.string());

export type _Message_Client_ =
  | _OPEN_Message__Client_
  | _CHANGE_Message__Client_
  | _TASK_Message__Client_
  | _STEER_Message__Client_
  | _REVIEW_Message__Client_
  | _WATCH_Message__Client_
  | _ACTIVATE_Message__Client_
  | _PARK_Message__Client_
  | _COMPLETE_Message__Client_
  | _CANCEL_Message__Client_
  | _ACCEPTALL_Message__Client_
  | _DRAFTING_Message__Client_
  | _REQUEST_Message__Client_
  | _FORGET_Message__Client_
  | _FOCUS_Message__Client_
  | _UNFOCUS_Message__Client_
  | _DISCARD_Message__Client_
  | _COPY_PROMPT_Message__Client_
  | _ACKNOWLEDGE_Message__Client_;

interface __BASE_Message__Client_<__MessageKind__ extends string> {
  kind: __MessageKind__;
}

export interface _OPEN_Message__Client_ extends __BASE_Message__Client_<"open"> {
  file: string;
}

export interface _CHANGE_Message__Client_ extends __BASE_Message__Client_<"change"> {
  file: string;
  operations: _NonEmpty_<_Operation_Change_>;
}

// a task to make, of one request: what's asked, and where it applies, if
// anywhere in particular
export interface _TASK_Message__Client_ extends __BASE_Message__Client_<"task"> {
  text: string;
  targets: Array<_Target_Request_>;
}

// a request added to the active task, steering it
export interface _STEER_Message__Client_ extends __BASE_Message__Client_<"steer"> {
  task: _Id_Task_;
  text: string;
  targets: Array<_Target_Request_>;
}

export interface _REVIEW_Message__Client_ extends __BASE_Message__Client_<"review"> {
  task: _Id_Task_;
  proposal: _Id_Proposal_;
  verdict: _Verdict_Review_;
}

export type _Verdict_Review_ =
  | _ACCEPT_Verdict__Review_
  | _REJECT_Verdict__Review_
  | _REQUEST_Verdict__Review_
  | _REOPEN_Verdict__Review_
  | _EDIT_Verdict__Review_;

interface __BASE_Verdict__Review_<__VerdictKind__ extends string> {
  kind: __VerdictKind__;
}

export interface _ACCEPT_Verdict__Review_ extends __BASE_Verdict__Review_<"accept"> {}

export interface _REJECT_Verdict__Review_ extends __BASE_Verdict__Review_<"reject"> {
  reason: string;
}

// what should change in a proposal, and notes on words of its proposed text,
// one or the other at least
export interface _REQUEST_Verdict__Review_ extends __BASE_Verdict__Review_<"request"> {
  feedback: string;
  passages: Array<_Amendment_Review_>;
}

// An amendment to a proposal: a note on its words, the text they're in and
// where in it they start, counting code points; or, with no words, on the
// whole of it.
export interface _Amendment_Review_ {
  words: string;
  within: string;
  at: number;
  note: string;
}

// a rejected proposal reconsidered, waiting for review again
export interface _REOPEN_Verdict__Review_ extends __BASE_Verdict__Review_<"reopen"> {}

// a proposal as you've edited it yourself: its next round, yours
export interface _EDIT_Verdict__Review_ extends __BASE_Verdict__Review_<"edit"> {
  operations: _NonEmpty_<_Operation_Change_<_DRAFT_Id__Node_>>;
}

// the tasks, kept current: what the dashboard shows
export interface _WATCH_Message__Client_ extends __BASE_Message__Client_<"watch"> {}

// makes a draft or parked task the active one, parking any other
export interface _ACTIVATE_Message__Client_ extends __BASE_Message__Client_<"activate"> {
  task: _Id_Task_;
}

// starts drafting a task: what's asked from then on goes into one draft,
// made with the first request
export interface _DRAFTING_Message__Client_ extends __BASE_Message__Client_<"drafting"> {}

// a request for the task being drafted
export interface _REQUEST_Message__Client_ extends __BASE_Message__Client_<"request"> {
  text: string;
  targets: Array<_Target_Request_>;
}

// a request taken out of a draft
export interface _FORGET_Message__Client_ extends __BASE_Message__Client_<"forget"> {
  task: _Id_Task_;
  request: _Id_Request_;
}

// drafts a task that's already a draft, from the dashboard
export interface _FOCUS_Message__Client_ extends __BASE_Message__Client_<"focus"> {
  task: _Id_Task_;
}

export interface _UNFOCUS_Message__Client_ extends __BASE_Message__Client_<"unfocus"> {}

export interface _DISCARD_Message__Client_ extends __BASE_Message__Client_<"discard"> {
  task: _Id_Task_;
}

// puts what to tell an agent about doctor on the clipboard
export interface _COPY_PROMPT_Message__Client_ extends __BASE_Message__Client_<"copyPrompt"> {}

// a finished task seen, no longer shown in the bars
export interface _ACKNOWLEDGE_Message__Client_ extends __BASE_Message__Client_<"acknowledge"> {
  task: _Id_Task_;
}

export interface _PARK_Message__Client_ extends __BASE_Message__Client_<"park"> {
  task: _Id_Task_;
}

export interface _COMPLETE_Message__Client_ extends __BASE_Message__Client_<"complete"> {
  task: _Id_Task_;
}

// asks why before a task's canceled
export interface _CANCEL_Message__Client_ extends __BASE_Message__Client_<"cancel"> {
  task: _Id_Task_;
}

// every proposal waiting for review accepted at once, in a document, or,
// with none named, in the whole task; but those being amended
export interface _ACCEPTALL_Message__Client_ extends __BASE_Message__Client_<"acceptAll"> {
  task: _Id_Task_;
  document: Array<_Id_Document_>;
  except: Array<_Id_Proposal_>;
}

const verdictSchema: v.GenericSchema<unknown, _Verdict_Review_> = v.variant("kind", [
  v.strictObject({ kind: v.literal("accept") }),
  v.strictObject({ kind: v.literal("reject"), reason: v.string() }),
  v.pipe(
    v.strictObject({
      kind: v.literal("request"),
      feedback: v.string(),
      passages: v.array(
        v.strictObject({ words: v.pipe(v.string(), v.minLength(1)), within: v.string(), at: v.pipe(v.number(), v.integer(), v.minValue(0)), note: v.string() }),
      ),
    }),
    v.check((request) => request.feedback.trim() !== "" || request.passages.length > 0, "a request says what should change"),
  ),
  v.strictObject({ kind: v.literal("reopen") }),
  v.strictObject({ kind: v.literal("edit"), operations: proposalOperationsSchema }),
]);

const requestTextSchema = v.pipe(v.string(), v.trim(), v.minLength(1, "a request says what it asks for"));

export const clientMessageSchema: v.GenericSchema<unknown, _Message_Client_> = v.variant("kind", [
  v.strictObject({
    kind: v.literal("task"),
    text: requestTextSchema,
    targets: v.array(requestTargetSchema),
  }),
  v.strictObject({ kind: v.literal("steer"), task: taskIdSchema, text: requestTextSchema, targets: v.array(requestTargetSchema) }),
  v.strictObject({ kind: v.literal("review"), task: taskIdSchema, proposal: proposalIdSchema, verdict: verdictSchema }),
  v.strictObject({ kind: v.literal("watch") }),
  v.strictObject({ kind: v.literal("activate"), task: taskIdSchema }),
  v.strictObject({ kind: v.literal("drafting") }),
  v.strictObject({ kind: v.literal("request"), text: requestTextSchema, targets: v.array(requestTargetSchema) }),
  v.strictObject({ kind: v.literal("forget"), task: taskIdSchema, request: requestIdSchema }),
  v.strictObject({ kind: v.literal("focus"), task: taskIdSchema }),
  v.strictObject({ kind: v.literal("unfocus") }),
  v.strictObject({ kind: v.literal("discard"), task: taskIdSchema }),
  v.strictObject({ kind: v.literal("copyPrompt") }),
  v.strictObject({ kind: v.literal("acknowledge"), task: taskIdSchema }),
  v.strictObject({ kind: v.literal("park"), task: taskIdSchema }),
  v.strictObject({ kind: v.literal("complete"), task: taskIdSchema }),
  v.strictObject({ kind: v.literal("cancel"), task: taskIdSchema }),
  v.strictObject({
    kind: v.literal("acceptAll"),
    task: taskIdSchema,
    document: v.array(documentIdSchema),
    except: v.array(proposalIdSchema),
  }),
  v.strictObject({ kind: v.literal("open"), file: v.string() }),
  v.strictObject({
    kind: v.literal("change"),
    file: v.string(),
    operations: operationsSchema,
  }),
]);

export type _Message_Server_ =
  | _WELCOME_Message__Server_
  | _OPENED_Message__Server_
  | _UNREADABLE_Message__Server_
  | _APPLIED_Message__Server_
  | _UPDATED_Message__Server_
  | _REFUSED_Message__Server_
  | _PROPOSALS_Message__Server_
  | _TASKS_Message__Server_
  | _FOCUS_Message__Server_
  | _STATUS_Message__Server_;

interface __BASE_Message__Server_<__MessageKind__ extends string> {
  kind: __MessageKind__;
}

export interface _WELCOME_Message__Server_ extends __BASE_Message__Server_<"welcome"> {
  caller: _Author_Doctor_;
}

export interface _OPENED_Message__Server_ extends __BASE_Message__Server_<"opened"> {
  file: string;
  document: _Document_Doctor_;
}

export interface _UNREADABLE_Message__Server_ extends __BASE_Message__Server_<"unreadable"> {
  file: string;
  issues: _NonEmpty_<string>;
}

// to the view whose change it was
export interface _APPLIED_Message__Server_ extends __BASE_Message__Server_<"applied"> {
  file: string;
  document: _Document_Doctor_;
}

// to every other view of the file
export interface _UPDATED_Message__Server_ extends __BASE_Message__Server_<"updated"> {
  file: string;
  document: _Document_Doctor_;
}

export interface _REFUSED_Message__Server_ extends __BASE_Message__Server_<"refused"> {
  file: string;
  issues: _NonEmpty_<string>;
}

// a proposal waiting for review, as a file's viewers show it
// A proposal of the active task, as an editor shows it: waiting for your
// review; sent back, being revised as you asked; or decided, accepted, to
// apply when the task completes, or rejected, either open to reconsidering
// until then; or applied already, accepted before acceptance waited for the
// task's completion. With its operations as last proposed, how many rounds
// it's had, and what was last said of it: what you asked to change, or why
// you rejected it; and, once applied, where its change is in the document.
export interface _Open_Proposal_ {
  task: _Id_Task_;
  instruction: string;
  proposal: _Id_Proposal_;
  operations: _NonEmpty_<_Operation_Change_<_DRAFT_Id__Node_>>;
  state: "proposed" | "revising" | "accepted" | "rejected" | "applied";
  rounds: number;
  // who wrote its last round: the agent, or you, editing it
  written: _Author_Doctor_;
  // why it's this change, as its last round has it, and what that round
  // changed; empty when unsaid
  rationale: string;
  changes: string;
  feedback: string;
  changed: Array<_Holder_Text_>;
  // the amendments last requested of it: what should change in the whole of
  // it, with no words, and notes on words of its proposed text
  amendments: Array<_Amendment_Review_>;
  // waiting for review again after revising, its operations as its round
  // before had them, for what's changed since to be marked
  before: Array<_NonEmpty_<_Operation_Change_<_DRAFT_Id__Node_>>>;
}

// the active task's proposals on a file, sent whenever they change
export interface _PROPOSALS_Message__Server_ extends __BASE_Message__Server_<"proposals"> {
  file: string;
  open: Array<_Open_Proposal_>;
  problems: Array<string>;
}

export interface _TASKS_Message__Server_ extends __BASE_Message__Server_<"tasks"> {
  tasks: Array<_Task_Doctor_>;
  documents: Array<_Listed_Document_>;
  drafting: Array<_Focus_Drafting_>;
  problems: Array<string>;
}

// The task an editor's bar tells of, if any: the active one, whose turn it
// is and whether an agent is waiting, working or away, or else the last one
// finished, until it's acknowledged; and an overview of it, for the card the
// bar shows of it.
export interface _STATUS_Message__Server_ extends __BASE_Message__Server_<"status"> {
  file: string;
  task: Array<_Task_Status_>;
}

export interface _Task_Status_ {
  task: _Id_Task_;
  name: string;
  state: "working" | "reviewing" | "completed" | "canceled";
  turn: "agent" | "human";
  agent: "waiting" | "working" | "away";
  requests: Array<_Request_Status_>;
  proposals: _Proposals_Status_;
  // when it started, an ISO time, and when it finished, if it has, and by
  // whom: the agent, handing it back with nothing to review, or you, once
  // every proposal's decided or you canceled it
  started: string;
  finished: Array<{ at: string; by: "human" | "agent" }>;
  // why it was canceled, when that was said
  reason: string;
  // where the agent says it stands, as a whole, and in each document it
  // summarized; never what it said of one hand-over, which is about a round;
  // each in a line too, when it said that
  summary: string;
  headline: string;
  summaries: Array<{ document: _Id_Document_; summary: string; headline: string }>;
}

// a request's words, and where it's aimed, described
export interface _Request_Status_ {
  text: string;
  targets: Array<string>;
  // where it's aimed, for a document to say in its own words; none when
  // it's about every document
  aimed: Array<_Target_Request_>;
  // in progress, or addressed, and by how many proposals
  progress: "in progress" | "addressed";
  proposals: number;
}

// how many of the task's proposals are in each state
export interface _Proposals_Status_ {
  proposed: number;
  revising: number;
  accepted: number;
  rejected: number;
  withdrawn: number;
}

// what's being drafted, if anything: a task not made yet, before its first
// request, or the draft it became
export type _Focus_Drafting_ = _NEW_Focus__Drafting_ | _DRAFT_Focus__Drafting_;

interface __BASE_Focus__Drafting_<__FocusKind__ extends string> {
  kind: __FocusKind__;
}

export interface _NEW_Focus__Drafting_ extends __BASE_Focus__Drafting_<"new"> {}

export interface _DRAFT_Focus__Drafting_ extends __BASE_Focus__Drafting_<"draft"> {
  task: _Id_Task_;
}

// what's being drafted, as an editor shows it: sent whenever it changes,
// with the draft's requests that target this file's document
export interface _FOCUS_Message__Server_ extends __BASE_Message__Server_<"focus"> {
  file: string;
  drafting: Array<_View_Drafting_>;
}

export type _View_Drafting_ = _NEW_Focus__Drafting_ | _DRAFT_View__Drafting_;

export interface _DRAFT_View__Drafting_ extends __BASE_Focus__Drafting_<"draft"> {
  task: _Id_Task_;
  name: string;
  count: number;
  here: Array<_Here_Request_>;
}

// a request with just its targets in one document
export interface _Here_Request_ {
  request: _Id_Request_;
  text: string;
  targets: Array<_Target_Request_>;
}

// a document in the workspace, as the dashboard lists it
export interface _Listed_Document_ {
  document: _Id_Document_;
  title: string;
  path: string;
}

export const focusDraftingSchema: v.GenericSchema<unknown, _Focus_Drafting_> = v.variant("kind", [
  v.strictObject({ kind: v.literal("new") }),
  v.strictObject({ kind: v.literal("draft"), task: taskIdSchema }),
]);

const openProposalSchema: v.GenericSchema<unknown, _Open_Proposal_> = v.strictObject({
  task: taskIdSchema,
  instruction: v.string(),
  proposal: proposalIdSchema,
  operations: proposalOperationsSchema,
  state: v.picklist(["proposed", "revising", "accepted", "rejected", "applied"]),
  rounds: v.number(),
  written: v.picklist(["human", "agent"]),
  rationale: v.string(),
  changes: v.string(),
  feedback: v.string(),
  changed: v.array(holderSchema),
  amendments: v.array(v.strictObject({ words: v.string(), within: v.string(), at: v.number(), note: v.string() })),
  before: v.array(proposalOperationsSchema),
});

export const serverMessageSchema: v.GenericSchema<unknown, _Message_Server_> = v.variant("kind", [
  v.strictObject({
    kind: v.literal("proposals"),
    file: v.string(),
    open: v.array(openProposalSchema),
    problems: v.array(v.string()),
  }),
  v.strictObject({
    kind: v.literal("tasks"),
    tasks: v.array(taskSchema),
    documents: v.array(v.strictObject({ document: documentIdSchema, title: v.string(), path: v.string() })),
    drafting: v.array(focusDraftingSchema),
    problems: v.array(v.string()),
  }),
  v.strictObject({
    kind: v.literal("status"),
    file: v.string(),
    task: v.array(
      v.strictObject({
        task: taskIdSchema,
        name: v.string(),
        state: v.picklist(["working", "reviewing", "completed", "canceled"]),
        turn: v.picklist(["agent", "human"]),
        agent: v.picklist(["waiting", "working", "away"]),
        requests: v.array(
          v.strictObject({
            text: v.string(),
            targets: v.array(v.string()),
            aimed: v.array(requestTargetSchema),
            progress: v.picklist(["in progress", "addressed"]),
            proposals: v.number(),
          }),
        ),
        proposals: v.strictObject({
          proposed: v.number(),
          revising: v.number(),
          accepted: v.number(),
          rejected: v.number(),
          withdrawn: v.number(),
        }),
        started: v.string(),
        finished: v.array(v.strictObject({ at: v.string(), by: v.picklist(["human", "agent"]) })),
        reason: v.string(),
        summary: v.string(),
        headline: v.string(),
        summaries: v.array(v.strictObject({ document: documentIdSchema, summary: v.string(), headline: v.string() })),
      }),
    ),
  }),
  v.strictObject({
    kind: v.literal("focus"),
    file: v.string(),
    drafting: v.array(
      v.variant("kind", [
        v.strictObject({ kind: v.literal("new") }),
        v.strictObject({
          kind: v.literal("draft"),
          task: taskIdSchema,
          name: v.string(),
          count: v.number(),
          here: v.array(
            v.strictObject({ request: requestIdSchema, text: v.string(), targets: v.array(requestTargetSchema) }),
          ),
        }),
      ]),
    ),
  }),
  v.strictObject({ kind: v.literal("welcome"), caller: authorSchema }),
  v.strictObject({ kind: v.literal("opened"), file: v.string(), document: documentSchema }),
  v.strictObject({ kind: v.literal("unreadable"), file: v.string(), issues: issuesSchema }),
  v.strictObject({ kind: v.literal("applied"), file: v.string(), document: documentSchema }),
  v.strictObject({ kind: v.literal("updated"), file: v.string(), document: documentSchema }),
  v.strictObject({ kind: v.literal("refused"), file: v.string(), issues: issuesSchema }),
]);

// what the agent says on handing a task over, if anything
// handing the task over: with a summary of where it stands as a whole, or
// a note on this hand-over alone, kept with it but never taken for one
export const submitPayloadSchema = v.union([
  v.null(),
  v.strictObject({ summary: v.string(), headline: v.optional(v.string(), "") }),
  v.strictObject({ note: v.string() }),
]);

// the agent's summary of where the task stands, or, naming one, a document
export const summarizePayloadSchema = v.union([
  v.strictObject({ summary: v.string(), headline: v.optional(v.string(), "") }),
  v.strictObject({ document: documentIdSchema, summary: v.string(), headline: v.optional(v.string(), "") }),
]);

// what the agent proposes: which document, the version of it it was shown,
// and the operations that would change it
export const proposalPayloadSchema = v.strictObject({
  document: documentIdSchema,
  base: versionSchema,
  answers: v.optional(v.array(requestIdSchema), () => []),
  operations: proposalOperationsSchema,
  rationale: v.optional(v.string(), ""),
  changes: v.optional(v.string(), ""),
});

export type _Config_Webview_ = _DOCUMENT_Config__Webview_ | _TEXT_Config__Webview_ | _DASHBOARD_Config__Webview_;

interface __BASE_Config__Webview_<__ConfigKind__ extends string> {
  kind: __ConfigKind__;
  endpoint: _Url_Endpoint_;
  token: _Token_Endpoint_;
}

export interface _DOCUMENT_Config__Webview_ extends __BASE_Config__Webview_<"document"> {
  file: string;
}

// the document as text, in Monaco
export interface _TEXT_Config__Webview_ extends __BASE_Config__Webview_<"text"> {
  file: string;
}

export interface _DASHBOARD_Config__Webview_ extends __BASE_Config__Webview_<"dashboard"> {}

export const webviewConfigSchema: v.GenericSchema<unknown, _Config_Webview_> = v.variant("kind", [
  v.strictObject({
    kind: v.literal("document"),
    endpoint: endpointUrlSchema,
    token: tokenSchema,
    file: v.string(),
  }),
  v.strictObject({ kind: v.literal("text"), endpoint: endpointUrlSchema, token: tokenSchema, file: v.string() }),
  v.strictObject({ kind: v.literal("dashboard"), endpoint: endpointUrlSchema, token: tokenSchema }),
]);
