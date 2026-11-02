import type {
  _Block_Document_,
  _Body_Document_,
  _CODE_Block__Document_,
  _Document_Doctor_,
  _Holder_Text_,
  _Id_Node_,
  _LIST_Block__Document_,
  _ListItem_Document_,
  _Node_Document_,
  _Text_Doctor_,
} from "./domain.next.ts";
import type { _NonEmpty_ } from "./list.ts";
import type { _Result_Parse_ } from "./parse.ts";
import { rewrite } from "./text.ts";
import { childrenOf, indexNodes, textOfNode } from "./tree.ts";

// The document as lines of text: the title first, as #0, then a line per
// block. Sections are headings numbered by depth, #1, #2 and so on; items
// are - or a number, indented two spaces per level; code sits between ```
// fences, its language on the opening one; and a quote between fences of
// quote marks, its reference on the opening one, three of them, or more
// around a quote with quotes in it, so each fence closes the quote it opened.
// Blank lines only separate.

// where a text's content begins on its line, in UTF-16 units
export interface _Place_Projection_ {
  holder: _Holder_Text_;
  line: number;
  start: number;
}

// the body the lines describe, and the node each line now holds
export interface _Read_Projection_ {
  body: _Body_Document_;
  owners: Array<Array<_Id_Node_>>;
}

export interface _Projection_ {
  lines: Array<string>;
  places: Array<_Place_Projection_>;
  owners: Array<Array<_Id_Node_>>;
}

// how a line's content becomes a text, and where new nodes' ids come from
export interface _Reader_Projection_ {
  text: (holder: _Holder_Text_, content: string) => _Result_Parse_<_Text_Doctor_>;
  fresh: () => _Id_Node_;
  container: (kind: "list" | "quote", children: Array<_Id_Node_>) => _Id_Node_;
}

// a paragraph whose words would read as a mark starts with a backslash
export const startsBlock = (content: string) => /^(?:[#`\\]|"{3}| *(?:-|\d+\.) )/.test(content);

// a quote's fence: its quote marks, and on an opening one, what follows them,
// its reference; a closing one is bare, as long as the one it closes
export const fencePattern = /^("{3,})\s*(.*)$/;

// how deep quotes go inside a node, for a quote's fences to be longer than
// those of any quote in it
const quotesIn = (node: _Node_Document_): number =>
  Math.max(0, ...childrenOf(node).map((child) => (child.kind === "quote" ? 1 : 0) + quotesIn(child)));

export function project(document: _Document_Doctor_): _Projection_ {
  const lines: Array<string> = [];
  const places: Array<_Place_Projection_> = [];
  const owners: Array<Array<_Id_Node_>> = [];
  const content = (text: _Text_Doctor_) => text.text;
  const push = (line: string, owner: Array<_Id_Node_>) => {
    lines.push(line);
    owners.push(owner);
  };
  const holding = (node: _Id_Node_, prefix: string, text: string) => {
    places.push({ holder: { kind: "node", node }, line: lines.length, start: prefix.length });
    push(`${prefix}${text}`, [node]);
  };

  places.push({ holder: { kind: "title" }, line: 0, start: 3 });
  push(`#0 ${content(document.content.title)}`, []);

  // a quote's first block comes straight after its opening fence; any other
  // block has a blank line before it
  const items = (list: _LIST_Block__Document_, depth: number, within: "top" | "quote") => {
    list.children.forEach((item: _ListItem_Document_, index) => {
      const written = content(item);
      const mark = `${"  ".repeat(depth - 1)}${list.order === "ordered" ? `${index + 1}.` : "-"} `;
      holding(item.id, `${mark}${written.startsWith("\\") ? "\\" : ""}`, written);
      for (const child of item.children) {
        if (child.kind === "list") items(child, depth + 1, within);
        else blocks([child], 1, within);
      }
    });
  };

  const code = (block: _CODE_Block__Document_) => {
    push(`\`\`\`${block.language.kind === "stated" ? block.language.name : ""}`, [block.id]);
    for (const line of block.code.split("\n")) push(line, []);
    push("```", []);
  };

  const blocks = (children: Array<_Block_Document_>, depth: number, within: "top" | "quote") => {
    children.forEach((block, index) => {
      if (index > 0 || within === "top") push("", []);
      switch (block.kind) {
        case "paragraph": {
          const written = content(block);
          holding(block.id, startsBlock(written) ? "\\" : "", written);
          break;
        }
        case "section": {
          const written = content(block.heading);
          holding(block.id, `#${depth} ${written.startsWith("\\") ? "\\" : ""}`, written);
          blocks(block.children, depth + 1, within);
          break;
        }
        case "list":
          items(block, 1, within);
          break;
        case "code":
          code(block);
          break;
        case "quote": {
          // both its fences are the quote's, so what's in it ends at its close
          const fence = '"'.repeat(3 + quotesIn(block));
          const written = content(block.reference);
          places.push({ holder: { kind: "node", node: block.id }, line: lines.length, start: fence.length + (written === "" ? 0 : 1) });
          push(written === "" ? fence : `${fence} ${written}`, [block.id]);
          blocks(block.children, 1, "quote");
          push(fence, [block.id]);
          break;
        }
      }
    });
  };

  blocks(document.content.children, 1, "top");
  return { lines, places, owners };
}

interface _Row_Projection_ {
  text: string;
  number: number;
  owner: Array<_Id_Node_>;
}

interface _Item_Projection_ {
  row: _Row_Projection_;
  depth: number;
  ordered: boolean;
  content: string;
}

const itemPattern = /^( *)(?:-|(\d+)\.) (.*)$/;

const unescape = (content: string) => (content.startsWith("\\") ? content.slice(1) : content);

export function parseProjection(
  lines: Array<string>,
  owners: Array<Array<_Id_Node_>>,
  reader: _Reader_Projection_,
): _Result_Parse_<_Read_Projection_> {
  const problems: Array<string> = [];
  const assigned: Array<Array<_Id_Node_>> = lines.map(() => []);
  const read = (holder: _Holder_Text_, content: string, number: number): _Text_Doctor_ => {
    const result = reader.text(holder, content);
    if (result.kind === "parsed") return result.value;
    problems.push(`line ${number}: ${result.issues[0]}`);
    return { text: "", overlay: [] };
  };
  const idOf = (row: _Row_Projection_) => {
    const id = row.owner[0] ?? reader.fresh();
    assigned[row.number - 1] = [id];
    return id;
  };

  const listOf = (entries: Array<_Item_Projection_>): _LIST_Block__Document_ | undefined => {
    const at = (start: number, depth: number): { items: Array<_ListItem_Document_>; next: number } => {
      const found: Array<_ListItem_Document_> = [];
      let index = start;
      while (index < entries.length && (entries[index]?.depth ?? 0) >= depth) {
        const entry = entries[index];
        if (entry === undefined) break;
        index += 1;
        const id = idOf(entry.row);
        const text = read({ kind: "node", node: id }, unescape(entry.content), entry.row.number);
        const children: Array<_Block_Document_> = [];
        if ((entries[index]?.depth ?? 0) > depth) {
          const nested = at(index, depth + 1);
          const list = make(nested.items, entries[index]?.ordered ?? false);
          if (list !== undefined) children.push(list);
          index = nested.next;
        }
        found.push({ kind: "listItem", id, text: text.text, overlay: text.overlay, children });
      }
      return { items: found, next: index };
    };
    const make = (found: Array<_ListItem_Document_>, ordered: boolean): _LIST_Block__Document_ | undefined => {
      const [first, ...rest] = found;
      if (first === undefined) return undefined;
      const children: _NonEmpty_<_ListItem_Document_> = [first, ...rest];
      const id = reader.container("list", found.map((item) => item.id));
      return { kind: "list", id, order: ordered ? "ordered" : "unordered", children };
    };
    return make(at(0, 1).items, entries[0]?.ordered ?? false);
  };

  const parseBlocks = (rows: Array<_Row_Projection_>): Array<_Block_Document_> => {
    const top: Array<_Block_Document_> = [];
    const sections: Array<{ level: number; children: Array<_Block_Document_> }> = [];
    const attach = (block: _Block_Document_) => (sections.at(-1)?.children ?? top).push(block);
    let index = 0;
    while (index < rows.length) {
      const row = rows[index];
      if (row === undefined) break;
      if (row.text.trim() === "") {
        index += 1;
        continue;
      }
      // A quote, between its opening fence, its reference after it, and the
      // bare one as long that closes it: past any code in it, and any quote
      // nested in it, a fence that's bare and as long as the innermost open
      // one closing that, and any other opening another. Both fences are the
      // quote's.
      const opened = fencePattern.exec(row.text);
      if (opened !== null) {
        const length = opened[1]?.length ?? 3;
        const nested: Array<number> = [];
        let fenced: "outside" | "inside" = "outside";
        let close = -1;
        for (let at = index + 1; at < rows.length && close === -1; at += 1) {
          const text = rows[at]?.text ?? "";
          if (fenced === "inside") {
            if (text === "```") fenced = "outside";
            continue;
          }
          if (text.startsWith("```")) {
            fenced = "inside";
            continue;
          }
          const fence = fencePattern.exec(text);
          if (fence === null) continue;
          const bare = (fence[2] ?? "") === "";
          const long = fence[1]?.length ?? 3;
          if (bare && nested.at(-1) === long) nested.pop();
          else if (bare && nested.length === 0 && long === length) close = at;
          else nested.push(long);
        }
        if (close === -1) {
          problems.push(`line ${row.number}: this quote is never closed: end it with ${opened[1] ?? '"""'} on a line of its own`);
          return top;
        }
        const id = idOf(row);
        assigned[(rows[close]?.number ?? row.number) - 1] = [id];
        const [first, ...rest] = parseBlocks(rows.slice(index + 1, close));
        index = close + 1;
        if (first === undefined) {
          problems.push(`line ${row.number}: this quote has nothing in it yet`);
          continue;
        }
        attach({ kind: "quote", id, reference: read({ kind: "node", node: id }, opened[2] ?? "", row.number), children: [first, ...rest] });
        continue;
      }
      if (row.text.startsWith("```")) {
        const close = rows.findIndex((each, at) => at > index && each.text === "```");
        if (close === -1) {
          problems.push(`line ${row.number}: this code block is never closed`);
          return top;
        }
        const name = row.text.slice(3).trim();
        attach({
          kind: "code",
          id: idOf(row),
          language: name === "" ? { kind: "unstated" } : { kind: "stated", name },
          code: rows.slice(index + 1, close).map((each) => each.text).join("\n"),
        });
        index = close + 1;
        continue;
      }
      const heading = /^#(\d+)(?: (.*))?$/.exec(row.text);
      if (heading !== null) {
        const level = Number(heading[1]);
        if (level === 0) {
          problems.push(`line ${row.number}: #0 is the title, which comes first; sections are #1 and deeper`);
          index += 1;
          continue;
        }
        while ((sections.at(-1)?.level ?? 0) >= level) sections.pop();
        const id = idOf(row);
        const children: Array<_Block_Document_> = [];
        attach({ kind: "section", id, heading: read({ kind: "node", node: id }, unescape(heading[2] ?? ""), row.number), children });
        sections.push({ level, children });
        index += 1;
        continue;
      }
      const entries: Array<_Item_Projection_> = [];
      while (index < rows.length) {
        const each = rows[index];
        const match = itemPattern.exec(each?.text ?? "");
        if (each === undefined || match === null) break;
        const depth = Math.floor((match[1]?.length ?? 0) / 2) + 1;
        entries.push({ row: each, depth, ordered: match[2] !== undefined, content: match[3] ?? "" });
        index += 1;
      }
      if (entries.length > 0) {
        const list = listOf(entries);
        if (list !== undefined) attach(list);
        continue;
      }
      const id = idOf(row);
      const text = read({ kind: "node", node: id }, unescape(row.text), row.number);
      attach({ kind: "paragraph", id, text: text.text, overlay: text.overlay });
      index += 1;
    }
    return top;
  };

  const rows = lines.map((text, index) => ({ text, number: index + 1, owner: owners[index] ?? [] }));
  const [titleRow, ...rest] = rows;
  const titled = /^#0(?: (.*))?$/.exec(titleRow?.text ?? "");
  if (titled === null) problems.push("line 1: a document starts with its title, as #0 and then the title");
  const title = read({ kind: "title" }, titled?.[1] ?? "", 1);
  const children = parseBlocks(rest);
  const [problem, ...more] = problems;
  return problem === undefined
    ? { kind: "parsed", value: { body: { title, children }, owners: assigned } }
    : { kind: "rejected", issues: [problem, ...more] };
}

// Reads lines against the document they were projected from. A line holds
// only characters, so its marks are carried across from the text it had. A
// list or quote keeps the id of the one its first known child was in.
export function readerFor(document: _Document_Doctor_, fresh: () => _Id_Node_): _Reader_Projection_ {
  const index = indexNodes(document.content);
  const used = new Set<string>();
  const before = (holder: _Holder_Text_): Array<_Text_Doctor_> => {
    if (holder.kind === "title") return [document.content.title];
    const entry = index.get(holder.node);
    return entry === undefined ? [] : textOfNode(entry.node);
  };
  return {
    text: (holder, content) => {
      const [was] = before(holder);
      return { kind: "parsed", value: was === undefined ? { text: content, overlay: [] } : rewrite(was, content).text };
    },
    fresh,
    container: (kind, children) => {
      for (const child of children) {
        const parent = index.get(child)?.parent;
        if (parent?.kind !== "node" || used.has(parent.node)) continue;
        if (index.get(parent.node)?.node.kind !== kind) continue;
        used.add(parent.node);
        return parent.node;
      }
      return fresh();
    },
  };
}

// where a line's content begins: after a quote's opening fence, which its
// reference follows, or after a line's own mark and a backslash that keeps
// the content from reading as a mark
export function contentStart(line: string): number {
  const fence = /^"{3,}\s*/.exec(line)?.[0] ?? "";
  if (fence !== "") return fence.length;
  const mark = /^(?:#\d+(?: |$)| *(?:-|\d+\.) )?/.exec(line)?.[0] ?? "";
  return mark.length + (line.slice(mark.length).startsWith("\\") ? 1 : 0);
}
