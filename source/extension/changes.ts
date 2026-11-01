import { randomBytes } from "node:crypto";
import { applyOperations } from "../shared/apply.ts";
import type {
  _Author_Doctor_,
  _Document_Doctor_,
  _Operation_Change_,
  _Ref_Change_,
  _Stamp_Doctor_,
} from "../shared/domain.next.ts";
import { mintId } from "../shared/id.ts";
import type { _NonEmpty_ } from "../shared/list.ts";
import { parseOwn } from "../shared/parse.ts";
import { changeIdSchema, timeSchema } from "../shared/schema.ts";
import { exclusively, readDocument, writeDocument } from "./documents.ts";
import { appendEntry, storeVersion } from "./store.ts";

export interface _Request_Change_ {
  file: string;
  data: string;
  author: _Author_Doctor_;
  operations: _NonEmpty_<_Operation_Change_>;
}

export type _Outcome_Change_ = _APPLIED_Outcome__Change_ | _REFUSED_Outcome__Change_;

interface __BASE_Outcome__Change_<__OutcomeKind__ extends string> {
  kind: __OutcomeKind__;
}

export interface _APPLIED_Outcome__Change_ extends __BASE_Outcome__Change_<"applied"> {
  document: _Document_Doctor_;
}

export interface _REFUSED_Outcome__Change_ extends __BASE_Outcome__Change_<"refused"> {
  issues: _NonEmpty_<string>;
}

const stamp = (by: _Author_Doctor_): _Stamp_Doctor_ => ({ by, at: parseOwn(timeSchema, new Date().toISOString()) });

// The versions are stored and the change goes into the history before the
// document is written, so the history never lacks the state a file is in.
async function record(request: _Request_Change_): Promise<_Outcome_Change_> {
  const read = await readDocument(request.file);
  if (read.kind === "rejected") return { kind: "refused", issues: read.issues };
  const change: _Ref_Change_ = { document: read.value.id, id: mintId(changeIdSchema, randomBytes(10)) };
  const result = applyOperations(read.value, request.operations, change);
  if (result.kind === "refused") return { kind: "refused", issues: [result.issue] };
  const parent = await storeVersion(request.data, read.value);
  const version = await storeVersion(request.data, result.document);
  if (version === parent) return { kind: "applied", document: read.value };
  await appendEntry(request.data, change.document, {
    kind: "change",
    document: change.document,
    version,
    made: stamp(request.author),
    id: change.id,
    parent,
    source: { kind: "inline" },
    operations: request.operations,
  });
  await writeDocument(request.file, result.document);
  return { kind: "applied", document: result.document };
}

// inline changes apply to whatever the document is now, if they fit
export function makeChange(request: _Request_Change_): Promise<_Outcome_Change_> {
  return exclusively(request.file, async () => {
    try {
      return await record(request);
    } catch (someError) {
      return { kind: "refused", issues: [`couldn't save the change: ${String(someError)}`] };
    }
  });
}

export function createDocument(
  file: string,
  data: string,
  document: _Document_Doctor_,
  author: _Author_Doctor_,
): Promise<void> {
  return exclusively(file, async () => {
    const version = await storeVersion(data, document);
    await appendEntry(data, document.id, { kind: "creation", document: document.id, version, made: stamp(author) });
    await writeDocument(file, document);
  });
}
