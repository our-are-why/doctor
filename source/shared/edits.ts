import { applyOperations, textOperations } from "./apply.ts";
import type {
  _Document_Doctor_,
  _DRAFT_Id__Node_,
  _Holder_Text_,
  _Id_Node_,
  _Node_Document_,
  _Operation_Change_,
  _Parent_Position_,
  _Text_Doctor_,
} from "./domain.next.ts";
import { mintId } from "./id.ts";
import type { _NonEmpty_ } from "./list.ts";
import { parseOwn } from "./parse.ts";
import { realize, renameNode } from "./proposals.ts";
import { changeIdSchema, draftIdSchema, nodeIdSchema } from "./schema.ts";
import { childrenOf, idsWithin, indexNodes, textOfNode } from "./tree.ts";

// a proposal's operations, its new blocks named by draft ids
export type _Operations_Proposal_ = _NonEmpty_<_Operation_Change_<_DRAFT_Id__Node_>>;

export type _Divided_Edits_ = _DIVIDED_Divided__Edits_ | _REFUSED_Divided__Edits_;

interface __BASE_Divided__Edits_<__DividedKind__ extends string> {
  kind: __DividedKind__;
}

export interface _DIVIDED_Divided__Edits_ extends __BASE_Divided__Edits_<"divided"> {
  proposals: Array<_Operations_Proposal_>;
}

export interface _REFUSED_Divided__Edits_ extends __BASE_Divided__Edits_<"refused"> {
  issue: string;
}

const sameText = (first: _Text_Doctor_, second: _Text_Doctor_) =>
  first.text === second.text && JSON.stringify(first.overlay) === JSON.stringify(second.overlay);

// Edits to a document, made while a task is active, as the proposals they
// are, divided as an agent's are, by what they come to, not by how they
// were typed: the title, or a block already there, changed in place, each
// its own; each run of new blocks side by side, one, however many it spans;
// and each block taken out, moved, or with its code or list order changed,
// its own. New blocks are named by draft ids, as an agent names them, so
// applying one mints its own, and each proposal applies to the document as
// it is on its own. Random bytes, for the ids it mints to try them with,
// come from the caller.
export function proposalsOfEdits(
  trunk: _Document_Doctor_,
  operations: Array<_Operation_Change_>,
  random: () => Uint8Array,
): _Divided_Edits_ {
  const applied = applyOperations(trunk, operations, { document: trunk.id, id: mintId(changeIdSchema, random()) });
  if (applied.kind === "refused") return { kind: "refused", issue: applied.issue };
  const after = applied.document;
  const before = indexNodes(trunk.content);
  const now = indexNodes(after.content);
  const proposals: Array<_Operations_Proposal_> = [];
  const issues: Array<string> = [];
  const add = (made: Array<_Operation_Change_<_DRAFT_Id__Node_>>) => {
    const [first, ...rest] = made;
    if (first !== undefined) proposals.push([first, ...rest]);
  };
  const changed = (holder: _Holder_Text_, was: _Text_Doctor_, is: _Text_Doctor_) =>
    textOperations(holder, was, is).flatMap((operation) => (operation.kind === "write" || operation.kind === "style" ? [operation] : []));

  // changed in place: the title, and each block still there whose words or
  // marks, code, or list order aren't as they were
  if (!sameText(trunk.content.title, after.content.title)) add(changed({ kind: "title" }, trunk.content.title, after.content.title));
  for (const [id, entry] of before) {
    const kept = now.get(id)?.node;
    if (kept === undefined) continue;
    const [was] = textOfNode(entry.node);
    const [is] = textOfNode(kept);
    if (was !== undefined && is !== undefined && !sameText(was, is)) add(changed({ kind: "node", node: id }, was, is));
    if (entry.node.kind === "code" && kept.kind === "code" && (entry.node.code !== kept.code || JSON.stringify(entry.node.language) !== JSON.stringify(kept.language))) {
      add([{ kind: "edit", node: id, content: { kind: "code", language: kept.language, code: kept.code } }]);
    }
    if (entry.node.kind === "list" && kept.kind === "list" && entry.node.order !== kept.order) {
      add([{ kind: "edit", node: id, content: { kind: "list", order: kept.order } }]);
    }
  }

  // taken out: each block gone whose parent isn't gone with it
  for (const [id, entry] of before) {
    if (now.has(id)) continue;
    if (entry.parent.kind === "node" && !now.has(entry.parent.node)) continue;
    add([{ kind: "delete", node: id }]);
  }

  // where a block already there is now, after the nearest block before it
  // that was there too, or first in its parent
  const siblingsIn = (parent: _Parent_Position_): Array<_Node_Document_> => {
    if (parent.kind === "body") return after.content.children;
    const node = now.get(parent.node)?.node;
    return node === undefined ? [] : childrenOf(node);
  };
  // moved: each block an edit moved, to where it is now among those there
  // before; into a new block, it'd be part of that block, which isn't asked
  for (const operation of operations) {
    if (operation.kind !== "move" || !before.has(operation.node)) continue;
    const entry = now.get(operation.node);
    if (entry === undefined) continue;
    if (entry.parent.kind === "node" && !before.has(entry.parent.node)) {
      issues.push("a block moved into a new one isn't something a proposal says yet");
      continue;
    }
    const siblings = siblingsIn(entry.parent);
    const at = siblings.findIndex((sibling) => sibling.id === operation.node);
    const [sibling] = siblings
      .slice(0, at)
      .filter((each) => before.has(each.id))
      .slice(-1);
    add([{ kind: "move", node: operation.node, to: sibling === undefined ? { kind: "first", parent: entry.parent } : { kind: "after", parent: entry.parent, sibling: sibling.id } }]);
  }

  // added: each run of new blocks side by side under a parent that was
  // there, as they are now, with what's in them
  const draft = (id: _Id_Node_): _DRAFT_Id__Node_ => parseOwn(draftIdSchema, `new-${id}`);
  const parents: Array<_Parent_Position_> = [
    { kind: "body" },
    ...[...now.keys()].filter((id) => before.has(id)).map((id): _Parent_Position_ => ({ kind: "node", node: id })),
  ];
  for (const parent of parents) {
    let run: Array<_Operation_Change_<_DRAFT_Id__Node_>> = [];
    let previous: Array<_Id_Node_ | _DRAFT_Id__Node_> = [];
    for (const child of siblingsIn(parent)) {
      if (before.has(child.id)) {
        add(run);
        run = [];
        previous = [child.id];
        continue;
      }
      if (idsWithin(child).some((id) => before.has(id))) {
        issues.push("a new block holding one that was already there isn't something a proposal says yet");
        continue;
      }
      const [sibling] = previous;
      run.push({ kind: "insert", at: sibling === undefined ? { kind: "first", parent } : { kind: "after", parent, sibling }, subtree: renameNode(child, draft) });
      previous = [draft(child.id)];
    }
    add(run);
  }

  const [issue] = issues;
  if (issue !== undefined) return { kind: "refused", issue };
  // each on its own, as it'll be reviewed and applied
  for (const proposal of proposals) {
    const tried = applyOperations(
      trunk,
      realize(proposal, () => mintId(nodeIdSchema, random())),
      { document: trunk.id, id: mintId(changeIdSchema, random()) },
    );
    if (tried.kind === "refused") return { kind: "refused", issue: tried.issue };
  }
  return { kind: "divided", proposals };
}
