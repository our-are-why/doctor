import { applyOperations, textOperations } from "../shared/apply.ts";
import type {
  _Document_Doctor_,
  _Holder_Text_,
  _Operation_Change_,
  _Ref_Change_,
  _Text_Doctor_,
} from "../shared/domain.next.ts";
import { mintId } from "../shared/id.ts";
import { changeIdSchema } from "../shared/schema.ts";
import { indexNodes, textOfNode } from "../shared/tree.ts";

export interface _Session_Editor_ {
  confirmed: _Document_Doctor_;
  sent: Array<_Operation_Change_>;
  unsent: Array<_Operation_Change_>;
}

export type _Recorded_Session_ = _RECORDED_Recorded__Session_ | _REFUSED_Recorded__Session_;

interface __BASE_Recorded__Session_<__RecordedKind__ extends string> {
  kind: __RecordedKind__;
}

export interface _RECORDED_Recorded__Session_ extends __BASE_Recorded__Session_<"recorded"> {
  session: _Session_Editor_;
}

export interface _REFUSED_Recorded__Session_ extends __BASE_Recorded__Session_<"refused"> {
  issue: string;
}

export interface _Rebased_Session_ {
  session: _Session_Editor_;
  problems: Array<string>;
}

// what the editor shows is a change nobody has made yet; notes it detaches
// name this stand-in, and the server names the real change
const preview = mintId(changeIdSchema, crypto.getRandomValues(new Uint8Array(10)));

function applied(document: _Document_Doctor_, operations: ReadonlyArray<_Operation_Change_>) {
  const change: _Ref_Change_ = { document: document.id, id: preview };
  return applyOperations(document, operations, change);
}

function showing(document: _Document_Doctor_, operations: ReadonlyArray<_Operation_Change_>): _Document_Doctor_ {
  if (operations.length === 0) return document;
  const result = applied(document, operations);
  return result.kind === "applied" ? result.document : document;
}

export function opened(document: _Document_Doctor_): _Session_Editor_ {
  return { confirmed: document, sent: [], unsent: [] };
}

export const shown = (session: _Session_Editor_) =>
  showing(session.confirmed, [...session.sent, ...session.unsent]);

export const waiting = (session: _Session_Editor_) => session.sent.length + session.unsent.length;

function holderOf(operation: _Operation_Change_): Array<_Holder_Text_> {
  return operation.kind === "write" || operation.kind === "style" ? [operation.holder] : [];
}

function sameHolder(first: _Holder_Text_, second: _Holder_Text_): boolean {
  if (first.kind === "title") return second.kind === "title";
  return second.kind === "node" && second.node === first.node;
}

function textAt(document: _Document_Doctor_, holder: _Holder_Text_): Array<_Text_Doctor_> {
  if (holder.kind === "title") return [document.content.title];
  const entry = indexNodes(document.content).get(holder.node);
  return entry === undefined ? [] : textOfNode(entry.node);
}

// Typing on in the same text replaces the run of writes and styles it ends
// with by the fewest that take that text from before the run to now; a later
// edit of the same node replaces an earlier one, since an edit sets the whole.
function coalesce(session: _Session_Editor_, operations: Array<_Operation_Change_>): Array<_Operation_Change_> {
  const { confirmed, sent, unsent } = session;
  const [holder] = operations.flatMap(holderOf);
  const on = (operation: _Operation_Change_) =>
    holder !== undefined && holderOf(operation).some((each) => sameHolder(each, holder));
  if (holder !== undefined && operations.every(on)) {
    const firstOff = unsent.toReversed().findIndex((operation) => !on(operation));
    const run = firstOff === -1 ? unsent.length : firstOff;
    if (run > 0) {
      const kept = unsent.slice(0, unsent.length - run);
      const [before] = textAt(showing(confirmed, [...sent, ...kept]), holder);
      const [after] = textAt(showing(confirmed, [...sent, ...unsent, ...operations]), holder);
      if (before !== undefined && after !== undefined) return [...kept, ...textOperations(holder, before, after)];
    }
  }
  const last = unsent.at(-1);
  const [only, ...more] = operations;
  if (more.length === 0 && only?.kind === "edit" && last?.kind === "edit" && last.node === only.node) {
    return [...unsent.slice(0, -1), only];
  }
  return [...unsent, ...operations];
}

export function record(session: _Session_Editor_, operations: Array<_Operation_Change_>): _Recorded_Session_ {
  const result = applied(session.confirmed, [...session.sent, ...session.unsent, ...operations]);
  if (result.kind === "refused") return { kind: "refused", issue: result.issue };
  return { kind: "recorded", session: { ...session, unsent: coalesce(session, operations) } };
}

export function confirmed(session: _Session_Editor_, document: _Document_Doctor_): _Session_Editor_ {
  return { confirmed: document, sent: [], unsent: session.unsent };
}

export function updated(session: _Session_Editor_, document: _Document_Doctor_): _Session_Editor_ {
  return { ...session, confirmed: document };
}

// what was sent didn't fit; what wasn't sent yet is kept if it still fits
export function refused(session: _Session_Editor_, issues: Array<string>): _Rebased_Session_ {
  const { confirmed, unsent } = session;
  if (unsent.length === 0) return { session: opened(confirmed), problems: issues };
  const result = applied(confirmed, unsent);
  return result.kind === "applied"
    ? { session: { confirmed, sent: [], unsent }, problems: issues }
    : { session: opened(confirmed), problems: [...issues, `edits that no longer fit were dropped: ${result.issue}`] };
}

export function take(session: _Session_Editor_): _Session_Editor_ {
  return { ...session, sent: session.unsent, unsent: [] };
}
