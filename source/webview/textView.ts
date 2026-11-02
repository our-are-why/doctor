import { applyOperations, textOperations } from "../shared/apply.ts";
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
  _PASSAGE_Target__Request_,
  _Position_Operation_,
  _Target_Request_,
  _Text_Doctor_,
} from "../shared/domain.next.ts";
import { parseOwn } from "../shared/parse.ts";
import { contentStart, project, startsBlock, type _Projection_ } from "../shared/projection.ts";
import { realize } from "../shared/proposals.ts";
import type { _Open_Proposal_, _Verdict_Review_, _View_Drafting_ } from "../shared/protocol.ts";
import { changeIdSchema, nodeIdSchema, offsetSchema } from "../shared/schema.ts";
import { readTarget, writeTarget } from "../shared/target.ts";
import { compareTexts, lengthOf, relink, segmentsOf, toggleContrast, type _Change_Text_, type _Segment_Text_ } from "../shared/text.ts";
import { indexNodes, nodesWithin, textOfNode } from "../shared/tree.ts";
import * as monaco from "./monaco.ts";
import "./styles/monaco.css";
import styles from "./styles/TextEditor.module.css";
import { describeTarget } from "./TextView.tsx";

export interface _Hooks_View_ {
  edited: (lines: Array<string>, owners: Array<Array<_Id_Node_>>) => void;
  perform: (act: (document: _Document_Doctor_) => Array<_Operation_Change_>) => void;
  leave: () => void;
  // a quick task: one request, started at once
  makeTask: (targets: Array<_Target_Request_>, text: string) => void;
  // drafting: a task built up from requests, started when it's ready
  beginDrafting: () => void;
  addRequest: (targets: Array<_Target_Request_>, text: string) => void;
  stopDrafting: () => void;
  review: (task: _Id_Task_, proposal: _Id_Proposal_, verdict: _Verdict_Review_) => void;
  // where the line numbers start, from the editor's left, for the bar above
  // to start its words there too
  numbers: (left: number) => void;
}

export interface _View_Text_ {
  show: (document: _Document_Doctor_) => void;
  track: (owners: Array<Array<_Id_Node_>>) => void;
  decorate: (document: _Document_Doctor_) => void;
  mark: (issues: Array<string>) => void;
  proposals: (open: Array<_Open_Proposal_>) => void;
  focus: (drafting: Array<_View_Drafting_>) => void;
  // the form for a request about the whole document, docked under the bar
  requestForDocument: (route: _Route_Form_) => void;
  // scrolls to the first proposal waiting for review
  revealProposals: () => void;
  dispose: () => void;
}

// what the request form does with what's written in it
export type _Route_Form_ = "quick" | "draft";

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

// In the editor a quote's >s take no room, its bar drawn in the margin
// beside them; in a proposal's lines they show as well, so it's plain what
// stays quoted.
type _Quotes_Mark_ = "collapsed" | "shown";

function markPieces(content: string, quotes: _Quotes_Mark_): Array<_Piece_Mark_> {
  const pieces: Array<_Piece_Mark_> = [];
  const piece = (from: number, to: number, className: string, spacing: _Piece_Mark_["spacing"]) => {
    if (to > from) pieces.push({ from, to, className, spacing });
  };
  const quote = /^(>+)(?: |$)/.exec(content);
  let at = 0;
  if (quote !== null) {
    if (quotes === "collapsed") piece(0, quote[0].length, styles.collapse, "changes");
    else piece(0, quote[1]?.length ?? 0, styles.mark, "keeps");
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

// the colour a proposal boxes words in for what happens to them
const changeClass: Record<_Change_Text_["kind"], string> = {
  removed: styles.removedWords,
  replaced: styles.replacedWords,
  inserted: styles.insertedWords,
  restyled: styles.restyledWords,
};

// A line a proposal shows: as it's written, with the text it holds and where
// that starts, for its marks to be drawn as the document's are, how that
// text changes, when it's one the proposal changes in place, and a note on
// it, if there's one.
interface _Line_Proposal_ {
  content: string;
  texts: Array<{ start: number; text: _Text_Doctor_ }>;
  changes: Array<_Change_Text_>;
  note: string;
}

const plainLine = (content: string): _Line_Proposal_ => ({ content, texts: [], changes: [], note: "" });

// A zone a proposal makes among the lines: what it shows and beside it in
// the margin, the overlay kept level with it, and what's told where Monaco
// put it, so it can grow.
interface _Zone_Proposal_ {
  after: number;
  node: HTMLElement;
  margin: Array<HTMLElement>;
  lines: number;
  level: Array<HTMLElement>;
  placed: Array<(zone: monaco.editor.IViewZone, id: string) => void>;
}

// Where the request form is: inline among the lines of the selection it's
// about, or docked under the editor's bar when it's about the whole document.
type _Placement_Form_ = _INLINE_Placement__Form_ | _DOCKED_Placement__Form_;

interface __BASE_Placement__Form_<__PlacementKind__ extends string> {
  kind: __PlacementKind__;
}

interface _INLINE_Placement__Form_ extends __BASE_Placement__Form_<"inline"> {
  zone: monaco.editor.IViewZone;
  id: string;
  above: "above" | "below";
  shift: number;
}

interface _DOCKED_Placement__Form_ extends __BASE_Placement__Form_<"docked"> {}

export function createTextView(host: HTMLElement, dock: HTMLElement, hooks: _Hooks_View_): _View_Text_ {
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
    // room for a quote's bar and a request's mark side by side
    lineDecorationsWidth: 14,
    folding: false,
    glyphMargin: false,
    scrollBeyondLastLine: false,
    // room below the last line, as the bar gives above the first
    padding: { bottom: 24 },
    stickyScroll: { enabled: true, defaultModel: "foldingProviderModel" },
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
  const structureChanged = new monaco.Emitter<monaco.languages.FoldingRangeProvider>();

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
    structureChanged.fire(structure);
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
    structureChanged.fire(structure);
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
    // A line a proposal would change shows its quote's >s, as its preview
    // does, so what changes and what stays reads plainly between the two.
    // Its decorations move with edits, so they say which lines those are.
    const targeted = new Set(proposal.getRanges().map((range) => range.startLineNumber));
    const quoteMarks = (line: number, to: number) => {
      if (targeted.has(line)) inline(line, 0, to, styles.mark);
      else collapse(line, to);
    };
    // a line's marks show as they're written while the caret is in them
    const marks = (line: number, content: string, start: number) => {
      const prefix = new monaco.Range(line, 1, line, start + 1);
      if (selections.some((selection) => monaco.Range.areIntersectingOrTouching(selection, prefix))) {
        inline(line, 0, start, styles.mark);
        return;
      }
      for (const each of markPieces(content, targeted.has(line) ? "shown" : "collapsed")) {
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
      // it, on the band code has, and its >s take no room, so its text
      // starts where any other does. Code's >s are hidden here, the rest's
      // with the other marks.
      const quote = /^(?:>+(?: |$))?/.exec(content)?.[0] ?? "";
      if (quote.length > 0) {
        margin(line, styles.quote);
        whole(line, styles.quoted);
      }
      if (code === "inside") {
        const closing = content.slice(quote.length) === "```";
        whole(line, closing ? styles.codeEnd : styles.code);
        quoteMarks(line, quote.length);
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
        quoteMarks(line, quote.length);
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
    markRequests();
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
    whenDrawn(tellNumbers);
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
  // a projection's lines, from and up to the ones given, with their texts
  const proposalLines = (document: _Document_Doctor_, projection: _Projection_, from: number, to: number): Array<_Line_Proposal_> =>
    projection.lines.slice(from, to).map((content, at) => ({
      content,
      texts: projection.places
        .filter((place) => place.line === from + at)
        .flatMap((place) => textAt(document, place.holder).map((text) => ({ start: place.start, text }))),
      changes: [],
      note: "",
    }));
  const subtreeLines = (shown: _Document_Doctor_, node: _Node_Document_): Array<_Line_Proposal_> => {
    const block: _Block_Document_ = node.kind === "listItem" ? { kind: "list", id: previewId(), order: "unordered", children: [node] } : node;
    const alone: _Document_Doctor_ = { ...shown, content: { title: { text: "", overlay: [] }, children: [block] }, notes: [] };
    const projection = project(alone);
    return proposalLines(alone, projection, 2, projection.lines.length);
  };
  const previewChange = parseOwn(changeIdSchema, "preview000");

  // A node's lines in the document as the proposal would leave it, so they
  // read as they will: a heading at its real level, under its quote's marks,
  // at its list's depth, with what's moved into it, its words marked as
  // they'll be. From the node's first line to the last before a line of
  // something outside it. And a text's own line, as it will be.
  const linesAfter = (shown: _Document_Doctor_, operations: Array<_Operation_Change_>) => {
    const applied = applyOperations(shown, operations, { document: shown.id, id: previewChange });
    if (applied.kind === "refused") {
      return { node: (_node: _Id_Node_): Array<Array<_Line_Proposal_>> => [], holder: (_holder: _Holder_Text_): Array<_Line_Proposal_> => [] };
    }
    const projection = project(applied.document);
    const index = indexNodes(applied.document.content);
    const node = (id: _Id_Node_): Array<Array<_Line_Proposal_>> => {
      const entry = index.get(id);
      if (entry === undefined) return [];
      const inside = new Set<string>(nodesWithin(entry.node).map((each) => each.id));
      const start = projection.owners.findIndex((owner) => owner.some((owned) => inside.has(owned)));
      if (start === -1) return [];
      let end = start;
      for (let at = start + 1; at < projection.lines.length; at += 1) {
        const owner = projection.owners[at] ?? [];
        if (owner.length > 0 && !owner.some((owned) => inside.has(owned))) break;
        if (!/^>*$/.test((projection.lines[at] ?? "").trim())) end = at;
      }
      return [proposalLines(applied.document, projection, start, end + 1)];
    };
    const holder = (wanted: _Holder_Text_): Array<_Line_Proposal_> =>
      projection.places
        .filter((place) => (place.holder.kind === "node" && wanted.kind === "node" ? place.holder.node === wanted.node : place.holder.kind === wanted.kind))
        .flatMap((place) => proposalLines(applied.document, projection, place.line, place.line + 1));
    return { node, holder };
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

  // the line the first proposal's header is after, to scroll to
  let proposalAt: Array<number> = [];

  const clearProposals = () => {
    editor.changeViewZones((accessor) => {
      for (const zone of zones) accessor.removeZone(zone);
    });
    zones = [];
    for (const widget of headers) editor.removeOverlayWidget(widget);
    headers = [];
    proposalAt = [];
    proposal.clear();
  };

  // The line numbers' column: its right edge, where they're aligned, and a
  // digit's width, measured on a number drawn, else worked out from Monaco's
  // layout. A line's number starts a digit's width left of the edge for
  // each digit it has.
  const numberColumn = (): { right: number; digit: number } => {
    const info = editor.getLayoutInfo();
    const font = editor.getOption(monaco.editor.EditorOption.fontInfo);
    const estimate = { right: info.lineNumbersLeft + info.lineNumbersWidth, digit: font.maxDigitWidth };
    const [number] = [...host.querySelectorAll(".line-numbers")].filter((each) => (each.textContent ?? "").trim() !== "");
    if (number === undefined) return estimate;
    const range = window.document.createRange();
    range.selectNodeContents(number);
    const box = range.getBoundingClientRect();
    const drawn = (number.textContent ?? "").trim().length;
    return box.width === 0 ? estimate : { right: box.right - host.getBoundingClientRect().left, digit: box.width / drawn };
  };
  const numberLeft = (column: { right: number; digit: number }, line: number) => column.right - String(line).length * column.digit;

  // the document's lines drawn again for the proposals now shown
  const redecorate = () => {
    const [document] = documents;
    if (document !== undefined) decorate(document);
  };

  // the proposals shown, drawn again when the lines' width changes, as what
  // they add wraps with it
  let showing: Array<_Open_Proposal_> = [];
  let drawnWidth = 0;
  editor.onDidLayoutChange((info) => {
    if (showing.length > 0 && info.contentWidth !== drawnWidth) showProposals(showing);
  });

  // Proposals waiting for review, shown where they'd change the document:
  // what they'd take away struck through, what they'd add beneath, and under
  // each one its task's instruction and what you can do with it. What one
  // changes in the document is marked in the margin too, from where its
  // line's number starts, as what it adds is, so the lines it's about read
  // as one block with its actions closing it.
  const showProposals = (open: Array<_Open_Proposal_>) => {
    clearProposals();
    showing = open;
    drawnWidth = editor.getLayoutInfo().contentWidth;
    const [shown] = documents;
    if (shown === undefined || open.length === 0) {
      redecorate();
      return;
    }
    const owners = ownersNow();
    const index = indexNodes(shown.content);
    const height = editor.getOption(monaco.editor.EditorOption.lineHeight);
    // where each added line is, wrapped at the width the editor's lines are,
    // laid out out of sight to be measured
    const boxesOf = (node: HTMLElement): Array<{ top: number; height: number }> => {
      node.style.position = "absolute";
      node.style.visibility = "hidden";
      node.style.width = `${drawnWidth}px`;
      host.append(node);
      const boxes = [...node.children].flatMap((line) => (line instanceof HTMLElement ? [{ top: line.offsetTop, height: line.offsetHeight }] : []));
      node.remove();
      for (const property of ["position", "visibility", "width"]) node.style.removeProperty(property);
      return boxes;
    };
    // beside what's added, in the margin: its band and bar from where the
    // number of the line it's under starts, and a quote's bar where the
    // editor draws one
    const column = numberColumn();
    host.style.setProperty("--numbers-right", `${column.right}px`);
    host.style.setProperty("--digit", `${column.digit}px`);
    const digits = [styles.digits1, styles.digits2, styles.digits3, styles.digits4, styles.digits5];
    const gutter = (line: number, className: string) => `${className} ${digits[Math.min(String(line).length, digits.length) - 1] ?? ""}`;
    const actionsMargin = (after: number) => {
      const margin = element("div", styles.proposalActionsMargin, "");
      margin.style.setProperty("--left", `${numberLeft(column, Math.max(after, 1))}px`);
      return margin;
    };
    const marginOf = (after: number, lines: Array<_Line_Proposal_>, boxes: Array<{ top: number; height: number }>) => {
      const margin = element("div", styles.proposalMargin, "");
      margin.style.setProperty("--left", `${numberLeft(column, Math.max(after, 1))}px`);
      const lane = editor.getLayoutInfo().decorationsLeft;
      lines.forEach((line, at) => {
        const box = boxes[at];
        if (box === undefined || !line.content.startsWith(">")) return;
        const bar = element("div", styles.proposalQuote, "");
        bar.style.left = `${lane + 3}px`;
        bar.style.top = `${box.top}px`;
        bar.style.height = `${box.height}px`;
        margin.append(bar);
      });
      return margin;
    };
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
    // each line with its markers drawn as the editor draws them, a quote's
    // >s too, and its words marked as they'll be
    const linesZone = (lines: Array<_Line_Proposal_>) => {
      const zone = element("div", styles.proposalAdded, "");
      for (const { content, texts, changes, note } of lines) {
        const shownLine = element("div", styles.proposalLine, "");
        let at = 0;
        for (const piece of markPieces(content, "shown")) {
          shownLine.append(content.slice(at, piece.from), element("span", piece.className, content.slice(piece.from, piece.to)));
          at = piece.to;
        }
        const [held] = texts;
        const body = held === undefined || held.start < at ? "" : content.slice(held.start);
        if (held !== undefined && body !== "" && body === held.text.text) {
          shownLine.append(content.slice(at, held.start));
          // each stretch under one set of marks, cut where a change starts
          // or ends, and a change's stretches boxed together, so one box
          // spans words under different marks
          let box: Array<{ change: _Change_Text_; node: HTMLElement }> = [];
          for (const segment of segmentsOf(held.text)) {
            const inside = changes.flatMap((change) => [change.from, change.to]).filter((cut) => cut > segment.from && cut < segment.to);
            const cuts = [...new Set([segment.from, ...inside, segment.to])].toSorted((first, second) => first - second);
            cuts.slice(1).forEach((to, index) => {
              const from = cuts[index] ?? segment.from;
              const stretch = element("span", segmentClass(segment), body.slice(unitsOf(body, from), unitsOf(body, to)));
              const [change] = changes.filter((each) => each.from <= from && each.to >= to);
              const [open] = box;
              if (change === undefined) {
                box = [];
                shownLine.append(stretch);
              } else if (open !== undefined && open.change === change) {
                open.node.append(stretch);
              } else {
                const node = element("span", changeClass[change.kind], "");
                node.append(stretch);
                shownLine.append(node);
                box = [{ change, node }];
              }
            });
          }
          at = content.length;
        }
        shownLine.append(content === "" && note === "" ? " " : content.slice(at));
        if (note !== "") shownLine.append(element("span", styles.mark, content === "" ? `(${note})` : `  (${note})`));
        // wrapped, it goes on under its first character, as the editor's lines do
        const indent = (/^ */.exec(content)?.[0] ?? "").length;
        shownLine.style.paddingLeft = `${indent}ch`;
        shownLine.style.textIndent = `-${indent}ch`;
        shownLine.style.lineHeight = `${height}px`;
        zone.append(shownLine);
      }
      return zone;
    };
    const widgets: Array<monaco.editor.IOverlayWidget> = [];
    // A proposal's actions, under it: Accept, Reject and Request changes on
    // the right. Requesting changes opens a form under them for what should
    // change, its zone growing to make room, and with what's written.
    const actionLines = 2;
    const actions = (item: _Open_Proposal_) => {
      const zone = element("div", styles.proposalActions, "");
      zone.style.top = "-1000px";
      placeHeader(zone);
      widgets.push({ getId: () => `doctor.proposal.${item.proposal}`, getDomNode: () => zone, getPosition: () => null });
      const row = element("div", styles.proposalRow, "");
      row.style.height = `${actionLines * height}px`;
      const accept = element("button", styles.proposalAccept, "Accept");
      const reject = element("button", styles.proposalButton, "Reject");
      const request = element("button", styles.proposalButton, "Request changes");
      row.append(accept, reject, request);
      zone.append(row);

      const form = element("div", styles.changesForm, "");
      const input = window.document.createElement("textarea");
      input.className = styles.changesInput;
      input.rows = 1;
      input.placeholder = "What should change in this proposal?";
      const font = editor.getOption(monaco.editor.EditorOption.fontInfo);
      input.style.fontFamily = font.fontFamily;
      input.style.fontSize = `${font.fontSize}px`;
      input.style.lineHeight = `${font.lineHeight}px`;
      const cancel = element("button", styles.proposalButton, "Cancel");
      const send = element("button", styles.proposalAccept, "Submit");
      const formRow = element("div", styles.taskRow, "");
      formRow.append(element("span", styles.taskHint, "sent back to the agent with this proposal"), cancel, send);
      form.append(input, formRow);

      let room: Array<{ zone: monaco.editor.IViewZone; id: string }> = [];
      const fit = () => {
        const [placed] = room;
        if (placed === undefined) return;
        input.style.height = "auto";
        input.style.height = `${input.scrollHeight + input.offsetHeight - input.clientHeight}px`;
        const lines = actionLines + (form.isConnected ? Math.ceil(form.offsetHeight / height) : 0);
        if (placed.zone.heightInLines === lines) return;
        placed.zone.heightInLines = lines;
        editor.changeViewZones((accessor) => accessor.layoutZone(placed.id));
        // Monaco scrolls to show all of the form, so the field taking the
        // focus never scrolls the page instead
        whenDrawn(() => {
          const bottom = Number.parseFloat(zone.style.top) + lines * height;
          const shown = editor.getLayoutInfo().height;
          if (bottom > shown) editor.setScrollTop(editor.getScrollTop() + bottom - shown);
        });
      };
      const open = () => {
        if (!form.isConnected) zone.append(form);
        fit();
        whenDrawn(() => input.focus({ preventScroll: true }));
      };
      const close = () => {
        form.remove();
        input.value = "";
        fit();
        editor.focus();
      };
      const requestChanges = () => {
        const written = input.value.trim();
        if (written === "") {
          input.focus();
          return;
        }
        hooks.review(item.task, item.proposal, { kind: "request", feedback: written });
      };
      accept.addEventListener("click", () => hooks.review(item.task, item.proposal, { kind: "accept" }));
      reject.addEventListener("click", () => hooks.review(item.task, item.proposal, { kind: "reject", reason: "" }));
      request.addEventListener("click", open);
      cancel.addEventListener("click", close);
      send.addEventListener("click", requestChanges);
      input.addEventListener("input", fit);
      input.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Escape") close();
        if (event.key !== "Enter" || event.shiftKey) return;
        event.preventDefault();
        requestChanges();
      });
      const placed = (placedZone: monaco.editor.IViewZone, id: string) => {
        room = [{ zone: placedZone, id }];
      };
      return { node: zone, placed };
    };
    const added: Array<_Zone_Proposal_> = [];
    const struck: Array<monaco.editor.IModelDeltaDecoration> = [];
    // the lowest line the proposal being drawn reaches, its actions going under it
    let reached: Array<number> = [];
    // A line whose text the proposal changes in place: yellow, its words
    // boxed for what happens to them, as its new version's beneath are. No
    // strikethrough, underline or highlight: a document's own marks use
    // those. Each box is drawn behind the line's text, so one box spans words
    // under different marks.
    const change = (line: number, start: number, body: string, changes: Array<_Change_Text_>) => {
      reached.push(line);
      struck.push({
        range: new monaco.Range(line, 1, line, 1),
        options: { isWholeLine: true, className: styles.changedLine, marginClassName: gutter(line, styles.changedGutter) },
      });
      for (const each of changes) {
        const from = start + unitsOf(body, each.from);
        const to = start + unitsOf(body, each.to);
        if (to > from) struck.push({ range: new monaco.Range(line, from + 1, line, to + 1), options: { className: changeClass[each.kind] } });
      }
    };
    // what's moved away is dimmed where it is, not struck as if it went
    const dim = (from: number, to: number) => {
      for (let line = from; line <= to; line += 1) {
        const content = model.getLineContent(line);
        reached.push(line);
        struck.push({
          range: new monaco.Range(line, 1, line, 1),
          options: { isWholeLine: true, className: styles.movedLine, marginClassName: gutter(line, styles.movedGutter) },
        });
        if (content.length > 0) struck.push({ range: new monaco.Range(line, 1, line, content.length + 1), options: { inlineClassName: styles.moved } });
      }
    };
    const strike = (from: number, to: number) => {
      for (let line = from; line <= to; line += 1) {
        reached.push(line);
        struck.push({
          range: new monaco.Range(line, 1, line, 1),
          options: {
            isWholeLine: true,
            className: styles.removedLine,
            marginClassName: gutter(line, styles.removedGutter),
            lineNumberClassName: styles.removedNumber,
          },
        });
      }
    };
    for (const item of open) {
      reached = [];
      // a text is shown once, as all the proposal's operations leave it
      const changed = new Set<string>();
      const touched: Array<number> = [];
      const pieces: Array<_Zone_Proposal_> = [];
      const add = (after: number, lines: Array<_Line_Proposal_>) => {
        const node = linesZone(lines);
        const boxes = boxesOf(node);
        const rows = Math.max(Math.round(boxes.reduce((sum, box) => sum + box.height, 0) / height), 1);
        pieces.push({ after, node, margin: [marginOf(after, lines, boxes)], lines: rows, level: [], placed: [] });
        touched.push(after + 1);
        reached.push(after);
      };
      let last = 1;
      const operations = realize(item.operations, previewId);
      const previewed = linesAfter(shown, operations);
      // what goes into something this same proposal adds is shown within it
      const intoAdded = (at: _Position_Operation_) =>
        (at.parent.kind === "node" && !index.has(at.parent.node)) || (at.kind === "after" && !index.has(at.sibling));
      for (const operation of operations) {
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
              const [reference = plainLine(`${quoteMarks(quote)}-- ${operation.text}`)] = previewed.holder(holder);
              add(end, [reference]);
              last = end;
              break;
            }
            const key = holder.kind === "title" ? "title" : holder.node;
            if (changed.has(key)) break;
            changed.add(key);
            const content = model.getLineContent(line);
            const start = contentStart(content);
            touched.push(line);
            last = line;
            const [before] = textAt(shown, holder);
            const [after] = previewed.holder(holder);
            const [held] = after?.texts ?? [];
            // a quote's reference written away goes, as its line does
            if (quote !== undefined && after === undefined) {
              strike(line, line);
              break;
            }
            if (before === undefined || after === undefined || held === undefined) {
              strike(line, line);
              add(line, [plainLine(operation.kind === "write" ? `${content.slice(0, start)}${operation.text}` : content)]);
              break;
            }
            const changes = compareTexts(before, held.text);
            change(line, start, content.slice(start), changes.before);
            add(line, [{ ...after, changes: changes.after }]);
            break;
          }
          case "edit": {
            const line = startOf(operation.node);
            if (line === 0) break;
            const end = endOf(operation.node, line);
            touched.push(line);
            if (operation.content.kind === "code") {
              strike(line + 1, end - 1);
              // its lines between the fences, under its quote's marks if it's in one
              const [fenced] = previewed.node(operation.node);
              add(end - 1, fenced === undefined ? operation.content.code.split("\n").map(plainLine) : fenced.slice(1, -1));
            } else {
              const order = operation.content.order === "ordered" ? "numbered" : "bulleted";
              add(line - 1, [{ content: "", texts: [], changes: [], note: `this list becomes ${order}` }]);
            }
            last = end;
            break;
          }
          case "delete": {
            const line = startOf(operation.node);
            if (line === 0) break;
            const end = endOf(operation.node, line);
            strike(line, end);
            touched.push(line);
            last = end;
            break;
          }
          case "insert": {
            if (intoAdded(operation.at)) break;
            const after = placeAfter(operation.at, last);
            const [lines = subtreeLines(shown, operation.subtree)] = previewed.node(operation.subtree.id);
            add(after, lines);
            last = after;
            break;
          }
          case "move": {
            const line = startOf(operation.node);
            const node = index.get(operation.node)?.node;
            if (line === 0 || node === undefined) break;
            dim(line, endOf(operation.node, line));
            touched.push(line);
            if (intoAdded(operation.to)) break;
            const after = placeAfter(operation.to, last);
            const [lines = subtreeLines(shown, node)] = previewed.node(operation.node);
            add(after, lines.map((each, at) => (at === 0 ? { ...each, note: "moved here" } : each)));
            last = after;
            break;
          }
        }
      }
      if (touched.length === 0) continue;
      const top = Math.max(Math.min(...touched) - 1, 0);
      const [first] = proposalAt;
      proposalAt = [first === undefined ? top : Math.min(first, top)];
      const bottom = Math.max(...reached, top);
      const made = actions(item);
      added.push(...pieces, {
        after: bottom,
        // the band is the zone's, out to the editor's edge as what's added
        // is; the actions over it stop short of the scrollbar
        node: element("div", styles.proposalActionsBand, ""),
        margin: [actionsMargin(bottom)],
        lines: actionLines,
        level: [made.node],
        placed: [made.placed],
      });
    }
    proposal.set(struck);
    redecorate();
    headers = widgets;
    for (const widget of headers) editor.addOverlayWidget(widget);
    editor.changeViewZones((accessor) => {
      // a proposal's actions come after what it adds after the same line
      zones = added.map((zone, at) => {
        const placed: monaco.editor.IViewZone = {
          afterLineNumber: zone.after,
          heightInLines: zone.lines,
          domNode: zone.node,
          marginDomNode: zone.margin[0] ?? null,
          ordinal: at,
          suppressMouseDown: true,
          onDomNodeTop: (top) => {
            for (const node of zone.level) node.style.top = `${top}px`;
          },
          onComputedHeight: (computed) => {
            for (const node of zone.level) node.style.height = `${computed}px`;
          },
        };
        const id = accessor.addZone(placed);
        for (const told of zone.placed) told(placed, id);
        return id;
      });
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

  // Sticky scroll keeps a line in view while what it holds scrolls under it:
  // a section's heading, a list item over the items under it, a code
  // block's opening fence. Each spans the lines its node and the nodes in it
  // hold, a code block's inner lines going with its fence; Monaco would
  // otherwise go by indentation, which only list items have.
  const spans = (): Array<monaco.languages.FoldingRange> => {
    const [document] = documents;
    if (document === undefined) return [];
    const index = indexNodes(document.content);
    const kinds = lineKinds();
    const first = new Map<_Id_Node_, number>();
    const last = new Map<_Id_Node_, number>();
    const reach = (node: _Id_Node_, line: number) => {
      last.set(node, line);
      const parent = index.get(node)?.parent;
      if (parent?.kind === "node") reach(parent.node, line);
    };
    let held: Array<_Id_Node_> = [];
    ownersNow().forEach((owner, at) => {
      if (owner.length > 0) held = owner;
      for (const id of owner.length > 0 ? owner : kinds[at] === "code" ? held : []) {
        if (!first.has(id)) first.set(id, at + 1);
        reach(id, at + 1);
      }
    });
    return [...first].flatMap(([id, start]): Array<monaco.languages.FoldingRange> => {
      const node = index.get(id)?.node;
      const end = last.get(id) ?? start;
      const holds = node?.kind === "section" || node?.kind === "code" || (node?.kind === "listItem" && node.children.length > 0);
      return holds && end > start ? [{ start, end }] : [];
    });
  };
  const structure: monaco.languages.FoldingRangeProvider = {
    onDidChange: structureChanged.event,
    provideFoldingRanges: (asked) => (asked === model ? spans() : []),
  };
  const folds = monaco.languages.registerFoldingRangeProvider("doctor", structure);

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

  // A content widget is hidden until Monaco next draws it, and a hidden field
  // can't take the focus, so a widget's field is focused once it's drawn.
  const whenDrawn = (act: () => void) => requestAnimationFrame(() => requestAnimationFrame(act));

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
    whenDrawn(() => {
      linkInput.focus({ preventScroll: true });
      linkInput.select();
    });
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

  // a selection's last line, leaving out one it only reaches the start of
  const lastLineOf = (selection: monaco.Selection) =>
    selection.endColumn === 1 && selection.endLineNumber > selection.startLineNumber
      ? selection.endLineNumber - 1
      : selection.endLineNumber;

  // What the selections point at. One within a single line's words, short
  // of all of them, is a passage of that text. Any other is the blocks it
  // touches, each once: a code block's lines are its block's, and a block
  // inside another goes with it, as does a passage in it.
  const targetsOfSelection = (): Array<_Target_Request_> => {
    const [document] = documents;
    if (document === undefined) return [];
    const owners = ownersNow();
    const kinds = lineKinds();
    const passages: Array<_PASSAGE_Target__Request_> = [];
    const found = new Set<_Id_Node_>();
    for (const selection of editor.getSelections() ?? []) {
      if (selection.isEmpty()) continue;
      const line = selection.startLineNumber;
      const [holder] = holderAt(line, owners);
      const [text] = holder === undefined ? [] : textAt(document, holder);
      const content = model.getLineContent(line);
      const start = contentStart(content);
      const body = content.slice(start);
      const from = selection.startColumn - 1 - start;
      const to = selection.endColumn - 1 - start;
      const words = selection.endLineNumber === line && from >= 0 && to <= body.length && to - from < body.length;
      if (holder !== undefined && text !== undefined && text.text === body && words) {
        const range = { from: parseOwn(offsetSchema, pointsOf(body, from)), to: parseOwn(offsetSchema, pointsOf(body, to)) };
        passages.push({ kind: "passage", document: document.id, holder, range });
        continue;
      }
      for (let at = line; at <= lastLineOf(selection); at += 1) {
        let owned = at;
        while (owned > 1 && kinds[owned - 1] === "code" && (owners[owned - 1] ?? []).length === 0) owned -= 1;
        for (const id of owners[owned - 1] ?? []) found.add(id);
      }
    }
    const index = indexNodes(document.content);
    const inside = (id: _Id_Node_): boolean => {
      const parent = index.get(id)?.parent;
      return parent?.kind === "node" && (found.has(parent.node) || inside(parent.node));
    };
    const nodes = [...found].filter((id) => !inside(id)).map((node): _Target_Request_ => ({ kind: "node", document: document.id, node }));
    const loose = passages.filter((passage) => passage.holder.kind === "title" || !(found.has(passage.holder.node) || inside(passage.holder.node)));
    return [...nodes, ...loose];
  };

  // where the pointer last was over the editor, down from its top
  let pointer: Array<number> = [];
  editor.onMouseMove((event) => {
    const box = editor.getDomNode()?.getBoundingClientRect();
    pointer = box === undefined ? [] : [event.event.browserEvent.clientY - box.top];
  });

  // A new task's form, on lines of its own: below the selection, or above it
  // when the pointer's nearer its top. What's typed stays if it's closed
  // without making the task.
  const taskBox = document.createElement("div");
  taskBox.className = styles.taskBox;
  const taskInput = document.createElement("textarea");
  taskInput.className = styles.taskInput;
  taskInput.rows = 1;
  const taskHint = document.createElement("span");
  taskHint.className = styles.taskHint;
  const makeButton = document.createElement("button");
  makeButton.className = styles.proposalAccept;
  const cancelButton = document.createElement("button");
  cancelButton.className = styles.proposalButton;
  cancelButton.textContent = "Cancel";
  const taskRow = document.createElement("div");
  taskRow.className = styles.taskRow;
  taskRow.append(taskHint, cancelButton, makeButton);

  // What's being drafted, if anything. While a task is being drafted, the
  // form adds to it, and its requests here are marked: in the margin of the
  // lines they're on, a passage's words underlined, the request on hover.
  let drafting: Array<_View_Drafting_> = [];
  const draftingKey = editor.createContextKey<boolean>("doctorDrafting", false);
  const requestMarks = editor.createDecorationsCollection();
  const markRequests = () => {
    const [document] = documents;
    const [draft] = drafting.flatMap((focus) => (focus.kind === "draft" ? [focus] : []));
    if (document === undefined || draft === undefined) {
      requestMarks.clear();
      return;
    }
    const owners = ownersNow();
    const index = indexNodes(document.content);
    const marks: Array<monaco.editor.IModelDeltaDecoration> = [];
    const markLine = (line: number, hoverMessage: monaco.IMarkdownString) =>
      marks.push({ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, linesDecorationsClassName: styles.requestMark, hoverMessage } });
    for (const request of draft.here) {
      const hoverMessage = { value: `request · ${request.text}` };
      for (const target of request.targets) {
        if (target.kind === "node") {
          const entry = index.get(target.node);
          const inside = new Set<string>(entry === undefined ? [] : nodesWithin(entry.node).map((each) => each.id));
          owners.forEach((owner, at) => {
            if (owner.some((id) => inside.has(id))) markLine(at + 1, hoverMessage);
          });
        }
        if (target.kind === "passage") {
          const { holder } = target;
          const line = holder.kind === "title" ? 1 : owners.findIndex((owner) => owner.includes(holder.node)) + 1;
          if (line === 0) continue;
          const content = model.getLineContent(line);
          const start = contentStart(content);
          const body = content.slice(start);
          const range = new monaco.Range(line, start + unitsOf(body, target.range.from) + 1, line, start + unitsOf(body, target.range.to) + 1);
          marks.push({ range, options: { inlineClassName: styles.requestPassage, hoverMessage } });
          markLine(line, hoverMessage);
        }
      }
    }
    requestMarks.set(marks);
  };
  const focusOn = (next: Array<_View_Drafting_>) => {
    drafting = next;
    draftingKey.set(next.length > 0);
    markRequests();
  };
  taskBox.append(taskInput, taskRow);

  // The form takes whole lines of the document, from the text's left edge to
  // the editor's right and not the gutters: an empty zone makes the room,
  // and the form sits level with it in an overlay, as a proposal's header
  // does. It's four lines at least, more when what's in it needs them, and
  // laid out freely inside. Above the selection, the view scrolls with it,
  // so the selection stays where it was.
  let tasking: Array<{
    targets: Array<_Target_Request_>;
    route: _Route_Form_;
    placement: _Placement_Form_;
    selections: Array<monaco.Selection>;
  }> = [];
  const taskOverlay: monaco.editor.IOverlayWidget = { getId: () => "doctor.task", getDomNode: () => taskBox, getPosition: () => null };
  const lineHeight = () => editor.getOption(monaco.editor.EditorOption.lineHeight);
  // What the form is about, coloured as the form is while it's open: the
  // whole line where all its words are selected, blank lines among them
  // too, and just the words selected where only some are. A line the
  // selection only reaches the start of isn't taken.
  const targeted = editor.createDecorationsCollection();
  const targetedMarks = (selections: Array<monaco.Selection>): Array<monaco.editor.IModelDeltaDecoration> =>
    selections
      .filter((each) => !each.isEmpty())
      .flatMap((selection) => {
        const marks: Array<monaco.editor.IModelDeltaDecoration> = [];
        for (let line = selection.startLineNumber; line <= lastLineOf(selection); line += 1) {
          const end = model.getLineMaxColumn(line);
          const from = line === selection.startLineNumber ? selection.startColumn : 1;
          const to = line === selection.endLineNumber ? selection.endColumn : end;
          const whole = from <= contentStart(model.getLineContent(line)) + 1 && to >= end;
          marks.push(
            whole
              ? { range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: styles.targeted } }
              : { range: new monaco.Range(line, from, line, to), options: { className: styles.targeted } },
          );
        }
        return marks;
      });
  const fewestLines = 4;
  // the field grown to what's written, and, inline, the lines the form needs
  const growField = () => {
    taskInput.style.height = "auto";
    taskInput.style.height = `${taskInput.scrollHeight + taskInput.offsetHeight - taskInput.clientHeight}px`;
  };
  const formLines = () => {
    growField();
    taskBox.style.height = "auto";
    const lines = Math.max(fewestLines, Math.ceil(taskBox.scrollHeight / lineHeight()));
    taskBox.style.height = `${lines * lineHeight()}px`;
    return lines;
  };
  // While the form's open, the selection is hidden, so only the form's
  // colour shows over what it's about. Closing gives it back, unless another
  // form replaces this one, and goes back to the editor unless the focus
  // went elsewhere.
  const closeTask = (how: "back" | "away" | "replaced") => {
    const [place] = tasking;
    if (place === undefined) return;
    tasking = [];
    // the page itself never scrolls; if anything ever did scroll it, this
    // puts it back, the bar above the editor in view
    window.scrollTo(0, 0);
    targeted.clear();
    const { placement } = place;
    if (placement.kind === "docked") taskBox.remove();
    else {
      editor.changeViewZones((accessor) => accessor.removeZone(placement.id));
      editor.removeOverlayWidget(taskOverlay);
      if (placement.shift > 0) editor.setScrollTop(editor.getScrollTop() - placement.shift);
    }
    if (how === "back") editor.focus();
    if (how !== "replaced" && place.selections.length > 0) editor.setSelections(place.selections);
  };
  // Monaco scrolls to show all of a form opened or grown below the
  // selection, so focusing its field never scrolls the page instead
  const showTask = (after: number, lines: number) => {
    const bottom = editor.getTopForLineNumber(after) + lineHeight() + lines * lineHeight();
    const height = editor.getLayoutInfo().height;
    if (bottom > editor.getScrollTop() + height) editor.setScrollTop(bottom - height);
  };
  const fitTask = () => {
    const [place] = tasking;
    if (place === undefined) return;
    const { placement } = place;
    if (placement.kind === "docked") {
      growField();
      return;
    }
    const before = placement.zone.heightInLines ?? 0;
    const lines = formLines();
    if (lines === before) return;
    placement.zone.heightInLines = lines;
    editor.changeViewZones((accessor) => accessor.layoutZone(placement.id));
    if (placement.above === "below") {
      showTask(placement.zone.afterLineNumber, lines);
      return;
    }
    const more = (lines - before) * lineHeight();
    placement.shift += more;
    editor.setScrollTop(editor.getScrollTop() + more);
  };
  // Docked, the form spans the editor's whole width, gutters and all, its
  // contents between the text's left edge and the right gutter's, as the
  // document's lines are. Its purple line runs down the line numbers' left
  // edge, and its band starts there, with nothing left of it.
  const docked = ["padding-left", "padding-right", "box-shadow", "background-color", "background-image"];
  // where the line numbers start, the same however the view's scrolled:
  // where the last line's does
  const numbersLeft = (): number => numberLeft(numberColumn(), model.getLineCount());
  let toldNumbers: Array<number> = [];
  const tellNumbers = () => {
    const left = Math.round(numbersLeft() * 2) / 2;
    if (toldNumbers.includes(left)) return;
    toldNumbers = [left];
    hooks.numbers(left);
  };
  editor.onDidChangeModelContent(() => whenDrawn(tellNumbers));
  const placeDocked = () => {
    const info = editor.getLayoutInfo();
    const left = numbersLeft();
    const purple = "var(--vscode-charts-purple, #b180d7)";
    const band = "color-mix(in srgb, var(--vscode-editor-foreground) 6%, transparent)";
    taskBox.style.paddingLeft = `${info.contentLeft}px`;
    taskBox.style.paddingRight = `${info.verticalScrollbarWidth + info.minimap.minimapWidth}px`;
    taskBox.style.boxShadow = "none";
    taskBox.style.backgroundColor = "transparent";
    taskBox.style.backgroundImage = `linear-gradient(to right, transparent ${left}px, ${purple} ${left}px ${left + 3}px, ${band} ${left + 3}px)`;
  };
  editor.onDidLayoutChange(() => {
    const [place] = tasking;
    if (place?.placement.kind === "inline") placeHeader(taskBox);
    if (place?.placement.kind === "docked") placeDocked();
    whenDrawn(tellNumbers);
  });
  // One form for a request about a selection and about the whole document.
  // A quick task is this one request, started at once; drafting adds it to
  // the task being drafted. For a selection, the form is among its lines,
  // and what it's about is coloured; for the document, or when nothing's
  // selected, it's docked under the bar, across the whole width.
  const openTask = (route: _Route_Form_, about: "selection" | "document") => {
    const [document] = documents;
    if (document === undefined) return;
    const selection = editor.getSelection();
    const selections = editor.getSelections() ?? [];
    const chosen = about === "selection" ? targetsOfSelection() : [];
    const [picked] = selection === null || chosen.length === 0 ? [] : [selection];
    const targets: Array<_Target_Request_> = picked === undefined ? [{ kind: "document", document: document.id }] : chosen;
    closeTask("replaced");
    makeButton.textContent = route === "quick" ? "Start task" : "Add to draft";
    taskHint.textContent = route === "quick" ? "quick task, started now" : "added to the task you're drafting";
    taskInput.placeholder = picked === undefined ? "What should change in this document?" : "What should change here?";
    taskBox.classList.remove(styles.taskInvalid);
    if (picked !== undefined) {
      targeted.set(targetedMarks(selections));
      editor.setSelection(new monaco.Selection(picked.startLineNumber, picked.startColumn, picked.startLineNumber, picked.startColumn));
    }
    const font = editor.getOption(monaco.editor.EditorOption.fontInfo);
    taskBox.style.fontFamily = font.fontFamily;
    taskBox.style.fontSize = `${font.fontSize}px`;
    taskBox.style.lineHeight = `${font.lineHeight}px`;
    if (picked === undefined) {
      // docked, it takes its own height, so the inline layout's is cleared
      for (const property of ["position", "top", "left", "width", "height"]) taskBox.style.removeProperty(property);
      placeDocked();
      dock.append(taskBox);
      growField();
      tasking = [{ targets, route, placement: { kind: "docked" }, selections }];
      whenDrawn(() => taskInput.focus({ preventScroll: true }));
      return;
    }
    for (const property of docked) taskBox.style.removeProperty(property);
    placeHeader(taskBox);
    taskBox.style.top = "-1000px";
    editor.addOverlayWidget(taskOverlay);
    const lines = formLines();
    // beside the selection: above it when the pointer's nearer its top and
    // there's room on screen, below it otherwise; at the top for the document
    const place = (): { after: number; above: "above" | "below" } => {
      const first = picked.startLineNumber;
      const last = lastLineOf(picked);
      const top = editor.getScrolledVisiblePosition({ lineNumber: first, column: 1 });
      const bottom = editor.getScrolledVisiblePosition({ lineNumber: last, column: 1 });
      const [y] = pointer;
      const nearerTop =
        y !== undefined && top !== null && bottom !== null && Math.abs(y - top.top) < Math.abs(y - (bottom.top + bottom.height));
      return nearerTop && top !== null && top.top >= lines * lineHeight() ? { after: first - 1, above: "above" } : { after: last, above: "below" };
    };
    const { after, above } = place();
    const zone: monaco.editor.IViewZone = {
      afterLineNumber: after,
      heightInLines: lines,
      domNode: window.document.createElement("div"),
      onDomNodeTop: (at) => {
        taskBox.style.top = `${at}px`;
      },
      onComputedHeight: (height) => {
        taskBox.style.height = `${height}px`;
      },
    };
    const ids: Array<string> = [];
    editor.changeViewZones((accessor) => {
      ids.push(accessor.addZone(zone));
    });
    const [id] = ids;
    if (id === undefined) return;
    const shift = above === "above" ? lines * lineHeight() : 0;
    if (shift > 0) editor.setScrollTop(editor.getScrollTop() + shift);
    else showTask(after, lines);
    tasking = [{ targets, route, placement: { kind: "inline", zone, id, above, shift }, selections }];
    whenDrawn(() => taskInput.focus({ preventScroll: true }));
  };
  const submitTask = () => {
    const [place] = tasking;
    const written = taskInput.value.trim();
    if (place === undefined) return;
    if (written === "") {
      taskBox.classList.add(styles.taskInvalid);
      taskInput.focus();
      return;
    }
    if (place.route === "draft") hooks.addRequest(place.targets, written);
    else hooks.makeTask(place.targets, written);
    taskInput.value = "";
    closeTask("back");
  };
  taskInput.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") closeTask("back");
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    submitTask();
  });
  taskInput.addEventListener("input", () => {
    taskBox.classList.remove(styles.taskInvalid);
    fitTask();
  });
  makeButton.addEventListener("click", submitTask);
  cancelButton.addEventListener("click", () => closeTask("back"));
  // closed when the focus leaves it, not when it moves to one of its buttons
  taskBox.addEventListener("focusout", (event) => {
    if (!(event.relatedTarget instanceof Node && taskBox.contains(event.relatedTarget))) closeTask("away");
  });
  // What the right-click offers depends on whether a task is being drafted,
  // and on whether anything's selected: with a selection, requests about
  // it; without, requests about the whole document.
  const offer = (id: string, label: string, when: string, run: () => void) =>
    editor.addAction({ id, label, contextMenuGroupId: "0_doctor", precondition: when, run });
  const selected = "editorHasSelection";
  offer("doctor.quickTask", "doctor: quick task", `!doctorDrafting && ${selected}`, () => openTask("quick", "selection"));
  offer("doctor.draft", "doctor: draft a task", `!doctorDrafting && ${selected}`, () => {
    hooks.beginDrafting();
    openTask("draft", "selection");
  });
  offer("doctor.quickTaskDocument", "doctor: quick task for this document", `!doctorDrafting && !${selected}`, () =>
    openTask("quick", "document"),
  );
  offer("doctor.draftDocument", "doctor: draft a task for this document", `!doctorDrafting && !${selected}`, () => {
    hooks.beginDrafting();
    openTask("draft", "document");
  });
  offer("doctor.addToDraft", "doctor: add to the draft", `doctorDrafting && ${selected}`, () => openTask("draft", "selection"));
  offer("doctor.addDocumentToDraft", "doctor: add a request for this document to the draft", `doctorDrafting && !${selected}`, () =>
    openTask("draft", "document"),
  );
  offer("doctor.stopDrafting", "doctor: stop drafting", "doctorDrafting", () => hooks.stopDrafting());

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
    focus: focusOn,
    requestForDocument: (route) => openTask(route, "document"),
    revealProposals: () => {
      const [line] = proposalAt;
      if (line !== undefined) editor.revealLineInCenter(Math.min(line + 1, model.getLineCount()));
    },
    dispose: () => {
      observer.disconnect();
      folds.dispose();
      structureChanged.dispose();
      hover.dispose();
      editor.dispose();
      model.dispose();
    },
  };
}
