import { useEffect, useRef, useState } from "preact/hooks";
import { mintId } from "../shared/id.ts";
import { parseProjection, readerFor, type _Read_Projection_ } from "../shared/projection.ts";
import type { _TEXT_Config__Webview_ } from "../shared/protocol.ts";
import { reconcile } from "../shared/reconcile.ts";
import { nodeIdSchema } from "../shared/schema.ts";
import { waiting } from "./session.ts";
import styles from "./styles/TextEditor.module.css";
import { createTextView, type _View_Text_ } from "./textView.ts";
import { useSession } from "./useSession.ts";

const mintNodeId = () => mintId(nodeIdSchema, crypto.getRandomValues(new Uint8Array(10)));

export function TextEditor({ config }: { config: _TEXT_Config__Webview_ }) {
  const session = useSession(config.file, config.endpoint, config.token);
  const host = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const [listing, setListing] = useState<"hidden" | "shown">("hidden");
  const [copied, setCopied] = useState<"idle" | "copied">("idle");
  // where the editor's line numbers start, for the bar's words to start there
  const [numbers, setNumbers] = useState<Array<number>>([]);
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
      numbers: (left) => setNumbers([left]),
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

  // The bar's left is the document's status, each part only when it applies:
  // what needs you, what the agent's doing, what you're drafting, and the
  // document's own state. Its right holds the actions. A request for the
  // whole document opens the editor's request form docked beneath it.
  const { load, problems, openProblems, connection } = session;
  const issues = [...(load.kind === "unreadable" ? load.issues : []), ...problems, ...openProblems];
  const reviews = session.open.length;
  const [active] = session.active;
  const [numbersLeft] = numbers;
  const copyPrompt = () => {
    session.copyPrompt();
    setCopied("copied");
    window.setTimeout(() => setCopied("idle"), 3000);
  };
  const agentStatus = () => {
    if (active === undefined) return null;
    if (active.turn === "human") return reviews > 0 ? null : <span>waiting on you · {active.name}</span>;
    if (active.agent === "away") {
      return (
        <button className={styles.statusItem} type="button" title="Copy what to tell your agent" onClick={copyPrompt}>
          {copied === "copied" ? "copied what to tell your agent" : `no agent listening · ${active.name}`}
        </button>
      );
    }
    return (
      <span>
        working
        <span className={styles.pulse}>
          <span />
          <span />
          <span />
        </span>{" "}
        · {active.name}
      </span>
    );
  };
  // Each part is keyed: the bar and the editor's host are both divs, which
  // Preact could mix up, and the editor draws into two of them.
  return (
    <main className={styles.shell}>
      <div
        key="bar"
        className={focus === undefined ? styles.requestBar : styles.draftingBar}
        style={numbersLeft === undefined ? undefined : { paddingLeft: `${numbersLeft}px` }}
      >
        <span className={styles.status}>
          {issues.length > 0 ? (
            <button
              className={styles.statusProblem}
              type="button"
              onClick={() => setListing(listing === "shown" ? "hidden" : "shown")}
            >
              {issues.length === 1 ? "1 problem" : `${issues.length} problems`}
            </button>
          ) : null}
          {reviews > 0 ? (
            <button
              className={styles.statusItem}
              type="button"
              onClick={() => {
                for (const view of views.current) view.revealProposals();
              }}
            >
              {reviews === 1 ? "1 proposal to review" : `${reviews} proposals to review`}
            </button>
          ) : null}
          {agentStatus()}
          {drafted === "" ? null : <span>{drafted}</span>}
          {load.kind === "loading" ? <span>opening…</span> : null}
          {load.kind === "editing" && waiting(load.session) > 0 ? <span>saving…</span> : null}
          {connection.kind === "open" ? null : <span>{connection.kind === "connecting" ? "connecting…" : "disconnected"}</span>}
        </span>
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
      {listing === "shown" && issues.length > 0 ? (
        <ul key="problems" className={styles.problems}>
          {issues.map((issue) => (
            <li>{issue}</li>
          ))}
        </ul>
      ) : null}
      <div key="dock" ref={dock} className={styles.dock} />
      <div key="host" ref={host} className={styles.host} />
    </main>
  );
}
