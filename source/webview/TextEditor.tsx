import { useEffect, useRef } from "preact/hooks";
import { mintId } from "../shared/id.ts";
import { parseProjection, readerFor, type _Read_Projection_ } from "../shared/projection.ts";
import type { _TEXT_Config__Webview_ } from "../shared/protocol.ts";
import { reconcile } from "../shared/reconcile.ts";
import { nodeIdSchema } from "../shared/schema.ts";
import { ConnectionStatus } from "./ConnectionStatus.tsx";
import { waiting } from "./session.ts";
import styles from "./styles/TextEditor.module.css";
import { createTextView, lastParagraph, type _View_Text_ } from "./textView.ts";
import { useSession } from "./useSession.ts";

const mintNodeId = () => mintId(nodeIdSchema, crypto.getRandomValues(new Uint8Array(10)));

const proposedText = "A quoted paragraph, which the agent would rather say more plainly.";

export function TextEditor({ config }: { config: _TEXT_Config__Webview_ }) {
  const session = useSession(config.file, config.endpoint, config.token);
  const host = useRef<HTMLDivElement>(null);
  const views = useRef<Array<_View_Text_>>([]);
  const proposed = useRef<"waiting" | "shown">("waiting");
  const latest = useRef(session);
  latest.current = session;

  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    const view = createTextView(element, {
      edited: (lines, owners) => {
        const read: Array<_Read_Projection_> = [];
        latest.current.perform((document) => {
          const parsed = parseProjection(lines, owners, readerFor(document, mintNodeId));
          view.mark(parsed.kind === "rejected" ? parsed.issues : []);
          if (parsed.kind === "rejected") return [];
          read.push(parsed.value);
          return reconcile(document, parsed.value.body, mintNodeId);
        }, "soon");
        for (const each of read) view.track(each.owners);
      },
      perform: (act) => latest.current.perform(act, "now"),
      leave: () => latest.current.leave(),
    });
    views.current = [view];
    return () => {
      view.dispose();
      views.current = [];
    };
  }, []);

  useEffect(() => {
    if (session.load.kind !== "editing") return;
    const { document } = session.load;
    for (const view of views.current) {
      view.show(document);
      if (proposed.current === "shown") continue;
      proposed.current = "shown";
      for (const node of lastParagraph(document)) view.propose(node, proposedText);
    }
  }, [session.arrivals]);

  useEffect(() => {
    if (session.load.kind !== "editing") return;
    for (const view of views.current) view.decorate(session.load.document);
  }, [session.load]);

  const { load, problems, connection } = session;
  return (
    <main className={styles.shell}>
      <div ref={host} className={styles.host} />
      <footer className={styles.footer}>
        <ConnectionStatus connection={connection} />
        <p>{load.kind === "editing" ? (waiting(load.session) === 0 ? "saved" : "saving…") : load.kind}</p>
        {load.kind === "unreadable" ? <p className={styles.problem}>{load.issues[0]}</p> : null}
        {problems.map((problem) => (
          <p className={styles.problem}>{problem}</p>
        ))}
      </footer>
    </main>
  );
}
