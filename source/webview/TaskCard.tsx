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

// A task's overview, shown while the bar's task is hovered: where it is,
// what's asked, what the agent said on handing it over, its proposals, and
// when it started and finished.
export function TaskCard({
  status,
  left,
  top,
  onEnter,
  onLeave,
}: {
  status: _Task_Status_;
  left: number;
  top: number;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const proposals = describeProposals(status.proposals);
  const finished = status.state === "completed" ? "Completed" : "Canceled";
  return (
    <div className={styles.card} style={{ left: `${left}px`, top: `${top}px` }} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <div className={styles.head}>
        <span className={styles.id}>{status.task}</span>
        <span className={styles.state}>{describeState(status)}</span>
      </div>
      <p className={styles.heading}>{status.requests.length === 1 ? "Request" : `${status.requests.length} requests`}</p>
      <ul className={styles.requests}>
        {status.requests.map((request, index) => (
          <li key={index}>
            {request.text}
            <span className={styles.aim}>
              {" "}
              · {request.targets.length === 0 ? "every document" : request.targets.join(", ")}
            </span>
          </li>
        ))}
      </ul>
      {status.note === "" ? null : (
        <>
          <p className={styles.heading}>The agent's note</p>
          <p className={styles.note}>{status.note}</p>
        </>
      )}
      <dl className={styles.facts}>
        <dt>Proposals</dt>
        <dd>
          {proposals.length > 0
            ? proposals.join(", ")
            : status.state === "completed"
              ? "none: nothing needed changing"
              : "none yet"}
        </dd>
        <dt>Started</dt>
        <dd>{ago(status.started)}</dd>
        {status.finished.map((stamp) => (
          <>
            <dt>{stamp.by === "agent" ? "Handed back" : finished}</dt>
            <dd>{ago(stamp.at)}</dd>
          </>
        ))}
        {status.reason === "" ? null : (
          <>
            <dt>Why</dt>
            <dd>{status.reason}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
