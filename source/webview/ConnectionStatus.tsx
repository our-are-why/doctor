import styles from "./styles/ConnectionStatus.module.css";
import type { _Connection_Webview_ } from "./useConnection.ts";

function describe(connection: _Connection_Webview_): string {
  switch (connection.kind) {
    case "connecting":
      return "connecting…";
    case "open":
      return `connected, as the ${connection.caller}`;
    case "closed":
      return "disconnected";
  }
}

export function ConnectionStatus({ connection }: { connection: _Connection_Webview_ }) {
  return <p className={styles[connection.kind]}>{describe(connection)}</p>;
}
