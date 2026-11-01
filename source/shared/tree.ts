import type {
  _Body_Document_,
  _Id_Node_,
  _Node_Document_,
  _Parent_Position_,
  _Text_Doctor_,
} from "./domain.next.ts";

export interface _Entry_Index_ {
  node: _Node_Document_;
  parent: _Parent_Position_;
}

export type _Index_Document_ = Map<_Id_Node_, _Entry_Index_>;

export function childrenOf(node: _Node_Document_): Array<_Node_Document_> {
  switch (node.kind) {
    case "section":
    case "listItem":
    case "quote":
    case "list":
      return node.children;
    case "paragraph":
    case "code":
      return [];
  }
}

export function indexNodes(body: _Body_Document_): _Index_Document_ {
  const index: _Index_Document_ = new Map();
  const visit = (nodes: Array<_Node_Document_>, parent: _Parent_Position_) => {
    for (const node of nodes) {
      index.set(node.id, { node, parent });
      visit(childrenOf(node), { kind: "node", node: node.id });
    }
  };
  visit(body.children, { kind: "body" });
  return index;
}

export function nodesWithin(node: _Node_Document_): Array<_Node_Document_> {
  return [node, ...childrenOf(node).flatMap(nodesWithin)];
}

export function idsWithin(node: _Node_Document_): Array<_Id_Node_> {
  return nodesWithin(node).map((each) => each.id);
}

// the text a node holds: a paragraph's or an item's own, a section's heading
export function textOfNode(node: _Node_Document_): Array<_Text_Doctor_> {
  switch (node.kind) {
    case "section":
      return [node.heading];
    case "paragraph":
    case "listItem":
      return [node];
    case "list":
    case "code":
    case "quote":
      return [];
  }
}

export function nodeText(node: _Node_Document_): string {
  return node.kind === "code" ? node.code : textOfNode(node).map((text) => text.text).join("");
}
