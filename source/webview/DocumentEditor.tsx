import { useEffect, useState } from "preact/hooks";
import type { _Document_Doctor_ } from "../shared/domain.ts";
import type { _NonEmpty_ } from "../shared/list.ts";
import type { _DOCUMENT_Config__Webview_ } from "../shared/protocol.ts";
import { ConnectionStatus } from "./ConnectionStatus.tsx";
import { DocumentView } from "./DocumentView.tsx";
import styles from "./styles/Shell.module.css";
import { useSocket } from "./useSocket.ts";

type _Load_Editor_ = _LOADING_Load__Editor_ | _OPENED_Load__Editor_ | _UNREADABLE_Load__Editor_;

interface __BASE_Load__Editor_<__LoadKind__ extends string> {
  kind: __LoadKind__;
}

interface _LOADING_Load__Editor_ extends __BASE_Load__Editor_<"loading"> {}

interface _OPENED_Load__Editor_ extends __BASE_Load__Editor_<"opened"> {
  document: _Document_Doctor_;
}

interface _UNREADABLE_Load__Editor_ extends __BASE_Load__Editor_<"unreadable"> {
  issues: _NonEmpty_<string>;
}

export function DocumentEditor({ config }: { config: _DOCUMENT_Config__Webview_ }) {
  const [load, setLoad] = useState<_Load_Editor_>({ kind: "loading" });
  const { connection, send } = useSocket(config.endpoint, config.token, (message) => {
    if (message.kind === "opened" && message.file === config.file) {
      setLoad({ kind: "opened", document: message.document });
    }
    if (message.kind === "unreadable" && message.file === config.file) {
      setLoad({ kind: "unreadable", issues: message.issues });
    }
  });

  useEffect(() => {
    if (connection.kind === "open") send({ kind: "open", file: config.file });
  }, [connection.kind, config.file, send]);

  return (
    <main className={styles.shell}>
      {load.kind === "opened" ? <DocumentView document={load.document} /> : null}
      {load.kind === "unreadable" ? (
        <>
          <h1 className={styles.heading}>doctor can't read this document</h1>
          {load.issues.map((issue) => (
            <p className={styles.detail}>{issue}</p>
          ))}
        </>
      ) : null}
      {load.kind === "loading" ? <p className={styles.detail}>{config.file}</p> : null}
      <ConnectionStatus connection={connection} />
    </main>
  );
}
