import { useEffect, useRef, useState } from "preact/hooks";
import type { _Document_Doctor_, _Id_Document_, _Id_Node_, _Target_Request_ } from "../shared/domain.next.ts";
import { sliceOf } from "../shared/text.ts";
import { indexNodes, textOfNode } from "../shared/tree.ts";
import type { _Proposals_Status_, _Task_Status_ } from "../shared/protocol.ts";
import styles from "./styles/TaskCard.module.css";

// how long ago an ISO time was, roughly
export function ago(time: string): string {
  const seconds = (Date.now() - Date.parse(time)) / 1000;
  if (!Number.isFinite(seconds)) return "";
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.max(Math.round(seconds / 60), 1)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return new Date(time).toLocaleDateString();
}

// where the task is, in words
function describeState(status: _Task_Status_): string {
  switch (status.state) {
    case "completed":
      return status.finished.some((stamp) => stamp.by === "agent") ? "handed back, nothing to review" : "completed";
    case "canceled":
      return "canceled";
    case "working":
    case "reviewing":
      if (status.turn === "human") return "waiting for your review";
      if (status.agent === "away") return "the agent's turn, and no agent's listening";
      if (status.agent === "waiting") return "the agent's turn, about to be taken";
      return status.state === "reviewing" ? "sent back, the agent's revising" : "the agent's working on it";
  }
}

// Where a request's aimed, in the document it's aimed at, without naming
// it: the whole of it, a block by its first words, or a passage by its own.
function aimIn(document: _Document_Doctor_, target: _Target_Request_): string {
  const quoted = (words: string) => {
    const trimmed = words.trim();
    const points = Array.from(trimmed);
    return `“${points.length > 40 ? `${points.slice(0, 40).join("").trimEnd()}…` : trimmed}”`;
  };
  if (target.kind === "document") return "the whole document";
  if (target.kind === "passage") {
    const [text] = target.holder.kind === "title" ? [document.content.title] : textOf(document, target.holder.node);
    return text === undefined ? "a passage" : quoted(sliceOf(text.text, target.range.from, target.range.to));
  }
  const node = indexNodes(document.content).get(target.node)?.node;
  if (node === undefined) return "a block that's gone";
  const [text] = textOfNode(node);
  if (node.kind === "section") return `the section ${quoted(node.heading.text)}`;
  if (node.kind === "code") return node.language.kind === "stated" ? `the ${node.language.name} code` : "a code block";
  if (node.kind === "list") return "a list";
  return text === undefined || text.text.trim() === "" ? `a ${node.kind === "listItem" ? "list item" : node.kind}` : quoted(text.text);
}

const textOf = (document: _Document_Doctor_, node: _Id_Node_) => {
  const found = indexNodes(document.content).get(node)?.node;
  return found === undefined ? [] : textOfNode(found);
};

// something that can be done from the card, what it does when hovered
export interface _Offer_Card_ {
  label: string;
  title: string;
  run: () => void;
  // one that opens something under it, as Amend does: whether that's open
  opens: Array<"open" | "closed">;
}

// a section's footer: what can be done to what it's about, under a label
// saying what that is, so each can say just what it does
function Footer({ label, offers }: { label: string; offers: Array<_Offer_Card_> }) {
  if (offers.length === 0) return null;
  return (
    <div className={styles.footer}>
      <p className={styles.heading}>{label}</p>
      <div className={styles.actions}>
        {offers.map((offer) => (
          <button
            className={styles.action}
            type="button"
            title={offer.title}
            aria-expanded={offer.opens.length === 0 ? undefined : offer.opens.includes("open") ? "true" : "false"}
            onClick={offer.run}
          >
            {offer.label}
            {offer.opens.map((how) => (
              <span className={how === "open" ? `${styles.opens} ${styles.opened}` : styles.opens}>{how === "open" ? "▴" : "▾"}</span>
            ))}
          </button>
        ))}
      </div>
    </div>
  );
}

// adding a request about the document to the task, from the card, and
// keeping the card put while it's being written
export interface _Compose_Card_ {
  add: (text: string) => void;
  pin: (how: "pinned" | "free") => void;
}

// The form for a request about the document, in the card, as every request
// form is: a purple bar beside it over a band of its own. Open, it pins the
// card; Enter adds the request, Escape or cancel puts it away, as does a
// click outside the card, unless something's written in it.
function Composer({
  task,
  compose,
  root,
  field,
  written,
  write,
  close,
}: {
  task: string;
  compose: _Compose_Card_;
  root: { current: HTMLDivElement | null };
  field: { current: HTMLTextAreaElement | null };
  written: string;
  write: (written: string) => void;
  close: (from: "inside" | "outside") => void;
}) {
  useEffect(() => {
    compose.pin("pinned");
    field.current?.focus();
  }, []);
  useEffect(() => {
    const outside = (event: MouseEvent) => {
      if (written.trim() !== "" || !(event.target instanceof Node) || root.current?.contains(event.target) === true) return;
      close("outside");
    };
    window.addEventListener("mousedown", outside);
    return () => window.removeEventListener("mousedown", outside);
  }, [written]);
  const add = () => {
    const text = written.trim();
    if (text === "") {
      field.current?.focus();
      return;
    }
    compose.add(text);
    write("");
    close("inside");
  };
  return (
    <div className={styles.composer}>
      <textarea
        ref={field}
        className={styles.composeInput}
        rows={2}
        placeholder="What should change in this document?"
        value={written}
        onInput={(event) => write(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") close("inside");
          if (event.key !== "Enter" || event.shiftKey) return;
          event.preventDefault();
          add();
        }}
      />
      <div className={styles.composeRow}>
        <span className={styles.composeHint}>added to {task}, for the agent to take up</span>
        <button className={styles.composeCancel} type="button" onClick={() => close("inside")}>
          cancel
        </button>
        <button className={styles.composeAdd} type="button" onClick={add}>
          add to task
        </button>
      </div>
    </div>
  );
}

// a figure under its label, what it is when hovered, if that's more
function Stat({ label, value, more }: { label: string; value: string; more: string }) {
  return (
    <div className={styles.stat} title={more}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.figure}>{value}</span>
    </div>
  );
}

// How far through its proposals a task, or a document, is: how many are
// resolved, accepted or rejected, of those still in play, each state's count when it's hovered; or,
// with none, what's to say of that.
function Progress({ label, proposals, none }: { label: string; proposals: _Proposals_Status_; none: string }) {
  const decided = proposals.accepted + proposals.rejected;
  const total = decided + proposals.proposed + proposals.revising;
  return <Stat label={label} value={total === 0 ? none : `${decided} of ${total} resolved`} more={describeProposals(proposals).join(", ")} />;
}

// the proposals by state, the empty ones left out
export function describeProposals(proposals: _Proposals_Status_): Array<string> {
  const counts: Array<[number, string]> = [
    [proposals.proposed, "to review"],
    [proposals.revising, "sent back"],
    [proposals.accepted, "accepted"],
    [proposals.rejected, "rejected"],
    [proposals.withdrawn, "withdrawn"],
  ];
  return counts.filter(([count]) => count > 0).map(([count, what]) => `${count} ${what}`);
}

// A task's overview, shown while the bar's task is hovered, in two parts:
// the task in brief, where it is, where the agent says it stands, in a line,
// its proposals and when it started and finished; then, apart, the document
// it's shown over in full, what the agent says the task does there, the
// proposals there, and, folded, the requests aimed at it. What's asked of
// the task as a whole is the task's own view's to show. One the agent never
// summarized says what it's called instead.
export function TaskCard({
  status,
  document,
  actions,
  compose,
  left,
  top,
  onEnter,
  onLeave,
}: {
  status: _Task_Status_;
  // the document it's shown over, if any, and its proposals
  document: Array<{ id: _Id_Document_; content: _Document_Doctor_; proposals: _Proposals_Status_ }>;
  // while it's active, what can be done to the task, and to the document,
  // and a request about the document added to it, written here
  actions: { task: Array<_Offer_Card_>; document: Array<_Offer_Card_> };
  compose: Array<_Compose_Card_>;
  left: number;
  top: number;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const finished = status.state === "completed" ? "completed" : "canceled";
  const root = useRef<HTMLDivElement>(null);
  const [composing, setComposing] = useState<"closed" | "open">("closed");
  const [written, write] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  // The form put away. From a click outside, the card goes now. From inside,
  // the card's shorter, and may have gone from under the pointer, which the
  // browser takes for the pointer leaving it, so it stays pinned while the
  // pointer's anywhere it was, free again once the pointer's on the card, or
  // gone once it's off both.
  const watching = useRef<Array<(event: MouseEvent) => void>>([]);
  const unwatch = () => {
    for (const watch of watching.current) window.removeEventListener("mousemove", watch);
    watching.current = [];
  };
  useEffect(() => unwatch, []);
  const closeComposer = (from: "inside" | "outside") => {
    const was = root.current?.getBoundingClientRect();
    setComposing("closed");
    write("");
    if (from === "outside" || was === undefined) {
      for (const each of compose) each.pin("free");
      if (from === "outside") onLeave();
      return;
    }
    const over = (box: DOMRect | undefined, event: MouseEvent) =>
      box !== undefined && event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
    const watch = (event: MouseEvent) => {
      const onCard = over(root.current?.getBoundingClientRect(), event);
      if (!onCard && over(was, event)) return;
      unwatch();
      for (const each of compose) each.pin("free");
      if (!onCard) onLeave();
    };
    unwatch();
    watching.current = [watch];
    window.addEventListener("mousemove", watch);
  };
  const active = status.state === "working" || status.state === "reviewing";
  const when = [
    { label: "started", value: ago(status.started) },
    ...status.finished.map((stamp) => ({ label: stamp.by === "agent" ? "handed back" : finished, value: ago(stamp.at) })),
  ];
  return (
    <div
      ref={root}
      className={composing === "open" ? `${styles.card} ${styles.composing}` : styles.card}
      style={{ left: `${left}px`, top: `${top}px` }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <section className={styles.part}>
        <div className={styles.head}>
          <span className={styles.id}>{status.task}</span>
          <span className={styles.state}>{describeState(status)}</span>
        </div>
        {/* where it stands in a line, the whole when hovered, or, said only
            in full, cut short */}
        {status.summary === "" ? (
          <>
            <p className={styles.heading}>task request</p>
            <p className={`${styles.summary} ${styles.named}`} title={status.name}>
              {status.name}
            </p>
          </>
        ) : (
          <>
            <p className={styles.heading}>task overview</p>
            <p className={styles.summary} title={status.summary}>
              {status.headline === "" ? status.summary : status.headline}
            </p>
          </>
        )}
        <div className={styles.stats}>
          <Progress
            label="task proposals"
            proposals={status.proposals}
            none={status.state === "completed" ? "none needed" : "none yet"}
          />
          {when.map((each) => (
            <Stat label={each.label} value={each.value} more="" />
          ))}
        </div>
        {status.reason === "" ? null : <p className={styles.facts}>why: {status.reason}</p>}
        <Footer label="task actions" offers={actions.task} />
      </section>
      {document.map((shown) => {
        const said = status.summaries.filter((each) => each.document === shown.id).map((each) => each.summary);
        const here = describeProposals(shown.proposals);
        const asked = status.requests.filter((request) => request.aimed.some((target) => target.document === shown.id));
        if (said.length === 0 && here.length === 0 && asked.length === 0 && !active) return null;
        return (
          <section className={styles.part}>
            <div className={styles.stats}>
              <Progress label="document proposals" proposals={shown.proposals} none="none" />
            </div>
            {/* what changes here, when the agent's said */}
            {said.length === 0 ? null : <p className={styles.heading}>document changes</p>}
            {said.map((summary) => (
              <p className={styles.note}>{summary}</p>
            ))}
            {asked.length === 0 ? null : (
              <details className={styles.asked}>
                <summary>document requests · {asked.length}</summary>
                <ul className={styles.requests}>
                  {asked.map((request, index) => {
                    // where in the document, when it's somewhere in it; the
                    // whole of it goes without saying here
                    const where = request.aimed
                      .filter((target) => target.document === shown.id && target.kind !== "document")
                      .map((target) => aimIn(shown.content, target));
                    // in progress, or addressed, by its proposals or with
                    // nothing to change
                    const progress =
                      request.progress === "in progress"
                        ? "in progress"
                        : request.proposals === 0
                          ? "addressed · nothing to change"
                          : `addressed · ${request.proposals} ${request.proposals === 1 ? "proposal" : "proposals"}`;
                    return (
                      <li key={index}>
                        {request.text}
                        {where.length === 0 ? null : <span className={styles.aim}> · {where.join(", ")}</span>}
                        <span className={styles.progress}> · {progress}</span>
                      </li>
                    );
                  })}
                </ul>
              </details>
            )}
            <Footer
              label="document actions"
              offers={[
                ...actions.document,
                // it stays, saying whether the form's open, and again, it
                // closes it, or goes to it if something's written there
                ...compose.map((): _Offer_Card_ => ({
                  label: "add a request",
                  title: "A request about this document, added to this task, written here",
                  run: () => {
                    if (composing === "closed") setComposing("open");
                    else if (written.trim() !== "") field.current?.focus();
                    else closeComposer("inside");
                  },
                  opens: [composing],
                })),
              ]}
            />
            {composing === "open"
              ? compose.map((each) => (
                  <Composer
                    task={status.task}
                    compose={each}
                    root={root}
                    field={field}
                    written={written}
                    write={write}
                    close={closeComposer}
                  />
                ))
              : null}
          </section>
        );
      })}
    </div>
  );
}
