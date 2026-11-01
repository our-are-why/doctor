import { render, type ComponentChild } from "preact";
import type { _Config_Webview_ } from "../shared/protocol.ts";
import { readConfig } from "./config.ts";
import styles from "./styles/Shell.module.css";

// renders a webview's app into #root, or why it couldn't start
export function mount(renderApp: (config: _Config_Webview_) => ComponentChild): void {
  const root = document.getElementById("root");
  if (!root) throw new Error("the webview's page has no #root element");
  const result = readConfig();
  render(
    result.kind === "parsed" ? (
      renderApp(result.value)
    ) : (
      <main className={styles.shell}>
        <h1 className={styles.heading}>doctor couldn't start this view</h1>
        {result.issues.map((issue) => (
          <p className={styles.detail}>{issue}</p>
        ))}
      </main>
    ),
    root,
  );
}
