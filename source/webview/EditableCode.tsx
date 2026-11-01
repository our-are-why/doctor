import { useContext, useLayoutEffect, useRef } from "preact/hooks";
import type { _CODE_Block__Document_ } from "../shared/domain.next.ts";
import { sameSpot, type _Spot_Editor_ } from "./actions.ts";
import { EditingContext } from "./editing.ts";
import styles from "./styles/Editable.module.css";

export function EditableCode({ block }: { block: _CODE_Block__Document_ }) {
  const editing = useContext(EditingContext);
  const ref = useRef<HTMLTextAreaElement>(null);
  const spot: _Spot_Editor_ = { kind: "node", node: block.id };

  useLayoutEffect(() => {
    const element = ref.current;
    const { focus } = editing;
    if (element === null || focus.kind !== "at" || !sameSpot(focus.spot, spot)) return;
    element.focus();
    const units = Array.from(block.code).slice(0, focus.offset).join("").length;
    element.setSelectionRange(units, units);
  }, [editing.focus]);

  return (
    <textarea
      ref={ref}
      className={styles.code}
      value={block.code}
      rows={block.code.split("\n").length}
      spellcheck={false}
      onInput={(event) => editing.recode(block.id, event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Backspace" && event.currentTarget.value === "") {
          event.preventDefault();
          editing.backspace(spot);
        }
      }}
      onBlur={editing.leave}
    />
  );
}
