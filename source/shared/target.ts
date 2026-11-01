import type { _Target_Link_ } from "./domain.next.ts";
import { parse } from "./parse.ts";
import { documentIdSchema, nodeIdSchema, urlSchema } from "./schema.ts";

// a link's target as it's typed: a web address, doc:<document>, or
// doc:<document>#<node>
export function writeTarget(target: _Target_Link_): string {
  switch (target.kind) {
    case "external":
      return target.url;
    case "document":
      return `doc:${target.document}`;
    case "node":
      return `doc:${target.document}#${target.node}`;
  }
}

export function readTarget(written: string): Array<_Target_Link_> {
  const url = parse(urlSchema, written);
  if (url.kind === "parsed") return [{ kind: "external", url: url.value }];
  const match = /^doc:([^#]+)(?:#(.+))?$/.exec(written);
  if (match === null) return [];
  const document = parse(documentIdSchema, match[1]);
  if (document.kind === "rejected") return [];
  if (match[2] === undefined) return [{ kind: "document", document: document.value }];
  const node = parse(nodeIdSchema, match[2]);
  return node.kind === "parsed" ? [{ kind: "node", document: document.value, node: node.value }] : [];
}
