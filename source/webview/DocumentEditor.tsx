import type { _DOCUMENT_Config__Webview_ } from "../shared/protocol.ts";
import { ConnectionStatus } from "./ConnectionStatus.tsx";
import styles from "./styles/Shell.module.css";
import { useConnection } from "./useConnection.ts";

export function DocumentEditor({ config }: { config: _DOCUMENT_Config__Webview_ }) {
  const connection = useConnection(config.endpoint, config.token);
  return (
    <main className={styles.shell}>
      <h1 className={styles.heading}>document</h1>
      <p className={styles.detail}>{config.file}</p>
      <ConnectionStatus connection={connection} />
    </main>
  );
}
