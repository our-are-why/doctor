# where doctor stands, and why it's paused

As of 2026-11-04. Work on doctor is paused while a separate project builds
the editor it needs: one with proposals built in, which editing proposals
here keeps running into. This says what's built, what's broken, what's half
done on branches, and how to pick it up again. The editor's design is in
[EDITOR-COMPONENT.md](EDITOR-COMPONENT.md).

## what works

On `development`, at `f4eee5d`, two commits ahead of what's pushed:

- **documents** open in doctor's editor, Monaco, as lines of text: `#0` the
  title, `#n` headings, list items, fenced code and quotes, and `(contd.)`
  lines where a section's parent goes on after it, so the lines say all the
  document's structure and read back to the same document.
- **tasks** are their requests, quick or drafted, aimed at documents, blocks,
  passages, or nothing; one is active at a time, and starting another says
  which it parks.
- **the agent** works through the `doctor` command: `doctor wait` gives it
  its turn, it proposes, summarizes the task and each document it changes,
  and hands the task over. It says why each proposal is the change it is,
  and what each revision changed.
- **proposals** show where they'd change the document, in one colour each
  for what they do: added green, removed red, changed in place yellow and
  hatched, moved brown, yours purple. You accept, reject, reopen, peek, or
  amend them: on their words, selected, or on the whole of one, quickly or
  as a draft of amendments sent together. Each revision's changes since the
  round before are marked.
- **steering:** a request added to the active task from a document gives the
  agent its turn again; each request is in progress till a hand-over covers
  it, then addressed.
- **the bar** shows the active task and this document's progress; its card,
  on hover or from the keyboard, the task in brief and this document in full,
  with their actions. The footer says where the agent is, from what it
  actually does: waiting, working, quiet since it was last heard from, or
  away.

## what's broken

- **editing a proposal yourself.** Its green lines are drawn in the gaps
  Monaco leaves between its own lines, which Monaco doesn't treat as text,
  so each line's words were made editable on their own. A selection can't
  cross from one block to the next, Enter and Backspace can't make or join
  blocks, and pasting or undoing across lines doesn't work. This is the
  roadblock.
- **your edits while a task is active** go straight to the file, not into the
  task. The design is that they're proposals in it, as a pull request's
  changes are; that's on a branch, below, and not working well.
- **moving or deleting what a proposal hangs on**, the block an insert's
  placed after, isn't guarded: it can leave a proposal that no longer fits,
  found only when the task completes. Undecided.

## on branches

Both are local, not pushed, and both are attempts at the roadblock above.

- **`experiment/manual-proposals`** (`b1741c2`): your edits while a task is
  active become proposals, divided as the agent's are; held till the caret
  leaves the block, marked purple meanwhile; Enter and Backspace inside a
  run of new blocks' green lines. Its design is in
  `notes/manual-proposals.md` there. Built in four steps without being seen
  on screen, and broken in use.
- **`experiment/swap-in`** (`fef5eb6`): a click in a proposal swaps it into
  Monaco's own lines, with the rest made read-only and what it replaces shown
  above, so it edits as the document does; leaving makes the difference its
  next round. Its confining is a layer of its own, `confine.ts`. A decent
  start, still broken in places.

They're different answers to the same question, and both rewrite the same
code, so they're kept apart.

## why it's paused

Every attempt to make proposals editable has been a workaround for one
fact: in Monaco, a proposal isn't part of what's being edited. Drawing it in
the gaps, making its words editable line by line, swapping it into the
buffer for a while: each fixes some of what's wrong and leaves the rest.
What's needed is an editor whose model has proposals in it from the start,
not one they're drawn beside. That's a project of its own, done better
separately, with a narrow first goal, than inside doctor's view code.

## picking it up again

- read this, `EDITOR-COMPONENT.md`, and `notes/tasks.md` for the task model;
- the open decision for the editor is whether what's edited is the lines of
  text, as now, or a structured document shown formatted;
- once the component edits proposals in place, doctor's editor is replaced
  by it, and `experiment/manual-proposals`'s design, edits as proposals, is
  built on it rather than on Monaco;
- the demo task, `bqi43igvu9` in `playground/`, has fourteen proposals, one
  for each way a proposal can look, for trying the editor against.
