import { useEffect, useRef, useState } from "preact/hooks";
import type { _Target_Request_ } from "../shared/domain.next.ts";
import { mintId } from "../shared/id.ts";
import { parseProjection, readerFor, type _Read_Projection_ } from "../shared/projection.ts";
import type { _TEXT_Config__Webview_ } from "../shared/protocol.ts";
import { reconcile } from "../shared/reconcile.ts";
import { nodeIdSchema } from "../shared/schema.ts";
import { ConnectionStatus } from "./ConnectionStatus.tsx";
import { waiting } from "./session.ts";
import styles from "./styles/TextEditor.module.css";
import { createTextView, type _View_Text_ } from "./textView.ts";
import { useSession } from "./useSession.ts";

const mintNodeId = () => mintId(nodeIdSchema, crypto.getRandomValues(new Uint8Array(10)));

export function TextEditor({ config }: { config: _TEXT_Config__Webview_ }) {
  const session = useSession(config.file, config.endpoint, config.token);
  const host = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState("");
  const views = useRef<Array<_View_Text_>>([]);
  const latest = useRef(session);
  latest.current = session;

  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    const view = createTextView(element, {
      edited: (lines, owners) => {
        const read: Array<_Read_Projection_> = [];
        latest.current.perform((document) => {
          const parsed = parseProjection(lines, owners, readerFor(document, mintNodeId));
          view.mark(parsed.kind === "rejected" ? parsed.issues : []);
          if (parsed.kind === "rejected") return [];
          read.push(parsed.value);
          return reconcile(document, parsed.value.body, mintNodeId);
        }, "soon");
        for (const each of read) view.track(each.owners);
      },
      perform: (act) => latest.current.perform(act, "now"),
      leave: () => latest.current.leave(),
      makeTask: (targets, text) => latest.current.makeTask(targets, text),
      beginDrafting: () => latest.current.beginDrafting(),
      addRequest: (targets, text) => latest.current.addRequest(targets, text),
      stopDrafting: () => latest.current.stopDrafting(),
      requestDocument: () => bar.current?.focus(),
      review: (task, proposal, verdict) => latest.current.review(task, proposal, verdict),
    });
    views.current = [view];
    return () => {
      view.dispose();
      views.current = [];
    };
  }, []);

  useEffect(() => {
    if (session.load.kind !== "editing") return;
    const { document } = session.load;
    for (const view of views.current) view.show(document);
  }, [session.arrivals]);

  // after a document's shown, so its proposals are drawn on its lines
  useEffect(() => {
    if (session.load.kind !== "editing") return;
    for (const view of views.current) view.proposals(session.open);
  }, [session.open, session.arrivals]);

  useEffect(() => {
    if (session.load.kind !== "editing") return;
    for (const view of views.current) view.decorate(session.load.document);
  }, [session.load]);

  useEffect(() => {
    for (const view of views.current) view.focus(session.drafting);
  }, [session.drafting, session.arrivals]);

  // A request for the whole document, made from the bar above it: a quick
  // task, or added to the task being drafted.
  const documentTargets = (): Array<_Target_Request_> =>
    session.load.kind === "editing" ? [{ kind: "document", document: session.load.document.id }] : [];
  const requestForDocument = () => {
    const written = typed.trim();
    if (written === "") return;
    if (session.drafting.length > 0) session.addRequest(documentTargets(), written);
    else session.makeTask(documentTargets(), written);
    setTyped("");
  };
  // drafting begins with what's written, if anything, as its first request
  const draftTask = () => {
    const written = typed.trim();
    session.beginDrafting();
    if (written !== "") session.addRequest(documentTargets(), written);
    setTyped("");
    bar.current?.focus();
  };
  const [focus] = session.drafting;
  const draft = focus?.kind === "draft" ? focus : undefined;

  const { load, problems, openProblems, connection } = session;
  return (
    <main className={styles.shell}>
      <form
        className={focus === undefined ? styles.requestBar : styles.draftingBar}
        onSubmit={(event) => {
          event.preventDefault();
          requestForDocument();
        }}
      >
        {/* always here, empty when not drafting, so the input after it stays the same element, and keeps the focus, as drafting begins */}
        <span className={styles.barLabel}>
          {focus === undefined
            ? ""
            : draft === undefined
              ? "Drafting a task · no requests yet"
              : `Drafting: ${draft.name} · ${draft.count === 1 ? "1 request" : `${draft.count} requests`}`}
        </span>
        <input
          ref={bar}
          className={styles.requestInput}
          placeholder={focus === undefined ? "Request a change to this document…" : "Add a request for this document…"}
          value={typed}
          onInput={(event) => setTyped(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") event.currentTarget.blur();
          }}
        />
        {focus === undefined ? (
          <>
            <button className={styles.barPrimary} type="submit">
              Start task
            </button>
            <button className={styles.barButton} type="button" onClick={draftTask}>
              Draft a task
            </button>
          </>
        ) : (
          <>
            <button className={styles.barButton} type="submit">
              Add
            </button>
            {draft === undefined ? null : (
              <button className={styles.barPrimary} type="button" onClick={() => session.start(draft.task)}>
                Start task
              </button>
            )}
            <button className={styles.barButton} type="button" onClick={() => session.stopDrafting()}>
              Stop drafting
            </button>
          </>
        )}
      </form>
      <div ref={host} className={styles.host} />
      <footer className={styles.footer}>
        <ConnectionStatus connection={connection} />
        <p>{load.kind === "editing" ? (waiting(load.session) === 0 ? "saved" : "saving…") : load.kind}</p>
        {load.kind === "unreadable" ? <p className={styles.problem}>{load.issues[0]}</p> : null}
        {[...problems, ...openProblems].map((problem) => (
          <p className={styles.problem}>{problem}</p>
        ))}
      </footer>
    </main>
  );
}
