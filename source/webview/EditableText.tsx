import { h } from "preact";
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { _Contrast_Mark_, _Text_Doctor_ } from "../shared/domain.next.ts";
import { lengthOf, replaceRange, toggleContrast } from "../shared/text.ts";
import { sameSpot, type _Spot_Editor_ } from "./actions.ts";
import { EditingContext } from "./editing.ts";
import styles from "./styles/Editable.module.css";
import { contrastClass, describeTarget, groupsOf, linkClass, type _Segment_Render_ } from "./TextView.tsx";

export type _Tag_Editable_ = "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "div";

type _Selection_Text_ = _INSIDE_Selection__Text_ | _OUTSIDE_Selection__Text_;

interface __BASE_Selection__Text_<__SelectionKind__ extends string> {
  kind: __SelectionKind__;
}

interface _INSIDE_Selection__Text_ extends __BASE_Selection__Text_<"inside"> {
  start: number;
  end: number;
}

interface _OUTSIDE_Selection__Text_ extends __BASE_Selection__Text_<"outside"> {}

type _Caret_Editable_ = _KEEP_Caret__Editable_ | _PLACE_Caret__Editable_;

interface __BASE_Caret__Editable_<__CaretKind__ extends string> {
  kind: __CaretKind__;
}

interface _KEEP_Caret__Editable_ extends __BASE_Caret__Editable_<"keep"> {}

interface _PLACE_Caret__Editable_ extends __BASE_Caret__Editable_<"place"> {
  start: number;
  end: number;
}

interface _Difference_Text_ {
  start: number;
  end: number;
  inserted: string;
}

const outside: _OUTSIDE_Selection__Text_ = { kind: "outside" };
const keep: _KEEP_Caret__Editable_ = { kind: "keep" };
const place = (start: number, end: number): _PLACE_Caret__Editable_ => ({ kind: "place", start, end });

function segmentElement(page: Document, segment: _Segment_Render_): HTMLElement {
  const span = page.createElement("span");
  span.className = contrastClass(segment);
  span.textContent = segment.text;
  return span;
}

function renderText(element: HTMLElement, text: _Text_Doctor_): void {
  const page = element.ownerDocument;
  element.replaceChildren(
    ...groupsOf(text).flatMap((group) => {
      const segments = group.segments.map((segment) => segmentElement(page, segment));
      if (group.kind === "plain") return segments;
      const link = page.createElement("span");
      link.className = linkClass;
      link.title = describeTarget(group.target);
      link.replaceChildren(...segments);
      return [link];
    }),
  );
}

// offsets here count code points, as the document's do; the DOM counts
// UTF-16 units, and is converted at these edges
function offsetWithin(root: HTMLElement, node: Node, offset: number): number {
  const range = root.ownerDocument.createRange();
  range.setStart(root, 0);
  range.setEnd(node, offset);
  return lengthOf(range.toString());
}

function readSelection(root: HTMLElement): _Selection_Text_ {
  const selection = root.ownerDocument.getSelection();
  if (selection === null || selection.rangeCount === 0) return outside;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return outside;
  return {
    kind: "inside",
    start: offsetWithin(root, range.startContainer, range.startOffset),
    end: offsetWithin(root, range.endContainer, range.endOffset),
  };
}

function pointAt(root: HTMLElement, offset: number): [Node, number] {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let last: [Node, number] = [root, 0];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const data = node.textContent ?? "";
    const length = lengthOf(data);
    if (remaining <= length) return [node, Array.from(data).slice(0, remaining).join("").length];
    remaining -= length;
    last = [node, data.length];
  }
  return last;
}

function placeSelection(root: HTMLElement, start: number, end: number): void {
  const selection = root.ownerDocument.getSelection();
  if (selection === null) return;
  const range = root.ownerDocument.createRange();
  range.setStart(...pointAt(root, start));
  range.setEnd(...pointAt(root, end));
  selection.removeAllRanges();
  selection.addRange(range);
}

// What changed from before to after, given that the edit ends at the caret:
// that's what tells typing "a" into "aa" at the start from typing it at the end.
function difference(before: string, after: string, caret: number): _Difference_Text_ {
  const old = Array.from(before);
  const next = Array.from(after);
  const tail = next.slice(caret);
  const fits = caret <= next.length && tail.length <= old.length;
  const matches = tail.every((character, index) => old[old.length - tail.length + index] === character);
  const suffix = fits && matches ? tail.length : 0;
  const limit = Math.min(old.length - suffix, next.length - suffix);
  let prefix = 0;
  while (prefix < limit && old[prefix] === next[prefix]) prefix += 1;
  return { start: prefix, end: old.length - suffix, inserted: next.slice(prefix, next.length - suffix).join("") };
}

function shortcutContrast(event: KeyboardEvent): Array<_Contrast_Mark_> {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return [];
  const key = event.key.toLowerCase();
  if (!event.shiftKey) return key === "b" ? ["bold"] : key === "i" ? ["italic"] : [];
  return key === "m" ? ["monospace"] : key === "h" ? ["highlighted"] : key === "x" ? ["struck"] : [];
}

const blockedInputs = ["insertParagraph", "insertLineBreak", "insertFromDrop", "deleteByDrag", "insertLink"];

interface _Props_EditableText_ {
  spot: _Spot_Editor_;
  text: _Text_Doctor_;
  tag: _Tag_Editable_;
  className: string;
  placeholder: string;
}

// The browser types into the element; each input is then read back as a
// change to the text, and the element rebuilt from the text, so whatever
// markup the browser made doesn't last.
export function EditableText({ spot, text, tag, className, placeholder }: _Props_EditableText_) {
  const editing = useContext(EditingContext);
  const ref = useRef<HTMLElement>(null);
  const latest = useRef({ spot, text, editing });
  latest.current = { spot, text, editing };
  const composing = useRef<"composing" | "idle">("idle");
  const caret = useRef<_Caret_Editable_>(keep);
  const [paint, setPaint] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || composing.current === "composing") return;
    const focused = element.ownerDocument.activeElement === element;
    const kept = focused ? readSelection(element) : outside;
    renderText(element, text);
    const wanted = caret.current;
    caret.current = keep;
    if (!focused) return;
    if (wanted.kind === "place") placeSelection(element, wanted.start, wanted.end);
    else if (kept.kind === "inside") placeSelection(element, kept.start, kept.end);
  }, [text, paint]);

  useLayoutEffect(() => {
    const element = ref.current;
    const { focus } = editing;
    if (element === null || focus.kind !== "at" || !sameSpot(focus.spot, spot)) return;
    element.focus();
    placeSelection(element, focus.offset, focus.offset);
  }, [editing.focus]);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;

    const commit = (next: _Text_Doctor_, wanted: _Caret_Editable_) => {
      caret.current = wanted;
      latest.current.editing.retext(latest.current.spot, next);
      setPaint((count) => count + 1);
    };

    const reconcile = () => {
      const before = latest.current.text.text;
      const after = (element.textContent ?? "").replaceAll(" ", " ");
      const selection = readSelection(element);
      const end = selection.kind === "inside" ? selection.end : lengthOf(after);
      if (before === after) {
        setPaint((count) => count + 1);
        return;
      }
      const change = difference(before, after, end);
      commit(replaceRange(latest.current.text, change.start, change.end, change.inserted), place(end, end));
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const { text, spot, editing } = latest.current;
      const [contrast] = shortcutContrast(event);
      if (contrast !== undefined) {
        event.preventDefault();
        event.stopPropagation();
        const selection = readSelection(element);
        if (selection.kind === "inside" && selection.end > selection.start) {
          commit(toggleContrast(text, selection.start, selection.end, contrast), place(selection.start, selection.end));
        }
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const selection = readSelection(element);
        if (event.shiftKey || selection.kind !== "inside") return;
        editing.split(spot, replaceRange(text, selection.start, selection.end, ""), selection.start);
        return;
      }
      if (event.key === "Backspace" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const selection = readSelection(element);
        if (selection.kind === "inside" && selection.start === 0 && selection.end === 0) {
          event.preventDefault();
          editing.backspace(spot);
        }
      }
    };

    const onBeforeInput = (event: InputEvent) => {
      const type = event.inputType;
      if (type.startsWith("format") || type.startsWith("history") || blockedInputs.includes(type)) {
        event.preventDefault();
      }
    };

    const onInput = () => {
      if (composing.current === "idle") reconcile();
    };

    const onPaste = (event: ClipboardEvent) => {
      event.preventDefault();
      const pasted = (event.clipboardData?.getData("text/plain") ?? "").replace(/\s*\r?\n\s*/g, " ");
      const selection = readSelection(element);
      if (selection.kind !== "inside") return;
      const at = selection.start + lengthOf(pasted);
      commit(replaceRange(latest.current.text, selection.start, selection.end, pasted), place(at, at));
    };

    const onDrop = (event: DragEvent) => event.preventDefault();
    const onCompositionStart = () => {
      composing.current = "composing";
    };
    const onCompositionEnd = () => {
      composing.current = "idle";
      reconcile();
    };
    const onBlur = () => latest.current.editing.leave();

    element.addEventListener("keydown", onKeyDown);
    element.addEventListener("beforeinput", onBeforeInput);
    element.addEventListener("input", onInput);
    element.addEventListener("paste", onPaste);
    element.addEventListener("drop", onDrop);
    element.addEventListener("compositionstart", onCompositionStart);
    element.addEventListener("compositionend", onCompositionEnd);
    element.addEventListener("blur", onBlur);
    return () => {
      element.removeEventListener("keydown", onKeyDown);
      element.removeEventListener("beforeinput", onBeforeInput);
      element.removeEventListener("input", onInput);
      element.removeEventListener("paste", onPaste);
      element.removeEventListener("drop", onDrop);
      element.removeEventListener("compositionstart", onCompositionStart);
      element.removeEventListener("compositionend", onCompositionEnd);
      element.removeEventListener("blur", onBlur);
    };
  }, []);

  return h(tag, {
    ref,
    className: `${styles.editable} ${className}`,
    contentEditable: true,
    spellcheck: true,
    "data-placeholder": placeholder,
  });
}
