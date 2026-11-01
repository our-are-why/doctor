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

// past this many characters a rewrite is taken as one replacement, from the
// first difference to the last
const diffLimit = 4000;

// The fewest insertions and deletions that take before to after (Myers'
// algorithm, over code points), as the replacements they make, in order.
export function differences(before: string, after: string): Array<_Difference_Text_> {
  const outer = difference(before, after);
  const old = Array.from(before).slice(outer.start, outer.end);
  const next = Array.from(outer.inserted);
  if (old.length === 0 && next.length === 0) return [];
  if (old.length + next.length > diffLimit) return [outer];
  const max = old.length + next.length;
  const furthest: Array<number> = new Array(2 * max + 2).fill(0);
  const trace: Array<Array<number>> = [];
  let steps = 0;
  search: for (; steps <= max; steps += 1) {
    trace.push([...furthest]);
    for (let diagonal = -steps; diagonal <= steps; diagonal += 2) {
      const down = diagonal === -steps || (diagonal !== steps && (furthest[max + diagonal - 1] ?? 0) < (furthest[max + diagonal + 1] ?? 0));
      let x = down ? (furthest[max + diagonal + 1] ?? 0) : (furthest[max + diagonal - 1] ?? 0) + 1;
      let y = x - diagonal;
      while (x < old.length && y < next.length && old[x] === next[y]) {
        x += 1;
        y += 1;
      }
      furthest[max + diagonal] = x;
      if (x >= old.length && y >= next.length) break search;
    }
  }
  // walked back from the end, each step keeps, deletes or inserts one
  // character; a run of deletions and insertions is one replacement
  const path: Array<"keep" | "delete" | "insert"> = [];
  let x = old.length;
  let y = next.length;
  for (let step = steps; step > 0; step -= 1) {
    const at = trace[step] ?? [];
    const diagonal = x - y;
    const down = diagonal === -step || (diagonal !== step && (at[max + diagonal - 1] ?? 0) < (at[max + diagonal + 1] ?? 0));
    const previous = down ? diagonal + 1 : diagonal - 1;
    const fromX = at[max + previous] ?? 0;
    const fromY = fromX - previous;
    while (x > fromX && y > fromY) {
      path.push("keep");
      x -= 1;
      y -= 1;
    }
    path.push(down ? "insert" : "delete");
    if (down) y -= 1;
    else x -= 1;
  }
  while (x > 0 && y > 0) {
    path.push("keep");
    x -= 1;
    y -= 1;
  }
  const replacements: Array<_Difference_Text_> = [];
  let inOld = outer.start;
  let inNext = 0;
  let last: "keep" | "change" = "keep";
  for (const step of path.reverse()) {
    if (step === "keep") {
      inOld += 1;
      inNext += 1;
      last = "keep";
      continue;
    }
    if (last === "keep") replacements.push({ start: inOld, end: inOld, inserted: "" });
    last = "change";
    const current = replacements.at(-1);
    if (current === undefined) continue;
    if (step === "delete") {
      current.end += 1;
      inOld += 1;
    } else {
      current.inserted += next[inNext] ?? "";
      inNext += 1;
    }
  }
  return replacements;
}

// the text with new characters, its overlay carried across each replacement,
// the last first so the earlier ones' offsets still hold
export function rewrite(
  text: _Text_Doctor_,
  characters: string,
): { text: _Text_Doctor_; changes: Array<_Difference_Text_> } {
  const changes = differences(text.text, characters);
  const rewritten = changes.toReversed().reduce((each, change) => replaceRange(each, change.start, change.end, change.inserted), text);
  return { text: rewritten, changes };
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

// Links [start, end) to the target, or unlinks it when there's none; a link
// already over any of it is cut back to what lies outside.
export function relink(
  text: _Text_Doctor_,
  start: number,
  end: number,
  targets: Array<_Target_Link_>,
): _Text_Doctor_ {
  if (end <= start) return text;
  const kept = text.overlay.flatMap((mark) =>
    mark.kind !== "link" || mark.to <= start || mark.from >= end
      ? [mark]
      : [withRange(mark, mark.from, Math.min(mark.to, start)), withRange(mark, Math.max(mark.from, end), mark.to)],
  );
  const added = targets.map((target): _LINK_Mark__Text_ => ({ kind: "link", target, from: offset(start), to: offset(end) }));
  return { ...text, overlay: settle([...kept, ...added]) };
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

// a stretch of characters under one set of marks
export interface _Segment_Text_ {
  from: number;
  to: number;
  contrast: Array<_Contrast_Mark_>;
  links: Array<_LINK_Mark__Text_>;
}

// the text cut wherever a mark starts or ends
export function segmentsOf(text: _Text_Doctor_): Array<_Segment_Text_> {
  const length = lengthOf(text.text);
  const cuts = [...new Set([0, length, ...text.overlay.flatMap((mark) => [mark.from, mark.to])])]
    .filter((cut) => cut <= length)
    .toSorted((first, second) => first - second);
  return cuts.slice(1).map((to, index) => {
    const from = cuts[index] ?? 0;
    const covers = (mark: _Mark_Text_) => mark.from <= from && mark.to >= to;
    return {
      from,
      to,
      contrast: contrastOrder.filter((contrast) => text.overlay.some((mark) => isContrast(contrast)(mark) && covers(mark))),
      links: text.overlay.filter((mark): mark is _LINK_Mark__Text_ => isLink(mark) && covers(mark)),
    };
  });
}
