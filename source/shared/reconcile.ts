import { textOperations } from "./apply.ts";
import type {
  _Block_Document_,
  _Body_Document_,
  _Document_Doctor_,
  _Id_Node_,
  _ListItem_Document_,
  _Node_Document_,
  _Operation_Change_,
  _Parent_Position_,
  _Position_Operation_,
} from "./domain.next.ts";
import { childrenOf, idsWithin, indexNodes, nodesWithin, textOfNode } from "./tree.ts";

const sameShapes = (first: Array<_Node_Document_>, second: Array<_Node_Document_>): boolean =>
  first.length === second.length &&
  first.every((node, index) => {
    const other = second[index];
    return other !== undefined && sameShape(node, other);
  });

// the same node, holding the same nodes, whatever their text
function sameShape(first: _Node_Document_, second: _Node_Document_): boolean {
  return first.id === second.id && first.kind === second.kind && sameShapes(childrenOf(first), childrenOf(second));
}

function contentOperations(was: _Node_Document_, now: _Node_Document_): Array<_Operation_Change_> {
  if (was.kind === "code" && now.kind === "code") {
    const same =
      was.code === now.code &&
      was.language.kind === now.language.kind &&
      (was.language.kind === "unstated" || (now.language.kind === "stated" && was.language.name === now.language.name));
    return same ? [] : [{ kind: "edit", node: now.id, content: { kind: "code", language: now.language, code: now.code } }];
  }
  if (was.kind === "list" && now.kind === "list") {
    return was.order === now.order ? [] : [{ kind: "edit", node: now.id, content: { kind: "list", order: now.order } }];
  }
  const [before] = textOfNode(was);
  const [after] = textOfNode(now);
  if (before === undefined || after === undefined || was.kind !== now.kind) return [];
  return textOperations({ kind: "node", node: now.id }, before, after);
}

function renewItem(item: _ListItem_Document_, taken: Set<string>, mint: () => _Id_Node_): _ListItem_Document_ {
  return {
    ...item,
    id: taken.has(item.id) ? mint() : item.id,
    children: item.children.map((child) => renewBlock(child, taken, mint)),
  };
}

// the same block, with any id in taken swapped for a fresh one
function renewBlock(block: _Block_Document_, taken: Set<string>, mint: () => _Id_Node_): _Block_Document_ {
  const id = taken.has(block.id) ? mint() : block.id;
  switch (block.kind) {
    case "paragraph":
    case "code":
      return { ...block, id };
    case "section":
      return { ...block, id, children: block.children.map((child) => renewBlock(child, taken, mint)) };
    case "list": {
      const [first, ...rest] = block.children;
      return { ...block, id, children: [renewItem(first, taken, mint), ...rest.map((item) => renewItem(item, taken, mint))] };
    }
    case "quote": {
      const [first, ...rest] = block.children;
      return { ...block, id, children: [renewBlock(first, taken, mint), ...rest.map((child) => renewBlock(child, taken, mint))] };
    }
  }
}

const renew = (node: _Node_Document_, taken: Set<string>, mint: () => _Id_Node_): _Node_Document_ =>
  node.kind === "listItem" ? renewItem(node, taken, mint) : renewBlock(node, taken, mint);

const keepsOne = (node: _Node_Document_) => node.kind === "list" || node.kind === "quote";

// What changed between two lists of children: the same nodes at either end
// stay; a single node that changed inside is gone into; the rest between is
// replaced. A list or quote can't be left empty, so there what comes goes in
// before what goes comes out, and ids still in use are renewed.
function structure(
  parent: _Parent_Position_,
  nonEmpty: boolean,
  was: Array<_Node_Document_>,
  now: Array<_Node_Document_>,
  mint: () => _Id_Node_,
): Array<_Operation_Change_> {
  const shorter = Math.min(was.length, now.length);
  let prefix = 0;
  while (prefix < shorter && sameShapes(was.slice(prefix, prefix + 1), now.slice(prefix, prefix + 1))) prefix += 1;
  let suffix = 0;
  const end = (list: Array<_Node_Document_>) => list.slice(list.length - 1 - suffix, list.length - suffix);
  while (suffix < shorter - prefix && sameShapes(end(was), end(now))) suffix += 1;
  const gone = was.slice(prefix, was.length - suffix);
  const come = now.slice(prefix, now.length - suffix);
  if (gone.length === 0 && come.length === 0) return [];
  const [onlyGone] = gone;
  const [onlyCome] = come;
  if (
    gone.length === 1 &&
    come.length === 1 &&
    onlyGone !== undefined &&
    onlyCome !== undefined &&
    onlyGone.id === onlyCome.id &&
    onlyGone.kind === onlyCome.kind
  ) {
    return structure({ kind: "node", node: onlyGone.id }, keepsOne(onlyGone), childrenOf(onlyGone), childrenOf(onlyCome), mint);
  }
  const taken = new Set<string>(nonEmpty ? gone.flatMap(idsWithin) : []);
  const inserts: Array<_Operation_Change_> = [];
  let previous = now[prefix - 1];
  for (const node of come.map((each) => renew(each, taken, mint))) {
    const at: _Position_Operation_ =
      previous === undefined ? { kind: "first", parent } : { kind: "after", parent, sibling: previous.id };
    inserts.push({ kind: "insert", at, subtree: node });
    previous = node;
  }
  const deletes: Array<_Operation_Change_> = gone.map((node) => ({ kind: "delete", node: node.id }));
  return nonEmpty ? [...inserts, ...deletes] : [...deletes, ...inserts];
}

// the operations that take the document's body to body, keeping every id
// the two share
export function reconcile(
  document: _Document_Doctor_,
  body: _Body_Document_,
  mint: () => _Id_Node_,
): Array<_Operation_Change_> {
  const index = indexNodes(document.content);
  const content = body.children.flatMap(nodesWithin).flatMap((node) => {
    const was = index.get(node.id)?.node;
    return was === undefined ? [] : contentOperations(was, node);
  });
  return [
    ...textOperations({ kind: "title" }, document.content.title, body.title),
    ...content,
    ...structure({ kind: "body" }, false, document.content.children, body.children, mint),
  ];
}
