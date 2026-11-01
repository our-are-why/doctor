import type {
  _CONTRAST_Mark__Text_,
  _Contrast_Mark_,
  _Document_Doctor_,
  _LINK_Mark__Text_,
  _Mark_Text_,
  _Text_Doctor_,
} from "./domain.next.ts";
import { indexNodes, nodesWithin, textOfNode } from "./tree.ts";

export const contrastOrder: ReadonlyArray<_Contrast_Mark_> = ["bold", "italic", "monospace", "highlighted", "struck"];

const byStart = (first: _Mark_Text_, second: _Mark_Text_) => first.from - second.from;
const span = (mark: _Mark_Text_) => `${mark.from}–${mark.to}`;

// A range lies inside its text and isn't empty; one contrast's ranges don't
// overlap or touch, so each stretch is written once; links don't overlap.
export function overlayIssues(text: _Text_Doctor_): Array<string> {
  const length = Array.from(text.text).length;
  const issues: Array<string> = [];
  for (const mark of text.overlay) {
    if (mark.to <= mark.from) issues.push(`the range ${span(mark)} is empty`);
    if (mark.to > length) issues.push(`the range ${span(mark)} runs past the text's ${length} characters`);
  }
  for (const contrast of contrastOrder) {
    const ranges = text.overlay
      .filter((mark): mark is _CONTRAST_Mark__Text_ => mark.kind === "contrast" && mark.contrast === contrast)
      .toSorted(byStart);
    ranges.forEach((range, index) => {
      const previous = ranges[index - 1];
      if (previous !== undefined && range.from <= previous.to) {
        issues.push(`${contrast} ranges ${span(previous)} and ${span(range)} overlap or touch`);
      }
    });
  }
  const links = text.overlay.filter((mark): mark is _LINK_Mark__Text_ => mark.kind === "link").toSorted(byStart);
  links.forEach((link, index) => {
    const previous = links[index - 1];
    if (previous !== undefined && link.from < previous.to) {
      issues.push(`links ${span(previous)} and ${span(link)} overlap`);
    }
  });
  return issues;
}

// what relates the parts of a document: unique ids, valid overlays, and
// notes on nodes that are there
export function documentIssues(document: _Document_Doctor_): Array<string> {
  const issues: Array<string> = [];
  const nodes = document.content.children.flatMap(nodesWithin);
  const seen = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.id)) issues.push(`node ${node.id} appears more than once`);
    seen.add(node.id);
  }
  const texts = [
    { label: "the title", text: document.content.title },
    ...nodes.flatMap((node) => textOfNode(node).map((text) => ({ label: `node ${node.id}`, text }))),
    ...document.notes.map((note) => ({ label: `note ${note.id}`, text: note.body })),
  ];
  for (const { label, text } of texts) {
    for (const issue of overlayIssues(text)) issues.push(`${label}: ${issue}`);
  }
  const index = indexNodes(document.content);
  const notes = new Set<string>();
  for (const note of document.notes) {
    if (notes.has(note.id)) issues.push(`note ${note.id} appears more than once`);
    notes.add(note.id);
    if (note.kind !== "node" && note.kind !== "passage") continue;
    const entry = index.get(note.node);
    if (entry === undefined) {
      issues.push(`note ${note.id} is on node ${note.node}, which isn't in the document`);
      continue;
    }
    if (note.kind !== "passage") continue;
    const [text] = textOfNode(entry.node);
    if (text === undefined) {
      issues.push(`note ${note.id} is on a passage of node ${note.node}, which holds no text`);
    } else if (note.range.to <= note.range.from || note.range.to > Array.from(text.text).length) {
      issues.push(`note ${note.id}'s range ${note.range.from}–${note.range.to} isn't a passage of its node's text`);
    }
  }
  return issues;
}
