import type {
  _Block_Document_,
  _DRAFT_Id__Node_,
  _Text_Doctor_,
  _Id_Node_,
  _ListItem_Document_,
  _Node_Document_,
  _Operation_Change_,
  _Parent_Position_,
  _Position_Operation_,
} from "./domain.next.ts";
import { parse } from "./parse.ts";
import { draftIdSchema } from "./schema.ts";

const isDraft = (id: _Id_Node_ | _DRAFT_Id__Node_): id is _DRAFT_Id__Node_ => parse(draftIdSchema, id).kind === "parsed";

function renameItem<__From__, __To__>(
  item: _ListItem_Document_<__From__>,
  rename: (id: __From__) => __To__,
): _ListItem_Document_<__To__> {
  return { ...item, id: rename(item.id), children: item.children.map((child) => renameBlock(child, rename)) };
}

function renameBlock<__From__, __To__>(
  block: _Block_Document_<__From__>,
  rename: (id: __From__) => __To__,
): _Block_Document_<__To__> {
  switch (block.kind) {
    case "paragraph":
      return { ...block, id: rename(block.id) };
    case "code":
      return { ...block, id: rename(block.id) };
    case "section":
      return { ...block, id: rename(block.id), children: block.children.map((child) => renameBlock(child, rename)) };
    case "list": {
      const [first, ...rest] = block.children;
      return {
        ...block,
        id: rename(block.id),
        children: [renameItem(first, rename), ...rest.map((item) => renameItem(item, rename))],
      };
    }
    case "quote": {
      const [first, ...rest] = block.children;
      return {
        ...block,
        id: rename(block.id),
        children: [renameBlock(first, rename), ...rest.map((child) => renameBlock(child, rename))],
      };
    }
  }
}

function renameNode<__From__, __To__>(
  node: _Node_Document_<__From__>,
  rename: (id: __From__) => __To__,
): _Node_Document_<__To__> {
  return node.kind === "listItem" ? renameItem(node, rename) : renameBlock(node, rename);
}

// A proposal's operations as a document's: each new node's draft id becomes a
// freshly minted one, the same wherever it's referred to.
export function realize(
  operations: ReadonlyArray<_Operation_Change_<_DRAFT_Id__Node_>>,
  mint: () => _Id_Node_,
): Array<_Operation_Change_> {
  return realizeInto(operations, mint, new Map());
}

// realize, keeping in minted the id minted for each draft id
export function realizeInto(
  operations: ReadonlyArray<_Operation_Change_<_DRAFT_Id__Node_>>,
  mint: () => _Id_Node_,
  minted: Map<_DRAFT_Id__Node_, _Id_Node_>,
): Array<_Operation_Change_> {
  const real = (id: _DRAFT_Id__Node_): _Id_Node_ => {
    const known = minted.get(id) ?? mint();
    minted.set(id, known);
    return known;
  };
  const placed = (id: _Id_Node_ | _DRAFT_Id__Node_): _Id_Node_ => (isDraft(id) ? real(id) : id);
  const parent = (at: _Parent_Position_<_DRAFT_Id__Node_>): _Parent_Position_ =>
    at.kind === "body" ? at : { kind: "node", node: placed(at.node) };
  const position = (at: _Position_Operation_<_DRAFT_Id__Node_>): _Position_Operation_ =>
    at.kind === "first"
      ? { kind: "first", parent: parent(at.parent) }
      : { kind: "after", parent: parent(at.parent), sibling: placed(at.sibling) };
  return operations.map((operation): _Operation_Change_ => {
    switch (operation.kind) {
      case "insert":
        return { kind: "insert", at: position(operation.at), subtree: renameNode(operation.subtree, real) };
      case "move":
        return { kind: "move", node: operation.node, to: position(operation.to) };
      case "write":
      case "style":
      case "edit":
      case "delete":
        return operation;
    }
  });
}

// A subtree with the text of the node with the id given, anywhere in it, as
// it's given: a section's heading, a quote's reference, a paragraph's or a
// list item's words; the rest as it was.
export function withNodeText<__Id__>(node: _Node_Document_<__Id__>, id: __Id__, text: _Text_Doctor_): _Node_Document_<__Id__> {
  return node.kind === "listItem" ? itemWithText(node, id, text) : blockWithText(node, id, text);
}

function itemWithText<__Id__>(item: _ListItem_Document_<__Id__>, id: __Id__, text: _Text_Doctor_): _ListItem_Document_<__Id__> {
  const words = item.id === id ? { text: text.text, overlay: text.overlay } : {};
  return { ...item, ...words, children: item.children.map((child) => blockWithText(child, id, text)) };
}

function blockWithText<__Id__>(block: _Block_Document_<__Id__>, id: __Id__, text: _Text_Doctor_): _Block_Document_<__Id__> {
  switch (block.kind) {
    case "paragraph":
      return block.id === id ? { ...block, text: text.text, overlay: text.overlay } : block;
    case "code":
      return block;
    case "section":
      return { ...block, heading: block.id === id ? text : block.heading, children: block.children.map((child) => blockWithText(child, id, text)) };
    case "list": {
      const [first, ...rest] = block.children;
      return { ...block, children: [itemWithText(first, id, text), ...rest.map((item) => itemWithText(item, id, text))] };
    }
    case "quote": {
      const [first, ...rest] = block.children;
      return {
        ...block,
        reference: block.id === id ? text : block.reference,
        children: [blockWithText(first, id, text), ...rest.map((child) => blockWithText(child, id, text))],
      };
    }
  }
}
