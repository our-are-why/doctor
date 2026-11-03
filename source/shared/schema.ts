import * as v from "valibot";
import type {
  _Author_Doctor_,
  _Block_Document_,
  _Body_Document_,
  _Content_Node_,
  _Contrast_Mark_,
  _Document_Doctor_,
  _DRAFT_Id__Node_,
  _EDITABLE_Content__Node_,
  _Entry_History_,
  _FINAL_Proposal__Task_,
  _Former_Note_,
  _Hash_Node_,
  _Holder_Text_,
  _Id_Change_,
  _Id_Document_,
  _Id_Node_,
  _Id_Note_,
  _Id_Proposal_,
  _Id_Request_,
  _Id_Task_,
  _Language_Code_,
  _ListItem_Document_,
  _Mark_Text_,
  _Node_Document_,
  _Note_Document_,
  _Number_Brief_,
  _Object_Store_,
  _Offset_Text_,
  _Operation_Change_,
  _Parent_Position_,
  _Position_Operation_,
  _Proposal_Task_,
  _Range_Text_,
  _Reason_Task_,
  _Ref_Change_,
  _Ref_Node_,
  _Request_Task_,
  _EDITED_Round__Proposal_,
  _Past_Round__Proposal_,
  _REQUESTED_Round__Proposal_,
  _Review_Change_,
  _Round_Proposal_,
  _Source_Change_,
  _Stamp_Doctor_,
  _STANDING_Round__Proposal_,
  _Target_Link_,
  _Target_Request_,
  _Task_Doctor_,
  _Submission_Task_,
  _Text_Doctor_,
  _Time_Doctor_,
  _Url_Target_,
  _Version_Brief_,
  _Version_Document_,
  _Version_Proposal_,
  _Words_Former_,
} from "./domain.next.ts";
import { documentIssues } from "./invariants.ts";
import { parse, parseOwn } from "./parse.ts";

// ids are ten random characters from [0-9a-z]
const idPattern = /^[0-9a-z]{10}$/;
const isId = (input: unknown) => typeof input === "string" && idPattern.test(input);
const idMessage = "an id is ten characters from 0-9 and a-z";

export const documentIdSchema: v.GenericSchema<unknown, _Id_Document_> = v.custom<_Id_Document_>(isId, idMessage);
export const nodeIdSchema: v.GenericSchema<unknown, _Id_Node_> = v.custom<_Id_Node_>(isId, idMessage);
export const noteIdSchema: v.GenericSchema<unknown, _Id_Note_> = v.custom<_Id_Note_>(isId, idMessage);
export const changeIdSchema: v.GenericSchema<unknown, _Id_Change_> = v.custom<_Id_Change_>(isId, idMessage);
export const taskIdSchema: v.GenericSchema<unknown, _Id_Task_> = v.custom<_Id_Task_>(isId, idMessage);
export const proposalIdSchema: v.GenericSchema<unknown, _Id_Proposal_> = v.custom<_Id_Proposal_>(isId, idMessage);
export const requestIdSchema: v.GenericSchema<unknown, _Id_Request_> = v.custom<_Id_Request_>(isId, idMessage);

// hashes are SHA-256, in lowercase hex
const isHash = (input: unknown) => typeof input === "string" && /^[0-9a-f]{64}$/.test(input);
const hashMessage = "a hash is 64 characters from 0-9 and a-f";

export const versionSchema: v.GenericSchema<unknown, _Version_Document_> = v.custom<_Version_Document_>(
  isHash,
  hashMessage,
);
export const nodeHashSchema: v.GenericSchema<unknown, _Hash_Node_> = v.custom<_Hash_Node_>(isHash, hashMessage);

export const timeSchema: v.GenericSchema<unknown, _Time_Doctor_> = v.custom<_Time_Doctor_>(
  (input) => typeof input === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/.test(input),
  "a time is ISO 8601, in UTC",
);

export const authorSchema: v.GenericSchema<unknown, _Author_Doctor_> = v.picklist(["human", "agent"]);

export const stampSchema: v.GenericSchema<unknown, _Stamp_Doctor_> = v.strictObject({
  by: authorSchema,
  at: timeSchema,
});

export const offsetSchema: v.GenericSchema<unknown, _Offset_Text_> = v.custom<_Offset_Text_>(
  (input) => typeof input === "number" && Number.isInteger(input) && input >= 0,
  "an offset is a whole number from 0",
);

const contrastSchema: v.GenericSchema<unknown, _Contrast_Mark_> = v.picklist([
  "bold",
  "italic",
  "monospace",
  "highlighted",
  "struck",
]);

export const urlSchema: v.GenericSchema<unknown, _Url_Target_> = v.custom<_Url_Target_>(
  (input) => typeof input === "string" && /^https?:\/\/\S+$/.test(input),
  "a link URL starts with http:// or https://",
);

const targetSchema: v.GenericSchema<unknown, _Target_Link_> = v.variant("kind", [
  v.strictObject({ kind: v.literal("external"), url: urlSchema }),
  v.strictObject({ kind: v.literal("document"), document: documentIdSchema }),
  v.strictObject({ kind: v.literal("node"), document: documentIdSchema, node: nodeIdSchema }),
]);

export const markSchema: v.GenericSchema<unknown, _Mark_Text_> = v.variant("kind", [
  v.strictObject({ kind: v.literal("contrast"), contrast: contrastSchema, from: offsetSchema, to: offsetSchema }),
  v.strictObject({ kind: v.literal("link"), from: offsetSchema, to: offsetSchema, target: targetSchema }),
]);

const overlaySchema = v.array(markSchema);

export const textSchema: v.GenericSchema<unknown, _Text_Doctor_> = v.strictObject({
  text: v.string(),
  overlay: overlaySchema,
});

const languageSchema: v.GenericSchema<unknown, _Language_Code_> = v.variant("kind", [
  v.strictObject({ kind: v.literal("stated"), name: v.string() }),
  v.strictObject({ kind: v.literal("unstated") }),
]);

const orderSchema = v.picklist(["ordered", "unordered"]);

interface _Schemas_Node_<__Id__> {
  block: v.GenericSchema<unknown, _Block_Document_<__Id__>>;
  item: v.GenericSchema<unknown, _ListItem_Document_<__Id__>>;
  node: v.GenericSchema<unknown, _Node_Document_<__Id__>>;
}

// quotes written before they had references have none
const referenceSchema = v.optional(textSchema, (): _Text_Doctor_ => ({ text: "", overlay: [] }));

// Nodes whose ids are what idSchema reads: a document's, or the new ones a
// proposal makes. Each kind's schema is shared by blocks and nodes, so a
// node that doesn't fit is reported by what's wrong in its kind.
function nodeSchemas<__Id__>(idSchema: v.GenericSchema<unknown, __Id__>): _Schemas_Node_<__Id__> {
  const blocks = v.lazy(() => block);
  const items = v.lazy(() => item);
  const section = v.strictObject({ kind: v.literal("section"), id: idSchema, heading: textSchema, children: v.array(blocks) });
  const paragraph = v.strictObject({ kind: v.literal("paragraph"), id: idSchema, text: v.string(), overlay: overlaySchema });
  const list = v.strictObject({
    kind: v.literal("list"),
    id: idSchema,
    order: orderSchema,
    children: v.tupleWithRest([items], items),
  });
  const code = v.strictObject({ kind: v.literal("code"), id: idSchema, language: languageSchema, code: v.string() });
  const quote = v.strictObject({
    kind: v.literal("quote"),
    id: idSchema,
    reference: referenceSchema,
    children: v.tupleWithRest([blocks], blocks),
  });
  const listItem = v.strictObject({
    kind: v.literal("listItem"),
    id: idSchema,
    text: v.string(),
    overlay: overlaySchema,
    children: v.array(blocks),
  });
  const item: v.GenericSchema<unknown, _ListItem_Document_<__Id__>> = listItem;
  const block: v.GenericSchema<unknown, _Block_Document_<__Id__>> = v.variant("kind", [section, paragraph, list, code, quote]);
  const node: v.GenericSchema<unknown, _Node_Document_<__Id__>> = v.variant("kind", [
    section,
    paragraph,
    list,
    code,
    quote,
    listItem,
  ]);
  return { block, item, node };
}

const documentNodes = nodeSchemas(nodeIdSchema);
export const blockSchema = documentNodes.block;
export const listItemSchema = documentNodes.item;

// a node a proposal makes is named new-something until it's accepted, which
// no document id can be
export const draftIdSchema: v.GenericSchema<unknown, _DRAFT_Id__Node_> = v.custom<_DRAFT_Id__Node_>(
  (input) => typeof input === "string" && /^new-[0-9a-z-]+$/.test(input),
  "a new node's id is new- and then letters, digits or dashes",
);

const draftNodes = nodeSchemas(draftIdSchema);

export const bodySchema: v.GenericSchema<unknown, _Body_Document_> = v.strictObject({
  title: textSchema,
  children: v.array(blockSchema),
});

export const wordsSchema: v.GenericSchema<unknown, _Words_Former_> = v.custom<_Words_Former_>(
  (input) => typeof input === "string" && input.length > 0,
  "the former words are what a note was about, not empty",
);

const formerSchema: v.GenericSchema<unknown, _Former_Note_> = v.variant("kind", [
  v.strictObject({ kind: v.literal("node"), node: nodeIdSchema, text: v.string() }),
  v.strictObject({ kind: v.literal("passage"), node: nodeIdSchema, text: v.string(), words: wordsSchema }),
]);

const rangeSchema: v.GenericSchema<unknown, _Range_Text_> = v.strictObject({ from: offsetSchema, to: offsetSchema });

export const changeRefSchema: v.GenericSchema<unknown, _Ref_Change_> = v.strictObject({
  document: documentIdSchema,
  id: changeIdSchema,
});

export const noteSchema: v.GenericSchema<unknown, _Note_Document_> = v.variant("kind", [
  v.strictObject({
    kind: v.literal("node"),
    id: noteIdSchema,
    body: textSchema,
    written: stampSchema,
    node: nodeIdSchema,
    confirmedIn: versionSchema,
  }),
  v.strictObject({
    kind: v.literal("passage"),
    id: noteIdSchema,
    body: textSchema,
    written: stampSchema,
    node: nodeIdSchema,
    confirmedIn: versionSchema,
    range: rangeSchema,
  }),
  v.strictObject({ kind: v.literal("document"), id: noteIdSchema, body: textSchema, written: stampSchema }),
  v.strictObject({
    kind: v.literal("detached"),
    id: noteIdSchema,
    body: textSchema,
    written: stampSchema,
    detachedBy: changeRefSchema,
    former: formerSchema,
  }),
]);

export const documentSchema: v.GenericSchema<unknown, _Document_Doctor_> = v.pipe(
  v.strictObject({
    kind: v.literal("document"),
    formatVersion: v.literal(1),
    id: documentIdSchema,
    content: bodySchema,
    notes: v.array(noteSchema),
  }),
  v.rawCheck<_Document_Doctor_>(({ dataset, addIssue }) => {
    if (!dataset.typed) return;
    for (const issue of documentIssues(dataset.value)) addIssue({ message: issue });
  }),
);

// operations

export const holderSchema: v.GenericSchema<unknown, _Holder_Text_> = v.variant("kind", [
  v.strictObject({ kind: v.literal("title") }),
  v.strictObject({ kind: v.literal("node"), node: nodeIdSchema }),
]);

const editableSchema: v.GenericSchema<unknown, _EDITABLE_Content__Node_> = v.variant("kind", [
  v.strictObject({ kind: v.literal("list"), order: orderSchema }),
  v.strictObject({ kind: v.literal("code"), language: languageSchema, code: v.string() }),
]);

// operations whose new nodes have ids newSchema reads, as do the parents
// and siblings they can be placed by
function operationSchemaFor<__New__>(
  newSchema: v.GenericSchema<unknown, __New__>,
  subtreeSchema: v.GenericSchema<unknown, _Node_Document_<__New__>>,
): v.GenericSchema<unknown, _Operation_Change_<__New__>> {
  const placedBy = v.union([nodeIdSchema, newSchema]);
  const parentSchema: v.GenericSchema<unknown, _Parent_Position_<__New__>> = v.variant("kind", [
    v.strictObject({ kind: v.literal("body") }),
    v.strictObject({ kind: v.literal("node"), node: placedBy }),
  ]);
  const positionSchema: v.GenericSchema<unknown, _Position_Operation_<__New__>> = v.variant("kind", [
    v.strictObject({ kind: v.literal("first"), parent: parentSchema }),
    v.strictObject({ kind: v.literal("after"), parent: parentSchema, sibling: placedBy }),
  ]);
  return v.variant("kind", [
    v.strictObject({ kind: v.literal("write"), holder: holderSchema, text: v.string() }),
    v.strictObject({ kind: v.literal("style"), holder: holderSchema, overlay: overlaySchema }),
    v.strictObject({ kind: v.literal("edit"), node: nodeIdSchema, content: editableSchema }),
    v.strictObject({ kind: v.literal("insert"), at: positionSchema, subtree: subtreeSchema }),
    v.strictObject({ kind: v.literal("delete"), node: nodeIdSchema }),
    v.strictObject({ kind: v.literal("move"), node: nodeIdSchema, to: positionSchema }),
  ]);
}

export const operationSchema = operationSchemaFor(nodeIdSchema, documentNodes.node);
export const operationsSchema = v.tupleWithRest([operationSchema], operationSchema);

export const proposalOperationSchema = operationSchemaFor(draftIdSchema, draftNodes.node);
export const proposalOperationsSchema = v.tupleWithRest([proposalOperationSchema], proposalOperationSchema);

// the store and the history

const contentSchema: v.GenericSchema<unknown, _Content_Node_> = v.variant("kind", [
  v.strictObject({ kind: v.literal("section"), heading: textSchema }),
  v.strictObject({ kind: v.literal("paragraph"), text: v.string(), overlay: overlaySchema }),
  v.strictObject({ kind: v.literal("list"), order: orderSchema }),
  v.strictObject({ kind: v.literal("listItem"), text: v.string(), overlay: overlaySchema }),
  v.strictObject({ kind: v.literal("code"), language: languageSchema, code: v.string() }),
  v.strictObject({ kind: v.literal("quote"), reference: referenceSchema }),
]);

export const storeObjectSchema: v.GenericSchema<unknown, _Object_Store_> = v.variant("kind", [
  v.strictObject({
    kind: v.literal("version"),
    document: documentIdSchema,
    title: textSchema,
    notes: v.array(noteSchema),
    children: v.array(nodeHashSchema),
  }),
  v.strictObject({
    kind: v.literal("node"),
    id: nodeIdSchema,
    content: contentSchema,
    children: v.array(nodeHashSchema),
  }),
]);

const sourceSchema: v.GenericSchema<unknown, _Source_Change_> = v.variant("kind", [
  v.strictObject({ kind: v.literal("inline") }),
  v.strictObject({ kind: v.literal("proposal"), task: taskIdSchema, proposal: proposalIdSchema }),
  v.strictObject({ kind: v.literal("task"), task: taskIdSchema }),
]);

export const historyEntrySchema: v.GenericSchema<unknown, _Entry_History_> = v.variant("kind", [
  v.strictObject({
    kind: v.literal("creation"),
    document: documentIdSchema,
    version: versionSchema,
    made: stampSchema,
  }),
  v.strictObject({
    kind: v.literal("change"),
    document: documentIdSchema,
    version: versionSchema,
    made: stampSchema,
    id: changeIdSchema,
    parent: versionSchema,
    source: sourceSchema,
    operations: operationsSchema,
  }),
]);

// tasks and their proposals

export const numberBriefSchema: v.GenericSchema<unknown, _Number_Brief_> = v.custom<_Number_Brief_>(
  (input) => typeof input === "number" && Number.isInteger(input) && input >= 1,
  "a brief's number is a whole number from 1",
);

export const refNodeSchema: v.GenericSchema<unknown, _Ref_Node_> = v.strictObject({
  document: documentIdSchema,
  node: nodeIdSchema,
});

const reasonSchema: v.GenericSchema<unknown, _Reason_Task_> = v.variant("kind", [
  v.strictObject({ kind: v.literal("stated"), text: textSchema }),
  v.strictObject({ kind: v.literal("unstated") }),
]);

const partySchema = v.picklist(["human", "agent", "anybody"]);

export const requestTargetSchema: v.GenericSchema<unknown, _Target_Request_> = v.variant("kind", [
  v.strictObject({ kind: v.literal("document"), document: documentIdSchema }),
  v.strictObject({ kind: v.literal("node"), document: documentIdSchema, node: nodeIdSchema }),
  v.strictObject({ kind: v.literal("passage"), document: documentIdSchema, holder: holderSchema, range: rangeSchema }),
]);

const requestSchema: v.GenericSchema<unknown, _Request_Task_> = v.strictObject({
  id: requestIdSchema,
  made: stampSchema,
  text: textSchema,
  targets: v.array(requestTargetSchema),
});

// A brief written before requests had one instruction and a scope: nodes,
// with no kind at first, later whole documents or nodes. It reads as one
// request, aimed at its scope.
const earlierTargetSchema: v.GenericSchema<unknown, _Target_Request_> = v.union([
  v.variant("kind", [
    v.strictObject({ kind: v.literal("document"), document: documentIdSchema }),
    v.strictObject({ kind: v.literal("node"), document: documentIdSchema, node: nodeIdSchema }),
  ]),
  v.pipe(
    refNodeSchema,
    v.transform((ref): _Target_Request_ => ({ kind: "node", document: ref.document, node: ref.node })),
  ),
]);

const earlierRequest = parseOwn(requestIdSchema, "r000000001");

const briefVersionSchema: v.GenericSchema<unknown, _Version_Brief_> = v.union([
  v.strictObject({
    number: numberBriefSchema,
    written: stampSchema,
    requests: v.tupleWithRest([requestSchema], requestSchema),
  }),
  v.pipe(
    v.strictObject({ number: numberBriefSchema, written: stampSchema, instruction: textSchema, scope: v.array(earlierTargetSchema) }),
    v.transform(
      (earlier): _Version_Brief_ => ({
        number: earlier.number,
        written: earlier.written,
        requests: [{ id: earlierRequest, made: earlier.written, text: earlier.instruction, targets: earlier.scope }],
      }),
    ),
  ),
]);

// proposals made before they said what they answered answer nothing named
const proposalVersionSchema: v.GenericSchema<unknown, _Version_Proposal_> = v.strictObject({
  written: stampSchema,
  base: versionSchema,
  answering: numberBriefSchema,
  answers: v.optional(v.array(requestIdSchema), () => []),
  operations: proposalOperationsSchema,
});

const standingSchema: v.GenericSchema<unknown, _STANDING_Round__Proposal_> = v.strictObject({
  kind: v.literal("standing"),
  version: proposalVersionSchema,
});

// a passage noted before where its words start was kept is taken to be
// their first place in the text they're in
const passageSchema = v.pipe(
  v.strictObject({ words: v.string(), within: v.string(), at: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))), note: textSchema }),
  v.transform((passage) => {
    const first = passage.within.indexOf(passage.words);
    const at = passage.at ?? (first === -1 ? 0 : Array.from(passage.within.slice(0, first)).length);
    return { words: passage.words, within: passage.within, at, note: passage.note };
  }),
);

const requestedSchema: v.GenericSchema<unknown, _REQUESTED_Round__Proposal_> = v.strictObject({
  kind: v.literal("requested"),
  version: proposalVersionSchema,
  request: v.strictObject({
    made: stampSchema,
    feedback: textSchema,
    // requests made before they could note words of a proposal have none
    passages: v.optional(v.array(passageSchema), () => []),
  }),
});

const editedSchema: v.GenericSchema<unknown, _EDITED_Round__Proposal_> = v.strictObject({
  kind: v.literal("edited"),
  version: proposalVersionSchema,
});

const roundSchema: v.GenericSchema<unknown, _Round_Proposal_> = v.union([standingSchema, requestedSchema]);

const pastSchema: v.GenericSchema<unknown, _Past_Round__Proposal_> = v.union([requestedSchema, editedSchema]);

// every round but the last got a request for changes, or was edited by you;
// what the last may be depends on the proposal's state
function roundsSchema<__Last__ extends _Round_Proposal_>(
  lastSchema: v.GenericSchema<unknown, __Last__>,
): v.GenericSchema<unknown, [...Array<_Past_Round__Proposal_>, __Last__]> {
  return v.pipe(
    v.custom<Array<unknown>>(
      (input) =>
        Array.isArray(input) &&
        input.length > 0 &&
        input.slice(0, -1).every((round) => parse(pastSchema, round).kind === "parsed") &&
        parse(lastSchema, input.at(-1)).kind === "parsed",
      "a proposal's rounds are its earlier requested or edited ones, then its last",
    ),
    // each round as its schema reads it, with what it fills in for what an
    // older round doesn't have
    v.transform((input): [...Array<_Past_Round__Proposal_>, __Last__] => [
      ...input.slice(0, -1).map((round) => parseOwn(pastSchema, round)),
      parseOwn(lastSchema, input.at(-1)),
    ]),
  );
}

const proposalBase = { id: proposalIdSchema, document: documentIdSchema };

const accepted = v.strictObject({
  state: v.literal("accepted"),
  ...proposalBase,
  rounds: roundsSchema(standingSchema),
  accepted: stampSchema,
  // accepted before acceptance waited for its task's completion, a proposal
  // was applied at once, and kept the change it made as one
  change: v.union([v.array(changeRefSchema), v.pipe(changeRefSchema, v.transform((ref): Array<_Ref_Change_> => [ref]))]),
});

const rejected = v.strictObject({
  state: v.literal("rejected"),
  ...proposalBase,
  rounds: roundsSchema(standingSchema),
  rejected: stampSchema,
  reason: reasonSchema,
});

const withdrawn = v.strictObject({
  state: v.literal("withdrawn"),
  ...proposalBase,
  rounds: roundsSchema(roundSchema),
  withdrawn: stampSchema,
  reason: reasonSchema,
});

const finalProposalSchema: v.GenericSchema<unknown, _FINAL_Proposal__Task_> = v.variant("state", [accepted, rejected, withdrawn]);

export const proposalSchema: v.GenericSchema<unknown, _Proposal_Task_> = v.variant("state", [
  v.strictObject({ state: v.literal("proposed"), ...proposalBase, rounds: roundsSchema(standingSchema) }),
  v.strictObject({ state: v.literal("revising"), ...proposalBase, rounds: roundsSchema(requestedSchema) }),
  accepted,
  rejected,
  withdrawn,
]);

const reviewSchema: v.GenericSchema<unknown, _Review_Change_> = v.strictObject({
  change: changeRefSchema,
  reviewed: stampSchema,
});

const taskBase = {
  kind: v.literal("task"),
  formatVersion: v.literal(1),
  id: taskIdSchema,
  created: stampSchema,
  roles: v.strictObject({ worker: partySchema, reviewer: partySchema }),
  reviewTiming: v.picklist(["before", "after"]),
  brief: v.strictObject({ versions: v.tupleWithRest([briefVersionSchema], briefVersionSchema) }),
};

const submissionSchema: v.GenericSchema<unknown, _Submission_Task_> = v.strictObject({
  submitted: stampSchema,
  note: textSchema,
});

const activated = {
  activated: stampSchema,
  applied: v.array(changeRefSchema),
  reviews: v.array(reviewSchema),
  // tasks handed over before what was said in doing so was kept have none
  submissions: v.optional(v.array(submissionSchema), (): Array<_Submission_Task_> => []),
};

export const taskSchema: v.GenericSchema<unknown, _Task_Doctor_> = v.variant("state", [
  v.strictObject({ state: v.literal("draft"), ...taskBase }),
  v.strictObject({ state: v.literal("working"), ...taskBase, ...activated, proposals: v.array(proposalSchema) }),
  v.strictObject({ state: v.literal("reviewing"), ...taskBase, ...activated, proposals: v.array(proposalSchema) }),
  v.strictObject({
    state: v.literal("parked"),
    ...taskBase,
    ...activated,
    proposals: v.array(proposalSchema),
    // tasks parked before they kept what was waiting for review had it
    // withdrawn, and went back to being worked on
    was: v.optional(v.picklist(["working", "reviewing"]), "working"),
    parked: stampSchema,
  }),
  v.strictObject({
    state: v.literal("completed"),
    ...taskBase,
    ...activated,
    proposals: v.array(finalProposalSchema),
    completed: stampSchema,
  }),
  v.strictObject({
    state: v.literal("canceled"),
    ...taskBase,
    ...activated,
    proposals: v.array(finalProposalSchema),
    canceled: stampSchema,
    reason: reasonSchema,
  }),
]);
