import { useEffect, useRef, useState } from "preact/hooks";
import { mintId } from "../shared/id.ts";
import { parseProjection, readerFor, type _Read_Projection_ } from "../shared/projection.ts";
import type { _Task_Status_, _TEXT_Config__Webview_ } from "../shared/protocol.ts";
import { reconcile } from "../shared/reconcile.ts";
import { nodeIdSchema } from "../shared/schema.ts";
import { waiting } from "./session.ts";
import styles from "./styles/TextEditor.module.css";
import { describeProposals, TaskCard } from "./TaskCard.tsx";
import { createTextView, type _View_Text_ } from "./textView.ts";
import { useSession } from "./useSession.ts";

const mintNodeId = () => mintId(nodeIdSchema, crypto.getRandomValues(new Uint8Array(10)));

export function TextEditor({ config }: { config: _TEXT_Config__Webview_ }) {
  const session = useSession(config.file, config.endpoint, config.token);
  const host = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const [listing, setListing] = useState<"hidden" | "shown">("hidden");
  const [copied, setCopied] = useState<"idle" | "copied">("idle");
  // the task's card, while its item in the bar or the card itself is hovered,
  // put away a moment after the pointer leaves both
  const [card, setCard] = useState<Array<{ left: number; top: number }>>([]);
  const hiding = useRef<Array<number>>([]);
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

  // the task active now, which a quick task from the editor parks
  useEffect(() => {
    const [status] = session.status;
    const active = status !== undefined && (status.state === "working" || status.state === "reviewing") ? [status.task] : [];
    for (const view of views.current) view.active(active);
  }, [session.status]);

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
  const reviews = session.open.filter((each) => each.state === "proposed").length;
  const [task] = session.status;
  const [numbersLeft] = numbers;
  const copyPrompt = () => {
    session.copyPrompt();
    setCopied("copied");
    window.setTimeout(() => setCopied("idle"), 3000);
  };
  const keepCard = () => {
    for (const timer of hiding.current) window.clearTimeout(timer);
    hiding.current = [];
  };
  const hideCard = () => {
    keepCard();
    hiding.current = [window.setTimeout(() => setCard([]), 200)];
  };
  const showCard = (event: MouseEvent) => {
    keepCard();
    if (!(event.currentTarget instanceof HTMLElement)) return;
    const box = event.currentTarget.getBoundingClientRect();
    // its left edge under the left edge of the task's mark, where the item starts
    const mark = event.currentTarget.querySelector(`.${styles.taskMark}`);
    const left = mark === null ? box.left : mark.getBoundingClientRect().left;
    setCard([{ left: Math.max(Math.min(left, window.innerWidth - 448), 8), top: box.bottom + 6 }]);
  };
  const hover = { onMouseEnter: showCard, onMouseLeave: hideCard };
  // The task by its id, its overview a hover away, and before it a mark of
  // where it is, in a slot of its own width so the id stays put: a spinner
  // while an agent's on it, the id shimmering; a dot when it's waiting on
  // you; a dotted circle when it's the agent's turn and no agent's listening;
  // and once it's finished, until it's dismissed, a check when your review
  // finished it, an arrow back when the agent handed it back with nothing to
  // review, as nothing's been decided, or a cross when it was canceled.
  const markOf = (status: _Task_Status_) => {
    const mark = (symbol: string, className: string) => <span className={`${styles.taskMark} ${className}`}>{symbol}</span>;
    if (status.state === "canceled") return mark("✕", styles.stopped);
    if (status.state === "completed") {
      return status.finished.some((stamp) => stamp.by === "agent") ? mark("↩", styles.stopped) : mark("✓", styles.done);
    }
    if (status.turn === "human") return mark("●", styles.yours);
    if (status.agent === "away") return mark("◌", styles.away);
    return (
      <span className={styles.taskMark}>
        <span className={styles.spinner} />
      </span>
    );
  };
  const taskStatus = () => {
    if (task === undefined) return null;
    if (task.state === "completed" || task.state === "canceled") {
      const outcome = describeProposals({ ...task.proposals, proposed: 0, revising: 0 });
      return (
        <span className={styles.taskItem} {...hover}>
          {markOf(task)}
          <span className={styles.taskId}>{task.task}</span>
          <span>
            · {task.state === "canceled" ? "canceled" : outcome.length === 0 ? "nothing needed changing" : outcome.join(", ")}
          </span>
          <button
            className={styles.dismiss}
            type="button"
            title="Dismiss"
            onClick={() => {
              setCard([]);
              session.acknowledge(task.task);
            }}
          >
            ×
          </button>
        </span>
      );
    }
    // your turn: with proposals here, the id goes to the first of them, the
    // card saying how many; with none here, it says they're elsewhere
    if (task.turn === "human") {
      return reviews > 0 ? (
        <button
          className={`${styles.statusItem} ${styles.taskItem}`}
          type="button"
          onClick={() => {
            for (const view of views.current) view.revealProposals();
          }}
          {...hover}
        >
          {markOf(task)}
          <span className={styles.taskId}>{task.task}</span>
        </button>
      ) : (
        <span className={styles.taskItem} {...hover}>
          {markOf(task)}
          <span className={styles.taskId}>{task.task}</span>
          <span>· waiting on you</span>
        </span>
      );
    }
    if (task.agent === "away") {
      return (
        <button className={`${styles.statusItem} ${styles.taskItem}`} type="button" title="Copy what to tell your agent" onClick={copyPrompt} {...hover}>
          {markOf(task)}
          <span>{copied === "copied" ? "copied what to tell your agent" : `no agent listening · ${task.task}`}</span>
        </button>
      );
    }
    return (
      <span className={styles.taskItem} {...hover}>
        {markOf(task)}
        <span className={styles.shimmer}>{task.task}</span>
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
          {taskStatus()}
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
                {task !== undefined && (task.state === "working" || task.state === "reviewing") ? `Start task · parks ${task.task}` : "Start task"}
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
      {task === undefined
        ? null
        : card.map((place) => <TaskCard key="card" status={task} left={place.left} top={place.top} onEnter={keepCard} onLeave={hideCard} />)}
      <div key="dock" ref={dock} className={styles.dock} />
      <div key="host" ref={host} className={styles.host} />
    </main>
  );
}
