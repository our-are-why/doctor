import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  _Content_Node_,
  _Document_Doctor_,
  _Entry_History_,
  _Hash_Node_,
  _Id_Document_,
  _Node_Document_,
  _Note_Document_,
  _Object_Store_,
  _Text_Doctor_,
  _Version_Document_,
} from "../shared/domain.next.ts";
import { parse, parseOwn, type _Result_Parse_ } from "../shared/parse.ts";
import { documentSchema, historyEntrySchema, nodeHashSchema, storeObjectSchema, versionSchema } from "../shared/schema.ts";
import { childrenOf } from "../shared/tree.ts";

interface _Objects_Version_ {
  version: _Version_Document_;
  objects: Array<[string, _Object_Store_]>;
}

// JSON with every object's keys in order, so equal content is spelled, and
// hashed, one way
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).toSorted(([first], [second]) => (first < second ? -1 : first > second ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const hashOf = (object: _Object_Store_) => createHash("sha256").update(canonicalJson(object)).digest("hex");

// an overlay is a set, so its marks are put in one order before hashing
function orderedText(text: _Text_Doctor_): _Text_Doctor_ {
  const keyed = text.overlay.map((mark) => ({ mark, key: canonicalJson(mark) }));
  const sorted = keyed.toSorted((first, second) => (first.key < second.key ? -1 : first.key > second.key ? 1 : 0));
  return { text: text.text, overlay: sorted.map((entry) => entry.mark) };
}

const orderedNote = (note: _Note_Document_): _Note_Document_ => ({ ...note, body: orderedText(note.body) });

function contentOf(node: _Node_Document_): _Content_Node_ {
  switch (node.kind) {
    case "section":
      return { kind: "section", heading: orderedText(node.heading) };
    case "paragraph": {
      const { text, overlay } = orderedText(node);
      return { kind: "paragraph", text, overlay };
    }
    case "list":
      return { kind: "list", order: node.order };
    case "listItem": {
      const { text, overlay } = orderedText(node);
      return { kind: "listItem", text, overlay };
    }
    case "code":
      return { kind: "code", language: node.language, code: node.code };
    case "quote":
      return { kind: "quote", reference: orderedText(node.reference) };
  }
}

function objectsOf(document: _Document_Doctor_): _Objects_Version_ {
  const objects: Array<[string, _Object_Store_]> = [];
  const add = (object: _Object_Store_) => {
    const hash = hashOf(object);
    objects.push([hash, object]);
    return hash;
  };
  const nodeHash = (node: _Node_Document_): _Hash_Node_ =>
    parseOwn(
      nodeHashSchema,
      add({ kind: "node", id: node.id, content: contentOf(node), children: childrenOf(node).map(nodeHash) }),
    );
  const children = document.content.children.map(nodeHash);
  const version = add({
    kind: "version",
    document: document.id,
    title: orderedText(document.content.title),
    notes: document.notes.map(orderedNote),
    children,
  });
  return { version: parseOwn(versionSchema, version), objects };
}

export const versionOf = (document: _Document_Doctor_) => objectsOf(document).version;

// a node and everything in it, spelled one way, so two are the same exactly
// when their keys are
export function nodeKey(node: _Node_Document_): string {
  return canonicalJson({ id: node.id, content: contentOf(node), children: childrenOf(node).map(nodeKey) });
}

export const textKey = (text: _Text_Doctor_) => canonicalJson(orderedText(text));

const objectFile = (data: string, hash: string) =>
  join(data, "objects", hash.slice(0, 2), `${hash.slice(2)}.json`);

async function put(data: string, hash: string, object: _Object_Store_): Promise<void> {
  const file = objectFile(data, hash);
  await mkdir(join(file, ".."), { recursive: true });
  try {
    await writeFile(file, `${canonicalJson(object)}\n`, { flag: "wx" });
  } catch (someError) {
    if (!(someError instanceof Error && "code" in someError && someError.code === "EEXIST")) throw someError;
  }
}

// stores every object of the document's version that isn't stored yet
export async function storeVersion(data: string, document: _Document_Doctor_): Promise<_Version_Document_> {
  const { version, objects } = objectsOf(document);
  await Promise.all(objects.map(([hash, object]) => put(data, hash, object)));
  return version;
}

async function readObject(data: string, hash: string): Promise<_Object_Store_> {
  const result = parse(storeObjectSchema, JSON.parse(await readFile(objectFile(data, hash), "utf8")));
  if (result.kind === "rejected") throw new Error(`object ${hash}: ${result.issues.join("; ")}`);
  if (hashOf(result.value) !== hash) throw new Error(`object ${hash} doesn't match its hash`);
  return result.value;
}

async function loadNode(data: string, hash: string): Promise<unknown> {
  const object = await readObject(data, hash);
  if (object.kind !== "node") throw new Error(`object ${hash} is a version, not a node`);
  const children = await Promise.all(object.children.map((child) => loadNode(data, child)));
  const holds = object.content.kind !== "paragraph" && object.content.kind !== "code";
  if (!holds && children.length > 0) throw new Error(`object ${hash} is a ${object.content.kind} with children`);
  return holds ? { ...object.content, id: object.id, children } : { ...object.content, id: object.id };
}

// rebuilds a version from the store, parsed like any document
export async function loadVersion(data: string, version: _Version_Document_): Promise<_Result_Parse_<_Document_Doctor_>> {
  try {
    const object = await readObject(data, version);
    if (object.kind !== "version") throw new Error(`object ${version} is a node, not a version`);
    const children = await Promise.all(object.children.map((child) => loadNode(data, child)));
    return parse(documentSchema, {
      kind: "document",
      formatVersion: 1,
      id: object.document,
      content: { title: object.title, children },
      notes: object.notes,
    });
  } catch (someError) {
    return { kind: "rejected", issues: [`couldn't load version ${version}: ${String(someError)}`] };
  }
}

// a document's history, each entry that reads as one; none if it has none
export async function readEntries(data: string, document: _Id_Document_): Promise<Array<_Entry_History_>> {
  const text = await readFile(join(data, "history", `${document}.jsonl`), "utf8").catch(() => "");
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap((line) => {
      try {
        const entry = parse(historyEntrySchema, JSON.parse(line));
        return entry.kind === "parsed" ? [entry.value] : [];
      } catch {
        return [];
      }
    });
}

export async function appendEntry(data: string, document: _Id_Document_, entry: _Entry_History_): Promise<void> {
  const history = join(data, "history");
  await mkdir(history, { recursive: true });
  await appendFile(join(history, `${document}.jsonl`), `${JSON.stringify(entry)}\n`);
}
