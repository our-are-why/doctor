import { useEffect, useState } from "preact/hooks";
import { latestBrief, nameOf } from "../shared/brief.ts";
import type { _Id_Document_, _Target_Request_, _Task_Doctor_ } from "../shared/domain.next.ts";
import type { _DASHBOARD_Config__Webview_, _Focus_Drafting_, _Listed_Document_ } from "../shared/protocol.ts";
import { ConnectionStatus } from "./ConnectionStatus.tsx";
import styles from "./styles/Dashboard.module.css";
import shell from "./styles/Shell.module.css";
import { useSocket } from "./useSocket.ts";

function proposalsOf(task: _Task_Doctor_): string {
  if (task.state === "draft" || task.proposals.length === 0) return "no proposals";
  const counts = new Map<string, number>();
  for (const proposal of task.proposals) counts.set(proposal.state, (counts.get(proposal.state) ?? 0) + 1);
  return [...counts].map(([state, count]) => `${count} ${state}`).join(", ");
}

// where a task's requests reach: anywhere when one has no targets, else by
// document, all of one or some places in it
function reachOf(task: _Task_Doctor_, documents: Array<_Listed_Document_>): string {
  const { requests } = latestBrief(task);
  if (requests.some((request) => request.targets.length === 0)) return "anywhere in the project";
  const byDocument = new Map<_Id_Document_, Array<_Target_Request_>>();
  for (const target of requests.flatMap((request) => request.targets)) {
    byDocument.set(target.document, [...(byDocument.get(target.document) ?? []), target]);
  }
  return [...byDocument]
    .map(([document, targets]) => {
      const title = documents.find((listed) => listed.document === document)?.title ?? document;
      if (targets.some((target) => target.kind === "document")) return `all of ${title}`;
      return targets.length === 1 ? `a place in ${title}` : `${targets.length} places in ${title}`;
    })
    .join(", ");
}

// where one request applies
function whereOf(targets: Array<_Target_Request_>, documents: Array<_Listed_Document_>): string {
  if (targets.length === 0) return "anywhere";
  const titles = [...new Set(targets.map((target) => documents.find((listed) => listed.document === target.document)?.title ?? target.document))];
  const whole = targets.every((target) => target.kind === "document");
  return `${whole ? "all of" : targets.length === 1 ? "a place in" : `${targets.length} places in`} ${titles.join(", ")}`;
}

const requestsOf = (task: _Task_Doctor_) => {
  const { requests } = latestBrief(task);
  return requests.length === 1 ? "" : ` · ${requests.length} requests`;
};

// The tasks, newest first: the one being worked on, and the others to come
// back to. A request made here has no targets, so it reaches the whole
// project unless its words say otherwise: a quick task, or added to the
// task being drafted.
export function Dashboard({ config }: { config: _DASHBOARD_Config__Webview_ }) {
  const [tasks, setTasks] = useState<Array<_Task_Doctor_>>([]);
  const [documents, setDocuments] = useState<Array<_Listed_Document_>>([]);
  const [problems, setProblems] = useState<Array<string>>([]);
  const [drafting, setDrafting] = useState<Array<_Focus_Drafting_>>([]);
  const [making, setMaking] = useState<"closed" | "open">("closed");
  const [typed, setTyped] = useState("");
  const { connection, send } = useSocket(config.endpoint, config.token, (message) => {
    if (message.kind !== "tasks") return;
    setTasks(message.tasks);
    setDocuments(message.documents);
    setProblems(message.problems);
    setDrafting(message.drafting);
  });

  useEffect(() => {
    if (connection.kind === "open") send({ kind: "watch" });
  }, [connection.kind, send]);

  const makeTask = () => {
    const written = typed.trim();
    if (written === "") {
      setProblems(["say what the agent should do"]);
      return;
    }
    send(drafting.length > 0 ? { kind: "request", text: written, targets: [] } : { kind: "task", text: written, targets: [] });
    setTyped("");
    setMaking("closed");
  };

  return (
    <main className={shell.shell}>
      <div className={styles.line}>
        <h1 className={shell.heading}>tasks</h1>
        <span className={styles.instruction} />
        {making === "closed" ? (
          <button className={styles.button} type="button" onClick={() => setMaking("open")}>
            {drafting.length > 0 ? "Add a request…" : "Quick task…"}
          </button>
        ) : null}
        {drafting.length > 0 ? (
          <button className={styles.button} type="button" onClick={() => send({ kind: "unfocus" })}>
            Stop drafting
          </button>
        ) : (
          <button className={styles.button} type="button" onClick={() => send({ kind: "drafting" })}>
            Draft a task
          </button>
        )}
      </div>
      {drafting.some((focus) => focus.kind === "new") ? (
        <p className={shell.detail}>Drafting a task: make its first request in a document, or here.</p>
      ) : null}
      {making === "open" ? (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            makeTask();
          }}
        >
          <textarea
            className={styles.input}
            rows={2}
            placeholder="What should change? Like: fix the grammar in spike"
            value={typed}
            onInput={(event) => setTyped(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setMaking("closed");
              if (event.key !== "Enter" || event.shiftKey) return;
              event.preventDefault();
              makeTask();
            }}
          />
          <p className={styles.detail}>it reaches every document, unless its words say which</p>
          <div className={styles.line}>
            <span className={styles.instruction} />
            <button className={styles.button} type="button" onClick={() => setMaking("closed")}>
              Cancel
            </button>
            <button className={styles.primary} type="submit">
              {drafting.length > 0 ? "Add to draft" : "Start task"}
            </button>
          </div>
        </form>
      ) : null}
      {problems.map((problem) => (
        <p className={shell.problem}>{problem}</p>
      ))}
      {tasks.length === 0 ? (
        <p className={shell.detail}>
          No tasks yet: select something in a document and right-click "doctor: quick task" or "doctor: draft a task",
          use the bar above a document, or start one here.
        </p>
      ) : null}
      <ul className={styles.tasks}>
        {tasks.toReversed().map((task) => {
          const active = task.state === "working" || task.state === "reviewing";
          const drafted = task.state === "draft" && drafting.some((focus) => focus.kind === "draft" && focus.task === task.id);
          const open = active || task.state === "parked";
          return (
            <li key={task.id} className={active || drafted ? styles.active : styles.task}>
              <div className={styles.line}>
                <span className={styles.state}>{drafted ? "drafting" : task.state}</span>
                <span className={styles.instruction}>{nameOf(task)}</span>
                {active ? (
                  <button className={styles.button} type="button" onClick={() => send({ kind: "park", task: task.id })}>
                    Park
                  </button>
                ) : null}
                {task.state === "draft" ? (
                  <button
                    className={styles.button}
                    type="button"
                    onClick={() => send(drafted ? { kind: "unfocus" } : { kind: "focus", task: task.id })}
                  >
                    {drafted ? "Stop drafting" : "Continue drafting"}
                  </button>
                ) : null}
                {task.state === "draft" || task.state === "parked" ? (
                  <button className={styles.button} type="button" onClick={() => send({ kind: "activate", task: task.id })}>
                    {task.state === "draft" ? "Start" : "Make active"}
                  </button>
                ) : null}
                {task.state === "draft" ? (
                  <button className={styles.button} type="button" onClick={() => send({ kind: "discard", task: task.id })}>
                    Discard
                  </button>
                ) : null}
                {open ? (
                  <button className={styles.button} type="button" onClick={() => send({ kind: "complete", task: task.id })}>
                    Complete
                  </button>
                ) : null}
                {open ? (
                  <button className={styles.button} type="button" onClick={() => send({ kind: "cancel", task: task.id })}>
                    Cancel
                  </button>
                ) : null}
              </div>
              {task.state === "draft" ? (
                <ul className={styles.requests}>
                  {latestBrief(task).requests.map((request) => (
                    <li key={request.id} className={styles.request}>
                      <span className={styles.instruction}>{request.text.text}</span>
                      <span className={styles.detail}>{whereOf(request.targets, documents)}</span>
                      <button
                        className={styles.forget}
                        type="button"
                        title="Take this request out of the draft"
                        onClick={() => send({ kind: "forget", task: task.id, request: request.id })}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className={styles.detail}>
                {reachOf(task, documents)}
                {requestsOf(task)} · {proposalsOf(task)} · made {new Date(task.created.at).toLocaleString()} ·{" "}
                {task.id}
              </p>
            </li>
          );
        })}
      </ul>
      <ConnectionStatus connection={connection} />
    </main>
  );
}
