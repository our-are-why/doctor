import * as monaco from "./monaco.ts";

// A stretch of an editor's lines edited apart from the rest, as a proposal's
// are while they're swapped in to be edited: it knows nothing of what the
// lines are, only where they are, what they took the place of, and when
// they're left.
export interface _Confined_Lines_ {
  // its lines now, as they've grown or shrunk with what's typed
  range: () => { from: number; to: number };
  // whether a selection stays inside it
  holds: (selection: monaco.ISelection) => "inside" | "outside";
  release: () => void;
}

export interface _Options_Confined_ {
  // what the stretch took the place of, drawn read-only in the gap above it,
  // and how many lines tall that is; none when it only adds
  replaced: Array<{ node: HTMLElement; lines: number }>;
  // its lines' mark in the margin
  marginClassName: string;
  // left: the caret gone outside it, where it went, or the editor's focus
  // gone; or Escape, to put it back as it was
  left: (how: "left" | "escaped", at: Array<monaco.IPosition>) => void;
}

// Its lines are one decoration, growing as it's typed at either edge, so
// Enter at its end or before its start stays in it; leaving is told once.
export function confineLines(
  editor: monaco.editor.IStandaloneCodeEditor,
  lines: { from: number; to: number },
  options: _Options_Confined_,
): _Confined_Lines_ {
  const model = editor.getModel();
  const stretch = editor.createDecorationsCollection(
    model === null
      ? []
      : [
          {
            range: new monaco.Range(lines.from, 1, lines.to, model.getLineMaxColumn(lines.to)),
            options: {
              isWholeLine: true,
              marginClassName: options.marginClassName,
              stickiness: monaco.editor.TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges,
            },
          },
        ],
  );
  const range = () => {
    const [found] = stretch.getRanges();
    return found === undefined ? lines : { from: found.startLineNumber, to: found.endLineNumber };
  };
  const holds = (selection: monaco.ISelection): "inside" | "outside" => {
    const { from, to } = range();
    const first = Math.min(selection.selectionStartLineNumber, selection.positionLineNumber);
    const last = Math.max(selection.selectionStartLineNumber, selection.positionLineNumber);
    return first >= from && last <= to ? "inside" : "outside";
  };
  let zones: Array<string> = [];
  editor.changeViewZones((accessor) => {
    zones = options.replaced.map((each) =>
      accessor.addZone({ afterLineNumber: lines.from - 1, heightInLines: each.lines, domNode: each.node, showInHiddenAreas: true }),
    );
  });
  let state: "held" | "left" = "held";
  const leave = (how: "left" | "escaped", at: Array<monaco.IPosition>) => {
    if (state === "left") return;
    state = "left";
    options.left(how, at);
  };
  const listening = [
    editor.onDidChangeCursorPosition((event) => {
      const { from, to } = range();
      if (event.position.lineNumber < from || event.position.lineNumber > to) leave("left", [event.position]);
    }),
    editor.onDidBlurEditorText(() => leave("left", [])),
    editor.onKeyDown((event) => {
      if (event.keyCode === monaco.KeyCode.Escape) {
        event.preventDefault();
        event.stopPropagation();
        leave("escaped", []);
        return;
      }
      // Backspace at its very start, or Delete at its very end, would join
      // a line outside it to it, so neither does
      const selection = editor.getSelection();
      const model = editor.getModel();
      if (selection === null || model === null || !selection.isEmpty()) return;
      const { from: first, to: last } = range();
      const atStart = selection.positionLineNumber === first && selection.positionColumn === 1;
      const atEnd = selection.positionLineNumber === last && selection.positionColumn === model.getLineMaxColumn(last);
      if ((event.keyCode === monaco.KeyCode.Backspace && atStart) || (event.keyCode === monaco.KeyCode.Delete && atEnd)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }),
  ];
  const release = () => {
    state = "left";
    for (const each of listening) each.dispose();
    stretch.clear();
    editor.changeViewZones((accessor) => {
      for (const zone of zones) accessor.removeZone(zone);
    });
    zones = [];
  };
  return { range, holds, release };
}
