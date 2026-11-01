import { textOperations } from "../shared/apply.ts";
import type {
  _AFTER_Position__Operation_,
  _Document_Doctor_,
  _Holder_Text_,
  _Id_Node_,
  _ListItem_Document_,
  _Node_Document_,
  _Operation_Change_,
  _PARAGRAPH_Block__Document_,
  _Parent_Position_,
  _Text_Doctor_,
} from "../shared/domain.next.ts";
import { concatText, lengthOf, splitText } from "../shared/text.ts";
import { childrenOf, indexNodes, nodeText, textOfNode, type _Index_Document_ } from "../shared/tree.ts";

// a place the caret can be: the title, or a node's own text or code
export type _Spot_Editor_ = _TITLE_Spot__Editor_ | _NODE_Spot__Editor_;

interface __BASE_Spot__Editor_<__SpotKind__ extends string> {
  kind: __SpotKind__;
}

export interface _TITLE_Spot__Editor_ extends __BASE_Spot__Editor_<"title"> {}

export interface _NODE_Spot__Editor_ extends __BASE_Spot__Editor_<"node"> {
  node: _Id_Node_;
}

export function sameSpot(first: _Spot_Editor_, second: _Spot_Editor_): boolean {
  if (first.kind === "title") return second.kind === "title";
  return second.kind === "node" && second.node === first.node;
}

// where the caret goes once an action is applied; each request is its own
// object, so asking for the same place twice still moves it
export type _Focus_Editor_ = _KEEP_Focus__Editor_ | _AT_Focus__Editor_;

interface __BASE_Focus__Editor_<__FocusKind__ extends string> {
  kind: __FocusKind__;
}

export interface _KEEP_Focus__Editor_ extends __BASE_Focus__Editor_<"keep"> {}

export interface _AT_Focus__Editor_ extends __BASE_Focus__Editor_<"at"> {
  spot: _Spot_Editor_;
  offset: number;
}

export interface _Action_Editor_ {
  operations: Array<_Operation_Change_>;
  focus: _Focus_Editor_;
}

const keep: _KEEP_Focus__Editor_ = { kind: "keep" };
const nothing: _Action_Editor_ = { operations: [], focus: keep };
const at = (spot: _Spot_Editor_, offset: number): _AT_Focus__Editor_ => ({ kind: "at", spot, offset });
const atNode = (node: _Id_Node_, offset: number) => at({ kind: "node", node }, offset);
const nodeHolder = (node: _Id_Node_): _Holder_Text_ => ({ kind: "node", node });

function siblingsOf(document: _Document_Doctor_, index: _Index_Document_, parent: _Parent_Position_) {
  if (parent.kind === "body") return document.content.children;
  const entry = index.get(parent.node);
  return entry === undefined ? [] : childrenOf(entry.node);
}

function previousSibling(document: _Document_Doctor_, index: _Index_Document_, node: _Id_Node_) {
  const entry = index.get(node);
  if (entry === undefined) return [];
  const siblings = siblingsOf(document, index, entry.parent);
  const position = siblings.findIndex((sibling) => sibling.id === node);
  return position > 0 ? siblings.slice(position - 1, position) : [];
}

// every spot in reading order
function spots(document: _Document_Doctor_): Array<_Spot_Editor_> {
  const within = (node: _Node_Document_): Array<_Spot_Editor_> => {
    const own: Array<_Spot_Editor_> = node.kind === "list" || node.kind === "quote" ? [] : [{ kind: "node", node: node.id }];
    return [...own, ...childrenOf(node).flatMap(within)];
  };
  return [{ kind: "title" }, ...document.content.children.flatMap(within)];
}

function endOf(document: _Document_Doctor_, index: _Index_Document_, spot: _Spot_Editor_) {
  if (spot.kind === "title") return at(spot, lengthOf(document.content.title.text));
  const entry = index.get(spot.node);
  return at(spot, entry === undefined ? 0 : lengthOf(nodeText(entry.node)));
}

// Deletes the node, or the list or quote it would leave empty, and puts the
// caret at the end of whatever came before it.
function removal(document: _Document_Doctor_, index: _Index_Document_, node: _Id_Node_): _Action_Editor_ {
  let target = node;
  for (let entry = index.get(target); entry?.parent.kind === "node"; entry = index.get(target)) {
    const parent = index.get(entry.parent.node)?.node;
    if (parent === undefined || (parent.kind !== "list" && parent.kind !== "quote")) break;
    if (parent.children.length > 1) break;
    target = parent.id;
  }
  const order = spots(document);
  const position = order.findIndex((spot) => spot.kind === "node" && spot.node === node);
  const before = order[position - 1] ?? { kind: "title" };
  return { operations: [{ kind: "delete", node: target }], focus: endOf(document, index, before) };
}

export function retext(document: _Document_Doctor_, spot: _Spot_Editor_, text: _Text_Doctor_): _Action_Editor_ {
  if (spot.kind === "title") {
    return { operations: textOperations({ kind: "title" }, document.content.title, text), focus: keep };
  }
  const node = indexNodes(document.content).get(spot.node)?.node;
  const [current] = node === undefined ? [] : textOfNode(node);
  if (current === undefined) return nothing;
  return { operations: textOperations(nodeHolder(spot.node), current, text), focus: keep };
}

export function recode(document: _Document_Doctor_, node: _Id_Node_, code: string): _Action_Editor_ {
  const block = indexNodes(document.content).get(node)?.node;
  if (block?.kind !== "code") return nothing;
  return { operations: [{ kind: "edit", node, content: { kind: "code", language: block.language, code } }], focus: keep };
}

// Enter: the text before the caret stays, and the text after it starts the
// next paragraph or item; a heading's starts the section's first paragraph.
export function split(
  document: _Document_Doctor_,
  spot: _Spot_Editor_,
  text: _Text_Doctor_,
  offset: number,
  mint: () => _Id_Node_,
): _Action_Editor_ {
  const [before, after] = splitText(text, offset);
  const id = mint();
  const paragraph: _PARAGRAPH_Block__Document_ = { kind: "paragraph", id, text: after.text, overlay: after.overlay };
  if (spot.kind === "title") {
    return {
      operations: [
        ...textOperations({ kind: "title" }, document.content.title, before),
        { kind: "insert", at: { kind: "first", parent: { kind: "body" } }, subtree: paragraph },
      ],
      focus: atNode(id, 0),
    };
  }
  const entry = indexNodes(document.content).get(spot.node);
  const [current] = entry === undefined ? [] : textOfNode(entry.node);
  if (entry === undefined || current === undefined) return nothing;
  const { node, parent } = entry;
  const stays = textOperations(nodeHolder(node.id), current, before);
  const next: _AFTER_Position__Operation_ = { kind: "after", parent, sibling: node.id };
  switch (node.kind) {
    case "paragraph":
      return { operations: [...stays, { kind: "insert", at: next, subtree: paragraph }], focus: atNode(id, 0) };
    case "listItem": {
      const item: _ListItem_Document_ = { kind: "listItem", id, text: after.text, overlay: after.overlay, children: [] };
      return { operations: [...stays, { kind: "insert", at: next, subtree: item }], focus: atNode(id, 0) };
    }
    case "section":
      return {
        operations: [
          ...stays,
          { kind: "insert", at: { kind: "first", parent: { kind: "node", node: node.id } }, subtree: paragraph },
        ],
        focus: atNode(id, 0),
      };
    default:
      return nothing;
  }
}

function join(previous: { id: _Id_Node_ } & _Text_Doctor_, node: { id: _Id_Node_ } & _Text_Doctor_): _Action_Editor_ {
  return {
    operations: [
      ...textOperations(nodeHolder(previous.id), previous, concatText(previous, node)),
      { kind: "delete", node: node.id },
    ],
    focus: atNode(previous.id, lengthOf(previous.text)),
  };
}

// Backspace at the very start of a spot: an empty one is deleted, and a
// paragraph or childless item joins the one before it.
export function backspace(document: _Document_Doctor_, spot: _Spot_Editor_): _Action_Editor_ {
  if (spot.kind === "title") return nothing;
  const index = indexNodes(document.content);
  const node = index.get(spot.node)?.node;
  if (node === undefined) return nothing;
  const [previous] = previousSibling(document, index, node.id);
  switch (node.kind) {
    case "paragraph":
      if (node.text === "") return removal(document, index, node.id);
      return previous?.kind === "paragraph" ? join(previous, node) : nothing;
    case "listItem":
      if (node.children.length > 0) return nothing;
      if (node.text === "") return removal(document, index, node.id);
      return previous?.kind === "listItem" ? join(previous, node) : nothing;
    case "section":
      return node.heading.text === "" && node.children.length === 0 ? removal(document, index, node.id) : nothing;
    case "code":
      return node.code === "" ? removal(document, index, node.id) : nothing;
    case "list":
    case "quote":
      return nothing;
  }
}
