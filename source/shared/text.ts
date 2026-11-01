import type {
  _CONTRAST_Mark__Text_,
  _Contrast_Mark_,
  _LINK_Mark__Text_,
  _Mark_Text_,
  _Range_Text_,
  _Target_Link_,
  _Text_Doctor_,
} from "./domain.next.ts";
import { contrastOrder } from "./invariants.ts";
import { parseOwn } from "./parse.ts";
import { offsetSchema } from "./schema.ts";

// what replaced what: [start, end) of the old characters became inserted
export interface _Difference_Text_ {
  start: number;
  end: number;
  inserted: string;
}

const offset = (value: number) => parseOwn(offsetSchema, value);

export const lengthOf = (characters: string) => Array.from(characters).length;

export const sliceOf = (characters: string, from: number, to: number) =>
  Array.from(characters).slice(from, to).join("");

const withRange = (mark: _Mark_Text_, from: number, to: number): _Mark_Text_ => ({
  ...mark,
  from: offset(from),
  to: offset(Math.max(from, to)),
});

const isLink = (mark: _Mark_Text_): mark is _LINK_Mark__Text_ => mark.kind === "link";
const isContrast = (contrast: _Contrast_Mark_) => (mark: _Mark_Text_): mark is _CONTRAST_Mark__Text_ =>
  mark.kind === "contrast" && mark.contrast === contrast;

// drops empty ranges and joins a contrast's ranges that overlap or touch,
// so that what an operation makes is valid as it stands, in reading order
function settle(marks: ReadonlyArray<_Mark_Text_>): Array<_Mark_Text_> {
  const present = marks.filter((mark) => mark.to > mark.from);
  const contrasts = contrastOrder.flatMap((contrast) => {
    const joined: Array<_CONTRAST_Mark__Text_> = [];
    for (const mark of present.filter(isContrast(contrast)).toSorted((a, b) => a.from - b.from)) {
      const last = joined.at(-1);
      if (last !== undefined && mark.from <= last.to) {
        joined[joined.length - 1] = { ...last, to: offset(Math.max(last.to, mark.to)) };
      } else {
        joined.push(mark);
      }
    }
    return joined;
  });
  return [...contrasts, ...present.filter(isLink)].toSorted((a, b) => a.from - b.from || a.to - b.to);
}

// where a range lands once the difference is made; one that gains reaches
// over the inserted characters
function carried(from: number, to: number, change: _Difference_Text_, gains: boolean): [number, number] {
  const { start, end } = change;
  const added = lengthOf(change.inserted);
  const shift = added - (end - start);
  return [
    from < start ? from : gains ? start : Math.max(from, end) + shift,
    to > end ? to + shift : gains ? start + added : Math.min(to, start),
  ];
}

const inside = (from: number, to: number, change: _Difference_Text_) =>
  change.inserted !== "" && from < change.start && to > change.end;

// A contrast reaches over what's inserted right after it, or, at the very
// start, right before it; a link only over what's inserted inside it.
function gainsContrast(from: number, to: number, change: _Difference_Text_): boolean {
  if (change.inserted === "") return false;
  return change.start > 0 ? from < change.start && to >= change.start : from <= change.end && to > change.end;
}

export function replaceRange(text: _Text_Doctor_, start: number, end: number, inserted: string): _Text_Doctor_ {
  const change = { start, end, inserted };
  const characters = Array.from(text.text);
  const overlay = text.overlay.map((mark) => {
    const gains = mark.kind === "contrast" ? gainsContrast(mark.from, mark.to, change) : inside(mark.from, mark.to, change);
    return withRange(mark, ...carried(mark.from, mark.to, change, gains));
  });
  return {
    text: [...characters.slice(0, start), inserted, ...characters.slice(end)].join(""),
    overlay: settle(overlay),
  };
}

// a passage's range: it grows only with what's inserted inside it, and is
// empty once all of its characters are gone
export function carryRange(range: _Range_Text_, change: _Difference_Text_): _Range_Text_ {
  const [from, to] = carried(range.from, range.to, change, inside(range.from, range.to, change));
  return { from: offset(from), to: offset(Math.max(from, to)) };
}

export function difference(before: string, after: string): _Difference_Text_ {
  const old = Array.from(before);
  const next = Array.from(after);
  let prefix = 0;
  while (prefix < old.length && prefix < next.length && old[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < old.length - prefix &&
    suffix < next.length - prefix &&
    old[old.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return { start: prefix, end: old.length - suffix, inserted: next.slice(prefix, next.length - suffix).join("") };
}

// the text with new characters, its overlay carried across the difference
export function rewrite(text: _Text_Doctor_, characters: string): { text: _Text_Doctor_; change: _Difference_Text_ } {
  const change = difference(text.text, characters);
  return { text: replaceRange(text, change.start, change.end, change.inserted), change };
}

export function splitText(text: _Text_Doctor_, at: number): [_Text_Doctor_, _Text_Doctor_] {
  const characters = Array.from(text.text);
  return [
    {
      text: characters.slice(0, at).join(""),
      overlay: settle(text.overlay.map((mark) => withRange(mark, Math.min(mark.from, at), Math.min(mark.to, at)))),
    },
    {
      text: characters.slice(at).join(""),
      overlay: settle(
        text.overlay.map((mark) => withRange(mark, Math.max(mark.from, at) - at, Math.max(mark.to, at) - at)),
      ),
    },
  ];
}

export function concatText(first: _Text_Doctor_, second: _Text_Doctor_): _Text_Doctor_ {
  const shift = lengthOf(first.text);
  return {
    text: first.text + second.text,
    overlay: settle([...first.overlay, ...second.overlay.map((mark) => withRange(mark, mark.from + shift, mark.to + shift))]),
  };
}

// Adds the contrast over [start, end), or removes it if all of that already
// has it.
export function toggleContrast(
  text: _Text_Doctor_,
  start: number,
  end: number,
  contrast: _Contrast_Mark_,
): _Text_Doctor_ {
  if (end <= start) return text;
  const own = isContrast(contrast);
  const covered = text.overlay.some((mark) => own(mark) && mark.from <= start && mark.to >= end);
  if (!covered) {
    const added: _CONTRAST_Mark__Text_ = { kind: "contrast", contrast, from: offset(start), to: offset(end) };
    return { ...text, overlay: settle([...text.overlay, added]) };
  }
  return {
    ...text,
    overlay: settle(
      text.overlay.flatMap((mark) =>
        own(mark)
          ? [withRange(mark, mark.from, Math.min(mark.to, start)), withRange(mark, Math.max(mark.from, end), mark.to)]
          : [mark],
      ),
    ),
  };
}

function sameTarget(first: _Target_Link_, second: _Target_Link_): boolean {
  switch (first.kind) {
    case "external":
      return second.kind === "external" && second.url === first.url;
    case "document":
      return second.kind === "document" && second.document === first.document;
    case "node":
      return second.kind === "node" && second.document === first.document && second.node === first.node;
  }
}

function sameMark(first: _Mark_Text_, second: _Mark_Text_): boolean {
  if (first.from !== second.from || first.to !== second.to) return false;
  if (first.kind === "contrast") return second.kind === "contrast" && second.contrast === first.contrast;
  return second.kind === "link" && sameTarget(first.target, second.target);
}

// an overlay is a set of marks, so it's compared as one
export function sameOverlay(first: ReadonlyArray<_Mark_Text_>, second: ReadonlyArray<_Mark_Text_>): boolean {
  return (
    first.length === second.length &&
    first.every((mark) => second.some((other) => sameMark(mark, other))) &&
    second.every((mark) => first.some((other) => sameMark(mark, other)))
  );
}
