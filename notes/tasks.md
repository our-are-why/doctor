# tasks

how tasks work in doctor, as worked out with the user on 2026-11-01. it's a
design, mostly not built yet: what exists today is listed near the end,
then what's decided and what's still open. it's framed in version-control
terms, git's vocabulary where it fits and jj's (Jujutsu's) ideas where they
make things simpler.

## a task is a branch

a document, as its file holds it, is the trunk. a task is a branch off it:

- its **base** is the version of each of its documents when it started;
- its **head** is the base plus everything accepted into the task and
  everything edited in it.

| git | doctor |
|---|---|
| the trunk | a document, as its file holds it |
| a pull request | a task |
| its branch | the task's head |
| a review suggestion | a proposal |
| committing a suggestion | accepting a proposal |
| pushing your own commits | editing in task mode |
| a review comment | requesting changes |
| editing the PR's description | steering the brief |
| merge | complete |
| close without merging | cancel |
| a rebase | replaying the task onto the trunk |

the file on disk holds the trunk, and the task's head lives in doctor's
store. so git, and anything else reading a `.doctor.json`, only ever sees
finished work.

**git is the history.** doctor doesn't archive or time-travel. it keeps only
what live work needs:

- each document's current version;
- each open task's base and head;
- the versions open notes are anchored to.

anything older is collected, so the oldest open task sets how far back
doctor looks. there's no history log.

## modes

- **no active task:** you edit the trunk directly.
- **an active task:** task mode. the editor shows the task's head, and a
  line can be in one of three states:
  - **the trunk as it is:** no mark;
  - **changed in the task:** a neutral mark in the margin, saying it applies
    when the task completes. these are accepted proposals and your own
    edits;
  - **proposed:** struck through and added beneath, waiting for a decision.

  the task bar says plainly that you're in task mode. parking, completing or
  cancelling takes you back to the trunk.

everything you edit in task mode belongs to the task. doctor doesn't try to
judge which edits are related to it. there's only ever one active task, so
parking one and making another active switches branches.

## what a task asks for

a task is a **goal**, a **scope** and, optionally, **parts**.

- **the goal** is what the task is for, in your words: "simplify", "audit
  grammar", "make the terms consistent".
- **the scope** is where the agent may change things. it's a list of
  regions, each one of:
  - **a whole document**, meaning whatever it holds when the agent works,
    so text added later is covered;
  - **a node**: a block, a list item, or a section with everything under it;
  - **a passage**: a range of characters within one text, such as a
    sentence or a phrase, anchored the way notes are.
- **a part** is a focused request within the task: a region and its own
  instruction. a part's region is in scope by virtue of being a part.

| you want | goal | scope | parts |
|---|---|---|---|
| "simplify" this sentence | simplify | the sentence | none |
| "use the same term" in five places | use the same term | the five places | none |
| "audit grammar" across documents | audit grammar | the documents | none |
| fix X here, Y there, Z there | a summary, optionally | the three places | three |
| "make it consistent, and X here" | make it consistent | the document | one |

regions are anchored to nodes and passages, never to line numbers, each at
the version it was written against.

## steering

a task's brief is a list of versions (the domain has this already). each
steer writes a new version:

- add a part: select a place, then Add part, while the task is active;
- change a part's instruction or region, or drop it;
- change the goal, or widen or narrow the scope;
- follow on from a proposal ("add part here"), when a change opens a new
  direction rather than needing a fix.

the agent's next `doctor wait` says what changed since it last looked.

- **it's the agent's turn whenever it has something to do:** new or changed
  parts, a changed goal, or proposals sent back. that's whether or not
  proposals are waiting for review, so it works while you review.
- **a proposal answering an older brief version is marked as such.** it can
  still be accepted or rejected.
- **the agent can propose widening the scope** when a change ripples outside
  it. you accept or decline that like any other proposal.

## proposals and review

a proposal is one independent change, a focused diff. it says what it
answers: a part, or the goal. review can then say "2 of 3 parts answered"
and show a part the agent skipped.

- **accept** applies it to the task's head, not to the document.
- **reject** drops it.
- **request changes** sends it back to the agent with comments. a comment
  can be anchored to words in the proposed text ("this phrase is wrong") or
  apply to the whole proposal. only the proposals sent back are revised.
- **to edit a proposal yourself,** accept it and then edit it. in task mode
  that's just one of your edits in the task.

the proposed text has to be selectable for comments, so its lines move out
of Monaco's view zones, which sit beneath the text and never get the mouse,
into the overlay that already holds the header.

## finishing

- **submit:** the agent says it's done with the current brief version.
- **complete** merges the task into its documents. it happens on its own
  once the task is submitted against the current brief version, every
  proposal is decided, and none was sent back. a steer after a submit puts
  the task back to working, so "done" means done with what was asked last.
- **cancel** discards the branch.
- **park** keeps the branch, to resume later.

merging replays the task's changes onto the trunk as it is then. nodes
changed on both sides are conflicts, left for you to resolve.

the common case stays one gesture: select, write the instruction, press
Enter. one proposal comes back, you accept it, and the task completes and
merges straight away.

## when the trunk moves

the trunk moves only through edits made outside task mode, or outside
doctor. following jj:

- a task is replayed onto the trunk when it's next active. when it replays
  cleanly, nothing needs saying.
- a conflict doesn't block anything. it's recorded on the task and shown,
  and you resolve it when you get to it.

what's shown about a task's freshness is worked out from versions when it's
needed, never stored, and it's separate from the task's state:

- **behind:** the trunk has moved since the task's base. a parked task is
  replayed when it's resumed.
- **conflicted:** replaying the task's changes hits nodes changed on both
  sides.
- **regions changed:** a region's text or node has changed since it was
  written, so the brief may need steering. this applies to drafts too.

## making tasks

- **the common case:** select one place or several (Cmd+click and Alt+drag
  add selections), write the instruction in the form beside the selection,
  press Enter.
- **composite:** the form's Add part opens a draft, and each later
  selection and instruction adds a part to it, in any document, marked in
  the margin. Start sends it. there's one draft at a time, the current
  task, so Add part never has to ask which one.
- **whole documents:** with nothing selected, the task covers this
  document. several documents come from the dashboard, or from selecting
  files in the Explorer.

## the task view, later

the other perspective: one task across all its documents, where the
document editor is one document across all tasks. each region is shown as
an excerpt with a little context, its part's instruction and its
proposals, with the brief's versions as the task's history. you'd review,
steer and edit there.

it needs two things from the model, both in the shape above: regions
anchored to nodes and passages, and proposals that say what they answer.

## today

- one active task at a time; the states are draft, working, reviewing,
  parked, completed and canceled.
- a brief has versions, but only one is ever written. it holds an
  instruction and a scope of nodes.
- proposals have rounds. accept applies a proposal to the document
  straight away, as a change whose source is the proposal.
- `doctor wait` gives the agent its turn: while the active task is in
  working and nothing proposed waits for review.
- the form beside the selection makes a task with one instruction.
- documents keep a history log and every version in `.doctor/`.

## decided

- a task is a branch. the file holds the trunk until the task completes.
- everything edited in task mode belongs to the task.
- in task mode, the editor marks what the task changed as not yet applied.
- a task is a goal, a scope of regions, and optional parts.
- the brief is steerable, as versions, and the agent works while you review.
- proposals are focused, say what they answer, and take comments anchored to
  their words. you edit a proposal by accepting and then editing it.
- a task completes on its own once it's submitted and every proposal is
  accepted or rejected.
- git is the history. doctor keeps only what open work needs.
- freshness is worked out, not stored: behind, conflicted, regions changed.

## open

- should passages be usable as scope from the start, or nodes only at first?
- is the goal optional when a task has parts?
- can the agent add parts itself, or only propose under the goal and ask to
  widen the scope?
- should cancel offer to keep your own edits? an edit to text that only the
  task introduced has nothing to apply to, so it would be dropped, and doctor
  would say so.
- what does a completed task leave behind: a small record, or nothing?
- should completing a task offer to commit, with the goal as the message?
- should a task be replayed whenever the trunk moves, or only when it's next
  active?
