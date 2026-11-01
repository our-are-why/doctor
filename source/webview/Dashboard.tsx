import type { _DASHBOARD_Config__Webview_ } from "../shared/protocol.ts";
import { ConnectionStatus } from "./ConnectionStatus.tsx";
import styles from "./styles/Shell.module.css";
import { useSocket } from "./useSocket.ts";

export function Dashboard({ config }: { config: _DASHBOARD_Config__Webview_ }) {
  const { connection } = useSocket(config.endpoint, config.token, () => {});
  return (
    <main className={styles.shell}>
      <h1 className={styles.heading}>tasks</h1>
      <ConnectionStatus connection={connection} />
    </main>
  );
}
