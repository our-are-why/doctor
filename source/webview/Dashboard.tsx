import { useEffect, useState } from "preact/hooks";
import type { _Task_Doctor_ } from "../shared/domain.next.ts";
import type { _DASHBOARD_Config__Webview_ } from "../shared/protocol.ts";
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

// the tasks, newest first: the one being worked on, and the others to come
// back to
export function Dashboard({ config }: { config: _DASHBOARD_Config__Webview_ }) {
  const [tasks, setTasks] = useState<Array<_Task_Doctor_>>([]);
  const [problems, setProblems] = useState<Array<string>>([]);
  const { connection, send } = useSocket(config.endpoint, config.token, (message) => {
    if (message.kind !== "tasks") return;
    setTasks(message.tasks);
    setProblems(message.problems);
  });

  useEffect(() => {
    if (connection.kind === "open") send({ kind: "watch" });
  }, [connection.kind, send]);

  return (
    <main className={shell.shell}>
      <h1 className={shell.heading}>tasks</h1>
      {problems.map((problem) => (
        <p className={shell.problem}>{problem}</p>
      ))}
      {tasks.length === 0 ? (
        <p className={shell.detail}>No tasks yet: select blocks in a document and run "doctor: new task".</p>
      ) : null}
      <ul className={styles.tasks}>
        {tasks.toReversed().map((task) => {
          const latest = task.brief.versions[task.brief.versions.length - 1] ?? task.brief.versions[0];
          const active = task.state === "working" || task.state === "reviewing";
          const resumable = task.state === "draft" || task.state === "parked";
          return (
            <li key={task.id} className={active ? styles.active : styles.task}>
              <div className={styles.line}>
                <span className={styles.state}>{task.state}</span>
                <span className={styles.instruction}>{latest.instruction.text}</span>
                {active ? (
                  <button className={styles.button} type="button" onClick={() => send({ kind: "park", task: task.id })}>
                    Park
                  </button>
                ) : null}
                {resumable ? (
                  <button className={styles.button} type="button" onClick={() => send({ kind: "activate", task: task.id })}>
                    Make active
                  </button>
                ) : null}
              </div>
              <p className={styles.detail}>
                {task.id} · {proposalsOf(task)} · made {new Date(task.created.at).toLocaleString()}
              </p>
            </li>
          );
        })}
      </ul>
      <ConnectionStatus connection={connection} />
    </main>
  );
}
