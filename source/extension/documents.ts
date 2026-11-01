import { randomBytes } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { _Document_Doctor_ } from "../shared/domain.ts";
import { parse, parseOwn, type _Result_Parse_, type _Schema_Parse_ } from "../shared/parse.ts";
import { documentIdSchema, documentSchema, revisionSchema } from "../shared/schema.ts";

export const documentSuffix = ".doctor.json";

const idAlphabet = "0123456789abcdefghijklmnopqrstuvwxyz";

export function mintId<__Id__>(schema: _Schema_Parse_<__Id__>): __Id__ {
  const raw = Array.from(randomBytes(10), (byte) => idAlphabet.charAt(byte % idAlphabet.length)).join("");
  return parseOwn(schema, raw);
}

export function newDocument(title: string): _Document_Doctor_ {
  return {
    kind: "document",
    formatVersion: 1,
    id: mintId(documentIdSchema),
    revision: parseOwn(revisionSchema, 1),
    content: {
      title: title === "" ? [] : [{ kind: "run", text: title, contrast: [] }],
      children: [],
    },
    notes: [],
  };
}

export async function readDocument(file: string): Promise<_Result_Parse_<_Document_Doctor_>> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (someError) {
    return { kind: "rejected", issues: [`couldn't read the file: ${String(someError)}`] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (someError) {
    return { kind: "rejected", issues: [`the file isn't JSON: ${String(someError)}`] };
  }
  return parse(documentSchema, raw);
}

const writes = new Map<string, Promise<void>>();

// One write at a time per file, each to a temporary file renamed into place,
// so nothing ever reads half a document.
export function writeDocument(file: string, document: _Document_Doctor_): Promise<void> {
  const previous = writes.get(file) ?? Promise.resolve();
  const next = previous.then(async () => {
    const temporary = join(dirname(file), `.${basename(file)}.${randomBytes(4).toString("hex")}.tmp`);
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`);
    await rename(temporary, file);
  });
  writes.set(
    file,
    next.catch(() => {}),
  );
  return next;
}
