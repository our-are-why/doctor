import type {
  _Block_Document_,
  _Body_Document_,
  _DETACHED_Note__Document_,
  _Document_Doctor_,
  _EDITABLE_Content__Node_,
  _Former_Note_,
  _Holder_Text_,
  _Id_Node_,
  _ListItem_Document_,
  _NODE_Note__Document_,
  _Node_Document_,
  _Note_Document_,
  _Operation_Change_,
  _Parent_Position_,
  _PASSAGE_Note__Document_,
  _Position_Operation_,
  _Ref_Change_,
  _Text_Doctor_,
} from "./domain.next.ts";
import { overlayIssues } from "./invariants.ts";
import { parseOwn } from "./parse.ts";
import { wordsSchema } from "./schema.ts";
import { carryRange, rewrite, sameOverlay, sliceOf, type _Difference_Text_ } from "./text.ts";
import { childrenOf, idsWithin, indexNodes, nodesWithin, nodeText, textOfNode, type _Index_Document_ } from "./tree.ts";

export type _Result_Apply_ = _APPLIED_Result__Apply_ | _REFUSED_Result__Apply_;

interface __BASE_Result__Apply_<__ResultKind__ extends string> {
  kind: __ResultKind__;
}

export interface _APPLIED_Result__Apply_ extends __BASE_Result__Apply_<"applied"> {
  document: _Document_Doctor_;
}

export interface _REFUSED_Result__Apply_ extends __BASE_Result__Apply_<"refused"> {
  issue: string;
}

type _Step_Apply_<__Value__> = _DONE_Step__Apply_<__Value__> | _REFUSED_Result__Apply_;

interface _DONE_Step__Apply_<__Value__> extends __BASE_Result__Apply_<"done"> {
  value: __Value__;
}

// what operations work on: the body, and the notes, whose passages move with
// the text they're on
interface _State_Apply_ {
  body: _Body_Document_;
  notes: Array<_Note_Document_>;
}

const done = <__Value__>(value: __Value__): _Step_Apply_<__Value__> => ({ kind: "done", value });
const refuse = (issue: string): _REFUSED_Result__Apply_ => ({ kind: "refused", issue });
const absent = (node: _Id_Node_) => refuse(`there's no node ${node}`);

const kindNames: Record<_Node_Document_["kind"], string> = {
  section: "section",
  paragraph: "paragraph",
  list: "list",
  listItem: "list item",
  code: "code block",
  quote: "quote",
};

export function sameParent(first: _Parent_Position_, second: _Parent_Position_): boolean {
  if (first.kind === "body") return second.kind === "body";
  return second.kind === "node" && second.node === first.node;
}

const isBlock = (node: _Node_Document_): node is _Block_Document_ => node.kind !== "listItem";
const isItem = (node: _Node_Document_): node is _ListItem_Document_ => node.kind === "listItem";

function blocksOnly(nodes: Array<_Node_Document_>, holder: string): _Step_Apply_<Array<_Block_Document_>> {
  const blocks = nodes.filter(isBlock);
  return blocks.length === nodes.length ? done(blocks) : refuse(`only a list holds list items, not ${holder}`);
}

function withChildren(node: _Node_Document_, children: Array<_Node_Document_>): _Step_Apply_<_Node_Document_> {
  switch (node.kind) {
    case "section": {
      const blocks = blocksOnly(children, "a section");
      return blocks.kind === "done" ? done({ ...node, children: blocks.value }) : blocks;
    }
    case "listItem": {
      const blocks = blocksOnly(children, "a list item");
      return blocks.kind === "done" ? done({ ...node, children: blocks.value }) : blocks;
    }
    case "quote": {
      const blocks = blocksOnly(children, "a quote");
      if (blocks.kind !== "done") return blocks;
      const [first, ...rest] = blocks.value;
      return first === undefined
        ? refuse("a quote keeps at least one block")
        : done({ ...node, children: [first, ...rest] });
    }
    case "list": {
      const items = children.filter(isItem);
      if (items.length !== children.length) return refuse("a list holds only list items");
      const [first, ...rest] = items;
      return first === undefined
        ? refuse("a list keeps at least one item")
        : done({ ...node, children: [first, ...rest] });
    }
    case "paragraph":
    case "code":
      return children.length === 0 ? done(node) : refuse(`a ${kindNames[node.kind]} holds no other nodes`);
  }
}

function withText(node: _Node_Document_, text: _Text_Doctor_): _Step_Apply_<_Node_Document_> {
  switch (node.kind) {
    case "section":
      return done({ ...node, heading: text });
    case "paragraph":
      return done({ ...node, text: text.text, overlay: text.overlay });
    case "listItem":
      return done({ ...node, text: text.text, overlay: text.overlay });
    case "list":
    case "code":
    case "quote":
      return refuse(`a ${kindNames[node.kind]} holds no text`);
  }
}

function withContent(node: _Node_Document_, content: _EDITABLE_Content__Node_): _Step_Apply_<_Node_Document_> {
  const mismatch = refuse(`an edit can't turn a ${kindNames[node.kind]} into a ${kindNames[content.kind]}`);
  switch (content.kind) {
    case "list":
      return node.kind === "list" ? done({ ...node, order: content.order }) : mismatch;
    case "code":
      return node.kind === "code" ? done({ ...node, language: content.language, code: content.code }) : mismatch;
  }
}

const sameNodes = (first: ReadonlyArray<_Node_Document_>, second: ReadonlyArray<_Node_Document_>) =>
  first.length === second.length && first.every((node, index) => node === second[index]);

// change is applied to the node with the id, wherever it is; what's off its
// path stays the same object
function mapNode(
  node: _Node_Document_,
  id: _Id_Node_,
  change: (node: _Node_Document_) => _Step_Apply_<_Node_Document_>,
): _Step_Apply_<_Node_Document_> {
  if (node.id === id) return change(node);
  const children = childrenOf(node);
  const mapped = mapNodes(children, id, change);
  if (mapped.kind !== "done") return mapped;
  return sameNodes(children, mapped.value) ? done(node) : withChildren(node, mapped.value);
}

function mapNodes(
  nodes: Array<_Node_Document_>,
  id: _Id_Node_,
  change: (node: _Node_Document_) => _Step_Apply_<_Node_Document_>,
): _Step_Apply_<Array<_Node_Document_>> {
  const mapped: Array<_Node_Document_> = [];
  for (const node of nodes) {
    const step = mapNode(node, id, change);
    if (step.kind !== "done") return step;
    mapped.push(step.value);
  }
  return done(mapped);
}

function withBodyChildren(body: _Body_Document_, children: Array<_Node_Document_>): _Step_Apply_<_Body_Document_> {
  if (sameNodes(body.children, children)) return done(body);
  const blocks = blocksOnly(children, "the document's body");
  return blocks.kind === "done" ? done({ ...body, children: blocks.value }) : blocks;
}

function mapBody(
  body: _Body_Document_,
  id: _Id_Node_,
  change: (node: _Node_Document_) => _Step_Apply_<_Node_Document_>,
): _Step_Apply_<_Body_Document_> {
  const mapped = mapNodes(body.children, id, change);
  return mapped.kind === "done" ? withBodyChildren(body, mapped.value) : mapped;
}

function rewriteChildren(
  body: _Body_Document_,
  parent: _Parent_Position_,
  change: (children: Array<_Node_Document_>) => _Step_Apply_<Array<_Node_Document_>>,
): _Step_Apply_<_Body_Document_> {
  if (parent.kind === "body") {
    const children = change(body.children);
    return children.kind === "done" ? withBodyChildren(body, children.value) : children;
  }
  return mapBody(body, parent.node, (node) => {
    const children = change(childrenOf(node));
    return children.kind === "done" ? withChildren(node, children.value) : children;
  });
}

function placeAt(
  children: Array<_Node_Document_>,
  position: _Position_Operation_,
  node: _Node_Document_,
): _Step_Apply_<Array<_Node_Document_>> {
  if (position.kind === "first") return done([node, ...children]);
  const at = children.findIndex((child) => child.id === position.sibling);
  return at === -1
    ? refuse(`node ${position.sibling} isn't a child of that parent`)
    : done([...children.slice(0, at + 1), node, ...children.slice(at + 1)]);
}

export function textOfHolder(body: _Body_Document_, index: _Index_Document_, holder: _Holder_Text_): _Step_Apply_<_Text_Doctor_> {
  if (holder.kind === "title") return done(body.title);
  const entry = index.get(holder.node);
  if (entry === undefined) return absent(holder.node);
  const [text] = textOfNode(entry.node);
  return text === undefined ? refuse(`a ${kindNames[entry.node.kind]} holds no text`) : done(text);
}

function withHolderText(body: _Body_Document_, holder: _Holder_Text_, text: _Text_Doctor_): _Step_Apply_<_Body_Document_> {
  if (holder.kind === "title") return done({ ...body, title: text });
  return mapBody(body, holder.node, (node) => withText(node, text));
}

function carryNotes(notes: Array<_Note_Document_>, node: _Id_Node_, change: _Difference_Text_): Array<_Note_Document_> {
  return notes.map((note) =>
    note.kind === "passage" && note.node === node ? { ...note, range: carryRange(note.range, change) } : note,
  );
}

function applyOperation(state: _State_Apply_, operation: _Operation_Change_): _Step_Apply_<_State_Apply_> {
  const { body } = state;
  const index = indexNodes(body);
  const withBody = (step: _Step_Apply_<_Body_Document_>): _Step_Apply_<_State_Apply_> =>
    step.kind === "done" ? done({ ...state, body: step.value }) : step;
  switch (operation.kind) {
    case "write": {
      const current = textOfHolder(body, index, operation.holder);
      if (current.kind !== "done") return current;
      const written = rewrite(current.value, operation.text);
      const next = withHolderText(body, operation.holder, written.text);
      if (next.kind !== "done") return next;
      const notes =
        operation.holder.kind === "node" ? carryNotes(state.notes, operation.holder.node, written.change) : state.notes;
      return done({ body: next.value, notes });
    }
    case "style": {
      const current = textOfHolder(body, index, operation.holder);
      if (current.kind !== "done") return current;
      const next = { text: current.value.text, overlay: operation.overlay };
      const [issue] = overlayIssues(next);
      if (issue !== undefined) return refuse(issue);
      return withBody(withHolderText(body, operation.holder, next));
    }
    case "edit":
      if (!index.has(operation.node)) return absent(operation.node);
      return withBody(mapBody(body, operation.node, (node) => withContent(node, operation.content)));
    case "delete": {
      const entry = index.get(operation.node);
      if (entry === undefined) return absent(operation.node);
      return withBody(
        rewriteChildren(body, entry.parent, (children) => done(children.filter((child) => child.id !== operation.node))),
      );
    }
    case "insert": {
      const { at, subtree } = operation;
      if (at.parent.kind === "node" && !index.has(at.parent.node)) return absent(at.parent.node);
      const ids = idsWithin(subtree);
      if (new Set(ids).size !== ids.length) return refuse("an inserted subtree repeats an id");
      const taken = ids.find((id) => index.has(id));
      if (taken !== undefined) return refuse(`node ${taken} already exists`);
      const [issue] = nodesWithin(subtree).flatMap(textOfNode).flatMap(overlayIssues);
      if (issue !== undefined) return refuse(issue);
      return withBody(rewriteChildren(body, at.parent, (children) => placeAt(children, at, subtree)));
    }
    case "move": {
      const { node, to } = operation;
      const entry = index.get(node);
      if (entry === undefined) return absent(node);
      if (to.parent.kind === "node") {
        if (!index.has(to.parent.node)) return absent(to.parent.node);
        if (idsWithin(entry.node).includes(to.parent.node)) return refuse("a node can't move into itself");
      }
      if (to.kind === "after" && to.sibling === node) return refuse("a node can't move after itself");
      const without = (children: Array<_Node_Document_>) => children.filter((child) => child.id !== node);
      if (sameParent(entry.parent, to.parent)) {
        return withBody(rewriteChildren(body, to.parent, (children) => placeAt(without(children), to, entry.node)));
      }
      const removed = rewriteChildren(body, entry.parent, (children) => done(without(children)));
      if (removed.kind !== "done") return removed;
      return withBody(rewriteChildren(removed.value, to.parent, (children) => placeAt(children, to, entry.node)));
    }
  }
}

function detach(
  note: _NODE_Note__Document_ | _PASSAGE_Note__Document_,
  detachedBy: _Ref_Change_,
  former: _Former_Note_,
): _DETACHED_Note__Document_ {
  return { kind: "detached", id: note.id, body: note.body, written: note.written, detachedBy, former };
}

// A note detaches when its node is gone, or a passage note when its range is
// empty; it keeps what the node said before the change.
function settleNote(
  before: _Note_Document_,
  after: _Note_Document_,
  was: _Index_Document_,
  now: _Index_Document_,
  change: _Ref_Change_,
): _Note_Document_ {
  if (before.kind === "document" || before.kind === "detached") return after;
  const entry = was.get(before.node);
  const text = entry === undefined ? "" : nodeText(entry.node);
  const present = now.has(before.node);
  if (before.kind === "node") {
    return present ? after : detach(before, change, { kind: "node", node: before.node, text });
  }
  if (present && after.kind === "passage" && after.range.to > after.range.from) return after;
  const words = parseOwn(wordsSchema, sliceOf(text, before.range.from, before.range.to));
  return detach(before, change, { kind: "passage", node: before.node, text, words });
}

// the operations in order, as one change: all of them or none
export function applyOperations(
  document: _Document_Doctor_,
  operations: ReadonlyArray<_Operation_Change_>,
  change: _Ref_Change_,
): _Result_Apply_ {
  let state: _State_Apply_ = { body: document.content, notes: document.notes };
  for (const operation of operations) {
    const step = applyOperation(state, operation);
    if (step.kind !== "done") return step;
    state = step.value;
  }
  const was = indexNodes(document.content);
  const now = indexNodes(state.body);
  const notes = document.notes.map((note, index) => settleNote(note, state.notes[index] ?? note, was, now, change));
  return { kind: "applied", document: { ...document, content: state.body, notes } };
}

// the operations that take a text from current to next: the characters
// written, then the overlay styled if writing them doesn't already carry it
export function textOperations(
  holder: _Holder_Text_,
  current: _Text_Doctor_,
  next: _Text_Doctor_,
): Array<_Operation_Change_> {
  const operations: Array<_Operation_Change_> = [];
  if (current.text !== next.text) operations.push({ kind: "write", holder, text: next.text });
  if (!sameOverlay(rewrite(current, next.text).text.overlay, next.overlay)) {
    operations.push({ kind: "style", holder, overlay: next.overlay });
  }
  return operations;
}
