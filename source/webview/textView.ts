import { textOperations } from "../shared/apply.ts";
import type {
  _Block_Document_,
  _Contrast_Mark_,
  _Document_Doctor_,
  _Holder_Text_,
  _Id_Node_,
  _Id_Proposal_,
  _Id_Task_,
  _LINK_Mark__Text_,
  _Node_Document_,
  _Operation_Change_,
  _Parent_Position_,
  _Position_Operation_,
  _Text_Doctor_,
} from "../shared/domain.next.ts";
import { parseOwn } from "../shared/parse.ts";
import { contentStart, project, startsBlock } from "../shared/projection.ts";
import { realize } from "../shared/proposals.ts";
import type { _Open_Proposal_, _Verdict_Review_ } from "../shared/protocol.ts";
import { nodeIdSchema } from "../shared/schema.ts";
import { readTarget, writeTarget } from "../shared/target.ts";
import { lengthOf, relink, segmentsOf, toggleContrast, type _Segment_Text_ } from "../shared/text.ts";
import { indexNodes, nodesWithin, textOfNode } from "../shared/tree.ts";
import * as monaco from "./monaco.ts";
import "./styles/monaco.css";
import styles from "./styles/TextEditor.module.css";
import { describeTarget } from "./TextView.tsx";

export interface _Hooks_View_ {
  edited: (lines: Array<string>, owners: Array<Array<_Id_Node_>>) => void;
  perform: (act: (document: _Document_Doctor_) => Array<_Operation_Change_>) => void;
  leave: () => void;
  makeTask: (scope: Array<_Id_Node_>) => void;
  review: (task: _Id_Task_, proposal: _Id_Proposal_, verdict: _Verdict_Review_) => void;
}

export interface _View_Text_ {
  show: (document: _Document_Doctor_) => void;
  track: (owners: Array<Array<_Id_Node_>>) => void;
  decorate: (document: _Document_Doctor_) => void;
  mark: (issues: Array<string>) => void;
  proposals: (open: Array<_Open_Proposal_>) => void;
  dispose: () => void;
}

// positions in a line's content: the document counts code points, Monaco
// counts UTF-16 units
const unitsOf = (characters: string, points: number) => Array.from(characters).slice(0, points).join("").length;
const pointsOf = (characters: string, units: number) => lengthOf(characters.slice(0, units));

const colorPairs: Array<[string, string]> = [
  ["editor.background", "editor-background"],
  ["editor.foreground", "editor-foreground"],
  ["editorLineNumber.foreground", "editorLineNumber-foreground"],
  ["editorLineNumber.activeForeground", "editorLineNumber-activeForeground"],
  ["editorCursor.foreground", "editorCursor-foreground"],
  ["editor.selectionBackground", "editor-selectionBackground"],
  ["editor.inactiveSelectionBackground", "editor-inactiveSelectionBackground"],
  ["editor.selectionHighlightBackground", "editor-selectionHighlightBackground"],
  ["editor.lineHighlightBackground", "editor-lineHighlightBackground"],
  ["editor.lineHighlightBorder", "editor-lineHighlightBorder"],
  ["editorGutter.background", "editorGutter-background"],
  ["editorWidget.background", "editorWidget-background"],
  ["editorWidget.foreground", "editorWidget-foreground"],
  ["editorWidget.border", "editorWidget-border"],
  ["editorHoverWidget.background", "editorHoverWidget-background"],
  ["editorHoverWidget.border", "editorHoverWidget-border"],
  ["editorError.foreground", "editorError-foreground"],
  ["input.background", "input-background"],
  ["input.foreground", "input-foreground"],
  ["input.border", "input-border"],
  ["focusBorder", "focusBorder"],
  ["menu.background", "menu-background"],
  ["menu.foreground", "menu-foreground"],
  ["menu.selectionBackground", "menu-selectionBackground"],
  ["menu.selectionForeground", "menu-selectionForeground"],
  ["scrollbarSlider.background", "scrollbarSlider-background"],
  ["scrollbarSlider.hoverBackground", "scrollbarSlider-hoverBackground"],
  ["scrollbarSlider.activeBackground", "scrollbarSlider-activeBackground"],
];

// VS Code's own colours, as the webview receives them
function applyTheme(): void {
  const style = getComputedStyle(document.documentElement);
  const colors = Object.fromEntries(
    colorPairs.flatMap(([key, name]) => {
      const value = style.getPropertyValue(`--vscode-${name}`).trim();
      return /^#[0-9a-f]{3,8}$/i.test(value) ? [[key, value]] : [];
    }),
  );
  const classes = document.body.classList;
  const dark = classes.contains("vscode-dark") || classes.contains("vscode-high-contrast");
  monaco.editor.defineTheme("doctor", { base: dark ? "vs-dark" : "vs", inherit: true, rules: [], colors });
  monaco.editor.setTheme("doctor");
}

const languages = new Set<string>();

// Enter carries an item's marker, or a quote's, on to the next line, which
// keeps the item's indentation, except past a quote's reference, which
// closed it; a code block's lines are tokenized in the language its fence
// names
function registerLanguages(): void {
  if (languages.size > 0) return;
  const carry = (pattern: string, mark: string) => ({
    beforeText: new RegExp(`^${pattern}`),
    action: { indentAction: monaco.languages.IndentAction.None, appendText: mark },
  });
  const onEnterRules = [
    carry(" *- ", "- "),
    carry(" *\\d+\\. ", "1. "),
    ...[6, 5, 4, 3, 2, 1].map((depth) => carry(`>{${depth}} --(?: |$)`, depth > 1 ? `${">".repeat(depth - 1)} ` : "")),
    ...[6, 5, 4, 3, 2, 1].map((depth) => carry(`>{${depth}} `, `${">".repeat(depth)} `)),
  ];
  monaco.languages.register({ id: "doctor" });
  monaco.languages.setLanguageConfiguration("doctor", { onEnterRules });
  const fence = "^(?:>+ )?```";
  monaco.languages.setMonarchTokensProvider("doctor", {
    tokenizer: {
      root: [
        ...fenceLanguages.map(([names, id]): monaco.languages.IMonarchLanguageRule => [
          new RegExp(`${fence}(?:${names})\\s*$`),
          { token: "doctor.fence", next: "@code", nextEmbedded: id },
        ]),
        [new RegExp(`${fence}.*$`), { token: "doctor.fence", next: "@plain" }],
        [/.*$/, ""],
      ],
      code: [[new RegExp(`${fence}\\s*$`), { token: "doctor.fence", next: "@pop", nextEmbedded: "@pop" }]],
      plain: [
        [new RegExp(`${fence}\\s*$`), { token: "doctor.fence", next: "@pop" }],
        [/.*$/, ""],
      ],
    },
  });
  languages.add("doctor");
}

// A line's marks, drawn quietly: a heading's #n as a badge, an item's - or
// number dimmed, a quote's > hidden behind its bar, an escaping backslash
// as nothing. They stay characters, so they're edited like any text; the
// one that changes width says so, for Monaco to measure.
interface _Piece_Mark_ {
  from: number;
  to: number;
  className: string;
  spacing: "keeps" | "changes";
}

function markPieces(content: string): Array<_Piece_Mark_> {
  const pieces: Array<_Piece_Mark_> = [];
  const piece = (from: number, to: number, className: string, spacing: _Piece_Mark_["spacing"]) => {
    if (to > from) pieces.push({ from, to, className, spacing });
  };
  const quote = /^(>+)(?: |$)/.exec(content);
  let at = 0;
  if (quote !== null) {
    piece(0, quote[0].length, styles.collapse, "changes");
    at = quote[0].length;
  }
  const rest = content.slice(at);
  const reference = quote === null ? null : /^--(?= |$)/.exec(rest);
  const heading = /^#\d+(?= |$)/.exec(rest);
  const item = /^( *)(-|\d+\.) /.exec(rest);
  if (reference !== null) {
    piece(at, at + 2, styles.mark, "keeps");
    at += rest.charAt(2) === " " ? 3 : 2;
  } else if (heading !== null) {
    piece(at, at + heading[0].length, styles.badge, "keeps");
    at += heading[0].length + (rest.charAt(heading[0].length) === " " ? 1 : 0);
  } else if (item !== null) {
    const indent = item[1]?.length ?? 0;
    piece(at + indent, at + indent + (item[2]?.length ?? 1), styles.mark, "keeps");
    at += item[0].length;
  }
  if (content.slice(at).startsWith("\\")) piece(at, at + 1, styles.collapse, "changes");
  return pieces;
}

// the languages a code block's fence can name, and what Monaco calls them
const fenceLanguages: Array<[string, string]> = [
  ["typescript|ts|tsx", "typescript"],
  ["javascript|js|jsx|mjs|cjs|json|jsonc", "javascript"],
  ["python|py", "python"],
  ["shell|sh|bash|zsh|console", "shell"],
  ["powershell|ps1", "powershell"],
  ["css", "css"],
  ["scss", "scss"],
  ["less", "less"],
  ["html", "html"],
  ["xml|svg", "xml"],
  ["markdown|md", "markdown"],
  ["yaml|yml", "yaml"],
  ["ini|toml", "ini"],
  ["dockerfile|docker", "dockerfile"],
  ["sql", "sql"],
  ["graphql|gql", "graphql"],
  ["rust|rs", "rust"],
  ["go", "go"],
  ["java", "java"],
  ["kotlin|kt", "kotlin"],
  ["swift", "swift"],
  ["c|cpp|cc|h|hpp", "cpp"],
  ["csharp|cs", "csharp"],
  ["ruby|rb", "ruby"],
  ["php", "php"],
  ["lua", "lua"],
];

const segmentClass = (segment: _Segment_Text_) =>
  [...segment.contrast.map((contrast) => styles[contrast]), ...(segment.links.length > 0 ? [styles.link] : [])].join(" ");

export function createTextView(host: HTMLElement, hooks: _Hooks_View_): _View_Text_ {
  registerLanguages();
  applyTheme();
  const observer = new MutationObserver(applyTheme);
  observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });

  const style = getComputedStyle(document.documentElement);
  const model = monaco.editor.createModel("", "doctor");
  const editor = monaco.editor.create(host, {
    model,
    theme: "doctor",
    automaticLayout: true,
    fontFamily: style.getPropertyValue("--vscode-editor-font-family").trim() || "monospace",
    fontSize: Number.parseFloat(style.getPropertyValue("--vscode-editor-font-size")) || 14,
    wordWrap: "on",
    wrappingIndent: "same",
    detectIndentation: false,
    tabSize: 2,
    insertSpaces: true,
    wrappingStrategy: "advanced",
    minimap: { enabled: false },
    folding: false,
    glyphMargin: false,
    scrollBeyondLastLine: false,
    quickSuggestions: false,
    suggestOnTriggerCharacters: false,
    wordBasedSuggestions: "off",
    links: false,
    occurrencesHighlight: "off",
    unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false },
    renderLineHighlight: "gutter",
    fixedOverflowWidgets: true,
  });

  let documents: Array<_Document_Doctor_> = [];
  let applying: "idle" | "applying" = "idle";
  let queued: "idle" | "queued" = "idle";
  let tracked = new Map<string, _Id_Node_>();
  const styling = editor.createDecorationsCollection();
  const proposal = editor.createDecorationsCollection();
  let zones: Array<string> = [];

  // the node each line holds: the line its tracking decoration starts on,
  // preferring one that still covers something, then the leftmost
  const ownersNow = (): Array<Array<_Id_Node_>> => {
    const best: Array<{ id: _Id_Node_; empty: boolean; column: number } | undefined> = [];
    for (const [decoration, id] of tracked) {
      const range = model.getDecorationRange(decoration);
      if (range === null) continue;
      const line = range.startLineNumber - 1;
      const candidate = { id, empty: range.isEmpty(), column: range.startColumn };
      const current = best[line];
      const better =
        current === undefined ||
        (current.empty && !candidate.empty) ||
        (current.empty === candidate.empty && candidate.column < current.column);
      if (better) best[line] = candidate;
    }
    return model.getLinesContent().map((_, line) => {
      const entry = best[line];
      return entry === undefined ? [] : [entry.id];
    });
  };

  const track = (owners: Array<Array<_Id_Node_>>) => {
    const decorations = owners.flatMap((owner, line) =>
      owner.map((id) => ({
        id,
        decoration: {
          range: new monaco.Range(line + 1, 1, line + 1, model.getLineMaxColumn(line + 1)),
          options: {
            description: "doctor-owner",
            stickiness: monaco.editor.TrackedRangeStickiness.GrowsOnlyWhenTypingAfter,
          },
        },
      })),
    );
    const ids = model.deltaDecorations([...tracked.keys()], decorations.map((entry) => entry.decoration));
    tracked = new Map(
      ids.flatMap((decoration, index) => {
        const entry = decorations[index];
        return entry === undefined ? [] : [[decoration, entry.id]];
      }),
    );
  };

  const holderAt = (line: number, owners: Array<Array<_Id_Node_>>): Array<_Holder_Text_> =>
    line === 1 ? [{ kind: "title" }] : (owners[line - 1] ?? []).map((node) => ({ kind: "node", node }));

  const textAt = (document: _Document_Doctor_, holder: _Holder_Text_): Array<_Text_Doctor_> => {
    if (holder.kind === "title") return [document.content.title];
    const node = indexNodes(document.content).get(holder.node)?.node;
    return node === undefined ? [] : textOfNode(node);
  };

  const decorate = (document: _Document_Doctor_) => {
    documents = [document];
    const owners = ownersNow();
    const index = indexNodes(document.content);
    const decorations: Array<monaco.editor.IModelDeltaDecoration> = [];
    const inline = (line: number, from: number, to: number, className: string) => {
      if (to > from) decorations.push({ range: new monaco.Range(line, from + 1, line, to + 1), options: { inlineClassName: className } });
    };
    const whole = (line: number, className: string) =>
      decorations.push({ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className } });
    const margin = (line: number, className: string) =>
      decorations.push({ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, linesDecorationsClassName: className } });
    const collapse = (line: number, to: number) => {
      if (to > 0) {
        decorations.push({
          range: new monaco.Range(line, 1, line, to + 1),
          options: { inlineClassName: styles.collapse, inlineClassNameAffectsLetterSpacing: true },
        });
      }
    };
    const selections = editor.getSelections() ?? [];
    // a line's marks show as they're written while the caret is in them
    const marks = (line: number, content: string, start: number) => {
      const prefix = new monaco.Range(line, 1, line, start + 1);
      if (selections.some((selection) => monaco.Range.areIntersectingOrTouching(selection, prefix))) {
        inline(line, 0, start, styles.mark);
        return;
      }
      for (const each of markPieces(content)) {
        decorations.push({
          range: new monaco.Range(line, each.from + 1, line, each.to + 1),
          options: { inlineClassName: each.className, inlineClassNameAffectsLetterSpacing: each.spacing === "changes" },
        });
      }
    };
    let code: "outside" | "inside" = "outside";
    model.getLinesContent().forEach((content, at) => {
      const line = at + 1;
      // A quote's lines, the blank ones between its blocks and its code's
      // too, carry its bar in the margin, where wrapped rows can't run over
      // it, and its >s take no room, so its text starts where any other
      // does. Code's >s are hidden here, the rest's with the other marks.
      const quote = /^(?:>+(?: |$))?/.exec(content)?.[0] ?? "";
      if (quote.length > 0) margin(line, styles.quote);
      if (code === "inside") {
        const closing = content.slice(quote.length) === "```";
        whole(line, closing ? styles.codeEnd : styles.code);
        collapse(line, quote.length);
        if (closing) {
          inline(line, quote.length, content.length, styles.fence);
          code = "outside";
        }
        return;
      }
      const [owner] = owners[at] ?? [];
      const node = owner === undefined ? undefined : index.get(owner)?.node;
      if (node?.kind === "code") {
        whole(line, styles.codeStart);
        const fence = quote.length + 3;
        collapse(line, quote.length);
        inline(line, quote.length, fence, styles.fence);
        inline(line, fence, content.length, styles.language);
        code = "inside";
        return;
      }
      const start = contentStart(content);
      marks(line, content, start);
      if (line === 1 || node?.kind === "section") {
        const last = content.length - (Array.from(content).at(-1)?.length ?? 0);
        inline(line, last, content.length, styles.leader);
      }
      const [text] = line === 1 ? [document.content.title] : node === undefined ? [] : textOfNode(node);
      const body = content.slice(start);
      if (text === undefined || text.text !== body) return;
      for (const segment of segmentsOf(text)) {
        inline(line, start + unitsOf(body, segment.from), start + unitsOf(body, segment.to), segmentClass(segment));
      }
    });
    styling.set(decorations);
  };

  // where the caret sits, as a character of a text, so it can be put back
  // on the same character once the text is replaced
  const caretIn = (): Array<{ holder: _Holder_Text_; character: number }> => {
    const position = editor.getPosition();
    if (position === null) return [];
    const [holder] = holderAt(position.lineNumber, ownersNow());
    if (holder === undefined) return [];
    const content = model.getLineContent(position.lineNumber);
    const start = contentStart(content);
    const body = content.slice(start);
    return [{ holder, character: pointsOf(body, Math.max(position.column - 1 - start, 0)) }];
  };

  const show = (document: _Document_Doctor_) => {
    const [caret] = caretIn();
    const scroll = editor.getScrollTop();
    const projection = project(document);
    applying = "applying";
    model.setValue(projection.lines.join("\n"));
    track(projection.owners);
    applying = "idle";
    decorate(document);
    editor.setScrollTop(scroll);
    if (caret === undefined) return;
    const place = projection.places.find((each) =>
      caret.holder.kind === "title" ? each.holder.kind === "title" : each.holder.kind === "node" && each.holder.node === caret.holder.node,
    );
    if (place === undefined) return;
    const body = (projection.lines[place.line] ?? "").slice(place.start);
    const column = unitsOf(body, caret.character);
    editor.setPosition({ lineNumber: place.line + 1, column: place.start + column + 1 });
  };

  const mark = (issues: Array<string>) => {
    const markers = issues.flatMap((issue) => {
      const match = /^line (\d+): (?:column (\d+): )?(.*)$/.exec(issue);
      if (match === null) return [];
      const line = Number(match[1]);
      if (line < 1 || line > model.getLineCount()) return [];
      const content = model.getLineContent(line);
      const column = match[2] === undefined ? 1 : contentStart(content) + Number(match[2]);
      return [
        {
          severity: monaco.MarkerSeverity.Error,
          message: match[3] ?? issue,
          startLineNumber: line,
          startColumn: column,
          endLineNumber: line,
          endColumn: match[2] === undefined ? model.getLineMaxColumn(line) : column + 1,
        },
      ];
    });
    monaco.editor.setModelMarkers(model, "doctor", markers);
  };

  const toggle = (contrast: _Contrast_Mark_) => {
    const [document] = documents;
    if (document === undefined) return;
    const owners = ownersNow();
    const selections = (editor.getSelections() ?? []).filter((selection) => !selection.isEmpty());
    const changed = new Map<string, { holder: _Holder_Text_; before: _Text_Doctor_; after: _Text_Doctor_ }>();
    for (const selection of selections) {
      for (let line = selection.startLineNumber; line <= selection.endLineNumber; line += 1) {
        const [holder] = holderAt(line, owners);
        const [before] = holder === undefined ? [] : textAt(document, holder);
        if (holder === undefined || before === undefined) continue;
        const content = model.getLineContent(line);
        const start = contentStart(content);
        const body = content.slice(start);
        if (body !== before.text) continue;
        const from = line === selection.startLineNumber ? Math.max(selection.startColumn - 1 - start, 0) : 0;
        const to = line === selection.endLineNumber ? Math.max(selection.endColumn - 1 - start, 0) : body.length;
        const key = holder.kind === "title" ? "" : holder.node;
        const entry = changed.get(key) ?? { holder, before, after: before };
        changed.set(key, { ...entry, after: toggleContrast(entry.after, pointsOf(body, from), pointsOf(body, to), contrast) });
      }
    }
    hooks.perform(() => [...changed.values()].flatMap((entry) => textOperations(entry.holder, entry.before, entry.after)));
  };

  // what a proposal would add, as lines in the editor's own syntax
  let previewCount = 0;
  const previewId = () => {
    previewCount += 1;
    return parseOwn(nodeIdSchema, `prev${previewCount.toString(36).padStart(6, "0")}`);
  };
  const subtreeLines = (shown: _Document_Doctor_, node: _Node_Document_): Array<string> => {
    const block: _Block_Document_ = node.kind === "listItem" ? { kind: "list", id: previewId(), order: "unordered", children: [node] } : node;
    return project({ ...shown, content: { title: { text: "", overlay: [] }, children: [block] }, notes: [] }).lines.slice(2);
  };

  // Monaco lays view zones beneath its lines of text, where clicks never
  // reach them, so a proposal's controls sit in an overlay widget kept level
  // with an empty zone that makes room for them, as VS Code's peek views do
  let headers: Array<monaco.editor.IOverlayWidget> = [];
  const placeHeader = (node: HTMLElement) => {
    const info = editor.getLayoutInfo();
    node.style.left = `${info.contentLeft}px`;
    node.style.width = `${info.width - info.contentLeft - info.verticalScrollbarWidth - info.minimap.minimapWidth}px`;
  };
  editor.onDidLayoutChange(() => {
    for (const widget of headers) placeHeader(widget.getDomNode());
  });

  const clearProposals = () => {
    editor.changeViewZones((accessor) => {
      for (const zone of zones) accessor.removeZone(zone);
    });
    zones = [];
    for (const widget of headers) editor.removeOverlayWidget(widget);
    headers = [];
    proposal.clear();
  };

  // Proposals waiting for review, shown where they'd change the document:
  // what they'd take away struck through, what they'd add beneath, and above
  // each one its task's instruction and what you can do with it.
  const showProposals = (open: Array<_Open_Proposal_>) => {
    clearProposals();
    const [shown] = documents;
    if (shown === undefined || open.length === 0) return;
    const owners = ownersNow();
    const index = indexNodes(shown.content);
    const height = editor.getOption(monaco.editor.EditorOption.lineHeight);
    const lineOf = (node: _Id_Node_) => owners.findIndex((owner) => owner.includes(node)) + 1;
    // a node's first line: its own, or a list's or a quote's first child's
    const startOf = (node: _Id_Node_): number => {
      const entry = index.get(node);
      const lines = (entry === undefined ? [] : nodesWithin(entry.node)).map((each) => lineOf(each.id)).filter((line) => line > 0);
      return lines.length === 0 ? 0 : Math.min(...lines);
    };
    // a node's last line: before the next line held by a node outside it
    const endOf = (node: _Id_Node_, start: number): number => {
      const entry = index.get(node);
      const inside = new Set<string>(entry === undefined ? [node] : nodesWithin(entry.node).map((each) => each.id));
      let last = start;
      for (let at = start + 1; at <= model.getLineCount(); at += 1) {
        const [owner] = owners[at - 1] ?? [];
        if (owner !== undefined && !inside.has(owner)) break;
        if (!/^>*$/.test(model.getLineContent(at).trim())) last = at;
      }
      return last;
    };
    // a quote's >s, one for it and one for each quote it's in
    const quoteMarks = (node: _Id_Node_): string => {
      let depth = 0;
      let at: _Parent_Position_ = { kind: "node", node };
      while (at.kind === "node") {
        const entry = index.get(at.node);
        if (entry === undefined) break;
        if (entry.node.kind === "quote") depth += 1;
        at = entry.parent;
      }
      return `${">".repeat(depth)} `;
    };
    const placeAfter = (at: _Position_Operation_, fallback: number): number => {
      if (at.kind === "after") {
        const line = startOf(at.sibling);
        return line === 0 ? fallback : endOf(at.sibling, line);
      }
      if (at.parent.kind === "body") return 1;
      // a quote's own line is its reference, which comes last
      const own = index.get(at.parent.node)?.node.kind === "quote" ? 0 : lineOf(at.parent.node);
      if (own > 0) return own;
      const first = startOf(at.parent.node);
      return first === 0 ? fallback : first - 1;
    };
    const element = (tag: string, className: string, content: string) => {
      const made = window.document.createElement(tag);
      made.className = className;
      made.textContent = content;
      return made;
    };
    // each line with its markers drawn as the editor draws them
    const linesZone = (lines: Array<string>) => {
      const zone = element("div", styles.proposalAdded, "");
      for (const line of lines) {
        const shownLine = element("div", styles.proposalLine, "");
        let at = 0;
        for (const piece of markPieces(line)) {
          shownLine.append(line.slice(at, piece.from), element("span", piece.className, line.slice(piece.from, piece.to)));
          at = piece.to;
        }
        shownLine.append(line === "" ? " " : line.slice(at));
        shownLine.style.height = `${height}px`;
        shownLine.style.lineHeight = `${height}px`;
        zone.append(shownLine);
      }
      return zone;
    };
    const widgets: Array<monaco.editor.IOverlayWidget> = [];
    const header = (item: _Open_Proposal_) => {
      const zone = element("div", styles.proposalHeader, "");
      zone.style.top = "-1000px";
      placeHeader(zone);
      widgets.push({ getId: () => `doctor.proposal.${item.proposal}`, getDomNode: () => zone, getPosition: () => null });
      const feedback = window.document.createElement("input");
      feedback.className = styles.proposalInput;
      feedback.placeholder = "what should change…";
      const accept = element("button", styles.proposalAccept, "Accept");
      const reject = element("button", styles.proposalButton, "Reject");
      const request = element("button", styles.proposalButton, "Request changes");
      const requestChanges = () => {
        const written = feedback.value.trim();
        if (written === "") {
          feedback.focus();
          return;
        }
        hooks.review(item.task, item.proposal, { kind: "request", feedback: written });
      };
      accept.addEventListener("click", () => hooks.review(item.task, item.proposal, { kind: "accept" }));
      reject.addEventListener("click", () => hooks.review(item.task, item.proposal, { kind: "reject", reason: feedback.value.trim() }));
      request.addEventListener("click", requestChanges);
      feedback.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Enter") requestChanges();
      });
      zone.append(element("span", styles.proposalTitle, `proposal · ${item.instruction}`), accept, reject, feedback, request);
      return zone;
    };
    const added: Array<{ after: number; node: HTMLElement; lines: number; level: Array<HTMLElement> }> = [];
    const struck: Array<monaco.editor.IModelDeltaDecoration> = [];
    const strike = (from: number, to: number, start: number) => {
      for (let line = from; line <= to; line += 1) {
        const content = model.getLineContent(line);
        struck.push({ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: styles.removedLine } });
        const begin = line === from ? start : 0;
        if (content.length > begin) {
          struck.push({ range: new monaco.Range(line, begin + 1, line, content.length + 1), options: { inlineClassName: styles.removed } });
        }
      }
    };
    for (const item of open) {
      const touched: Array<number> = [];
      const pieces: Array<{ after: number; node: HTMLElement; lines: number; level: Array<HTMLElement> }> = [];
      const add = (after: number, lines: Array<string>) => {
        pieces.push({ after, node: linesZone(lines), lines: Math.max(lines.length, 1), level: [] });
        touched.push(after + 1);
      };
      let last = 1;
      for (const operation of realize(item.operations, previewId)) {
        switch (operation.kind) {
          case "write":
          case "style": {
            const { holder } = operation;
            const line = holder.kind === "title" ? 1 : lineOf(holder.node);
            const quoted = holder.kind === "node" && index.get(holder.node)?.node.kind === "quote" ? [holder.node] : [];
            const [quote] = quoted;
            if (line === 0) {
              // a reference given to a quote that had none: its new last line
              const first = quote === undefined ? 0 : startOf(quote);
              if (quote === undefined || first === 0 || operation.kind !== "write" || operation.text === "") break;
              const end = endOf(quote, first);
              add(end, [`${quoteMarks(quote)}-- ${operation.text}`]);
              last = end;
              break;
            }
            const content = model.getLineContent(line);
            const start = contentStart(content);
            if (operation.kind === "write") strike(line, line, start);
            touched.push(line);
            if (quote === undefined || operation.kind !== "write" || operation.text !== "") {
              add(line, [operation.kind === "write" ? `${content.slice(0, start)}${operation.text}` : `${content}  (restyled)`]);
            }
            last = line;
            break;
          }
          case "edit": {
            const line = startOf(operation.node);
            if (line === 0) break;
            const end = endOf(operation.node, line);
            touched.push(line);
            if (operation.content.kind === "code") {
              strike(line + 1, end - 1, 0);
              add(end - 1, operation.content.code.split("\n"));
            } else {
              add(line - 1, [`(this list becomes ${operation.content.order === "ordered" ? "numbered" : "bulleted"})`]);
            }
            last = end;
            break;
          }
          case "delete": {
            const line = startOf(operation.node);
            if (line === 0) break;
            const end = endOf(operation.node, line);
            strike(line, end, 0);
            touched.push(line);
            last = end;
            break;
          }
          case "insert": {
            const after = placeAfter(operation.at, last);
            add(after, subtreeLines(shown, operation.subtree));
            last = after;
            break;
          }
          case "move": {
            const line = startOf(operation.node);
            const node = index.get(operation.node)?.node;
            if (line === 0 || node === undefined) break;
            strike(line, endOf(operation.node, line), 0);
            touched.push(line);
            const after = placeAfter(operation.to, last);
            add(after, subtreeLines(shown, node).map((each, at) => (at === 0 ? `${each}  (moved here)` : each)));
            last = after;
            break;
          }
        }
      }
      if (touched.length === 0) continue;
      const room = element("div", "", "");
      added.push({ after: Math.max(Math.min(...touched) - 1, 0), node: room, lines: 2, level: [header(item)] }, ...pieces);
    }
    proposal.set(struck);
    headers = widgets;
    for (const widget of headers) editor.addOverlayWidget(widget);
    editor.changeViewZones((accessor) => {
      // a header comes before what's added after the same line
      zones = added.map((zone, at) =>
        accessor.addZone({
          afterLineNumber: zone.after,
          heightInLines: zone.lines,
          domNode: zone.node,
          ordinal: at,
          suppressMouseDown: true,
          onDomNodeTop: (top) => {
            for (const node of zone.level) node.style.top = `${top}px`;
          },
          onComputedHeight: (computed) => {
            for (const node of zone.level) node.style.height = `${computed}px`;
          },
        }),
      );
    });
  };

  const linkAt = (position: monaco.Position): Array<_LINK_Mark__Text_> => {
    const [document] = documents;
    const [holder] = holderAt(position.lineNumber, ownersNow());
    const [text] = document === undefined || holder === undefined ? [] : textAt(document, holder);
    if (text === undefined) return [];
    const content = model.getLineContent(position.lineNumber);
    const start = contentStart(content);
    const character = pointsOf(content.slice(start), position.column - 1 - start);
    return text.overlay.filter(
      (mark): mark is _LINK_Mark__Text_ => mark.kind === "link" && mark.from <= character && mark.to > character,
    );
  };

  const hover = monaco.languages.registerHoverProvider("doctor", {
    provideHover: (hovered, position) => {
      if (hovered !== model) return null;
      const [link] = linkAt(position);
      return link === undefined ? null : { contents: [{ value: describeTarget(link.target) }] };
    },
  });

  const action = (id: string, label: string, keybindings: Array<number>, run: () => void) =>
    editor.addAction({ id, label, keybindings, contextMenuGroupId: "1_doctor", run });
  const { KeyMod, KeyCode } = monaco;
  action("doctor.bold", "doctor: bold", [KeyMod.CtrlCmd | KeyCode.KeyB], () => toggle("bold"));
  action("doctor.italic", "doctor: italic", [KeyMod.CtrlCmd | KeyCode.KeyI], () => toggle("italic"));
  action("doctor.monospace", "doctor: monospace", [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyM], () => toggle("monospace"));
  action("doctor.highlighted", "doctor: highlighted", [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyH], () => toggle("highlighted"));
  action("doctor.struck", "doctor: struck", [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyX], () => toggle("struck"));

  // linking: a small input beside the selection, or beside the link the caret
  // is in, takes a target; an empty one unlinks
  const linkBox = document.createElement("div");
  linkBox.className = styles.linkBox;
  const linkInput = document.createElement("input");
  linkInput.className = styles.linkInput;
  linkInput.placeholder = "https://…, doc:… or doc:…#…";
  linkBox.append(linkInput);
  let linking: Array<{ holder: _Holder_Text_; before: _Text_Doctor_; from: number; to: number; at: monaco.IPosition }> = [];
  const linkWidget: monaco.editor.IContentWidget = {
    getId: () => "doctor.link",
    getDomNode: () => linkBox,
    getPosition: () => {
      const [place] = linking;
      return place === undefined
        ? null
        : {
            position: place.at,
            preference: [monaco.editor.ContentWidgetPositionPreference.BELOW, monaco.editor.ContentWidgetPositionPreference.ABOVE],
          };
    },
  };
  const closeLink = () => {
    if (linking.length === 0) return;
    linking = [];
    editor.removeContentWidget(linkWidget);
    editor.focus();
  };
  const openLink = () => {
    const [document] = documents;
    const selection = editor.getSelection();
    if (document === undefined || selection === null || selection.startLineNumber !== selection.endLineNumber) return;
    const line = selection.startLineNumber;
    const [holder] = holderAt(line, ownersNow());
    const [before] = holder === undefined ? [] : textAt(document, holder);
    if (holder === undefined || before === undefined) return;
    const content = model.getLineContent(line);
    const start = contentStart(content);
    const body = content.slice(start);
    if (body !== before.text) return;
    let from = pointsOf(body, Math.max(selection.startColumn - 1 - start, 0));
    let to = pointsOf(body, Math.max(selection.endColumn - 1 - start, 0));
    const [existing] = before.overlay.filter(
      (mark): mark is _LINK_Mark__Text_ => mark.kind === "link" && (from === to ? mark.from <= from && mark.to > from : mark.from < to && mark.to > from),
    );
    if (from === to) {
      if (existing === undefined) return;
      from = existing.from;
      to = existing.to;
    }
    linking = [{ holder, before, from, to, at: { lineNumber: line, column: start + unitsOf(body, from) + 1 } }];
    linkInput.value = existing === undefined ? "" : writeTarget(existing.target);
    linkBox.classList.remove(styles.linkInvalid);
    editor.addContentWidget(linkWidget);
    linkInput.focus();
    linkInput.select();
  };
  linkInput.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") closeLink();
    if (event.key !== "Enter") return;
    event.preventDefault();
    const written = linkInput.value.trim();
    const targets = written === "" ? [] : readTarget(written);
    if (written !== "" && targets.length === 0) {
      linkBox.classList.add(styles.linkInvalid);
      return;
    }
    const [place] = linking;
    closeLink();
    if (place === undefined) return;
    hooks.perform(() => textOperations(place.holder, place.before, relink(place.before, place.from, place.to, targets)));
  });
  linkInput.addEventListener("input", () => linkBox.classList.remove(styles.linkInvalid));
  linkInput.addEventListener("blur", closeLink);
  action("doctor.link", "doctor: link", [KeyMod.CtrlCmd | KeyCode.KeyK], openLink);

  // A line's kind, as far as joining blocks goes: text that holds a block's
  // words, a blank between blocks, or code, which joins as plain lines do.
  const lineKinds = (): Array<"text" | "blank" | "code"> => {
    let code: "outside" | "inside" = "outside";
    return model.getLinesContent().map((content) => {
      const rest = content.slice((/^(?:>+ )?/.exec(content)?.[0] ?? "").length);
      if (code === "inside") {
        if (rest === "```") code = "outside";
        return "code";
      }
      if (rest.startsWith("```")) {
        code = "inside";
        return "code";
      }
      return /^>*$/.test(content.trim()) ? "blank" : "text";
    });
  };

  // Delete at the end of a block joins the next block's words onto it, past
  // the blank between them and without the next block's marks.
  const joinNext = () => {
    const position = editor.getPosition();
    if (position === null) return;
    const kinds = lineKinds();
    const line = position.lineNumber;
    let next = line + 1;
    while (next <= model.getLineCount() && kinds[next - 1] === "blank") next += 1;
    if (next > model.getLineCount() || kinds[next - 1] !== "text") return;
    const following = model.getLineContent(next);
    const end = model.getLineMaxColumn(line);
    editor.executeEdits(
      "doctor",
      [{ range: new monaco.Range(line, end, next, model.getLineMaxColumn(next)), text: following.slice(contentStart(following)) }],
      [new monaco.Selection(line, end, line, end)],
    );
  };

  // Backspace at the start of a block's words takes its mark away, a
  // heading's, an item's or a quote's reference's, then a quote's level; a
  // paragraph's words join onto the block before it. The title keeps its #0.
  const joinPrevious = () => {
    const position = editor.getPosition();
    if (position === null || position.lineNumber === 1) return;
    const line = position.lineNumber;
    const content = model.getLineContent(line);
    const start = contentStart(content);
    const quote = /^(?:>+ )?/.exec(content)?.[0] ?? "";
    const marks = quote === "" ? /^(?:#\d+(?: |$)| *(?:-|\d+\.) )/ : /^(?:--(?: |$)|#\d+(?: |$)| *(?:-|\d+\.) )/;
    const mark = marks.exec(content.slice(quote.length))?.[0] ?? "";
    if (mark.length > 0) {
      const escape = startsBlock(content.slice(start)) ? "\\" : "";
      const column = quote.length + 1;
      editor.executeEdits(
        "doctor",
        [{ range: new monaco.Range(line, column, line, start + 1), text: escape }],
        [new monaco.Selection(line, column + escape.length, line, column + escape.length)],
      );
      return;
    }
    if (quote.length > 0) {
      const marks = quote.trimEnd().length;
      const fewer = marks > 1 ? `${">".repeat(marks - 1)} ` : "";
      editor.executeEdits(
        "doctor",
        [{ range: new monaco.Range(line, 1, line, quote.length + 1), text: fewer }],
        [new monaco.Selection(line, fewer.length + 1, line, fewer.length + 1)],
      );
      return;
    }
    const kinds = lineKinds();
    let previous = line - 1;
    while (previous >= 1 && kinds[previous - 1] === "blank") previous -= 1;
    if (previous < 1 || kinds[previous - 1] !== "text") return;
    const end = model.getLineMaxColumn(previous);
    editor.executeEdits(
      "doctor",
      [{ range: new monaco.Range(previous, end, line, start + 1), text: "" }],
      [new monaco.Selection(previous, end, previous, end)],
    );
  };

  // the keys only do this with one caret, at a block's very end or start
  const atBlockEnd = editor.createContextKey<boolean>("doctorBlockEnd", false);
  const atBlockStart = editor.createContextKey<boolean>("doctorBlockStart", false);
  const placeKeys = () => {
    const selections = editor.getSelections() ?? [];
    const [only] = selections;
    if (only === undefined || selections.length > 1 || !only.isEmpty()) {
      atBlockEnd.set(false);
      atBlockStart.set(false);
      return;
    }
    const content = model.getLineContent(only.startLineNumber);
    const text = lineKinds()[only.startLineNumber - 1] === "text";
    atBlockEnd.set(text && only.startColumn === content.length + 1);
    atBlockStart.set(text && only.startColumn === contentStart(content) + 1);
  };
  editor.onDidChangeCursorSelection(placeKeys);
  editor.addCommand(KeyCode.Delete, joinNext, "doctorBlockEnd");
  editor.addCommand(KeyCode.Backspace, joinPrevious, "doctorBlockStart");

  // a task about the blocks the selection touches; a code block's lines are
  // its block's
  const scopeOfSelection = (): Array<_Id_Node_> => {
    const owners = ownersNow();
    const kinds = lineKinds();
    const found = new Set<_Id_Node_>();
    for (const selection of editor.getSelections() ?? []) {
      for (let line = selection.startLineNumber; line <= selection.endLineNumber; line += 1) {
        let at = line;
        while (at > 1 && kinds[at - 1] === "code" && (owners[at - 1] ?? []).length === 0) at -= 1;
        for (const id of owners[at - 1] ?? []) found.add(id);
      }
    }
    return [...found];
  };
  editor.addAction({
    id: "doctor.task",
    label: "doctor: new task",
    contextMenuGroupId: "0_doctor",
    run: () => hooks.makeTask(scopeOfSelection()),
  });

  // a numbered list's numbers, kept right as items come and go and move
  const renumber = () => {
    const edits: Array<monaco.editor.IIdentifiedSingleEditOperation> = [];
    let counters: Array<number> = [];
    let within = "";
    let code: "outside" | "inside" = "outside";
    model.getLinesContent().forEach((content, at) => {
      const quote = /^(?:>+ )?/.exec(content)?.[0] ?? "";
      const rest = content.slice(quote.length);
      if (rest.startsWith("```")) code = code === "inside" ? "outside" : "inside";
      const item = code === "outside" ? /^( *)(?:-|(\d+)\.) /.exec(rest) : null;
      if (item === null || quote !== within) counters = [];
      within = quote;
      if (item === null) return;
      const indent = item[1]?.length ?? 0;
      const depth = Math.floor(indent / 2) + 1;
      counters = counters.slice(0, depth);
      while (counters.length < depth) counters.push(0);
      const number = (counters[depth - 1] ?? 0) + 1;
      counters[depth - 1] = number;
      if (item[2] === undefined || item[2] === String(number)) return;
      const column = quote.length + indent + 1;
      edits.push({ range: new monaco.Range(at + 1, column, at + 1, column + item[2].length), text: String(number) });
    });
    if (edits.length === 0) return;
    applying = "applying";
    model.pushEditOperations([], edits, () => null);
    applying = "idle";
  };

  // a heading's #n, kept equal to its depth: a section whose parent goes
  // moves up a level, and a level skipped is the next one down
  const relevel = () => {
    const edits: Array<monaco.editor.IIdentifiedSingleEditOperation> = [];
    const open = new Map<string, Array<number>>();
    let code: "outside" | "inside" = "outside";
    model.getLinesContent().forEach((content, at) => {
      const quote = /^(?:>+ )?/.exec(content)?.[0] ?? "";
      const rest = content.slice(quote.length);
      if (rest.startsWith("```")) code = code === "inside" ? "outside" : "inside";
      if (code === "inside" || at === 0) return;
      if (quote === "" && content.trim() !== "") {
        for (const key of [...open.keys()]) if (key !== "") open.delete(key);
      }
      const heading = /^#(\d+)(?= |$)/.exec(rest);
      const written = Number(heading?.[1] ?? 0);
      if (heading === null || written === 0) return;
      const levels = open.get(quote) ?? [];
      while ((levels.at(-1) ?? 0) >= written) levels.pop();
      const depth = levels.length + 1;
      levels.push(written);
      open.set(quote, levels);
      if (depth === written) return;
      const column = quote.length + 2;
      edits.push({ range: new monaco.Range(at + 1, column, at + 1, column + (heading[1]?.length ?? 1)), text: String(depth) });
    });
    if (edits.length === 0) return;
    applying = "applying";
    model.pushEditOperations([], edits, () => null);
    applying = "idle";
  };

  model.onDidChangeContent(() => {
    if (applying === "applying" || queued === "queued") return;
    queued = "queued";
    queueMicrotask(() => {
      queued = "idle";
      renumber();
      relevel();
      hooks.edited(model.getLinesContent(), ownersNow());
    });
  });

  // Tab and Shift+Tab move an item a level in or out, wherever the caret is
  // in it
  const inItem = editor.createContextKey<boolean>("doctorItem", false);
  const isItem = (line: number) => {
    const [owner] = ownersNow()[line - 1] ?? [];
    const [document] = documents;
    return owner !== undefined && document !== undefined && indexNodes(document.content).get(owner)?.node.kind === "listItem";
  };
  const shift = (direction: "in" | "out") => {
    const lines = new Set((editor.getSelections() ?? []).flatMap((selection) => {
      const spanned: Array<number> = [];
      for (let line = selection.startLineNumber; line <= selection.endLineNumber; line += 1) spanned.push(line);
      return spanned;
    }));
    const edits = [...lines].filter(isItem).flatMap((line) => {
      const content = model.getLineContent(line);
      const quote = /^(?:>+ )?/.exec(content)?.[0] ?? "";
      const column = quote.length + 1;
      if (direction === "in") return [{ range: new monaco.Range(line, column, line, column), text: "  " }];
      const spaces = /^ {0,2}/.exec(content.slice(quote.length))?.[0].length ?? 0;
      return spaces === 0 ? [] : [{ range: new monaco.Range(line, column, line, column + spaces), text: "" }];
    });
    editor.executeEdits("doctor", edits);
  };
  editor.addCommand(monaco.KeyCode.Tab, () => shift("in"), "doctorItem");
  editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.Tab, () => shift("out"), "doctorItem");

  // Tab and Shift+Tab move a section a level deeper or shallower, its
  // subsections with it; it goes deeper only under a section before it at
  // its own level, and no shallower than #1
  const inHeading = editor.createContextKey<boolean>("doctorHeading", false);
  const quoteOf = (content: string) => /^(?:>+ )?/.exec(content)?.[0] ?? "";
  const headingIn = (content: string) => /^#(\d+)(?= |$)/.exec(content.slice(quoteOf(content).length));
  const isHeading = (line: number) =>
    line > 1 && lineKinds()[line - 1] === "text" && headingIn(model.getLineContent(line)) !== null;
  const shiftSection = (direction: "in" | "out") => {
    const position = editor.getPosition();
    if (position === null || !isHeading(position.lineNumber)) return;
    const kinds = lineKinds();
    const quote = quoteOf(model.getLineContent(position.lineNumber));
    const headings = model.getLinesContent().flatMap((content, at) => {
      const match = at > 0 && kinds[at] === "text" && quoteOf(content) === quote ? headingIn(content) : null;
      if (match === null) return [];
      const digits = match[1] ?? "1";
      return [{ line: at + 1, level: Number(digits), digits: digits.length }];
    });
    const index = headings.findIndex((heading) => heading.line === position.lineNumber);
    const self = headings[index];
    if (self === undefined) return;
    const next = headings.findIndex((heading, at) => at > index && heading.level <= self.level);
    const section = headings.slice(index, next === -1 ? headings.length : next);
    if (direction === "out" && self.level <= 1) return;
    if (direction === "in") {
      const before = headings.slice(0, index).findLast((heading) => heading.level <= self.level);
      if (before?.level !== self.level) return;
    }
    const step = direction === "in" ? 1 : -1;
    const column = quote.length + 2;
    editor.executeEdits(
      "doctor",
      section.map((heading) => ({
        range: new monaco.Range(heading.line, column, heading.line, column + heading.digits),
        text: String(heading.level + step),
      })),
    );
  };
  editor.addCommand(monaco.KeyCode.Tab, () => shiftSection("in"), "doctorHeading");
  editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.Tab, () => shiftSection("out"), "doctorHeading");
  editor.onDidChangeCursorPosition((event) => {
    inItem.set(isItem(event.position.lineNumber));
    inHeading.set(isHeading(event.position.lineNumber));
  });
  editor.onDidBlurEditorText(() => hooks.leave());
  editor.onDidChangeCursorSelection(() => {
    for (const document of documents) decorate(document);
  });

  return {
    show,
    track,
    decorate,
    mark,
    proposals: showProposals,
    dispose: () => {
      observer.disconnect();
      hover.dispose();
      editor.dispose();
      model.dispose();
    },
  };
}
