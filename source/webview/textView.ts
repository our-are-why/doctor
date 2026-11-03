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
import { contentStart, fencePattern, project, startsBlock, type _Projection_ } from "../shared/projection.ts";
import { realize } from "../shared/proposals.ts";
import type { _Open_Proposal_, _Verdict_Review_, _View_Drafting_ } from "../shared/protocol.ts";
import { changeIdSchema, nodeIdSchema, offsetSchema } from "../shared/schema.ts";
import { readTarget, writeTarget } from "../shared/target.ts";
import { changedRuns, compareTexts, lengthOf, relink, segmentsOf, toggleContrast, type _Change_Text_, type _Segment_Text_ } from "../shared/text.ts";
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
  ];
  monaco.languages.register({ id: "doctor" });
  monaco.languages.setLanguageConfiguration("doctor", { onEnterRules });
  const fence = "^```";
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
// number and a quote's fence dimmed, an escaping backslash as nothing. They stay characters, so they're edited like any text; the
// one that changes width says so, for Monaco to measure.
interface _Piece_Mark_ {
  from: number;
  to: number;
  className: string;
  spacing: "keeps" | "changes";
}

// A line's marks: a quote's fence, a heading's level and an item's mark,
// drawn quietly, and a backslash that keeps words from reading as a mark,
// which takes no room.
function markPieces(content: string): Array<_Piece_Mark_> {
  const pieces: Array<_Piece_Mark_> = [];
  const piece = (from: number, to: number, className: string, spacing: _Piece_Mark_["spacing"]) => {
    if (to > from) pieces.push({ from, to, className, spacing });
  };
  const fence = /^"{3,}/.exec(content);
  if (fence !== null) {
    piece(0, fence[0].length, styles.mark, "keeps");
    return pieces;
  }
  let at = 0;
  const rest = content;
  const heading = /^#\d+(?= |$)/.exec(rest);
  const item = /^( *)(-|\d+\.) /.exec(rest);
  if (heading !== null) {
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
  replacedRestyled: styles.replacedRestyledWords,
  inserted: styles.insertedWords,
  restyled: styles.restyledWords,
};

// A line a proposal shows: as it's written, with the text it holds and where
// that starts, for its marks to be drawn as the document's are, how that
// text changes, when it's one the proposal changes in place, and a note on
// it, if there's one.
interface _Line_Proposal_ {
  content: string;
  texts: Array<{ start: number; text: _Text_Doctor_; holder: _Holder_Text_ }>;
  changes: Array<_Change_Text_>;
  note: string;
}

const plainLine = (content: string): _Line_Proposal_ => ({ content, texts: [], changes: [], note: "" });

// what's changed in a line since its proposal's round before: nothing, all
// of it, or some of its words
type _Since_Line_ = { kind: "same" } | { kind: "whole" } | { kind: "words"; changes: Array<_Change_Text_> };

// the colour a word's underlined in for what's happened to it since its
// proposal's round before, as it's boxed for what happens to it
const sinceClass: Record<_Change_Text_["kind"], string> = {
  removed: "",
  replaced: styles.sinceChanged,
  replacedRestyled: styles.sinceChanged,
  inserted: styles.sinceInserted,
  restyled: styles.sinceChanged,
};

// a node's lines as a proposal would leave the document, and whether a blank
// line comes before and after them there
interface _Lines_After_ {
  lines: Array<_Line_Proposal_>;
  before: "blank" | "none";
  after: "blank" | "none";
}

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
  // among zones after the same line, the lower first: a line's new version,
  // then what's added, the deeper first
  rank: number;
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
    // room for a quote's bar and a request's mark side by side, the text's
    // inset making up the rest, so the text is where it would be with 14
    lineDecorationsWidth: 10,
    folding: false,
    glyphMargin: false,
    scrollBeyondLastLine: false,
    // room below the last line, as the bar gives above the first
    padding: { bottom: 24 },
    stickyScroll: { enabled: true, defaultModel: "foldingProviderModel" },
    // the text's set in from its edge, so Monaco measures where characters
    // are rather than work it out from their count
    disableMonospaceOptimizations: true,
    // said when typing on a line a proposal's changing, which is locked
    readOnlyMessage: { value: "A proposal is changing this line: decide it, or reopen it, before editing the line yourself." },
    quickSuggestions: false,
    suggestOnTriggerCharacters: false,
    wordBasedSuggestions: "off",
    links: false,
    occurrencesHighlight: "off",
    unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false },
    renderLineHighlight: "gutter",
    fixedOverflowWidgets: true,
  });

  // The text is set in this far from its edge, where Monaco clips it, so
  // what's drawn around words at the start of a row, a change's box, has room
  // there: the document's lines, the sticky ones, and a proposal's added
  // lines and bar, alike. The margin's narrower by as much, so the text
  // doesn't move.
  const textInset = 4;
  host.style.setProperty("--text-inset", `${textInset}px`);

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
    const selections = editor.getSelections() ?? [];
    // a line a proposal would change, which shows its syntax rather than its
    // block's band; the proposal's decorations move with edits, so they say
    // which lines those are
    const targeted = new Set(proposal.getRanges().map((range) => range.startLineNumber));
    const scopes = quoteScopes();
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
      // A quote's lines, its fences and all between them, carry its bar in
      // the margin, where wrapped rows can't run over it, on the band code
      // has, but where a proposal's under review.
      if ((scopes[at] ?? "") !== "") {
        margin(line, styles.quote);
        if (!targeted.has(line)) whole(line, styles.quoted);
      }
      if (code === "inside") {
        const closing = content === "```";
        if (!targeted.has(line)) whole(line, closing ? styles.codeEnd : styles.code);
        if (closing) {
          inline(line, 0, content.length, styles.fence);
          code = "outside";
        }
        return;
      }
      const [owner] = owners[at] ?? [];
      const node = owner === undefined ? undefined : index.get(owner)?.node;
      if (node?.kind === "code") {
        if (!targeted.has(line)) whole(line, styles.codeStart);
        inline(line, 0, 3, styles.fence);
        inline(line, 3, content.length, styles.language);
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
        const from = start + unitsOf(body, segment.from);
        const to = start + unitsOf(body, segment.to);
        // monospace is drawn in another face, so Monaco's told it changes
        // the characters' widths, and measures the line rather than assume them
        if (segment.contrast.includes("monospace") && to > from) {
          decorations.push({
            range: new monaco.Range(line, from + 1, line, to + 1),
            options: { inlineClassName: segmentClass(segment), inlineClassNameAffectsLetterSpacing: true },
          });
        } else inline(line, from, to, segmentClass(segment));
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
        .flatMap((place) => textAt(document, place.holder).map((text) => ({ start: place.start, text, holder: place.holder }))),
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
      return {
        node: (_node: _Id_Node_): Array<_Lines_After_> => [],
        holder: (_holder: _Holder_Text_): Array<_Line_Proposal_> => [],
        all: (): Array<_Line_Proposal_> => [],
      };
    }
    const projection = project(applied.document);
    const index = indexNodes(applied.document.content);
    const node = (id: _Id_Node_): Array<_Lines_After_> => {
      const entry = index.get(id);
      if (entry === undefined) return [];
      const inside = new Set<string>(nodesWithin(entry.node).map((each) => each.id));
      const start = projection.owners.findIndex((owner) => owner.some((owned) => inside.has(owned)));
      if (start === -1) return [];
      let end = start;
      for (let at = start + 1; at < projection.lines.length; at += 1) {
        const owner = projection.owners[at] ?? [];
        if (owner.length > 0 && !owner.some((owned) => inside.has(owned))) break;
        if ((projection.lines[at] ?? "").trim() !== "") end = at;
      }
      const blank = (at: number): "blank" | "none" => ((projection.lines[at] ?? "x").trim() === "" ? "blank" : "none");
      return [{ lines: proposalLines(applied.document, projection, start, end + 1), before: blank(start - 1), after: blank(end + 1) }];
    };
    const holder = (wanted: _Holder_Text_): Array<_Line_Proposal_> =>
      projection.places
        .filter((place) => (place.holder.kind === "node" && wanted.kind === "node" ? place.holder.node === wanted.node : place.holder.kind === wanted.kind))
        .flatMap((place) => proposalLines(applied.document, projection, place.line, place.line + 1));
    const all = () => proposalLines(applied.document, projection, 0, projection.lines.length);
    return { node, holder, all };
  };

  // What's changed in a proposal since its round before, as each leaves the
  // document: line by line, marks included, then word by word where a line
  // changed. Found for a line drawn by the text it holds, or by what it
  // reads, unless that's the same for lines changed differently.
  const sinceBefore = (shown: _Document_Doctor_, item: _Open_Proposal_, now: () => Array<_Line_Proposal_>) => {
    const same = (_line: _Line_Proposal_): _Since_Line_ => ({ kind: "same" });
    const was = item.before.flatMap((operations) => linesAfter(shown, realize(operations, previewId)).all());
    const lines = was.length === 0 ? [] : now();
    if (lines.length === 0) return same;
    // its text, when that's all it reads after its markers
    const wholeText = (line: _Line_Proposal_) => line.texts.filter((held) => line.content.slice(held.start) === held.text.text).slice(0, 1);
    const keysOf = (line: _Line_Proposal_) => [
      ...wholeText(line).map((held) => `text ${held.holder.kind === "node" ? held.holder.node : "title"} ${held.text.text}`),
      `line ${line.content}`,
    ];
    const found = new Map<string, _Since_Line_>();
    const mixed = new Set<string>();
    const record = (line: _Line_Proposal_, since: _Since_Line_) => {
      for (const key of keysOf(line)) {
        const known = found.get(key);
        if (known !== undefined && JSON.stringify(known) !== JSON.stringify(since)) mixed.add(key);
        found.set(key, since);
      }
    };
    const signature = (line: _Line_Proposal_) => `${line.content} ${JSON.stringify(line.texts.map((held) => held.text.overlay))}`;
    const runs = changedRuns(was.map(signature), lines.map(signature));
    const changed = new Set(runs.flatMap((run) => lines.slice(run.newFrom, run.newTo)));
    for (const line of lines) if (!changed.has(line)) record(line, { kind: "same" });
    for (const run of runs) {
      lines.slice(run.newFrom, run.newTo).forEach((line, at) => {
        const [old] = run.from + at < run.to ? was.slice(run.from + at, run.from + at + 1) : [];
        const [before] = old === undefined ? [] : wholeText(old);
        const [after] = wholeText(line);
        if (before === undefined || after === undefined) {
          record(line, { kind: "whole" });
          return;
        }
        const changes = compareTexts(before.text, after.text).after;
        record(line, changes.length === 0 ? { kind: "same" } : { kind: "words", changes });
      });
    }
    return (line: _Line_Proposal_): _Since_Line_ => {
      const [key] = keysOf(line).filter((each) => found.has(each) && !mixed.has(each));
      return (key === undefined ? undefined : found.get(key)) ?? { kind: "same" };
    };
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
  // decided proposals peeked at: shown as they'd change their lines, the
  // lines as they are beside what they'd become
  const peeked = new Set<_Id_Proposal_>();
  // Changes batched on a proposal, kept while the proposals are drawn again,
  // to be sent back together: each a note on words of its proposed text, or
  // on the whole of it. Their words are marked dotted where they are, as a
  // task's requests being drafted are, and the words a change is being
  // written about purple, as the request form's, through the browser's
  // highlights, which leave the text as it is.
  const batches = new Map<_Id_Proposal_, Array<{ words: string; within: string; note: string }>>();
  // what's written for the whole of a proposal in the form under its bar, and
  // which of those forms are open, kept while the proposals are drawn again;
  // and how to open each, from its lines' menu
  const wholes = new Map<_Id_Proposal_, string>();
  const opened = new Set<_Id_Proposal_>();
  let openers = new Map<_Id_Proposal_, () => void>();
  const marking = typeof Highlight === "function" ? [{ batched: new Highlight(), writing: new Highlight() }] : [];
  for (const each of marking) {
    CSS.highlights.set("doctor-batched", each.batched);
    CSS.highlights.set("doctor-writing", each.writing);
  }
  // A right-click menu over a proposal's lines, which Monaco's own menu never
  // reaches: the offers the document's selection has, for the proposal.
  const menu = window.document.createElement("div");
  menu.className = styles.proposalMenu;
  const closeMenu = () => menu.remove();
  const openMenu = (event: MouseEvent, offers: Array<{ label: string; run: () => void }>) => {
    menu.replaceChildren(
      ...offers.map(({ label, run }) => {
        const offer = window.document.createElement("button");
        offer.type = "button";
        offer.textContent = label;
        offer.addEventListener("click", () => {
          closeMenu();
          run();
        });
        return offer;
      }),
    );
    // at the pointer, kept in the window: moved left where it would go past
    // the right edge, and opened upward where it would go past the bottom
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;
    window.document.body.append(menu);
    const box = menu.getBoundingClientRect();
    const margin = 4;
    if (box.right > window.innerWidth - margin) menu.style.left = `${Math.max(window.innerWidth - box.width - margin, margin)}px`;
    if (box.bottom > window.innerHeight - margin) menu.style.top = `${Math.max(event.clientY - box.height, margin)}px`;
  };
  window.addEventListener("mousedown", (event) => {
    if (!(event.target instanceof Node) || !menu.contains(event.target)) closeMenu();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });
  // where a moved block's label, on the line it moves from, goes to
  let jumps = new Map<number, number>();
  // what accepted proposals changed, marked apart from what's under review,
  // so those lines keep their blocks' bands
  const decided = editor.createDecorationsCollection();
  // The lines proposals change, locked while one's waiting for review, being
  // revised, or accepted, to apply as the task completes: an edit there would
  // leave it no longer fitting. Marked so the lock moves with edits around
  // them; while the caret or a selection touches one, the editor's read-only,
  // which catches typing, pasting and cutting alike. A rejected one changes
  // nothing, so it locks nothing.
  const locks = editor.createDecorationsCollection();
  const lockedLines = () => new Set(locks.getRanges().map((range) => range.startLineNumber));
  const lockIfTouched = () => {
    const locked = lockedLines();
    const touches = (editor.getSelections() ?? []).some((selection) => {
      for (let line = selection.startLineNumber; line <= selection.endLineNumber; line += 1) if (locked.has(line)) return true;
      return false;
    });
    editor.updateOptions({ readOnly: touches });
  };
  editor.onDidChangeCursorSelection(lockIfTouched);
  // Monaco hides lines for folding, through a method its public types leave
  // out: an accepted proposal hides what it replaces, removes or moves away,
  // so the document reads as it will once the task completes
  const hideLines = (ranges: Array<monaco.IRange>) => {
    if ("setHiddenAreas" in editor && typeof editor.setHiddenAreas === "function") editor.setHiddenAreas(ranges);
  };
  editor.onMouseDown((event) => {
    const { target } = event;
    if (target.type !== monaco.editor.MouseTargetType.CONTENT_TEXT || !target.element?.classList.contains(styles.moveLabel)) return;
    const to = jumps.get(target.position.lineNumber);
    if (to !== undefined) editor.revealLineInCenter(Math.min(Math.max(to, 1), model.getLineCount()));
  });

  const clearProposals = () => {
    editor.changeViewZones((accessor) => {
      for (const zone of zones) accessor.removeZone(zone);
    });
    zones = [];
    for (const widget of headers) editor.removeOverlayWidget(widget);
    headers = [];
    proposalAt = [];
    jumps = new Map();
    openers = new Map();
    // what was marked was in the lines drawn, gone now
    for (const each of marking) {
      each.batched.clear();
      each.writing.clear();
    }
    closeMenu();
    proposal.clear();
    decided.clear();
    locks.clear();
    lockIfTouched();
    hideLines([]);
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
      const info = editor.getLayoutInfo();
      node.style.width = `${info.width - info.contentLeft - info.verticalScrollbarWidth - info.minimap.minimapWidth}px`;
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
    // a line's height, for what's hatched to run on from line to line
    host.style.setProperty("--line", `${height}px`);
    const digits = [styles.digits1, styles.digits2, styles.digits3, styles.digits4, styles.digits5];
    const gutter = (line: number, className: string) => `${className} ${digits[Math.min(String(line).length, digits.length) - 1] ?? ""}`;
    const actionsMargin = (after: number, tint: string) => {
      const margin = element("div", `${styles.proposalActionsMargin} ${tint}`, "");
      margin.style.setProperty("--left", `${numberLeft(column, Math.max(after, 1))}px`);
      return margin;
    };
    const marginOf = (after: number, tint: string) => {
      const margin = element("div", `${styles.proposalMargin} ${tint}`, "");
      margin.style.setProperty("--left", `${numberLeft(column, Math.max(after, 1))}px`);
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
        if (model.getLineContent(at).trim() !== "") last = at;
      }
      return last;
    };
    // What's added or moved, with the blank line the document would have
    // before or after it where it goes, where the lines it's put between don't
    // have one already: a block among blocks has one, an item among items
    // none.
    const spaced = (lines: _Lines_After_, after: number): Array<_Line_Proposal_> => {
      const blankAt = (line: number) => line < 1 || line > model.getLineCount() || model.getLineContent(line).trim() === "";
      return [
        ...(lines.before === "blank" && !blankAt(after) ? [plainLine("")] : []),
        ...lines.lines,
        ...(lines.after === "blank" && !blankAt(after + 1) ? [plainLine("")] : []),
      ];
    };
    // what's added after a line comes after the line's own new version, and
    // the deeper it goes the sooner: into a block the line ends before after
    // that block
    const rankOf = (at: _Position_Operation_): number => {
      let depth = 0;
      let parent: _Parent_Position_ = at.parent;
      while (parent.kind === "node") {
        depth += 1;
        parent = index.get(parent.node)?.parent ?? { kind: "body" };
      }
      return 1000 - depth;
    };
    const placeAfter = (at: _Position_Operation_, fallback: number): number => {
      if (at.kind === "after") {
        const line = startOf(at.sibling);
        return line === 0 ? fallback : endOf(at.sibling, line);
      }
      if (at.parent.kind === "body") return 1;
      // a section's own line is its heading, a quote's its opening fence
      const own = lineOf(at.parent.node);
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
    // what each line drawn shows, for a selection in them to be read
    const linesOf = new WeakMap<Element, _Line_Proposal_>();
    // the words selected in a proposal's lines, a passage of each line's text
    // they're in
    const passagesIn = (lines: HTMLElement): Array<{ words: string; within: string; note: string }> => {
      const selection = window.getSelection();
      if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return [];
      const range = selection.getRangeAt(0);
      return [...lines.querySelectorAll(`.${styles.proposalLine}`)].flatMap((shownLine) => {
        const line = linesOf.get(shownLine);
        const [held] = line?.texts ?? [];
        if (line === undefined || held === undefined || !range.intersectsNode(shownLine)) return [];
        // how far into the line a point is, in its content's units
        const offset = (container: Node, at: number) => {
          const measure = window.document.createRange();
          measure.setStart(shownLine, 0);
          measure.setEnd(container, at);
          return measure.toString().length;
        };
        const from = shownLine.contains(range.startContainer) ? offset(range.startContainer, range.startOffset) : 0;
        const to = shownLine.contains(range.endContainer) ? offset(range.endContainer, range.endOffset) : line.content.length;
        const body = line.content.slice(held.start);
        const words = body.slice(Math.max(from - held.start, 0), Math.max(Math.min(to, line.content.length) - held.start, 0)).trim();
        return words === "" ? [] : [{ words, within: held.text.text, note: "" }];
      });
    };
    // each line with its markers drawn as the editor draws them, and its
    // words marked as they'll be
    const linesZone = (lines: Array<_Line_Proposal_>, tint: string, since: (line: _Line_Proposal_) => _Since_Line_) => {
      const zone = element("div", `${styles.proposalAdded} ${tint}`, "");
      for (const line of lines) {
        const { content, texts, changes, note } = line;
        const lately = since(line);
        const shownLine = element("div", styles.proposalLine, "");
        linesOf.set(shownLine, line);
        let at = 0;
        for (const piece of markPieces(content)) {
          shownLine.append(content.slice(at, piece.from), element("span", piece.className, content.slice(piece.from, piece.to)));
          at = piece.to;
        }
        const [held] = texts;
        const body = held === undefined || held.start < at ? "" : content.slice(held.start);
        if (held !== undefined && body !== "" && body === held.text.text) {
          shownLine.append(content.slice(at, held.start));
          const fresh: Array<_Change_Text_> =
            lately.kind === "words" ? lately.changes : lately.kind === "whole" ? [{ kind: "inserted", from: 0, to: Array.from(body).length }] : [];
          // each stretch under one set of marks, cut where a change starts
          // or ends, and a change's stretches boxed together, so one box
          // spans words under different marks
          let box: Array<{ change: _Change_Text_; node: HTMLElement }> = [];
          for (const segment of segmentsOf(held.text)) {
            const inside = [...changes, ...fresh].flatMap((change) => [change.from, change.to]).filter((cut) => cut > segment.from && cut < segment.to);
            const cuts = [...new Set([segment.from, ...inside, segment.to])].toSorted((first, second) => first - second);
            cuts.slice(1).forEach((to, index) => {
              const from = cuts[index] ?? segment.from;
              const words = element("span", segmentClass(segment), body.slice(unitsOf(body, from), unitsOf(body, to)));
              // underlined, in its own span, where it's changed since the round before
              const [recent] = fresh.filter((each) => each.from <= from && each.to >= to);
              const stretch = recent === undefined ? words : element("span", sinceClass[recent.kind], "");
              if (stretch !== words) stretch.append(words);
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
        // a line that's not one text, new since the round before, underlined
        // after its markers and indent
        const rest = content.slice(at);
        const lead = (/^ */.exec(rest)?.[0] ?? "").length;
        if (lately.kind === "whole" && rest.trim() !== "") {
          shownLine.append(rest.slice(0, lead), element("span", styles.sinceInserted, rest.slice(lead)));
        } else {
          shownLine.append(content === "" && note === "" ? " " : rest);
        }
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
    // A proposal's actions, under it, on the right: Accept, Reject and Request
    // changes while it waits for review, saying which round it's on and what
    // you asked once it's back from revising; once it's decided, saying so,
    // Peek, Reopen and Request changes; while it's revised, a spinner and what
    // you asked, and Peek at what you sent back; and with changes batched on
    // it, how many. Request changes opens a form under it, its batched changes
    // and what should change in the whole of it, to send back together, its
    // zone growing to make room, and with what's written.
    const actionLines = 2;
    // the space left empty before a proposal that starts where another ends,
    // so where one ends and the next begins is plain, in lines
    const gapLines = 0.5;
    // Peek's offered where it shows something: what one rejected would do, or
    // what one accepted hides of the document, which one that only adds
    // doesn't
    const actions = (item: _Open_Proposal_, margin: HTMLElement, hides: "hides" | "nothing") => {
      const zone = element("div", styles.proposalActions, "");
      zone.style.top = "-1000px";
      placeHeader(zone);
      widgets.push({ getId: () => `doctor.proposal.${item.proposal}`, getDomNode: () => zone, getPosition: () => null });
      const row = element("div", styles.proposalRow, "");
      row.style.height = `${actionLines * height}px`;
      const batch = batches.get(item.proposal) ?? [];
      const said = item.feedback === "" ? "" : ` · you asked “${item.feedback}”`;
      const about =
        batch.length > 0
          ? `Drafting · ${batch.length} ${batch.length === 1 ? "amendment" : "amendments"}`
          : item.state === "rejected"
            ? `✕ rejected${item.feedback === "" ? "" : ` · “${item.feedback}”`}`
            : item.state === "accepted"
              ? "✓ accepted · applies when the task completes"
              : item.state === "revising"
                ? item.amendments.length > 0
                  ? "revising"
                  : `revising${said}`
                : item.rounds > 1
                  ? `round ${item.rounds}${item.before.length > 0 ? " · underlined: changed since the round before" : ""}${said}`
                  : "";
      if (item.state === "revising") row.append(element("span", styles.spinner, ""));
      row.append(element("span", styles.proposalRound, about));
      // Request changes opens the form under its bar: its batched changes, each
      // its words and note, and what should change in the whole of it
      const request = element("button", styles.proposalButton, "Amend");
      const changes = [request];
      const peeking = peeked.has(item.proposal);
      const peek = element("button", styles.proposalButton, peeking ? "Close peek" : "Peek");
      peek.addEventListener("click", () => {
        if (peeking) peeked.delete(item.proposal);
        else peeked.add(item.proposal);
        showProposals(showing);
      });
      if (item.state === "revising") {
        // it shows as it was sent back, so there's nothing to peek at
      } else if (item.state === "rejected" || item.state === "accepted") {
        const reopen = element("button", styles.proposalButton, "Reopen");
        reopen.addEventListener("click", () => hooks.review(item.task, item.proposal, { kind: "reopen" }));
        row.append(...(item.state === "accepted" && hides === "nothing" ? [] : [peek]), reopen, ...changes);
      } else {
        const accept = element("button", styles.proposalAccept, "Accept");
        const reject = element("button", styles.proposalButton, "Reject");
        accept.addEventListener("click", () => hooks.review(item.task, item.proposal, { kind: "accept" }));
        reject.addEventListener("click", () => hooks.review(item.task, item.proposal, { kind: "reject", reason: "" }));
        row.append(accept, reject, ...changes);
      }
      zone.append(row);
      // While it's revised, the amendments you requested, under its bar: each
      // its words, or the whole of it, and its note. Measured, so its zone is
      // as tall as its bar and them.
      const requested = item.state === "revising" && item.amendments.length > 0 ? [element("ul", `${styles.batchList} ${styles.amendmentsSent}`, "")] : [];
      for (const list of requested) {
        const count = item.amendments.length;
        list.append(element("li", styles.batchHeading, `Revising · ${count} ${count === 1 ? "amendment" : "amendments"} requested`));
        for (const amendment of item.amendments) {
          const entry = element("li", styles.batchEntry, "");
          const words =
            amendment.words === "" ? element("span", styles.batchWhole, "the whole proposal") : element("span", styles.batchWords, `“${amendment.words}”`);
          entry.append(words, element("span", styles.amendmentNote, amendment.note));
          list.append(entry);
        }
        zone.append(list);
      }
      const extra = requested.length === 0 ? 0 : measured(zone, requested) / height;

      const form = element("div", `${styles.changesForm} ${styles.taskBox}`, "");
      const slice = element("div", `${styles.requestMargin} ${styles.requestSlice}`, "");
      const list = element("ul", styles.batchList, "");
      const input = window.document.createElement("textarea");
      input.className = styles.taskInput;
      input.rows = 1;
      input.placeholder = batch.length > 0 ? "What else should change in this proposal? (optional)" : "What should change in this proposal?";
      input.value = wholes.get(item.proposal) ?? "";
      const font = editor.getOption(monaco.editor.EditorOption.fontInfo);
      input.style.fontFamily = font.fontFamily;
      input.style.fontSize = `${font.fontSize}px`;
      input.style.lineHeight = `${font.lineHeight}px`;
      const discard = element("button", styles.proposalButton, "Discard");
      const cancel = element("button", styles.proposalButton, "Cancel");
      const send = element("button", styles.proposalAccept, "Revise");
      const formRow = element("div", styles.taskRow, "");
      const hint = batch.length > 0 ? "the agent revises it with all of them" : "the agent revises this proposal";
      formRow.append(element("span", styles.taskHint, hint), ...(batch.length > 0 ? [discard] : []), cancel, send);
      if (batch.length > 0) list.append(element("li", styles.batchHeading, `Drafted · ${batch.length} ${batch.length === 1 ? "amendment" : "amendments"}`));
      form.append(list, input, formRow);

      let room: Array<{ zone: monaco.editor.IViewZone; id: string }> = [];
      const fit = () => {
        const [placed] = room;
        if (placed === undefined) return;
        input.style.height = "auto";
        input.style.height = `${input.scrollHeight + input.offsetHeight - input.clientHeight}px`;
        // as tall as the form exactly, so none of the bar's band shows under it
        const pixels = actionLines * height + (form.isConnected ? form.offsetHeight : 0);
        besideForm(margin, form, slice);
        if (placed.zone.heightInPx === pixels) return;
        placed.zone.heightInPx = pixels;
        editor.changeViewZones((accessor) => accessor.layoutZone(placed.id));
        // Monaco scrolls to show all of the form, so the field taking the
        // focus never scrolls the page instead
        whenDrawn(() => {
          const bottom = Number.parseFloat(zone.style.top) + pixels;
          const shown = editor.getLayoutInfo().height;
          if (bottom > shown) editor.setScrollTop(editor.getScrollTop() + bottom - shown);
        });
      };
      // opened, the focus goes to what should change in the whole of it;
      // opened again as the proposals are drawn, it's left where it is
      const open = (focus: "focus" | "leave") => {
        opened.add(item.proposal);
        markAmending(item.proposal);
        if (!form.isConnected) zone.append(form);
        fit();
        if (focus === "focus") whenDrawn(() => input.focus({ preventScroll: true }));
      };
      openers.set(item.proposal, () => open("focus"));
      const close = () => {
        opened.delete(item.proposal);
        wholes.delete(item.proposal);
        markAmending(item.proposal);
        form.remove();
        slice.remove();
        input.value = "";
        fit();
        editor.focus();
      };
      // its batched changes and what's written for the whole of it, sent
      // back together; a change with its note emptied is asked for again
      const sendAll = () => {
        const current = batches.get(item.proposal) ?? [];
        const written = input.value.trim();
        const unnoted = current.findIndex((change) => change.note.trim() === "");
        if (unnoted !== -1) {
          list.querySelectorAll("input")[unnoted]?.focus();
          return;
        }
        if (written === "" && current.length === 0) {
          input.focus();
          return;
        }
        batches.delete(item.proposal);
        wholes.delete(item.proposal);
        opened.delete(item.proposal);
        sendBack(item, [...current, ...(written === "" ? [] : [{ words: "", within: "", note: written }])]);
      };
      // each change batched: its words, or the whole of it, and its note,
      // which can be edited, or the change taken out
      batch.forEach((change, at) => {
        const entry = element("li", styles.batchEntry, "");
        const note = window.document.createElement("input");
        note.className = styles.batchNote;
        note.placeholder = "what should change";
        note.value = change.note;
        note.addEventListener("input", () => {
          const current = batches.get(item.proposal) ?? [];
          batches.set(item.proposal, current.map((each, index) => (index === at ? { ...each, note: note.value } : each)));
        });
        note.addEventListener("keydown", (event) => {
          event.stopPropagation();
          if (event.key === "Escape") close();
          if (event.key !== "Enter") return;
          event.preventDefault();
          sendAll();
        });
        const drop = element("button", styles.dismiss, "×");
        drop.title = "Take this amendment out";
        drop.addEventListener("click", () => {
          const current = batches.get(item.proposal) ?? [];
          batches.set(item.proposal, current.filter((_each, index) => index !== at));
          showProposals(showing);
        });
        const words = change.words === "" ? element("span", styles.batchWhole, "the whole proposal") : element("span", styles.batchWords, `“${change.words}”`);
        entry.append(words, note, drop);
        list.append(entry);
      });
      request.addEventListener("click", () => open("focus"));
      discard.addEventListener("click", () => {
        batches.delete(item.proposal);
        showProposals(showing);
      });
      cancel.addEventListener("click", close);
      send.addEventListener("click", sendAll);
      input.addEventListener("input", () => {
        wholes.set(item.proposal, input.value);
        fit();
      });
      input.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Escape") close();
        if (event.key !== "Enter" || event.shiftKey) return;
        event.preventDefault();
        sendAll();
      });
      const placed = (placedZone: monaco.editor.IViewZone, id: string) => {
        room = [{ zone: placedZone, id }];
        // a form open when the proposals were drawn again is open again, as
        // it was
        if (opened.has(item.proposal)) open("leave");
      };
      return { node: zone, placed, extra };
    };
    // how tall some of an overlay's contents are, laid out out of sight at
    // the overlay's width
    const measured = (overlay: HTMLElement, parts: Array<HTMLElement>) => {
      overlay.style.visibility = "hidden";
      host.append(overlay);
      const tall = parts.reduce((sum, part) => sum + part.offsetHeight, 0);
      overlay.remove();
      overlay.style.removeProperty("visibility");
      return tall;
    };
    // Changes sent back as one request: those on its words as passages, those
    // on the whole of it as what else should change.
    const sendBack = (item: _Open_Proposal_, changes: Array<{ words: string; within: string; note: string }>) => {
      const whole = changes.filter((change) => change.words === "").map((change) => change.note);
      hooks.review(item.task, item.proposal, {
        kind: "request",
        feedback: whole.join("\n"),
        passages: changes.filter((change) => change.words !== ""),
      });
    };
    // how each overlay a change's form can open in grows its zone to fit it,
    // by as many pixels as the form is tall,
    // and its zone's margin, where the form's bar goes beside it
    const growers = new WeakMap<HTMLElement, (extra: number) => void>();
    const marginsOf = new WeakMap<HTMLElement, HTMLElement>();
    // a form's purple bar and band in a proposal's margin, over its own,
    // laid beside the form, as far down and as tall as it is
    const besideForm = (margin: HTMLElement, form: HTMLElement, slice: HTMLElement) => {
      if (!form.isConnected) {
        slice.remove();
        return;
      }
      slice.style.top = `${form.offsetTop}px`;
      slice.style.height = `${form.offsetHeight}px`;
      if (slice.parentElement !== margin) margin.append(slice);
    };
    // The form for a change to words of a proposal: among its lines, under
    // them, as the task form is among the document's lines, purple, the words
    // it's about marked so. Sending it sends the change back now; adding it
    // puts it in the proposal's batch.
    const changeInput = window.document.createElement("textarea");
    changeInput.className = styles.taskInput;
    changeInput.rows = 1;
    const changeHint = element("span", styles.taskHint, "");
    const changeCancel = element("button", styles.proposalButton, "Cancel");
    const changeDone = element("button", styles.proposalAccept, "");
    const changeRow = element("div", styles.taskRow, "");
    changeRow.append(changeHint, changeCancel, changeDone);
    const changeBox = element("div", styles.taskBox, "");
    changeBox.append(changeInput, changeRow);
    const changeSlice = element("div", `${styles.requestMargin} ${styles.requestSlice}`, "");
    let changing: Array<{
      item: _Open_Proposal_;
      host: HTMLElement;
      found: Array<{ words: string; within: string; note: string }>;
      route: "send" | "batch";
    }> = [];
    // While it's amended, with amendments drafted or a form open on it, what's
    // changed in it since its round before isn't underlined, so only what's
    // amended is marked; a form cancelled with nothing drafted underlines it
    // again.
    const linesShown = new Map<_Id_Proposal_, Array<HTMLElement>>();
    const markAmending = (proposal: _Id_Proposal_) => {
      const amending = (batches.get(proposal) ?? []).length > 0 || opened.has(proposal) || changing.some((open) => open.item.proposal === proposal);
      for (const lines of linesShown.get(proposal) ?? []) lines.classList.toggle(styles.amending, amending);
    };
    const fitChange = (host: HTMLElement) => {
      changeInput.style.height = "auto";
      changeInput.style.height = `${changeInput.scrollHeight + changeInput.offsetHeight - changeInput.clientHeight}px`;
      growers.get(host)?.(host.contains(changeBox) ? changeBox.offsetHeight : 0);
      const margin = marginsOf.get(host);
      if (margin !== undefined) besideForm(margin, changeBox, changeSlice);
    };
    const closeChange = () => {
      const [open] = changing;
      changing = [];
      changeBox.remove();
      changeSlice.remove();
      for (const each of marking) each.writing.clear();
      if (open === undefined) return;
      fitChange(open.host);
      markAmending(open.item.proposal);
    };
    const doneChange = () => {
      const [open] = changing;
      const note = changeInput.value.trim();
      if (open === undefined) return;
      if (note === "") {
        changeInput.focus();
        return;
      }
      const changes = open.found.length > 0 ? open.found.map((passage) => ({ ...passage, note })) : [{ words: "", within: "", note }];
      closeChange();
      if (open.route === "send") {
        sendBack(open.item, changes);
        return;
      }
      batches.set(open.item.proposal, [...(batches.get(open.item.proposal) ?? []), ...changes]);
      // the form under its bar shows the draft from its first amendment on
      opened.add(open.item.proposal);
      showProposals(showing);
    };
    changeCancel.addEventListener("click", () => {
      closeChange();
      editor.focus();
    });
    changeDone.addEventListener("click", doneChange);
    changeInput.addEventListener("input", () => {
      const [open] = changing;
      if (open !== undefined) fitChange(open.host);
    });
    changeInput.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        closeChange();
        editor.focus();
      }
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      doneChange();
    });
    const openChange = (
      item: _Open_Proposal_,
      host: HTMLElement,
      found: Array<{ words: string; within: string; note: string }>,
      ranges: Array<Range>,
      route: "send" | "batch",
      under: Array<Element>,
    ) => {
      closeChange();
      changing = [{ item, host, found, route }];
      markAmending(item.proposal);
      for (const each of marking) for (const range of ranges) each.writing.add(range);
      const font = editor.getOption(monaco.editor.EditorOption.fontInfo);
      changeBox.style.fontFamily = font.fontFamily;
      changeBox.style.fontSize = `${font.fontSize}px`;
      changeBox.style.lineHeight = `${font.lineHeight}px`;
      changeInput.value = "";
      changeInput.placeholder = found.length > 0 ? "What should change here?" : "What should change in this proposal?";
      changeHint.textContent = route === "send" ? "quick amendment, the agent revises it now" : "added to the amendments you're drafting";
      changeDone.textContent = route === "send" ? "Revise" : "Add";
      const [line] = under;
      if (line === undefined) host.append(changeBox);
      else line.after(changeBox);
      fitChange(host);
      whenDrawn(() => changeInput.focus({ preventScroll: true }));
    };
    // What a proposal applied already changed, now in the document, accepted
    // before acceptance waited for the task's completion: a check left of the
    // number of each text's or node's first line, neutral, as it's a
    // decision, not a change still on offer.
    const acceptedMarks: Array<monaco.editor.IModelDeltaDecoration> = [];
    const lockMarks: Array<monaco.editor.IModelDeltaDecoration> = [];
    const markAccepted = (item: _Open_Proposal_) => {
      for (const holder of item.changed) {
        const line = holder.kind === "title" ? 1 : startOf(holder.node);
        if (line > 0) acceptedMarks.push({ range: new monaco.Range(line, 1, line, 1), options: { marginClassName: gutter(line, styles.acceptedGutter) } });
      }
    };
    // what a proposal does, for its colour: only removes, only moves, or
    // anything else, adding or changing
    const kindOf = (operations: _Open_Proposal_["operations"]): string =>
      operations.every((operation) => operation.kind === "delete")
        ? styles.removeKind
        : operations.every((operation) => operation.kind === "move")
          ? styles.moveKind
          : "";
    const added: Array<_Zone_Proposal_> = [];
    // each proposal's zones, with the line it starts after and the lines its
    // stretches end on, to be laid out in the document's order
    const laid: Array<{ top: number; zones: Array<_Zone_Proposal_>; ends: Array<number> }> = [];
    // the last line of each run of lines
    const runEnds = (lines: Set<number>) => [...lines].filter((line) => !lines.has(line + 1));
    const struck: Array<monaco.editor.IModelDeltaDecoration> = [];
    const hidden: Array<monaco.IRange> = [];
    // the lowest line the proposal being drawn reaches, its actions going under it
    let reached: Array<number> = [];
    // the lines it targets and how, marked in the margin once its bottom's
    // known, so its bar runs straight from them to its own
    let gutters: Array<{ line: number; band: string }> = [];
    // A line whose text the proposal changes in place: yellow, its words
    // boxed for what happens to them, as its new version's beneath are. No
    // strikethrough, underline or highlight: a document's own marks use
    // those. Each box is drawn behind the line's text, so one box spans words
    // under different marks.
    const change = (line: number, start: number, body: string, changes: Array<_Change_Text_>) => {
      reached.push(line);
      struck.push({ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: styles.changedLine } });
      gutters.push({ line, band: styles.changedGutter });
      for (const each of changes) {
        const from = start + unitsOf(body, each.from);
        const to = start + unitsOf(body, each.to);
        if (to > from) struck.push({ range: new monaco.Range(line, from + 1, line, to + 1), options: { className: changeClass[each.kind] } });
      }
    };
    // a moved block's label on the line it moves from, which goes to where it
    // moves when clicked
    const label = (line: number, content: string, to: number) => {
      const end = model.getLineMaxColumn(line);
      struck.push({
        range: new monaco.Range(line, end, line, end),
        options: { showIfCollapsed: true, after: { content: `  ${content}`, inlineClassName: styles.moveLabel } },
      });
      jumps.set(line, to);
    };
    // what's moved away is dimmed where it is, not struck as if it went
    const dim = (from: number, to: number) => {
      for (let line = from; line <= to; line += 1) {
        const content = model.getLineContent(line);
        reached.push(line);
        struck.push({ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: styles.movedLine } });
        gutters.push({ line, band: styles.movedGutter });
        if (content.length > 0) struck.push({ range: new monaco.Range(line, 1, line, content.length + 1), options: { inlineClassName: styles.moved } });
      }
    };
    const strike = (from: number, to: number) => {
      for (let line = from; line <= to; line += 1) {
        reached.push(line);
        struck.push({
          range: new monaco.Range(line, 1, line, 1),
          options: { isWholeLine: true, className: styles.removedLine, lineNumberClassName: styles.removedNumber },
        });
        gutters.push({ line, band: styles.removedGutter });
      }
    };
    for (const item of open) {
      if (item.state === "applied") {
        markAccepted(item);
        continue;
      }
      // One rejected, and not peeked at, is folded away: where it would change
      // the document is worked out as for one shown, then what was drawn for
      // it put away, its bar left. One accepted shows what it will be. One
      // being revised shows as it was sent back, its lines pulsing while the
      // agent revises them.
      const peeking = peeked.has(item.proposal);
      const folded = item.state === "rejected" && !peeking;
      const hiding = item.state === "accepted" && !peeking;
      // an accepted one shows only what it will be, so what's changed is
      // boxed only when it's peeked at, beside what's there now
      const boxed = item.state !== "accepted" || peeking;
      const drawn = struck.length;
      const kind = kindOf(item.operations);
      // a block only moved is moved, not added
      const tint = kind === styles.moveKind ? kind : "";
      reached = [];
      gutters = [];
      // a text is shown once, as all the proposal's operations leave it
      const changed = new Set<string>();
      const touched: Array<number> = [];
      const pieces: Array<_Zone_Proposal_> = [];
      // Its lines are in an overlay over the zone, as its actions are, as
      // Monaco never gives a zone the mouse, so their words can be selected;
      // the zone beneath holds only its band. Right-clicking them offers what
      // right-clicking the document does, for this proposal, where it takes a
      // request: a change sent back now, or one batched with others, about the
      // words selected, or the whole of it.
      const takes = item.state === "proposed" || item.state === "accepted" || item.state === "rejected";
      const offerChanges = (event: MouseEvent, lines: HTMLElement) => {
        event.preventDefault();
        event.stopPropagation();
        const found = passagesIn(lines);
        const selection = window.getSelection();
        const ranges = found.length > 0 && selection !== null && selection.rangeCount > 0 ? [selection.getRangeAt(0).cloneRange()] : [];
        const [range] = ranges;
        const end = range === undefined ? null : range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement;
        const line = end?.closest(`.${styles.proposalLine}`);
        const under = line === null || line === undefined ? [] : [line];
        // named as the document's offers are, a change to a proposal being an
        // amendment: a quick one, sent back now, or amendments drafted, sent
        // back together
        const drafting = (batches.get(item.proposal) ?? []).length > 0;
        const discard = {
          label: "doctor: discard the draft",
          run: () => {
            batches.delete(item.proposal);
            showProposals(showing);
          },
        };
        if (found.length === 0) {
          const whole = () => openChange(item, lines, [], [], "batch", []);
          openMenu(
            event,
            drafting
              ? [{ label: "doctor: add an amendment for this proposal to the draft", run: whole }, discard]
              : [
                  { label: "doctor: quick amendment for this proposal", run: () => openers.get(item.proposal)?.() },
                  { label: "doctor: draft amendments for this proposal", run: whole },
                ],
          );
          return;
        }
        openMenu(
          event,
          drafting
            ? [{ label: "doctor: add to the draft", run: () => openChange(item, lines, found, ranges, "batch", under) }, discard]
            : [
                { label: "doctor: quick amendment", run: () => openChange(item, lines, found, ranges, "send", under) },
                { label: "doctor: draft amendments", run: () => openChange(item, lines, found, ranges, "batch", under) },
              ],
        );
      };
      // a stretch of a line's content, as a range of what's drawn of it
      const rangeIn = (shownLine: Element, from: number, to: number): Array<Range> => {
        const walker = window.document.createTreeWalker(shownLine, NodeFilter.SHOW_TEXT);
        const range = window.document.createRange();
        let passed = 0;
        let started: "no" | "yes" = "no";
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          const length = node.textContent?.length ?? 0;
          if (started === "no" && from <= passed + length) {
            range.setStart(node, from - passed);
            started = "yes";
          }
          if (started === "yes" && to <= passed + length) {
            range.setEnd(node, to - passed);
            return [range];
          }
          passed += length;
        }
        return [];
      };
      // the words of the amendments being drafted, or, while it's revised,
      // requested, marked where they are in these lines
      const markBatched = (lines: HTMLElement) => {
        for (const change of [...(batches.get(item.proposal) ?? []), ...(item.state === "revising" ? item.amendments : [])]) {
          if (change.words === "") continue;
          for (const shownLine of lines.querySelectorAll(`.${styles.proposalLine}`)) {
            const line = linesOf.get(shownLine);
            const [held] = line?.texts ?? [];
            if (line === undefined || held === undefined || held.text.text !== change.within) continue;
            const at = line.content.indexOf(change.words, held.start);
            if (at === -1) continue;
            for (const each of marking) for (const range of rangeIn(shownLine, at, at + change.words.length)) each.batched.add(range);
            break;
          }
        }
      };
      const zoneOf = (after: number, lines: Array<_Line_Proposal_>, rank: number): _Zone_Proposal_ => {
        const shownLines = linesZone(lines, tint, since);
        if (item.state === "revising") shownLines.classList.add(styles.revisingLines);
        const boxes = boxesOf(shownLines);
        const rows = Math.max(Math.round(boxes.reduce((sum, box) => sum + box.height, 0) / height), 1);
        shownLines.style.top = "-1000px";
        placeHeader(shownLines);
        const id = `doctor.lines.${widgets.length}`;
        widgets.push({ getId: () => id, getDomNode: () => shownLines, getPosition: () => null });
        if (takes) shownLines.addEventListener("contextmenu", (event) => offerChanges(event, shownLines));
        markBatched(shownLines);
        linesShown.set(item.proposal, [...(linesShown.get(item.proposal) ?? []), shownLines]);
        markAmending(item.proposal);
        const margin = marginOf(after, tint);
        marginsOf.set(shownLines, margin);
        return {
          after,
          node: element("div", `${styles.proposalBand} ${tint}`, ""),
          margin: [margin],
          lines: rows,
          level: [shownLines],
          placed: [
            (placedZone, id) => {
              growers.set(shownLines, (extra) => {
                placedZone.heightInPx = rows * height + extra;
                editor.changeViewZones((accessor) => accessor.layoutZone(id));
              });
            },
          ],
          rank,
        };
      };
      // a zone no longer shown takes its lines' overlay with it
      const forget = (zone: _Zone_Proposal_ | undefined) => {
        for (const node of zone?.level ?? []) {
          const at = widgets.findIndex((widget) => widget.getDomNode() === node);
          if (at !== -1) widgets.splice(at, 1);
        }
      };
      const add = (after: number, lines: Array<_Line_Proposal_>, rank: number) => {
        pieces.push(zoneOf(after, lines, rank));
        touched.push(after + 1);
        reached.push(after);
        return pieces.length - 1;
      };
      // What it adds or moves, by the block's id: the zone it's in and its
      // lines there. What it puts right after one of them joins that zone,
      // beneath, so a run of new blocks reads as one.
      const runs = new Map<string, { index: number; lines: _Lines_After_; after: number; rank: number }>();
      const join = (sibling: string, id: string, lines: _Lines_After_): "joined" | "apart" => {
        const run = runs.get(sibling);
        if (run === undefined) return "apart";
        const joined: _Lines_After_ = {
          lines: [...run.lines.lines, ...(lines.before === "blank" ? [plainLine("")] : []), ...lines.lines],
          before: run.lines.before,
          after: lines.after,
        };
        forget(pieces[run.index]);
        pieces[run.index] = zoneOf(run.after, spaced(joined, run.after), run.rank);
        const grown = { ...run, lines: joined };
        runs.set(sibling, grown);
        runs.set(id, grown);
        return "joined";
      };
      let last = 1;
      const operations = realize(item.operations, previewId);
      const previewed = linesAfter(shown, operations);
      // back from revising, what's changed since its round before
      const since = sinceBefore(shown, item, previewed.all);
      // What changes inside a block it moves shows where the block goes, its
      // changed words boxed there, not where it leaves, which only dims.
      const moved = new Set(operations.flatMap((operation) => (operation.kind === "move" ? [operation.node] : [])));
      const inMoved = (node: _Id_Node_): boolean => {
        if (moved.has(node)) return true;
        const parent = index.get(node)?.parent;
        return parent?.kind === "node" && inMoved(parent.node);
      };
      const movedTexts = new Set(
        operations.flatMap((operation) =>
          (operation.kind === "write" || operation.kind === "style") && operation.holder.kind === "node" && inMoved(operation.holder.node)
            ? [operation.holder.node]
            : [],
        ),
      );
      // a line of a moved block, its words boxed where the proposal changes them
      const changedWhereMoved = (line: _Line_Proposal_): _Line_Proposal_ => {
        const [held] = line.texts;
        if (held === undefined || held.holder.kind !== "node" || !movedTexts.has(held.holder.node)) return line;
        const [before] = textAt(shown, held.holder);
        return before === undefined || !boxed ? line : { ...line, changes: compareTexts(before, held.text).after };
      };
      // what goes into something this same proposal adds is shown within it
      const intoAdded = (at: _Position_Operation_) =>
        (at.parent.kind === "node" && !index.has(at.parent.node)) || (at.kind === "after" && !index.has(at.sibling));
      for (const operation of operations) {
        switch (operation.kind) {
          case "write":
          case "style": {
            const { holder } = operation;
            if (holder.kind === "node" && movedTexts.has(holder.node)) break;
            // a quote's reference is on its opening fence, there even when
            // it has none
            const line = holder.kind === "title" ? 1 : lineOf(holder.node);
            if (line === 0) break;
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
            if (before === undefined || after === undefined || held === undefined) {
              strike(line, line);
              add(line, [plainLine(operation.kind === "write" ? `${content.slice(0, start)}${operation.text}` : content)], 0);
              break;
            }
            const changes = compareTexts(before, held.text);
            change(line, start, content.slice(start), changes.before);
            add(line, [{ ...after, changes: boxed ? changes.after : [] }], 0);
            break;
          }
          case "edit": {
            const line = startOf(operation.node);
            if (line === 0 || inMoved(operation.node)) break;
            const end = endOf(operation.node, line);
            touched.push(line);
            if (operation.content.kind === "code") {
              // Compared line by line: a line changed in place is yellow, its
              // words boxed, its new version beneath it; one only removed is
              // red; and what's only added goes beneath where it's added. Its
              // new lines are under its quote's marks if it's in one.
              const was = index.get(operation.node)?.node;
              const oldCode = was?.kind === "code" ? was.code.split("\n") : [];
              const newCode = operation.content.code.split("\n");
              const [fenced] = previewed.node(operation.node);
              const newLines = fenced === undefined ? newCode.map(plainLine) : fenced.lines.slice(1, -1);
              for (const run of changedRuns(oldCode, newCode)) {
                const paired = Math.min(run.to - run.from, run.newTo - run.newFrom);
                const shown: Array<_Line_Proposal_> = [];
                for (let at = 0; at < run.newTo - run.newFrom; at += 1) {
                  const code = newCode[run.newFrom + at] ?? "";
                  const next = newLines[run.newFrom + at] ?? plainLine(code);
                  if (at >= paired) {
                    shown.push(next);
                    continue;
                  }
                  const old = oldCode[run.from + at] ?? "";
                  const docLine = line + 1 + run.from + at;
                  const content = model.getLineContent(docLine);
                  // where the code starts on each line, after any quote's marks
                  const start = content.length - old.length;
                  const changes = compareTexts({ text: old, overlay: [] }, { text: code, overlay: [] });
                  change(docLine, start, content.slice(start), changes.before);
                  const holder: _Holder_Text_ = { kind: "node", node: operation.node };
                  const texts = [{ start: next.content.length - code.length, text: { text: code, overlay: [] }, holder }];
                  shown.push({ ...next, texts, changes: boxed ? changes.after : [] });
                }
                if (run.to - run.from > paired) strike(line + 1 + run.from + paired, line + run.to);
                if (shown.length > 0) add(run.to > run.from ? line + run.to : line + run.from, shown, 0);
              }
            } else {
              const order = operation.content.order === "ordered" ? "numbered" : "bulleted";
              add(line - 1, [{ content: "", texts: [], changes: [], note: `this list becomes ${order}` }], 1);
            }
            last = end;
            break;
          }
          case "delete": {
            const line = startOf(operation.node);
            if (line === 0 || inMoved(operation.node)) break;
            const end = endOf(operation.node, line);
            strike(line, end);
            touched.push(line);
            last = end;
            break;
          }
          case "insert": {
            const [lines = { lines: subtreeLines(shown, operation.subtree), before: "none", after: "none" }] = previewed.node(operation.subtree.id);
            if (operation.at.kind === "after" && join(operation.at.sibling, operation.subtree.id, lines) === "joined") break;
            if (intoAdded(operation.at)) break;
            // into a block it moves, it's in that block where it goes
            if (operation.at.parent.kind === "node" && inMoved(operation.at.parent.node)) break;
            const after = placeAfter(operation.at, last);
            const rank = rankOf(operation.at);
            runs.set(operation.subtree.id, { index: add(after, spaced(lines, after), rank), lines, after, rank });
            last = after;
            break;
          }
          case "move": {
            const line = startOf(operation.node);
            const node = index.get(operation.node)?.node;
            if (line === 0 || node === undefined) break;
            const end = endOf(operation.node, line);
            dim(line, end);
            touched.push(line);
            const [lines = { lines: subtreeLines(shown, node), before: "none", after: "none" }] = previewed.node(operation.node);
            const noted = {
              ...lines,
              lines: lines.lines.map(changedWhereMoved).map((each, at) => (at === 0 ? { ...each, note: `moved from line ${line}` } : each)),
            };
            const moved = (after: number) => {
              const where = after === 0 ? "to the top" : `below line ${after}`;
              label(line, after < line ? `↑ moves ${where}` : `↓ moves ${where}`, after + 1);
            };
            if (operation.to.kind === "after" && join(operation.to.sibling, operation.node, noted) === "joined") {
              moved(runs.get(operation.node)?.after ?? line);
              break;
            }
            if (intoAdded(operation.to)) break;
            const after = placeAfter(operation.to, last);
            moved(after);
            const rank = rankOf(operation.to);
            runs.set(operation.node, { index: add(after, spaced(noted, after), rank), lines: noted, after, rank });
            last = after;
            break;
          }
        }
      }
      if (touched.length === 0) continue;
      const top = Math.max(Math.min(...touched) - 1, 0);
      const bottom = Math.max(...reached, top);
      // the lines it marks in the document, whole, locked unless it's rejected
      const marked = new Set(struck.slice(drawn).flatMap((each) => (each.options.isWholeLine === true ? [each.range.startLineNumber] : [])));
      if (item.state !== "rejected") {
        for (const line of marked) lockMarks.push({ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true } });
      }
      // Folded, what it would do is put away, its lines reading as they are,
      // tied to its bar by a grey bar of its own beside them. That's marked
      // apart from what's under review, so they keep their blocks' bands.
      // one rejected, folded, is grey, a decision
      if (folded) {
        struck.length = drawn;
        for (const piece of pieces) forget(piece);
        for (const line of marked) {
          acceptedMarks.push({
            range: new monaco.Range(line, 1, line, 1),
            options: { isWholeLine: true, className: styles.decidedLine, marginClassName: gutter(bottom, styles.decidedGutter) },
          });
        }
        const ends = [...runEnds(marked), bottom];
        const tone = styles.decidedKind;
        const footing = actionsMargin(bottom, tone);
        const made = actions(item, footing, "hides");
        const footer: _Zone_Proposal_ = {
          after: bottom,
          node: element("div", `${styles.proposalActionsBand} ${tone}`, ""),
          margin: [footing],
          lines: actionLines + made.extra,
          level: [made.node],
          placed: [made.placed],
          rank: 0,
        };
        laid.push({ top, zones: [footer], ends });
        continue;
      }
      // accepted, what it replaces, removes or moves away is hidden, not
      // marked, and only what it will be is shown, unless it's peeked at
      if (hiding) {
        for (const line of marked) hidden.push(new monaco.Range(line, 1, line, model.getLineMaxColumn(line)));
        struck.length = drawn;
      }
      if (item.state === "proposed") {
        const [first] = proposalAt;
        proposalAt = [first === undefined ? top : Math.min(first, top)];
      }
      // one rejected peeked at is neutral: what it would do keeps its colours,
      // but its bar is a decision's
      const bar = item.state === "rejected" ? styles.decidedKind : kind;
      const footing = actionsMargin(bottom, bar);
      const made = actions(item, footing, marked.size > 0 ? "hides" : "nothing");
      // its bar runs beside the lines it targets, by what each becomes, and
      // what it adds, all lined up with the number of the line its own bar's
      // under
      for (const target of gutters) {
        // the whole line, so a line that wraps has it beside every row
        struck.push({
          range: new monaco.Range(target.line, 1, target.line, 1),
          options: { isWholeLine: true, marginClassName: `${gutter(bottom, `${styles.targetGutter} ${target.band}`)} ${bar}` },
        });
      }
      for (const piece of pieces) {
        for (const margin of piece.margin) margin.style.setProperty("--left", `${numberLeft(column, Math.max(bottom, 1))}px`);
      }
      const footer: _Zone_Proposal_ = {
        after: bottom,
        // the band is the zone's, out to the editor's edge as what's added
        // is; the actions over it stop short of the scrollbar
        node: element("div", `${styles.proposalActionsBand} ${bar}`, ""),
        margin: [footing],
        lines: actionLines + made.extra,
        level: [made.node],
        placed: [made.placed],
        // with what it shows after the same line, if anything, or else right
        // under the lines it's about
        rank: Math.min(...pieces.filter((piece) => piece.after === bottom).map((piece) => piece.rank), ...(pieces.some((piece) => piece.after === bottom) ? [] : [0])),
      };
      // what it hides isn't a stretch of it that shows
      const ends = [...runEnds(hiding ? new Set() : marked), ...pieces.map((piece) => piece.after), bottom];
      laid.push({ top, zones: [...pieces, footer], ends });
    }
    // In the document's order, a proposal that starts where another ends, on
    // the line another's lines or zones end on, starts with a space left
    // empty, so where one ends and the next begins is plain. None ends with
    // one.
    // Zones after the same line go by their rank, then by where their
    // proposals start, then in each proposal's own order.
    const gaps = new Set<_Zone_Proposal_>();
    const gapAfter = (after: number, rank: number): _Zone_Proposal_ => {
      const gap = { after, node: element("div", "", ""), margin: [], lines: gapLines, level: [], placed: [], rank };
      gaps.add(gap);
      return gap;
    };
    laid.sort((first, second) => first.top - second.top);
    const ordered = laid
      .flatMap((entry, at) => {
        const follows = laid.some((other, index) => index !== at && other.ends.includes(entry.top));
        const first = Math.min(...entry.zones.filter((zone) => zone.after === entry.top).map((zone) => zone.rank), 0);
        const gap = follows ? [gapAfter(entry.top, first)] : [];
        return [...gap, ...entry.zones].map((zone, sequence) => ({ zone, at, sequence }));
      })
      .toSorted(
        (first, second) =>
          first.zone.after - second.zone.after ||
          first.zone.rank - second.zone.rank ||
          first.at - second.at ||
          first.sequence - second.sequence,
      );
    // and where one proposal's zone comes straight after another's, after the
    // same line, as what one adds can after another's bar, the space too,
    // unless one's there already
    ordered.forEach((each, at) => {
      const before = ordered[at - 1];
      const touches = before !== undefined && before.zone.after === each.zone.after && before.at !== each.at;
      if (touches && !gaps.has(before.zone) && !gaps.has(each.zone)) {
        added.push(gapAfter(each.zone.after, each.zone.rank));
      }
      added.push(each.zone);
    });
    proposal.set(struck);
    decided.set(acceptedMarks);
    locks.set(lockMarks);
    lockIfTouched();
    hideLines(hidden);
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
          showInHiddenAreas: true,
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
  // words, a blank between blocks, code, which joins as plain lines do, or a
  // quote's fence, which nothing joins onto or off.
  const lineKinds = (): Array<"text" | "blank" | "code" | "fence"> => {
    let code: "outside" | "inside" = "outside";
    return model.getLinesContent().map((content) => {
      if (code === "inside") {
        if (content === "```") code = "outside";
        return "code";
      }
      if (content.startsWith("```")) {
        code = "inside";
        return "code";
      }
      if (fencePattern.test(content)) return "fence";
      return content.trim() === "" ? "blank" : "text";
    });
  };

  // Delete at the end of a block joins the next block's words onto it, past
  // the blank between them and without the next block's marks.
  const joinNext = () => {
    const position = editor.getPosition();
    if (position === null) return;
    const kinds = lineKinds();
    const line = position.lineNumber;
    if (kinds[line - 1] === "fence") return;
    let next = line + 1;
    while (next <= model.getLineCount() && kinds[next - 1] === "blank") next += 1;
    if (next > model.getLineCount() || kinds[next - 1] !== "text" || lockedLines().has(next)) return;
    const following = model.getLineContent(next);
    const end = model.getLineMaxColumn(line);
    editor.executeEdits(
      "doctor",
      [{ range: new monaco.Range(line, end, next, model.getLineMaxColumn(next)), text: following.slice(contentStart(following)) }],
      [new monaco.Selection(line, end, line, end)],
    );
  };

  // Backspace at the start of a block's words takes its mark away, a
  // heading's or an item's; a paragraph's words join onto the block before
  // it. The title keeps its #0, and a quote its fences.
  const joinPrevious = () => {
    const position = editor.getPosition();
    if (position === null || position.lineNumber === 1) return;
    const line = position.lineNumber;
    const content = model.getLineContent(line);
    const start = contentStart(content);
    const kinds = lineKinds();
    if (kinds[line - 1] === "fence") return;
    const mark = /^(?:#\d+(?: |$)| *(?:-|\d+\.) )/.exec(content)?.[0] ?? "";
    if (mark.length > 0) {
      const escape = startsBlock(content.slice(start)) ? "\\" : "";
      editor.executeEdits(
        "doctor",
        [{ range: new monaco.Range(line, 1, line, start + 1), text: escape }],
        [new monaco.Selection(line, 1 + escape.length, line, 1 + escape.length)],
      );
      return;
    }
    let previous = line - 1;
    while (previous >= 1 && kinds[previous - 1] === "blank") previous -= 1;
    if (previous < 1 || kinds[previous - 1] !== "text" || lockedLines().has(previous)) return;
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
  // its purple bar and band in the margin beside it, as every request form's
  const taskMargin = document.createElement("div");
  taskMargin.className = styles.requestMargin;
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
            // the form's bar runs beside every line it's about, into its own
            { range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, marginClassName: styles.targetedGutter } },
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
    taskBox.style.paddingLeft = `${info.contentLeft + textInset}px`;
    taskBox.style.paddingRight = `${info.verticalScrollbarWidth + info.minimap.minimapWidth}px`;
    taskBox.style.backgroundImage = "linear-gradient(to right, var(--vscode-charts-purple, #b180d7) 3px, transparent 3px)";
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
      marginDomNode: taskMargin,
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

  // Each line's place among quotes, by their fences: the lines its quotes
  // open on, outermost first, or "" outside any, so the lines of one quote
  // share it, its fences too. Code's lines aren't read for fences, and a
  // fence that's bare and as long as the innermost open one closes it, as the
  // projection reads them.
  function quoteScopes(): Array<string> {
    const open: Array<{ line: number; length: number }> = [];
    let code: "outside" | "inside" = "outside";
    const scope = () => open.map((each) => each.line).join("/");
    return model.getLinesContent().map((content, at) => {
      if (code === "inside") {
        if (content === "```") code = "outside";
        return scope();
      }
      if (content.startsWith("```")) {
        code = "inside";
        return scope();
      }
      const fence = fencePattern.exec(content);
      if (fence === null) return scope();
      const length = fence[1]?.length ?? 3;
      if ((fence[2] ?? "") === "" && open.at(-1)?.length === length) {
        const within = scope();
        open.pop();
        return within;
      }
      open.push({ line: at + 1, length });
      return scope();
    });
  }

  // a numbered list's numbers, kept right as items come and go and move
  const renumber = () => {
    const edits: Array<monaco.editor.IIdentifiedSingleEditOperation> = [];
    let counters: Array<number> = [];
    let within = "";
    let code: "outside" | "inside" = "outside";
    const scopes = quoteScopes();
    model.getLinesContent().forEach((content, at) => {
      const quote = scopes[at] ?? "";
      if (content.startsWith("```")) code = code === "inside" ? "outside" : "inside";
      const item = code === "outside" ? /^( *)(?:-|(\d+)\.) /.exec(content) : null;
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
      const column = indent + 1;
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
    const scopes = quoteScopes();
    model.getLinesContent().forEach((content, at) => {
      const quote = scopes[at] ?? "";
      const rest = content;
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
      edits.push({ range: new monaco.Range(at + 1, 2, at + 1, 2 + (heading[1]?.length ?? 1)), text: String(depth) });
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
      if (direction === "in") return [{ range: new monaco.Range(line, 1, line, 1), text: "  " }];
      const spaces = /^ {0,2}/.exec(content)?.[0].length ?? 0;
      return spaces === 0 ? [] : [{ range: new monaco.Range(line, 1, line, 1 + spaces), text: "" }];
    });
    editor.executeEdits("doctor", edits);
  };
  editor.addCommand(monaco.KeyCode.Tab, () => shift("in"), "doctorItem");
  editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.Tab, () => shift("out"), "doctorItem");

  // Tab and Shift+Tab move a section a level deeper or shallower, its
  // subsections with it; it goes deeper only under a section before it at
  // its own level, and no shallower than #1
  const inHeading = editor.createContextKey<boolean>("doctorHeading", false);
  const headingIn = (content: string) => /^#(\d+)(?= |$)/.exec(content);
  const isHeading = (line: number) =>
    line > 1 && lineKinds()[line - 1] === "text" && headingIn(model.getLineContent(line)) !== null;
  const shiftSection = (direction: "in" | "out") => {
    const position = editor.getPosition();
    if (position === null || !isHeading(position.lineNumber)) return;
    const kinds = lineKinds();
    const scopes = quoteScopes();
    const quote = scopes[position.lineNumber - 1] ?? "";
    const headings = model.getLinesContent().flatMap((content, at) => {
      const match = at > 0 && kinds[at] === "text" && (scopes[at] ?? "") === quote ? headingIn(content) : null;
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
    const column = 2;
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
