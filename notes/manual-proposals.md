# your edits as proposals

what happens to your own edits while a task is active, as worked out on
2026-11-04. it's a design, not built: what exists today first, then the
design, then what's still to decide.

## today

- while a task is active, an edit in the document editor goes straight to
  the document's file, the trunk, as it does with no task.
- the agent's proposals were made against the version it was shown. an edit
  of yours that touches what one changes makes it no longer fit, and that's
  only found when the task completes: it goes back for review, with why.
- the lines a waiting, revising or accepted proposal targets are locked, so
  most such edits can't happen. moving or deleting a block a proposal hangs
  on isn't guarded; that's its own question.
- the editor mints real node ids for blocks you add, so an edit can name a
  node that exists only once it's applied.

## the idea

an edit you make while a task is active is a **proposal**, the same as the
agent's, in the same task: as the task notes decided, "everything edited in
task mode belongs to the task". there's no other kind of proposal for it.

- the file keeps the trunk until the task completes, so git, and anything
  else reading the file, only sees finished work;
- your proposals and the agent's are reviewed together, side by side, and
  where they'd overlap that's seen while the task runs, not when it ends;
- what happens to the task happens to them: completing applies what's
  accepted, cancelling or parking takes the rest with it.

it's what a document editor's suggesting mode does: while it's on, what you
type is a suggestion, like anyone else's. and it's a pull request: while a
task is active, every change, in every document, is part of it.

## the same as any proposal

- **divided as the agent's are:** a change to a block already there, its
  words or marks, is a proposal for that block; a continuous run of new
  blocks is one proposal across them, however many it spans; a block taken
  out is one, a block moved is one, a list made numbered or bulleted is one.
  further typing in a block, or on at the end of a run, goes into the same
  proposal.
- **waiting for review,** like any: you accept or reject it with the rest,
  amend it, edit it, and the task completes only once it's decided.
- **in the task's current round of work:** it answers the brief's current
  version, as the agent's do, and is reviewed with what they've proposed.
  it answers no request in particular.
- **its rounds say who wrote them,** as every round does: its first is yours.
  nothing else marks it as yours, and nothing's done differently for it.
- **its operations name real ids,** the ones the editor minted, not draft
  ones, so applying it never renames anything.

## typing, when what's typed is a proposal

a proposal shows the trunk's line, and its own version beneath, in green.
so what you type can't stay in the document's line for good; it becomes a
proposal once you're done with it.

- **done is leaving it:** you type in the document's lines as you would
  without a task, and the block the caret's in is yours to go on with,
  however long you pause to think. once the caret leaves it, it's lifted
  into a proposal: the line goes back to how the trunk has it, and your
  version shows beneath, in green. meanwhile it's marked purple in the
  margin, as what's yours is, so it reads as becoming a proposal of yours,
  not the trunk's.
- **a block already there, changed:** lifted on leaving it into its own
  proposal, a change in place, as the agent's are, per block.
- **new blocks:** each is lifted on leaving it, as a block of new content:
  the first of a run, the leading new block, makes its proposal and says
  where it goes, after the block before it, or first in its section or
  list; each after it, the subsequent ones, typed straight on from the end
  of that run, joins it, so a run of new blocks is one proposal however
  many it spans, as one of the agent's is. a change to a block already
  there is never joined to one.
- **a block split** with Enter in its middle is its first half changed in
  place, one proposal, and its second half new, starting a run, or joining
  the one it's at the end of.
- **taking out or moving:** deleting a block, or moving it, makes its
  proposal at once, drawn as the agent's are.
- **coming back to one:** what a proposal of yours targets is locked, as any
  proposal's is; you go on with it by editing its green lines, or amending
  it. your rounds of it one after another fold into one, so coming back
  after a pause doesn't scatter it.

editing a proposal's words in place exists; adding new blocks at the end of
a run from inside its green lines, with Enter, doesn't yet, and it's the
larger part of the work. till it does, a block typed after a lifted run
makes a proposal of its own right after it, which the editor draws joined.

## the agent

- `doctor document` shows the trunk, as now, and the task view lists every
  proposal, yours with the agent's, so it can build on them and not undo
  them.
- your proposals don't give it the turn: they're not asks. a request is.

## completing, cancelling and parking

- **complete:** as now: once every proposal is decided, what's accepted,
  yours and the agent's, applies in the order it was accepted; one that no
  longer fits goes back for review.
- **cancel:** as now, everything goes with the task, your proposals too.
  what's yours isn't kept apart from what's the agent's.
- **park:** your proposals go with the task, as the agent's do.

## what's built, in order

1. the extension: while a task is active, an edit in the document editor
   makes or grows a proposal of yours, not a change to the file, divided as
   above.
2. the editor: a block you're in marked purple, and lifted into its
   proposal once the caret leaves it; new blocks joining the run they
   continue; deleting and moving making theirs at once.
3. new blocks inside a run's green lines: Enter at the end of one adding to
   the run, and blocks taken out of it.
4. the agent's view of your proposals.

## decided

- **every document:** while a task is active, every edit, in any document,
  is a proposal in it, whether the task touched that document or not. the
  bar says which task is active in every document, so it's plain.
- **no way round it:** there's no editing the trunk on purpose while a task is
  active. grouping changes is yours to do: a fix that isn't the task's waits
  till it's parked, or completed, or goes in as part of it.
- **cancelling drops everything:** yours and the agent's alike, as nothing
  tells them apart for it.
