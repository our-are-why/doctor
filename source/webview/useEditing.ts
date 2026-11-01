import { useEffect, useRef, useState } from "preact/hooks";
import type { _Document_Doctor_ } from "../shared/domain.next.ts";
import { mintId } from "../shared/id.ts";
import type { _NonEmpty_ } from "../shared/list.ts";
import type { _DOCUMENT_Config__Webview_ } from "../shared/protocol.ts";
import { nodeIdSchema } from "../shared/schema.ts";
import { backspace, recode, retext, split, type _Action_Editor_, type _Focus_Editor_ } from "./actions.ts";
import type { _Editing_View_ } from "./editing.ts";
import {
  confirmed,
  opened,
  record,
  refused,
  shown,
  take,
  updated,
  type _Rebased_Session_,
  type _Session_Editor_,
} from "./session.ts";
import { useSocket, type _Connection_Webview_ } from "./useSocket.ts";

export type _Load_Editor_ = _LOADING_Load__Editor_ | _EDITING_Load__Editor_ | _UNREADABLE_Load__Editor_;

interface __BASE_Load__Editor_<__LoadKind__ extends string> {
  kind: __LoadKind__;
}

export interface _LOADING_Load__Editor_ extends __BASE_Load__Editor_<"loading"> {}

export interface _EDITING_Load__Editor_ extends __BASE_Load__Editor_<"editing"> {
  session: _Session_Editor_;
  document: _Document_Doctor_;
}

export interface _UNREADABLE_Load__Editor_ extends __BASE_Load__Editor_<"unreadable"> {
  issues: _NonEmpty_<string>;
}

export interface _Editor_Webview_ {
  load: _Load_Editor_;
  problems: Array<string>;
  connection: _Connection_Webview_;
  editing: _Editing_View_;
}

type _Due_Editor_ = "waiting" | "due";

// typing waits this long for a pause before it's sent
const pause = 400;

const editingLoad = (session: _Session_Editor_): _EDITING_Load__Editor_ => ({
  kind: "editing",
  session,
  document: shown(session),
});

const mintNodeId = () => mintId(nodeIdSchema, crypto.getRandomValues(new Uint8Array(10)));

export function useEditing(config: _DOCUMENT_Config__Webview_): _Editor_Webview_ {
  const [load, setLoadState] = useState<_Load_Editor_>({ kind: "loading" });
  const [problems, setProblems] = useState<Array<string>>([]);
  const [focus, setFocus] = useState<_Focus_Editor_>({ kind: "keep" });
  const [due, setDue] = useState<_Due_Editor_>("waiting");
  const timer = useRef(0);

  // what the handlers read, kept current as soon as it changes rather than
  // at the next render, so two events in a row see each other's edits
  const loadRef = useRef(load);
  const setLoad = (next: _Load_Editor_) => {
    loadRef.current = next;
    setLoadState(next);
  };

  const rebased = ({ session, problems }: _Rebased_Session_) => {
    setLoad(editingLoad(session));
    if (problems.length > 0) setProblems(problems);
    setDue("due");
  };

  const { connection, send } = useSocket(config.endpoint, config.token, (message) => {
    if (message.kind === "welcome" || message.file !== config.file) return;
    const current = loadRef.current;
    switch (message.kind) {
      case "opened":
        setLoad(editingLoad(opened(message.document)));
        return;
      case "unreadable":
        setLoad({ kind: "unreadable", issues: message.issues });
        return;
      case "applied":
        if (current.kind === "editing") setLoad(editingLoad(confirmed(current.session, message.document)));
        return;
      case "updated":
        if (current.kind === "editing") setLoad(editingLoad(updated(current.session, message.document)));
        return;
      case "refused":
        if (current.kind === "editing") rebased(refused(current.session, message.issues));
        return;
    }
  });

  useEffect(() => {
    if (connection.kind === "open") send({ kind: "open", file: config.file });
  }, [connection.kind, config.file, send]);

  useEffect(() => {
    if (due !== "due" || load.kind !== "editing" || connection.kind !== "open") return;
    const { session } = load;
    if (session.sent.length > 0) return;
    const [first, ...rest] = session.unsent;
    setDue("waiting");
    if (first === undefined) return;
    send({ kind: "change", file: config.file, operations: [first, ...rest] });
    setLoad(editingLoad(take(session)));
  }, [due, load, connection.kind]);

  const perform = (act: (document: _Document_Doctor_) => _Action_Editor_, urgency: "now" | "soon") => {
    const current = loadRef.current;
    if (current.kind !== "editing") return;
    const action = act(current.document);
    if (action.operations.length > 0) {
      const result = record(current.session, action.operations);
      if (result.kind === "refused") {
        setProblems([result.issue]);
        return;
      }
      setLoad(editingLoad(result.session));
      setProblems([]);
      window.clearTimeout(timer.current);
      if (urgency === "now") setDue("due");
      else timer.current = window.setTimeout(() => setDue("due"), pause);
    }
    setFocus(action.focus);
  };

  const editing: _Editing_View_ = {
    focus,
    retext: (spot, text) => perform((document) => retext(document, spot, text), "soon"),
    split: (spot, text, offset) => perform((document) => split(document, spot, text, offset, mintNodeId), "now"),
    backspace: (spot) => perform((document) => backspace(document, spot), "now"),
    recode: (node, code) => perform((document) => recode(document, node, code), "soon"),
    leave: () => {
      window.clearTimeout(timer.current);
      setDue("due");
    },
  };

  return { load, problems, connection, editing };
}
