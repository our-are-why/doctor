# an editor with proposals built in

The idea for the editor doctor needs, as a component of its own, worked out
on 2026-11-04. It's an outline, not a design to build from line by line: what
it's for, the model it's built on, its parts, and the first thing it has to
do. Why doctor's paused for it is in [STATUS.md](STATUS.md).

## what it's for

A document editor in which a **proposal**, a change someone offers to the
document, is part of what's edited, not drawn beside it. You read the
document with its proposals in it, decide them, and edit inside them as
freely as anywhere else. It knows nothing of doctor: not its documents, its
tasks, or its agent. Doctor is one host of it; any web page could be.

## the model

The heart of it is a model, plain code with no screen in it:

- **a document:** blocks, each its kind and its text, a text being its
  characters and the marks over them, bold, a link and so on; blocks nest,
  as items in a list and blocks in a section do. The kinds and marks are the
  host's to say, so doctor's are one set.
- **a proposal:** a change to the document, as the operations that make it:
  text written or restyled, blocks added, taken out or moved; with an id, a
  state, waiting, accepted or rejected, and its rounds, each a version of it
  and who wrote it. Proposals don't nest; a change asked of one is a round
  of it.
- **anchors:** where a proposal is, held as positions in the document that
  move with every edit, so a proposal stays on what it's about however the
  document around it changes, and says so when what it hung on is gone.
- **one history:** every edit, to the document or inside a proposal, is a
  transaction, undone and redone as one, mapped through the anchors.

From the model come the questions the editor answers, without a screen:
what the document is with a proposal applied, or with all that are
accepted; whether a proposal still fits; what a round changed since the one
before, words added, changed and taken out.

## how it shows them

As a document editor's suggesting mode does, the proposal's own words are
**in the document**, as real content you edit, marked; what it replaces is
shown beside them, read-only. So:

- what's added reads in place, green, and is edited where it is;
- what's changed in place shows its new words, with the old ones beside;
- what's taken out shows, struck, where it was; what's moved shows where it
  goes, a mark where it was;
- each proposal has its bar, where it's decided.

Editing inside a proposal changes the proposal: a selection across its
blocks, Enter making a block, Backspace joining two, pasting, marks, undo,
all as anywhere else, and kept inside it, so an edit can't leak out of a
proposal into the document. Editing outside one changes the document, or,
in suggesting mode, makes a proposal of your own, divided as anyone's are: a
change in place for each block, a run of new blocks as one.

## its parts

1. **the model**, above: plain code, tested without a screen.
2. **an editing engine**, not written from scratch: what a browser gives an
   editor, typing, selection, input methods for other languages, the
   clipboard, spelling, is where editors built by hand go wrong, so an
   engine made for it does that: CodeMirror 6 or ProseMirror. The model is
   bound to it, not built from it, so it could be another.
3. **its look and controls**: proposals' bars, forms, the marks for what's
   changed, in Preact, themed by CSS variables, so a host's colours are its
   colours; in VS Code, VS Code's theme.
4. **a small interface** for a host: give it a document and its proposals;
   hear what's edited and decided; tell it what's new from elsewhere.

## the engine, still to choose

Which engine follows from one question: is what's edited lines of text, in a
syntax, as doctor's are now, `#1` headings, fences and all; or a document
shown formatted, headings as headings?

- **lines of text: CodeMirror 6.** It edits text, as Monaco does, but its
  state, decorations and widgets are made to be extended, and a transaction
  can be filtered, so keeping an edit inside a proposal is something it's
  asked, not something worked around.
- **formatted: ProseMirror.** It edits a structured document, for which
  suggestions as part of the document, added and taken-out content marked,
  are what it's often used for.

## carried over from doctor

What doctor worked out holds for the component:

- each colour means one thing: green added, red removed, yellow changed in
  place, brown moved, purple yours; and within one, the line's style says
  how, solid replaced, dashed restyled;
- a proposal's rounds, each a version, consecutive ones of yours one;
  what a round changed since the one before, dotted under what's new or
  changed, a mark where words were taken out;
- amendments: a note on words of a proposal, or on the whole of it, asked
  for its next round, as one quick one or a draft sent together;
- a proposal of new blocks side by side is one, however many it spans.

## the first thing it has to do

Doctor's roadblock, and nothing more: a document with proposals in it, the
proposals edited in place, a selection across a proposal's blocks, Enter,
Backspace, paste and undo working there as in the document, edits kept
inside the proposal they're in, and each proposal accepted or rejected.
Then, in order: suggesting mode, your edits made proposals; what a round
changed since the one before; amendments; and doctor's editor replaced by
it, through a binding from doctor's documents and tasks to its model.

## not to begin with

Editing by several people at once; proposals of proposals; a proposal across
documents; anything doctor's tasks say, which stay doctor's.
