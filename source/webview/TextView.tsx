import type { _LINK_Inline__Text_, _RUN_Inline__Text_, _Target_Link_, _Text_Doctor_ } from "../shared/domain.ts";
import styles from "./styles/Text.module.css";

function RunView({ run }: { run: _RUN_Inline__Text_ }) {
  return <span className={run.contrast.map((contrast) => styles[contrast]).join(" ")}>{run.text}</span>;
}

function describeTarget(target: _Target_Link_): string {
  switch (target.kind) {
    case "external":
      return target.url;
    case "document":
      return `document ${target.document}`;
    case "node":
      return `node ${target.node} in document ${target.document}`;
  }
}

function LinkView({ link }: { link: _LINK_Inline__Text_ }) {
  return (
    <span className={styles.link} title={describeTarget(link.target)}>
      {link.label.map((run, index) => (
        <RunView key={index} run={run} />
      ))}
    </span>
  );
}

export function TextView({ text }: { text: _Text_Doctor_ }) {
  return (
    <>
      {text.map((inline, index) =>
        inline.kind === "run" ? <RunView key={index} run={inline} /> : <LinkView key={index} link={inline} />,
      )}
    </>
  );
}
