import type {
  _Block_Document_,
  _DRAFT_Id__Node_,
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
  const minted = new Map<string, _Id_Node_>();
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
