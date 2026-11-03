import { useEffect, useRef, useState } from "preact/hooks";
import type {
  _Document_Doctor_,
  _Id_Document_,
  _Id_Node_,
  _Id_Proposal_,
  _Id_Task_,
  _Operation_Change_,
  _Target_Request_,
} from "../shared/domain.next.ts";
import type { _NonEmpty_ } from "../shared/list.ts";
import type {
  _Task_Status_,
  _Open_Proposal_,
  _Token_Endpoint_,
  _Url_Endpoint_,
  _Verdict_Review_,
  _View_Drafting_,
} from "../shared/protocol.ts";
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

export type _Urgency_Session_ = "now" | "soon";

export interface _Session_Webview_ {
  load: _Load_Editor_;
  problems: Array<string>;
  connection: _Connection_Webview_;
  // counts the documents that came from somewhere other than this view's
  // own edits: the first one opened, others' changes, a refusal's rebase
  arrivals: number;
  perform: (act: (document: _Document_Doctor_) => Array<_Operation_Change_>, urgency: _Urgency_Session_) => void;
  leave: () => void;
  // the proposals waiting for review on this file, and what's wrong with any
  open: Array<_Open_Proposal_>;
  openProblems: Array<string>;
  makeTask: (targets: Array<_Target_Request_>, text: string) => void;
  review: (task: _Id_Task_, proposal: _Id_Proposal_, verdict: _Verdict_Review_) => void;
  // what's being drafted, if anything, with the draft's requests for this
  // document
  drafting: Array<_View_Drafting_>;
  beginDrafting: () => void;
  addRequest: (targets: Array<_Target_Request_>, text: string) => void;
  start: (task: _Id_Task_) => void;
  stopDrafting: () => void;
  // the task the bar tells of, if any: the active one, or the last finished
  status: Array<_Task_Status_>;
  copyPrompt: () => void;
  acknowledge: (task: _Id_Task_) => void;
  // the active task parked, canceled, steered with a request added to it, or
  // its waiting proposals accepted, in a document or all of it
  park: (task: _Id_Task_) => void;
  cancel: (task: _Id_Task_) => void;
  steer: (task: _Id_Task_, targets: Array<_Target_Request_>, text: string) => void;
  acceptAll: (task: _Id_Task_, document: Array<_Id_Document_>, except: Array<_Id_Proposal_>) => void;
}

type _Due_Editor_ = "waiting" | "due";

// typing waits this long for a pause before it's sent
const pause = 400;

const editingLoad = (session: _Session_Editor_): _EDITING_Load__Editor_ => ({
  kind: "editing",
  session,
  document: shown(session),
});

// one document's edits: shown at once, sent after a pause, one change at a
// time, rebased when the server refuses one
export function useSession(file: string, endpoint: _Url_Endpoint_, token: _Token_Endpoint_): _Session_Webview_ {
  const [load, setLoadState] = useState<_Load_Editor_>({ kind: "loading" });
  const [problems, setProblems] = useState<Array<string>>([]);
  const [due, setDue] = useState<_Due_Editor_>("waiting");
  const [arrivals, setArrivals] = useState(0);
  const [open, setOpen] = useState<Array<_Open_Proposal_>>([]);
  const [drafting, setDrafting] = useState<Array<_View_Drafting_>>([]);
  const [status, setStatus] = useState<Array<_Task_Status_>>([]);
  const [openProblems, setOpenProblems] = useState<Array<string>>([]);
  const timer = useRef(0);

  // what the handlers read, kept current as soon as it changes rather than
  // at the next render, so two events in a row see each other's edits
  const loadRef = useRef(load);
  const setLoad = (next: _Load_Editor_) => {
    loadRef.current = next;
    setLoadState(next);
  };
  const arrived = (next: _Load_Editor_) => {
    setLoad(next);
    setArrivals((count) => count + 1);
  };

  const rebased = ({ session, problems }: _Rebased_Session_) => {
    arrived(editingLoad(session));
    if (problems.length > 0) setProblems(problems);
    setDue("due");
  };

  const { connection, send } = useSocket(endpoint, token, (message) => {
    if (message.kind === "welcome" || message.kind === "tasks" || message.file !== file) return;
    if (message.kind === "proposals") {
      setOpen(message.open);
      setOpenProblems(message.problems);
      return;
    }
    if (message.kind === "focus") {
      setDrafting(message.drafting);
      return;
    }
    if (message.kind === "status") {
      setStatus(message.task);
      return;
    }
    const current = loadRef.current;
    switch (message.kind) {
      case "opened":
        arrived(editingLoad(opened(message.document)));
        return;
      case "unreadable":
        setLoad({ kind: "unreadable", issues: message.issues });
        return;
      case "applied":
        if (current.kind === "editing") setLoad(editingLoad(confirmed(current.session, message.document)));
        return;
      case "updated":
        if (current.kind === "editing") arrived(editingLoad(updated(current.session, message.document)));
        return;
      case "refused":
        if (current.kind === "editing") rebased(refused(current.session, message.issues));
        return;
    }
  });

  useEffect(() => {
    if (connection.kind === "open") send({ kind: "open", file });
  }, [connection.kind, file, send]);

  useEffect(() => {
    if (due !== "due" || load.kind !== "editing" || connection.kind !== "open") return;
    const { session } = load;
    if (session.sent.length > 0) return;
    const [first, ...rest] = session.unsent;
    setDue("waiting");
    if (first === undefined) return;
    send({ kind: "change", file, operations: [first, ...rest] });
    setLoad(editingLoad(take(session)));
  }, [due, load, connection.kind]);

  const perform: _Session_Webview_["perform"] = (act, urgency) => {
    const current = loadRef.current;
    if (current.kind !== "editing") return;
    const operations = act(current.document);
    if (operations.length === 0) return;
    const result = record(current.session, operations);
    if (result.kind === "refused") {
      setProblems([result.issue]);
      return;
    }
    setLoad(editingLoad(result.session));
    setProblems([]);
    window.clearTimeout(timer.current);
    if (urgency === "now") setDue("due");
    else timer.current = window.setTimeout(() => setDue("due"), pause);
  };

  const leave = () => {
    window.clearTimeout(timer.current);
    setDue("due");
  };

  const makeTask = (targets: Array<_Target_Request_>, text: string) => send({ kind: "task", text, targets });
  const review = (task: _Id_Task_, proposal: _Id_Proposal_, verdict: _Verdict_Review_) =>
    send({ kind: "review", task, proposal, verdict });

  const beginDrafting = () => send({ kind: "drafting" });
  const addRequest = (targets: Array<_Target_Request_>, text: string) => send({ kind: "request", text, targets });
  const start = (task: _Id_Task_) => send({ kind: "activate", task });
  const stopDrafting = () => send({ kind: "unfocus" });
  const copyPrompt = () => send({ kind: "copyPrompt" });
  const acknowledge = (task: _Id_Task_) => send({ kind: "acknowledge", task });
  const park = (task: _Id_Task_) => send({ kind: "park", task });
  const cancel = (task: _Id_Task_) => send({ kind: "cancel", task });
  const acceptAll = (task: _Id_Task_, document: Array<_Id_Document_>, except: Array<_Id_Proposal_>) =>
    send({ kind: "acceptAll", task, document, except });
  const steer = (task: _Id_Task_, targets: Array<_Target_Request_>, text: string) => send({ kind: "steer", task, text, targets });

  return {
    load,
    problems,
    connection,
    arrivals,
    perform,
    leave,
    open,
    openProblems,
    makeTask,
    review,
    drafting,
    beginDrafting,
    addRequest,
    start,
    stopDrafting,
    status,
    copyPrompt,
    acknowledge,
    park,
    cancel,
    steer,
    acceptAll,
  };
}
