import * as v from "valibot";
import type {
  _Author_Doctor_,
  _Block_Document_,
  _Body_Document_,
  _Contrast_Run_,
  _Contrasts_Run_,
  _Document_Doctor_,
  _Former_Note_,
  _Id_Document_,
  _Id_Node_,
  _Id_Note_,
  _Inline_Text_,
  _Language_Code_,
  _ListItem_Document_,
  _Note_Document_,
  _Quote_Note_,
  _RUN_Inline__Text_,
  _Revision_Document_,
  _Stamp_Doctor_,
  _Target_Link_,
  _Text_Doctor_,
  _Time_Doctor_,
  _Url_Target_,
  _Words_Former_,
} from "./domain.ts";

// ids are ten random characters from [0-9a-z]
const idPattern = /^[0-9a-z]{10}$/;
const isId = (input: unknown) => typeof input === "string" && idPattern.test(input);
const idMessage = "an id is ten characters from 0-9 and a-z";

export const documentIdSchema: v.GenericSchema<unknown, _Id_Document_> = v.custom<_Id_Document_>(isId, idMessage);
export const nodeIdSchema: v.GenericSchema<unknown, _Id_Node_> = v.custom<_Id_Node_>(isId, idMessage);
export const noteIdSchema: v.GenericSchema<unknown, _Id_Note_> = v.custom<_Id_Note_>(isId, idMessage);

export const revisionSchema: v.GenericSchema<unknown, _Revision_Document_> = v.custom<_Revision_Document_>(
  (input) => typeof input === "number" && Number.isInteger(input) && input >= 1,
  "a revision is a whole number from 1",
);

export const timeSchema: v.GenericSchema<unknown, _Time_Doctor_> = v.custom<_Time_Doctor_>(
  (input) => typeof input === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/.test(input),
  "a time is ISO 8601, in UTC",
);

export const authorSchema: v.GenericSchema<unknown, _Author_Doctor_> = v.picklist(["human", "agent"]);

export const stampSchema: v.GenericSchema<unknown, _Stamp_Doctor_> = v.strictObject({
  by: authorSchema,
  at: timeSchema,
});

const contrastOptions: ReadonlyArray<_Contrast_Run_> = ["bold", "italic", "monospace", "highlighted", "struck"];
const isContrast = (input: unknown) => contrastOptions.some((option) => option === input);

export const contrastsSchema: v.GenericSchema<unknown, _Contrasts_Run_> = v.custom<_Contrasts_Run_>(
  (input) => Array.isArray(input) && input.every(isContrast) && new Set(input).size === input.length,
  "contrast lists bold, italic, monospace, highlighted or struck, each at most once",
);

const urlSchema: v.GenericSchema<unknown, _Url_Target_> = v.custom<_Url_Target_>(
  (input) => typeof input === "string" && /^https?:\/\/\S+$/.test(input),
  "a link URL starts with http:// or https://",
);

const runObjectSchema = v.strictObject({ kind: v.literal("run"), text: v.string(), contrast: contrastsSchema });

const targetSchema: v.GenericSchema<unknown, _Target_Link_> = v.variant("kind", [
  v.strictObject({ kind: v.literal("external"), url: urlSchema }),
  v.strictObject({ kind: v.literal("document"), document: documentIdSchema }),
  v.strictObject({ kind: v.literal("node"), document: documentIdSchema, node: nodeIdSchema }),
]);

export const inlineSchema: v.GenericSchema<unknown, _Inline_Text_> = v.variant("kind", [
  runObjectSchema,
  v.strictObject({
    kind: v.literal("link"),
    label: v.tupleWithRest([runObjectSchema], runObjectSchema),
    target: targetSchema,
  }),
]);

export const runSchema: v.GenericSchema<unknown, _RUN_Inline__Text_> = runObjectSchema;

export const textSchema: v.GenericSchema<unknown, _Text_Doctor_> = v.array(inlineSchema);

const languageSchema: v.GenericSchema<unknown, _Language_Code_> = v.variant("kind", [
  v.strictObject({ kind: v.literal("stated"), name: v.string() }),
  v.strictObject({ kind: v.literal("unstated") }),
]);

export const blockSchema: v.GenericSchema<unknown, _Block_Document_> = v.lazy(() =>
  v.variant("kind", [
    v.strictObject({
      kind: v.literal("section"),
      id: nodeIdSchema,
      heading: textSchema,
      children: v.array(blockSchema),
    }),
    v.strictObject({ kind: v.literal("paragraph"), id: nodeIdSchema, text: textSchema }),
    v.strictObject({
      kind: v.literal("list"),
      id: nodeIdSchema,
      order: v.picklist(["ordered", "unordered"]),
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
    text: textSchema,
    children: v.array(blockSchema),
  }),
);

export const bodySchema: v.GenericSchema<unknown, _Body_Document_> = v.strictObject({
  title: textSchema,
  children: v.array(blockSchema),
});

const quoteSchema: v.GenericSchema<unknown, _Quote_Note_> = v.custom<_Quote_Note_>(
  (input) => typeof input === "string" && input.length > 0,
  "a quote is the words a note is about, not empty",
);

const wordsSchema: v.GenericSchema<unknown, _Words_Former_> = v.custom<_Words_Former_>(
  (input) => typeof input === "string" && input.length > 0,
  "the former words are what a note was about, not empty",
);

const formerSchema: v.GenericSchema<unknown, _Former_Note_> = v.variant("kind", [
  v.strictObject({ kind: v.literal("node"), node: nodeIdSchema, text: v.string() }),
  v.strictObject({ kind: v.literal("passage"), node: nodeIdSchema, text: v.string(), words: wordsSchema }),
]);

export const noteSchema: v.GenericSchema<unknown, _Note_Document_> = v.variant("kind", [
  v.strictObject({
    kind: v.literal("node"),
    id: noteIdSchema,
    body: textSchema,
    written: stampSchema,
    node: nodeIdSchema,
    confirmedAt: revisionSchema,
  }),
  v.strictObject({
    kind: v.literal("passage"),
    id: noteIdSchema,
    body: textSchema,
    written: stampSchema,
    node: nodeIdSchema,
    confirmedAt: revisionSchema,
    quote: quoteSchema,
  }),
  v.strictObject({ kind: v.literal("document"), id: noteIdSchema, body: textSchema, written: stampSchema }),
  v.strictObject({
    kind: v.literal("detached"),
    id: noteIdSchema,
    body: textSchema,
    written: stampSchema,
    detachedAt: revisionSchema,
    former: formerSchema,
  }),
]);

export const documentSchema: v.GenericSchema<unknown, _Document_Doctor_> = v.strictObject({
  kind: v.literal("document"),
  formatVersion: v.literal(1),
  id: documentIdSchema,
  revision: revisionSchema,
  content: bodySchema,
  notes: v.array(noteSchema),
});
