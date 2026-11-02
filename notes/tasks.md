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
| a review comment | a request on a proposal |
| editing the PR's description | steering: making more requests |
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

## requests

a task is its **requests**: the changes you want. every request
belongs to a task. a request is its text and, optionally, its **targets**:
where it applies.

- **targets say where a request is aimed, not what may change.** answering
  it can move what's targeted, restructure around it, or change other
  blocks or documents it leads to: doctor describes change, it doesn't
  fence it in, and every change is reviewed before it applies. a target is
  one of:
  - **a whole document:** whatever it holds when the agent works, so text
    added later is covered too;
  - **a node:** a block, a list item, or a section with everything under it;
  - **a passage:** a range of characters within one text, such as a
    sentence or a phrase;
  - **a proposal, or words in it:** changes to that proposal, which send it
    back.
- **one request can have several targets,** so "use the same term" in five
  places is one request.
- **without targets, a request is about every document in the project.**
  its own words can narrow that loosely ("cleanup grammar in spike"), and
  the agent reads them that way.
- **there's no scope to set.** what a task is about follows from its
  requests.
- **a task is named** by its first request.
- **targets in documents are anchored the way notes are,** to a document, a
  node or a passage, never to line numbers, each at the version it was made
  against. when the text under one changes or goes away, it's detached, and
  keeps what it was attached to. requests live in the task, not in the
  document's file.

| you want | requests | their targets |
|---|---|---|
| "simplify" this sentence | simplify | the sentence |
| "use the same term" in five places | use the same term | the five places |
| "audit grammar" in two documents | audit grammar | the two documents |
| "cleanup grammar in spike" | cleanup grammar in spike | none: the agent reads "in spike" |
| fix X here, Y there | fix X; fix Y | here; there |
| "make it consistent, and X here" | make it consistent; X | the document; the place |
| all of that, in British spelling | …and keep British spelling | none: everywhere |

since a request without targets reaches every document, the agent needs to
see the project's documents: a `doctor documents` listing each one, with its
id and title.

you make requests, the agent answers with proposals, and you decide.

## steering

a task's brief is its requests over time, as versions (the domain has
versions already). steering is making more requests, or changing or
dropping one, while the task runs. each steer writes a new version, and
that includes following on from a proposal when a change opens a new
direction rather than needing a fix.

the agent's next `doctor wait` says what changed since it last looked.

- **it's the agent's turn whenever it has something to do:** new or changed
  requests, including requests on its proposals. that's whether or not
  proposals are waiting for review, so it works while you review.
- **a proposal answering an older brief version is marked as such.**
  proposals already record the version they answer. it can still be
  accepted or rejected.
- **the agent can ask to go further** when a change ripples past where your
  requests are. you accept or decline that like any other proposal.

## proposals and review

a proposal is one independent change, a focused diff. it says which
requests it answers. review can then say "2 of 3 requests answered" and show
one the agent skipped.

- **accept** applies it to the task's head, not to the document.
- **reject** drops it.
- **a request on it** sends it back to the agent. the request can be on the
  whole proposal, or on words in the proposed text ("this phrase is
  wrong"). only the proposals sent back are revised.
- **to edit a proposal yourself,** accept it and then edit it. in task mode
  that's just one of your edits in the task.

the proposed text has to be selectable for requests on its words, so its
lines move out of Monaco's view zones, which sit beneath the text and never
get the mouse, into the overlay that already holds the header.

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
- **requests detached:** the text a request was on has changed or gone
  since it was made, so the brief may need steering. this applies to drafts
  too.

## making tasks

each way of making a request has one meaning:

| gesture | the request's targets |
|---|---|
| select something, then the form beside it | what you selected |
| the bar at the top of the editor, or right-click "doctor: request for this document" | this document |
| the dashboard's New task | none: the whole project, unless its words say otherwise |
| the Explorer's "doctor: new task" on files | those files |

- **the quick path is a selection:** select one place or several (Cmd+click
  and Alt+drag add selections), write in the form beside it, press Enter.
  that makes a task in one go, with one request targeting what you selected.
  it always has targets, so it only opens with a selection.
- **the request bar** sits at the top of the editor: "Request a change to
  this document…". typing in it and pressing Enter makes a task with one
  request targeting this document, with nothing to select. right-click
  "doctor: request for this document", and "doctor: new task" with nothing
  selected, put the caret in it.

**focus:** a mode around one task, a draft or the active one, for anything
more than one request.

- **you focus a task:** a new one, started from a selection, a document or
  the dashboard, or an existing one.
- **the request bar becomes the focus bar.** it shows the task: its name,
  editable in place, how many requests it has, and Start for a draft.
  typing in it adds a request targeting this document to the task.
- **while it's focused, you make requests anywhere:** select a phrase or a
  block, write in the form beside it, and press Enter, and it adds to the
  task instead of making a new one. its requests show in the margin of
  every document you visit. hovering one shows its text, and clicking it
  lets you change or remove it.
- **focus lasts** as you move between documents, and across reloads.
- **the gestures are the same for a draft and the active task.** on the
  active task, a request is a steer.

## the task view, later

the other perspective: one task across all its documents, where the
document editor is one document across all tasks. each request is shown as
an excerpt with a little context, with its proposals and the brief's
versions as the task's history. you'd review, steer and edit there.

it needs two things from the model, both in the shape above: requests
anchored to nodes and passages, and proposals that say which requests they
answer.

## today

- one active task at a time; the states are draft, working, reviewing,
  parked, completed and canceled.
- a brief has versions, but only one is ever written, and a task is made
  with one request. requests have targets: whole documents, nodes and
  passages, in any documents, or none. briefs written before read as one
  request aimed at their scope.
- a proposal can change anything, in any document, and names the requests
  it answers. `doctor documents` lists the project's documents for the
  agent. proposals are one document each, so a move into another document
  is two, reviewed separately.
- requests are made from the selection's form (a passage, or the blocks a
  selection touches), the request bar above a document (the document), the
  dashboard's New task (no targets) and the Explorer (the files picked).
  requests on proposals are still "request changes", kept in the proposal's
  rounds.
- there are two ways to make a task, each its own entry point. a **quick
  task** is one request, started at once: right-click "doctor: quick task"
  on a selection, or the bar's Start task, or the dashboard's Quick task…. **draft a task** is a mode: right-click "doctor: draft a task",
  or Draft a task in the bar or on the dashboard. while drafting, requests
  go into the draft, which is made with the first one, so a task is never
  without a request. the form and the bar say "Add to draft", the
  right-click items become "add to the draft" and "stop drafting", the
  draft's requests are marked in every document's margin, and the bar shows
  it with Start task. stopping leaves the draft on the dashboard, which
  lists its requests to take out, and can continue drafting it, start it
  or discard it. a task can be drafted while another is active, and edits
  made while drafting go to the document, as there's no task mode yet.
- proposals have rounds. accept is a decision: the task's accepted
  proposals apply to their documents when it completes, each as a change
  whose source is the proposal, and one that no longer fits goes back for
  review. until then a decision can be changed: an accepted or rejected
  proposal can be reopened, or sent back for changes. there's no head yet,
  so the editor shows the trunk, an accepted proposal as a collapsed row.
  proposals accepted before this applied at once.
- the agent proposes everything, then submits. a submitted task completes
  on its own once every proposal is accepted or rejected, and goes back to
  working when one is sent back for changes.
- `doctor wait` gives the agent its turn: while the active task is in
  working, and either something was sent back to revise or nothing proposed
  waits for review.
- the form beside the selection makes a task with one instruction.
- documents keep a history log and every version in `.doctor/`.

## decided

- a task is a branch. the file holds the trunk until the task completes.
- everything edited in task mode belongs to the task.
- in task mode, the editor marks what the task changed as not yet applied.
- a task is its requests. a request is text with optional targets: whole
  documents, nodes, passages or proposals. targets say where it's aimed,
  not what may change; without them it's about every document in the
  project, which its words can narrow loosely. there's no scope to set.
- the brief is steerable, as versions, and the agent works while you review.
- proposals are focused, say which requests they answer, and take requests
  on their words. you edit a proposal by accepting and then editing it.
- focus is the mode for building and steering a task across documents; the
  quick path makes one in a single gesture from a selection, and the
  request bar at the top of the editor from the document.
- a task completes on its own once it's submitted and every proposal is
  accepted or rejected.
- git is the history. doctor keeps only what open work needs.
- freshness is worked out, not stored: behind, conflicted, requests detached.

## open

- can you focus a draft while another task is active, to compose the next
  task while the agent works on this one?
- do your edits while a draft is focused go into the draft, so you can
  prepare changes before starting it, or do edits only belong to the active
  task?
- can the agent make requests itself ("I found two more places"), or only
  propose and ask to go further?
- should cancel offer to keep your own edits? an edit to text that only the
  task introduced has nothing to apply to, so it would be dropped, and doctor
  would say so.
- what does a completed task leave behind: a small record, or nothing?
- should completing a task offer to commit, with the task's name as the
  message?
- should a task be replayed whenever the trunk moves, or only when it's next
  active?
