import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { _Document_Doctor_ } from "../shared/domain.next.ts";
import { mintId } from "../shared/id.ts";
import { parse, type _Result_Parse_ } from "../shared/parse.ts";
import { documentIdSchema, documentSchema } from "../shared/schema.ts";
import { printJson } from "./json.ts";

export const documentSuffix = ".doctor.json";

export function newDocument(title: string): _Document_Doctor_ {
  return {
    kind: "document",
    formatVersion: 1,
    id: mintId(documentIdSchema, randomBytes(10)),
    content: { title: { text: title, overlay: [] }, children: [] },
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

// to a temporary file renamed into place, so nothing ever reads half of it
export async function writeJson(file: string, value: unknown): Promise<void> {
  const temporary = join(dirname(file), `.${basename(file)}.${randomBytes(4).toString("hex")}.tmp`);
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(temporary, `${printJson(value)}\n`);
    await rename(temporary, file);
  } catch (someError) {
    await rm(temporary, { force: true });
    throw someError;
  }
}

export const writeDocument = (file: string, document: _Document_Doctor_) => writeJson(file, document);

const queues = new Map<string, Promise<void>>();

// Runs work once everything queued on the file before it has finished, so a
// read and the write that follows it can't interleave with another's.
export function exclusively<__Value__>(file: string, work: () => Promise<__Value__>): Promise<__Value__> {
  const next = (queues.get(file) ?? Promise.resolve()).then(work);
  const settled = next.then(
    () => {},
    () => {},
  );
  queues.set(file, settled);
  void settled.then(() => {
    if (queues.get(file) === settled) queues.delete(file);
  });
  return next;
}
