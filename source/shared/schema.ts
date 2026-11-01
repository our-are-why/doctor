import * as v from "valibot";
import type {
  _Author_Doctor_,
  _Block_Document_,
  _Body_Document_,
  _Content_Node_,
  _Contrast_Mark_,
  _Document_Doctor_,
  _EDITABLE_Content__Node_,
  _Entry_History_,
  _Former_Note_,
  _Hash_Node_,
  _Holder_Text_,
  _Id_Change_,
  _Id_Document_,
  _Id_Node_,
  _Id_Note_,
  _Id_Proposal_,
  _Id_Task_,
  _Language_Code_,
  _ListItem_Document_,
  _Mark_Text_,
  _Node_Document_,
  _Note_Document_,
  _Object_Store_,
  _Offset_Text_,
  _Operation_Change_,
  _Parent_Position_,
  _Position_Operation_,
  _Range_Text_,
  _Ref_Change_,
  _Source_Change_,
  _Stamp_Doctor_,
  _Target_Link_,
  _Text_Doctor_,
  _Time_Doctor_,
  _Url_Target_,
  _Version_Document_,
  _Words_Former_,
} from "./domain.next.ts";
import { documentIssues } from "./invariants.ts";

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

export const blockSchema: v.GenericSchema<unknown, _Block_Document_> = v.lazy(() =>
  v.variant("kind", [
    v.strictObject({
      kind: v.literal("section"),
      id: nodeIdSchema,
      heading: textSchema,
      children: v.array(blockSchema),
    }),
    v.strictObject({ kind: v.literal("paragraph"), id: nodeIdSchema, text: v.string(), overlay: overlaySchema }),
    v.strictObject({
      kind: v.literal("list"),
      id: nodeIdSchema,
      order: orderSchema,
      children: v.tupleWithRest([listItemSchema], listItemSchema),
    }),
    v.strictObject({ kind: v.literal("code"), id: nodeIdSchema, language: languageSchema, code: v.string() }),
    v.strictObject({
      kind: v.literal("quote"),
      id: nodeIdSchema,
      children: v.tupleWithRest([blockSchema], blockSchema),
    }),
  ]),
);

export const listItemSchema: v.GenericSchema<unknown, _ListItem_Document_> = v.lazy(() =>
  v.strictObject({
    kind: v.literal("listItem"),
    id: nodeIdSchema,
    text: v.string(),
    overlay: overlaySchema,
    children: v.array(blockSchema),
  }),
);

const nodeSchema: v.GenericSchema<unknown, _Node_Document_> = v.union([blockSchema, listItemSchema]);

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

const holderSchema: v.GenericSchema<unknown, _Holder_Text_> = v.variant("kind", [
  v.strictObject({ kind: v.literal("title") }),
  v.strictObject({ kind: v.literal("node"), node: nodeIdSchema }),
]);

const editableSchema: v.GenericSchema<unknown, _EDITABLE_Content__Node_> = v.variant("kind", [
  v.strictObject({ kind: v.literal("list"), order: orderSchema }),
  v.strictObject({ kind: v.literal("code"), language: languageSchema, code: v.string() }),
]);

const parentSchema: v.GenericSchema<unknown, _Parent_Position_> = v.variant("kind", [
  v.strictObject({ kind: v.literal("body") }),
  v.strictObject({ kind: v.literal("node"), node: nodeIdSchema }),
]);

const positionSchema: v.GenericSchema<unknown, _Position_Operation_> = v.variant("kind", [
  v.strictObject({ kind: v.literal("first"), parent: parentSchema }),
  v.strictObject({ kind: v.literal("after"), parent: parentSchema, sibling: nodeIdSchema }),
]);

export const operationSchema: v.GenericSchema<unknown, _Operation_Change_> = v.variant("kind", [
  v.strictObject({ kind: v.literal("write"), holder: holderSchema, text: v.string() }),
  v.strictObject({ kind: v.literal("style"), holder: holderSchema, overlay: overlaySchema }),
  v.strictObject({ kind: v.literal("edit"), node: nodeIdSchema, content: editableSchema }),
  v.strictObject({ kind: v.literal("insert"), at: positionSchema, subtree: nodeSchema }),
  v.strictObject({ kind: v.literal("delete"), node: nodeIdSchema }),
  v.strictObject({ kind: v.literal("move"), node: nodeIdSchema, to: positionSchema }),
]);

export const operationsSchema = v.tupleWithRest([operationSchema], operationSchema);

// the store and the history

const contentSchema: v.GenericSchema<unknown, _Content_Node_> = v.variant("kind", [
  v.strictObject({ kind: v.literal("section"), heading: textSchema }),
  v.strictObject({ kind: v.literal("paragraph"), text: v.string(), overlay: overlaySchema }),
  v.strictObject({ kind: v.literal("list"), order: orderSchema }),
  v.strictObject({ kind: v.literal("listItem"), text: v.string(), overlay: overlaySchema }),
  v.strictObject({ kind: v.literal("code"), language: languageSchema, code: v.string() }),
  v.strictObject({ kind: v.literal("quote") }),
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
