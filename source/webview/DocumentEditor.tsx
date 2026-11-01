import type { _DOCUMENT_Config__Webview_ } from "../shared/protocol.ts";
import { ConnectionStatus } from "./ConnectionStatus.tsx";
import { DocumentView } from "./DocumentView.tsx";
import styles from "./styles/Shell.module.css";
import { useSession } from "./useSession.ts";

// the reading view: the document rendered, kept current as it changes
export function DocumentEditor({ config }: { config: _DOCUMENT_Config__Webview_ }) {
  const { load, connection } = useSession(config.file, config.endpoint, config.token);
  return (
    <main className={styles.shell}>
      {load.kind === "editing" ? <DocumentView document={load.document} /> : null}
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
      </footer>
    </main>
  );
}
