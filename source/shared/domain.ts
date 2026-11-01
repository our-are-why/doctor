import type { _Proof_, _Role_ } from "./brand.ts";
import type { _NonEmpty_ } from "./list.ts";

// ids, revisions and times

export type _Id_Document_ = _Role_<string, "DocumentId">;
export type _Id_Node_ = _Role_<string, "NodeId">;
export type _DRAFT_Id__Node_ = _Role_<string, "DraftNodeId">;
export type _Id_Note_ = _Role_<string, "NoteId">;
export type _Id_Task_ = _Role_<string, "TaskId">;
export type _Id_Proposal_ = _Role_<string, "ProposalId">;
export type _Revision_Document_ = _Proof_<number, "DocumentRevision">;
export type _Time_Doctor_ = _Proof_<string, "Time">;

export interface _Stamp_Doctor_ {
  by: _Author_Doctor_;
  at: _Time_Doctor_;
}

export type _Author_Doctor_ = "human" | "agent";

export type _Text_Doctor_ = Array<_Inline_Text_>;

export type _Inline_Text_ = _RUN_Inline__Text_ | _LINK_Inline__Text_;

interface __BASE_Inline__Text_<__InlineKind__ extends string> {
  kind: __InlineKind__;
}

export interface _RUN_Inline__Text_ extends __BASE_Inline__Text_<"run"> {
  text: string;
  contrast: _Contrasts_Run_;
}

export type _Contrast_Run_ = "bold" | "italic" | "monospace" | "highlighted" | "struck";

export type _Contrasts_Run_ = _Arrangements_<_Contrast_Run_>;

// Every ordering of every subset of a union: each value at most once. A
// distributive conditional, so TypeScript only expands it once it's used.
type _Arrangements_<__Values__ extends string, __All__ extends string = __Values__> = [
  __Values__,
] extends [never]
  ? []
  : [] | (__Values__ extends string ? [__Values__, ..._Arrangements_<Exclude<__All__, __Values__>>] : never);

interface __ACTIONABLE_Inline__Text_<__InlineKind__ extends string>
  extends __BASE_Inline__Text_<__InlineKind__> {
  label: _NonEmpty_<_RUN_Inline__Text_>;
}

export interface _LINK_Inline__Text_ extends __ACTIONABLE_Inline__Text_<"link"> {
  target: _Target_Link_;
}

export type _Target_Link_ =
  | _EXTERNAL_Target__Link_
  | _DOCUMENT_Target__Link_
  | _NODE_Target__Link_;

interface __BASE_Target__Link_<__TargetKind__ extends string> {
  kind: __TargetKind__;
}

export interface _EXTERNAL_Target__Link_ extends __BASE_Target__Link_<"external"> {
  url: _Url_Target_;
}

export type _Url_Target_ = _Proof_<string, "Url">;

export interface _DOCUMENT_Target__Link_ extends __BASE_Target__Link_<"document"> {
  document: _Id_Document_;
}

export interface _NODE_Target__Link_ extends __BASE_Target__Link_<"node">, _Ref_Node_ {}

interface __BASE_File_Doctor_<__FileKind__ extends string> {
  kind: __FileKind__;
  formatVersion: 1;
}

// documents

export interface _Document_Doctor_ extends __BASE_File_Doctor_<"document"> {
  id: _Id_Document_;
  revision: _Revision_Document_;
  content: _Body_Document_;
  notes: Array<_Note_Document_>;
}

export type _Block_Document_<__Id__ = _Id_Node_> =
  | _SECTION_Block__Document_<__Id__>
  | _PARAGRAPH_Block__Document_<__Id__>
  | _LIST_Block__Document_<__Id__>
  | _CODE_Block__Document_<__Id__>
  | _QUOTE_Block__Document_<__Id__>;

export type _Node_Document_<__Id__ = _Id_Node_> =
  | _Block_Document_<__Id__>
  | _ListItem_Document_<__Id__>;

interface __BASE_Content__Node_<__NodeKind__ extends string> {
  kind: __NodeKind__;
}

export type _Content_Node_ =
  | _SECTION_Content__Node_
  | _PARAGRAPH_Content__Node_
  | _LIST_Content__Node_
  | _ITEM_Content__Node_
  | _CODE_Content__Node_;

export interface _SECTION_Content__Node_ extends __BASE_Content__Node_<"section"> {
  heading: _Text_Doctor_;
}

export interface _PARAGRAPH_Content__Node_ extends __BASE_Content__Node_<"paragraph"> {
  text: _Text_Doctor_;
}

export interface _LIST_Content__Node_ extends __BASE_Content__Node_<"list"> {
  order: _OrderStatus_List_;
}

export type _OrderStatus_List_ = "ordered" | "unordered";

export interface _ITEM_Content__Node_ extends __BASE_Content__Node_<"listItem"> {
  text: _Text_Doctor_;
}

export interface _CODE_Content__Node_ extends __BASE_Content__Node_<"code"> {
  language: _Language_Code_;
  code: string;
}

interface __Identity_Node_<__Id__> {
  id: __Id__;
}

export interface _Ref_Node_ {
  document: _Id_Document_;
  node: _Id_Node_;
}

interface __Parent_Document_<__Children__ extends Array<unknown>> {
  children: __Children__;
}

export interface _Body_Document_ extends __Parent_Document_<Array<_Block_Document_>> {
  title: _Text_Doctor_;
}

export interface _SECTION_Block__Document_<__Id__ = _Id_Node_>
  extends _SECTION_Content__Node_,
    __Identity_Node_<__Id__>,
    __Parent_Document_<Array<_Block_Document_<__Id__>>> {}

export interface _PARAGRAPH_Block__Document_<__Id__ = _Id_Node_>
  extends _PARAGRAPH_Content__Node_,
    __Identity_Node_<__Id__> {}

export interface _LIST_Block__Document_<__Id__ = _Id_Node_>
  extends _LIST_Content__Node_,
    __Identity_Node_<__Id__>,
    __Parent_Document_<_NonEmpty_<_ListItem_Document_<__Id__>>> {}

export interface _ListItem_Document_<__Id__ = _Id_Node_>
  extends _ITEM_Content__Node_,
    __Identity_Node_<__Id__>,
    __Parent_Document_<Array<_Block_Document_<__Id__>>> {}

export interface _CODE_Block__Document_<__Id__ = _Id_Node_>
  extends _CODE_Content__Node_,
    __Identity_Node_<__Id__> {}

export type _Language_Code_ = _STATED_Language__Code_ | _UNSTATED_Language__Code_;

interface __BASE_Language__Code_<__LanguageKind__ extends string> {
  kind: __LanguageKind__;
}

export interface _STATED_Language__Code_ extends __BASE_Language__Code_<"stated"> {
  name: string;
}

export interface _UNSTATED_Language__Code_ extends __BASE_Language__Code_<"unstated"> {}

export interface _QUOTE_Block__Document_<__Id__ = _Id_Node_>
  extends __BASE_Content__Node_<"quote">,
    __Identity_Node_<__Id__>,
    __Parent_Document_<_NonEmpty_<_Block_Document_<__Id__>>> {}

// notes

export type _Note_Document_ =
  | _NODE_Note__Document_
  | _PASSAGE_Note__Document_
  | _DOCUMENT_Note__Document_
  | _DETACHED_Note__Document_;

interface __BASE_Note__Document_<__NoteKind__ extends string> {
  kind: __NoteKind__;
  id: _Id_Note_;
  body: _Text_Doctor_;
  written: _Stamp_Doctor_;
}

interface __TARGETED_Note__Document_<__NoteKind__ extends string>
  extends __BASE_Note__Document_<__NoteKind__> {
  node: _Id_Node_;
  confirmedAt: _Revision_Document_;
}

export interface _NODE_Note__Document_ extends __TARGETED_Note__Document_<"node"> {}

export interface _PASSAGE_Note__Document_ extends __TARGETED_Note__Document_<"passage"> {
  quote: _Quote_Note_;
}

export type _Quote_Note_ = _Role_<string, "NoteQuote">;

export interface _DOCUMENT_Note__Document_ extends __BASE_Note__Document_<"document"> {}

export interface _DETACHED_Note__Document_ extends __BASE_Note__Document_<"detached"> {
  detachedAt: _Revision_Document_;
  former: _Former_Note_;
}

export type _Former_Note_ = _NODE_Former__Note_ | _PASSAGE_Former__Note_;

interface __BASE_Former__Note_<__FormerKind__ extends string> {
  kind: __FormerKind__;
  node: _Id_Node_;
  text: string;
}

export interface _NODE_Former__Note_ extends __BASE_Former__Note_<"node"> {}

export interface _PASSAGE_Former__Note_ extends __BASE_Former__Note_<"passage"> {
  words: _Words_Former_;
}

export type _Words_Former_ = _Role_<string, "FormerWords">;

// changes

export interface _Change_Document_ {
  document: _Id_Document_;
  revision: _Revision_Document_;
  author: _Author_Doctor_;
  applied: _Time_Doctor_;
  source: _Source_Change_;
  operations: _NonEmpty_<_Operation_Change_>;
}

export type _Ref_Change_ = Pick<_Change_Document_, "document" | "revision">;

export type _Source_Change_ =
  | _INLINE_Source__Change_
  | _PROPOSAL_Source__Change_
  | _TASK_Source__Change_;

interface __BASE_Source__Change_<__SourceKind__ extends string> {
  kind: __SourceKind__;
}

interface __DELEGATED_Source__Change_<__SourceKind__ extends string>
  extends __BASE_Source__Change_<__SourceKind__> {
  task: _Id_Task_;
}

export interface _INLINE_Source__Change_ extends __BASE_Source__Change_<"inline"> {}

export interface _PROPOSAL_Source__Change_ extends __DELEGATED_Source__Change_<"proposal"> {
  proposal: _Id_Proposal_;
}

export interface _TASK_Source__Change_ extends __DELEGATED_Source__Change_<"task"> {}

export interface _Review_Change_ {
  change: _Ref_Change_;
  reviewed: _Stamp_Doctor_;
}

export type _Operation_Change_<__New__ = _Id_Node_> =
  | _EDIT_Operation__Change_
  | _RETITLE_Operation__Change_
  | _INSERT_Operation__Change_<__New__>
  | _DELETE_Operation__Change_
  | _MOVE_Operation__Change_<__New__>;

interface __BASE_Operation__Change_<__OperationKind__ extends string> {
  kind: __OperationKind__;
}

interface __TARGETED_Operation__Change_<__OperationKind__ extends string>
  extends __BASE_Operation__Change_<__OperationKind__> {
  node: _Id_Node_;
}

export interface _EDIT_Operation__Change_ extends __TARGETED_Operation__Change_<"edit"> {
  content: _Content_Node_;
}

export interface _RETITLE_Operation__Change_ extends __BASE_Operation__Change_<"retitle"> {
  title: _Text_Doctor_;
}

export interface _INSERT_Operation__Change_<__New__ = _Id_Node_>
  extends __BASE_Operation__Change_<"insert"> {
  at: _Position_Operation_<__New__>;
  subtree: _Node_Document_<__New__>;
}

export interface _DELETE_Operation__Change_ extends __TARGETED_Operation__Change_<"delete"> {}

export interface _MOVE_Operation__Change_<__New__ = _Id_Node_>
  extends __TARGETED_Operation__Change_<"move"> {
  to: _Position_Operation_<__New__>;
}

export type _Position_Operation_<__New__ = _Id_Node_> =
  | _FIRST_Position__Operation_<__New__>
  | _AFTER_Position__Operation_<__New__>;

interface __BASE_Position__Operation_<__PositionKind__ extends string, __New__> {
  kind: __PositionKind__;
  parent: _Parent_Position_<__New__>;
}

export interface _FIRST_Position__Operation_<__New__ = _Id_Node_>
  extends __BASE_Position__Operation_<"first", __New__> {}

export interface _AFTER_Position__Operation_<__New__ = _Id_Node_>
  extends __BASE_Position__Operation_<"after", __New__> {
  sibling: _Id_Node_ | __New__;
}

export type _Parent_Position_<__New__ = _Id_Node_> =
  | _BODY_Parent__Position_
  | _NODE_Parent__Position_<__New__>;

interface __BASE_Parent__Position_<__ParentKind__ extends string> {
  kind: __ParentKind__;
}

export interface _BODY_Parent__Position_ extends __BASE_Parent__Position_<"body"> {}

export interface _NODE_Parent__Position_<__New__ = _Id_Node_>
  extends __BASE_Parent__Position_<"node"> {
  node: _Id_Node_ | __New__;
}

// tasks

export type _Task_Doctor_ =
  | _DRAFT_Task__Doctor_
  | _WORKING_Task__Doctor_
  | _REVIEWING_Task__Doctor_
  | _COMPLETED_Task__Doctor_
  | _CANCELED_Task__Doctor_;

interface __BASE_Task__Doctor_<__TaskState__ extends string>
  extends __BASE_File_Doctor_<"task"> {
  state: __TaskState__;
  id: _Id_Task_;
  created: _Stamp_Doctor_;
  roles: _Roles_Task_;
  reviewTiming: _ReviewTiming_Task_;
  brief: _Brief_Task_;
}

interface __ACTIVATED_Task__Doctor_<
  __TaskState__ extends string,
  __Proposal__ extends _Proposal_Task_,
> extends __BASE_Task__Doctor_<__TaskState__> {
  activated: _Stamp_Doctor_;
  proposals: Array<__Proposal__>;
  applied: Array<_Ref_Change_>;
  reviews: Array<_Review_Change_>;
}

export interface _DRAFT_Task__Doctor_ extends __BASE_Task__Doctor_<"draft"> {}

export type _ACTIVE_Task__Doctor_<__Proposal__ extends _Proposal_Task_ = _Proposal_Task_> =
  | _WORKING_Task__Doctor_<__Proposal__>
  | _REVIEWING_Task__Doctor_<__Proposal__>;

export interface _WORKING_Task__Doctor_<__Proposal__ extends _Proposal_Task_ = _Proposal_Task_>
  extends __ACTIVATED_Task__Doctor_<"working", __Proposal__> {}

export interface _REVIEWING_Task__Doctor_<__Proposal__ extends _Proposal_Task_ = _Proposal_Task_>
  extends __ACTIVATED_Task__Doctor_<"reviewing", __Proposal__> {}

export interface _COMPLETED_Task__Doctor_
  extends __ACTIVATED_Task__Doctor_<"completed", _FINAL_Proposal__Task_> {
  completed: _Stamp_Doctor_;
}

export interface _CANCELED_Task__Doctor_
  extends __ACTIVATED_Task__Doctor_<"canceled", _FINAL_Proposal__Task_> {
  canceled: _Stamp_Doctor_;
  reason: _Reason_Task_;
}

export interface _Brief_Task_ {
  versions: _NonEmpty_<_Version_Brief_>;
}

export interface _Version_Brief_ {
  number: _Number_Brief_;
  written: _Stamp_Doctor_;
  instruction: _Text_Doctor_;
  scope: Array<_Ref_Node_>;
}

export type _Number_Brief_ = _Proof_<number, "BriefNumber">;

export interface _Roles_Task_ {
  worker: _Party_Role_;
  reviewer: _Party_Role_;
}

export type _Party_Role_ = "human" | "agent" | "anybody";

export type _ReviewTiming_Task_ = "before" | "after";

export type _Reason_Task_ = _STATED_Reason__Task_ | _UNSTATED_Reason__Task_;

interface __BASE_Reason__Task_<__ReasonKind__ extends string> {
  kind: __ReasonKind__;
}

export interface _STATED_Reason__Task_ extends __BASE_Reason__Task_<"stated"> {
  text: _Text_Doctor_;
}

export interface _UNSTATED_Reason__Task_ extends __BASE_Reason__Task_<"unstated"> {}

// proposals

export type _Proposal_Task_ = _WAITING_Proposal__Task_ | _FINAL_Proposal__Task_;

export type _WAITING_Proposal__Task_ = _PROPOSED_Proposal__Task_ | _REVISING_Proposal__Task_;

export type _FINAL_Proposal__Task_ =
  | _ACCEPTED_Proposal__Task_
  | _REJECTED_Proposal__Task_
  | _WITHDRAWN_Proposal__Task_;

interface __BASE_Proposal__Task_<
  __ProposalState__ extends string,
  __Last__ extends _Round_Proposal_,
> {
  state: __ProposalState__;
  id: _Id_Proposal_;
  document: _Id_Document_;
  rounds: [...Array<_REQUESTED_Round__Proposal_>, __Last__];
}

export interface _PROPOSED_Proposal__Task_
  extends __BASE_Proposal__Task_<"proposed", _STANDING_Round__Proposal_> {}

export interface _REVISING_Proposal__Task_
  extends __BASE_Proposal__Task_<"revising", _REQUESTED_Round__Proposal_> {}

export interface _ACCEPTED_Proposal__Task_
  extends __BASE_Proposal__Task_<"accepted", _STANDING_Round__Proposal_> {
  accepted: _Stamp_Doctor_;
  revision: _Revision_Document_;
}

export interface _REJECTED_Proposal__Task_
  extends __BASE_Proposal__Task_<"rejected", _STANDING_Round__Proposal_> {
  rejected: _Stamp_Doctor_;
  reason: _Reason_Task_;
}

export interface _WITHDRAWN_Proposal__Task_
  extends __BASE_Proposal__Task_<"withdrawn", _Round_Proposal_> {
  withdrawn: _Stamp_Doctor_;
  reason: _Reason_Task_;
}

export type _Round_Proposal_ = _STANDING_Round__Proposal_ | _REQUESTED_Round__Proposal_;

interface __BASE_Round__Proposal_<__RoundKind__ extends string> {
  kind: __RoundKind__;
  version: _Version_Proposal_;
}

export interface _STANDING_Round__Proposal_ extends __BASE_Round__Proposal_<"standing"> {}

export interface _REQUESTED_Round__Proposal_ extends __BASE_Round__Proposal_<"requested"> {
  request: _Request_Proposal_;
}

export interface _Version_Proposal_ {
  written: _Stamp_Doctor_;
  baseRevision: _Revision_Document_;
  answering: _Number_Brief_;
  operations: _NonEmpty_<_Operation_Change_<_DRAFT_Id__Node_>>;
}

export interface _Request_Proposal_ {
  made: _Stamp_Doctor_;
  feedback: _Text_Doctor_;
}

// transitions

export type _ACTIVATE_Transition__Task_ = (
  task: _DRAFT_Task__Doctor_,
  activated: _Stamp_Doctor_,
) => _WORKING_Task__Doctor_;

export type _SUBMIT_Transition__Task_ = (task: _WORKING_Task__Doctor_) => _REVIEWING_Task__Doctor_;

export type _RETURN_Transition__Task_ = (task: _REVIEWING_Task__Doctor_) => _WORKING_Task__Doctor_;

export type _COMPLETE_Transition__Task_ = (
  task: _ACTIVE_Task__Doctor_<_FINAL_Proposal__Task_>,
  completed: _Stamp_Doctor_,
) => _COMPLETED_Task__Doctor_;

export type _CANCEL_Transition__Task_ = (
  task: _ACTIVE_Task__Doctor_,
  canceled: _Stamp_Doctor_,
  reason: _Reason_Task_,
) => _CANCELED_Task__Doctor_;
