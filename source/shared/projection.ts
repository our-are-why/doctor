import type {
  _Block_Document_,
  _Body_Document_,
  _CODE_Block__Document_,
  _Document_Doctor_,
  _Holder_Text_,
  _Id_Node_,
  _LIST_Block__Document_,
  _ListItem_Document_,
  _Text_Doctor_,
} from "./domain.next.ts";
import type { _NonEmpty_ } from "./list.ts";
import type { _Result_Parse_ } from "./parse.ts";
import { rewrite } from "./text.ts";
import { indexNodes, textOfNode } from "./tree.ts";

// The document as lines of text: the title first, as #0, then a line per
// block. Sections are headings numbered by depth, #1, #2 and so on; items
// are - or a number, indented two spaces per level; quotes are >, a > per
// level, closed by their reference as -- when they have one; code sits
// between ``` fences. Blank lines only separate.

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
export const startsBlock = (content: string) => /^(?:[#`>\\]|--(?: |$)| *(?:-|\d+\.) )/.test(content);

const referencePattern = /^--(?: (.*))?$/;

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

  const items = (list: _LIST_Block__Document_, depth: number, quote: string) => {
    list.children.forEach((item: _ListItem_Document_, index) => {
      const written = content(item);
      const mark = `${quote}${"  ".repeat(depth - 1)}${list.order === "ordered" ? `${index + 1}.` : "-"} `;
      holding(item.id, `${mark}${written.startsWith("\\") ? "\\" : ""}`, written);
      for (const child of item.children) {
        if (child.kind === "list") items(child, depth + 1, quote);
        else blocks([child], 1, quote);
      }
    });
  };

  const code = (block: _CODE_Block__Document_, quote: string) => {
    push(`${quote}\`\`\`${block.language.kind === "stated" ? block.language.name : ""}`, [block.id]);
    for (const line of block.code.split("\n")) push(`${quote}${line}`, []);
    push(`${quote}\`\`\``, []);
  };

  const blocks = (children: Array<_Block_Document_>, depth: number, quote: string) => {
    children.forEach((block, index) => {
      if (index > 0 || quote === "") push(quote.trimEnd(), []);
      switch (block.kind) {
        case "paragraph": {
          const written = content(block);
          holding(block.id, `${quote}${startsBlock(written) ? "\\" : ""}`, written);
          break;
        }
        case "section": {
          const written = content(block.heading);
          holding(block.id, `${quote}#${depth} ${written.startsWith("\\") ? "\\" : ""}`, written);
          blocks(block.children, depth + 1, quote);
          break;
        }
        case "list":
          items(block, 1, quote);
          break;
        case "code":
          code(block, quote);
          break;
        case "quote": {
          const marks = `${quote.trimEnd()}> `;
          blocks(block.children, 1, marks);
          const written = content(block.reference);
          if (written !== "") holding(block.id, `${marks}-- ${written.startsWith("\\") ? "\\" : ""}`, written);
          break;
        }
      }
    });
  };

  blocks(document.content.children, 1, "");
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
      // A quote's lines, one level of > off each, up to its reference, which
      // closes it: a -- line at its own level, outside any code in it.
      if (row.text.startsWith(">")) {
        const quoted: Array<_Row_Projection_> = [];
        const referenced: Array<_Row_Projection_> = [];
        let fenced: "outside" | "inside" = "outside";
        while (referenced.length === 0 && rows[index]?.text.startsWith(">")) {
          const each = rows[index];
          if (each === undefined) break;
          const inner = { ...each, text: each.text.replace(/^> ?/, "") };
          index += 1;
          if (fenced === "outside" && referencePattern.test(inner.text)) {
            referenced.push(inner);
            continue;
          }
          if (fenced === "outside" ? inner.text.startsWith("```") : inner.text === "```") {
            fenced = fenced === "outside" ? "inside" : "outside";
          }
          quoted.push(inner);
        }
        const [first, ...rest] = parseBlocks(quoted);
        const [reference] = referenced;
        if (first === undefined) {
          if (reference !== undefined) {
            problems.push(`line ${reference.number}: a quote's reference closes it, so it comes after what's quoted`);
          }
          continue;
        }
        const children: _NonEmpty_<_Block_Document_> = [first, ...rest];
        if (reference === undefined) {
          const id = reader.container("quote", children.map((child) => child.id));
          attach({ kind: "quote", id, reference: { text: "", overlay: [] }, children });
          continue;
        }
        const id = idOf(reference);
        const written = unescape(referencePattern.exec(reference.text)?.[1] ?? "");
        attach({ kind: "quote", id, reference: read({ kind: "node", node: id }, written, reference.number), children });
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

// where a line's content begins: after its quote marks, its own mark, and a
// backslash that keeps the content from reading as a mark
export function contentStart(line: string): number {
  const quote = /^(?:>+ )?/.exec(line)?.[0] ?? "";
  const rest = line.slice(quote.length);
  const marks = quote === "" ? /^(?:#\d+(?: |$)| *(?:-|\d+\.) )?/ : /^(?:--(?: |$)|#\d+(?: |$)| *(?:-|\d+\.) )?/;
  const mark = marks.exec(rest)?.[0] ?? "";
  return quote.length + mark.length + (rest.slice(mark.length).startsWith("\\") ? 1 : 0);
}
