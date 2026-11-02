import * as v from "valibot";
import type { _Proof_, _Role_ } from "./brand.ts";
import type {
  _Author_Doctor_,
  _Document_Doctor_,
  _DRAFT_Id__Node_,
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
  | _REVIEW_Message__Client_
  | _WATCH_Message__Client_
  | _ACTIVATE_Message__Client_
  | _PARK_Message__Client_
  | _COMPLETE_Message__Client_
  | _CANCEL_Message__Client_
  | _DRAFTING_Message__Client_
  | _REQUEST_Message__Client_
  | _FORGET_Message__Client_
  | _FOCUS_Message__Client_
  | _UNFOCUS_Message__Client_
  | _DISCARD_Message__Client_;

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

export interface _REVIEW_Message__Client_ extends __BASE_Message__Client_<"review"> {
  task: _Id_Task_;
  proposal: _Id_Proposal_;
  verdict: _Verdict_Review_;
}

export type _Verdict_Review_ = _ACCEPT_Verdict__Review_ | _REJECT_Verdict__Review_ | _REQUEST_Verdict__Review_;

interface __BASE_Verdict__Review_<__VerdictKind__ extends string> {
  kind: __VerdictKind__;
}

export interface _ACCEPT_Verdict__Review_ extends __BASE_Verdict__Review_<"accept"> {}

export interface _REJECT_Verdict__Review_ extends __BASE_Verdict__Review_<"reject"> {
  reason: string;
}

export interface _REQUEST_Verdict__Review_ extends __BASE_Verdict__Review_<"request"> {
  feedback: string;
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

const verdictSchema: v.GenericSchema<unknown, _Verdict_Review_> = v.variant("kind", [
  v.strictObject({ kind: v.literal("accept") }),
  v.strictObject({ kind: v.literal("reject"), reason: v.string() }),
  v.strictObject({ kind: v.literal("request"), feedback: v.pipe(v.string(), v.minLength(1)) }),
]);

const requestTextSchema = v.pipe(v.string(), v.trim(), v.minLength(1, "a request says what it asks for"));

export const clientMessageSchema: v.GenericSchema<unknown, _Message_Client_> = v.variant("kind", [
  v.strictObject({
    kind: v.literal("task"),
    text: requestTextSchema,
    targets: v.array(requestTargetSchema),
  }),
  v.strictObject({ kind: v.literal("review"), task: taskIdSchema, proposal: proposalIdSchema, verdict: verdictSchema }),
  v.strictObject({ kind: v.literal("watch") }),
  v.strictObject({ kind: v.literal("activate"), task: taskIdSchema }),
  v.strictObject({ kind: v.literal("drafting") }),
  v.strictObject({ kind: v.literal("request"), text: requestTextSchema, targets: v.array(requestTargetSchema) }),
  v.strictObject({ kind: v.literal("forget"), task: taskIdSchema, request: requestIdSchema }),
  v.strictObject({ kind: v.literal("focus"), task: taskIdSchema }),
  v.strictObject({ kind: v.literal("unfocus") }),
  v.strictObject({ kind: v.literal("discard"), task: taskIdSchema }),
  v.strictObject({ kind: v.literal("park"), task: taskIdSchema }),
  v.strictObject({ kind: v.literal("complete"), task: taskIdSchema }),
  v.strictObject({ kind: v.literal("cancel"), task: taskIdSchema }),
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
  | _FOCUS_Message__Server_;

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
export interface _Open_Proposal_ {
  task: _Id_Task_;
  instruction: string;
  proposal: _Id_Proposal_;
  operations: _NonEmpty_<_Operation_Change_<_DRAFT_Id__Node_>>;
}

// the proposals waiting for review on a file, sent whenever they change
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

// what the agent proposes: which document, the version of it it was shown,
// and the operations that would change it
export const proposalPayloadSchema = v.strictObject({
  document: documentIdSchema,
  base: versionSchema,
  answers: v.optional(v.array(requestIdSchema), () => []),
  operations: proposalOperationsSchema,
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
