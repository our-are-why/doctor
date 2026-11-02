import { useEffect, useRef } from "preact/hooks";
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
  const dock = useRef<HTMLDivElement>(null);
  const views = useRef<Array<_View_Text_>>([]);
  const latest = useRef(session);
  latest.current = session;

  useEffect(() => {
    const element = host.current;
    const docking = dock.current;
    if (element === null || docking === null) return;
    const view = createTextView(element, docking, {
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

  const [focus] = session.drafting;
  const draft = focus?.kind === "draft" ? focus : undefined;
  const drafted =
    focus === undefined
      ? ""
      : draft === undefined
        ? "Drafting a task · no requests yet"
        : `Drafting: ${draft.name} · ${draft.count === 1 ? "1 request" : `${draft.count} requests`}`;

  // The bar holds what's being drafted, on the left, and the actions, on the
  // right; a request for the whole document opens the editor's request form
  // docked beneath it. Each part is keyed, as two are divs Preact could mix
  // up, and the editor draws into two of them.
  const { load, problems, openProblems, connection } = session;
  return (
    <main className={styles.shell}>
      <div key="bar" className={focus === undefined ? styles.requestBar : styles.draftingBar}>
        <span className={styles.barStatus}>{drafted}</span>
        {focus === undefined ? (
          <>
            <button
              className={styles.barButton}
              type="button"
              onClick={() => {
                for (const view of views.current) view.requestForDocument("quick");
              }}
            >
              Quick task
            </button>
            <button className={styles.barButton} type="button" onClick={() => session.beginDrafting()}>
              Draft a task
            </button>
          </>
        ) : (
          <>
            <button
              className={styles.barButton}
              type="button"
              onClick={() => {
                for (const view of views.current) view.requestForDocument("draft");
              }}
            >
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
      </div>
      <div key="dock" ref={dock} className={styles.dock} />
      <div key="host" ref={host} className={styles.host} />
      <footer key="footer" className={styles.footer}>
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
