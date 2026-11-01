import type { _DOCUMENT_Config__Webview_ } from "../shared/protocol.ts";
import { ConnectionStatus } from "./ConnectionStatus.tsx";
import { DocumentView } from "./DocumentView.tsx";
import { EditingContext } from "./editing.ts";
import { waiting } from "./session.ts";
import styles from "./styles/Shell.module.css";
import { useEditing, type _Load_Editor_ } from "./useEditing.ts";

function describeSaving(load: _Load_Editor_): string {
  if (load.kind !== "editing") return "";
  return waiting(load.session) === 0 ? "saved" : "saving…";
}

export function DocumentEditor({ config }: { config: _DOCUMENT_Config__Webview_ }) {
  const { load, problems, connection, editing } = useEditing(config);
  return (
    <main className={styles.shell}>
      {problems.map((problem) => (
        <p className={styles.problem}>{problem}</p>
      ))}
      {load.kind === "editing" ? (
        <EditingContext.Provider value={editing}>
          <DocumentView document={load.document} />
        </EditingContext.Provider>
      ) : null}
      {load.kind === "unreadable" ? (
        <>
          <h1 className={styles.heading}>doctor can't read this document</h1>
          {load.issues.map((issue) => (
            <p className={styles.detail}>{issue}</p>
          ))}
        </>
      ) : null}
      {load.kind === "loading" ? <p className={styles.detail}>{config.file}</p> : null}
      <footer className={styles.status}>
        <ConnectionStatus connection={connection} />
        <p className={styles.detail}>{describeSaving(load)}</p>
      </footer>
    </main>
  );
}
