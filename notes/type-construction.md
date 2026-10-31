# type construction

how types are built in doctor, as I've understood it from working through
`source/shared/domain.ts` with the user (2026-10-30 to 31). it's my
interpretation, to be corrected. naming, of types and of fields, is
deliberately left out: it has rules of its own.

each rule is stated from the positive side, what to do, and where it helps,
complemented by the negative, what it rules out and why.

## the aim

types are how the model is communicated. they carry meaning first and
structure second. meaning comes from the role an instance plays (what it refers
to, what may be done with it), not from its shape or its names: two types
with the same shape, field names included, can still be two types. a little
boilerplate is a fair price for saying exactly what something is.
the test for any type is whether it says what the thing *means*, and whether
code downstream could misread or misuse it: reach for it because its shape
roughly fits a context of its own, and shoehorn that context's meaning into
it. a type should be specific, tailored enough that it only fits where its
meaning does.

coarse concepts (a document, a task) are set top-down. the nuance within
them, their cases and where each piece of data sits, emerges bottom-up,
worked out algebraically and verified by downstream use. so what follows
describes what the types look like once settled, not a plan to draw up front.

## the algebra

a type is read as the set of instances it allows, where an instance is one
concrete piece of plain data of that type, as it sits in a file or in
memory (an inhabitant of the type, in type theory). the type exists at
compile time; instances are what exist at runtime. data is plain, and types
describe it: there are no classes.

types compose in two ways, and most decisions here come down to which one
something is.

- **a product composes orthogonally.** as a type, it's every combination of
  its fields' types; any one instance has data for every field at once.
  adding a field adds an axis, and the possibilities multiply. an object type
  is the product of its fields' types, and a tuple is the product of its
  elements' types (its fields, by position). a field can be any type: a
  two-option status, an object type, or a sum of them (a change is a product
  whose source field is a sum).
- **a sum composes along one axis.** as a type, it's the union of its cases;
  any one instance falls into exactly one of them, never two, never none.
  adding a case adds a point on that axis, and the possibilities add. a
  discriminated union is a sum. a case can be any type, a literal or a whole
  object type, so each case can open its own space behind it (one case
  carries a quote, another doesn't), which is what separates a sum from a
  plain enumeration.
- **they nest freely.** products of sums, sums of products, at any depth, and
  the counting composes: a product multiplies its fields' possibilities and a
  sum adds its cases', whatever those fields and cases are made of.
- **a sum refines or extends.** refining splits a case that was conflating
  others (a note on a node into whole-node and passage notes); extending adds
  a case that's genuinely new (a detached note). refining means something
  downstream was guessing; extending means everything that switches on that
  axis has a new case to handle.
- **cases group, too.** refining goes down a sum; grouping goes up: cases
  gathered into a sum of their own, when code needs to treat them as one
  (waiting proposals and final ones; the notes that target a node). a sum of
  sums is still one sum, just with its structure said.
- **a case can contain the sum itself.** that's a recursive type: a section
  holds blocks, and so does a list item. cases that hold none are terminal
  (a paragraph, a code block), and every instance bottoms out in them. the
  test is whether following the references leads back to where you started:
  block → section → block is a cycle, so it's recursive; inline → link → run
  never comes back to inline. a case built from a sibling case is
  composition: a link holds runs, and runs hold no links, so it's a parent
  over a terminal, deliberately, so that actions stay unnested. a type is
  recursive where nesting is meant.
- **stratification and recursion are separate properties.** stratification
  is conceptual: types at different semantic levels, a higher one built over
  lower ones, references pointing down. recursion is structural: a cycle.
  they often travel together, and each happens alone: blocks are recursive
  without levels (a section and a paragraph are both blocks); inline text is
  stratified without a cycle (a link is an action over runs); a list over its
  items is both.
- **position in a hierarchy can change what something is.** the root of a
  structure is rarely the same kind of thing as what's under it: a document's
  body has a title and no identity, so it can't be moved or deleted, while a
  section is a node. terminals differ from parents, and some types exist only
  under a particular parent (an item, only in a list). where position changes
  meaning, it gets its own type.
- **the laws carry over.** an optional field is `1 + A`, a sum hidden in a
  product, its cases left implicit. a boolean is `1 + 1`. factoring a shared
  field out of several cases is distributivity: `A×B + A×C = A×(B + C)`.
- **orthogonal means independent.** a product is free only when its fields
  are independent; when one field constrains another, the dependency is made
  structural: the ways a thing can be become its own variants, and a state narrows
  what it holds.

## no hidden sums

- **each case gets its own type.** an optional field is almost always several
  kinds of thing conflated into one, losing what downstream uses need to
  know. ask when the field exists and when it doesn't, and give each case a
  type: a note about a whole node versus about a passage within it; a code
  block whose language is stated versus not; a reason that was given versus
  not.
- **a flag is a status with two options.** a boolean is a two-case sum with
  its cases left implicit; making both explicit says what each one means: a
  list's order is ordered or unordered.
- **in data, an absence is a case of its own.** every null in data so far has
  been a status in disguise: "not reviewed yet" is a real state, so review is
  pending or done; "first" is a real position, so a position is first or
  after a sibling.
- **an empty case is the zero of what the thing does.** where an empty case is
  real, it's an instance that changes nothing when it's composed in (an
  identity element, in algebra): an empty list for a set of additions (a run
  whose contrast is `[]` is plain); a no-op function for a callback. a zero
  needs no check: code that uses it just works. where empty would mean
  nothing real (a change with no operations), the type requires non-empty.
- **`null` belongs where a mechanism makes it the zero.** that's mechanical,
  not semantic: structural configuration, nearly always static, like a slot
  in a base component that one use fills and another leaves empty, where the
  mechanism has made `null` its zero (rendered ui, which preact renders as
  nothing). anywhere a mechanism hasn't, `null` is an absence the slot's user
  has to remember to check for, and the slot's own zero belongs there.
- **nulls from outside are parsed into cases at the boundary.** external
  formats bring them in (a database schema, someone else's API); parsed into
  explicit cases as they arrive, they never travel inward. a null that has to
  be kept is a smell to note, not a pattern to copy.

## additions whose opposite is absence

some properties are asymmetric: having one adds something, and not having it
is just its absence (a run's contrast: bold, italic, monospace, highlighted,
struck). they're listed, not given a two-option status each:

- **only what's present is listed.** an empty list means none,
  unambiguously.
- **the type enumerates every valid list.** each option at most once,
  generated with a distributive conditional type, so it's only expanded where
  it's used.
- **order means nothing, so they compare as sets.** any order is accepted,
  and comparison is by set, everywhere; imposing an order on something that
  has none would add a second, more fragile way to compare.

## discriminated unions, built up

- **every variant carries a discriminant.**
- **a base holds the discriminant, and variants add the rest.** the base takes
  the discriminant's literal as a type parameter; variants extend it and
  declare only what they add. a variant that adds nothing is still declared,
  as a type of its own.
- **data lives on the most general type whose every instance has it.** every
  case has it: the base; some cases share it: an intermediate base between
  the base and those variants; one case has it: that variant.
- **the ways a thing can be are variants of the thing itself.** each is a
  variant of the thing, extending what all of them share and adding what
  that way has: a note on a node has a confirmation, a note on the whole
  document doesn't. the thing is the sum, not a part it holds, so its
  discriminant sits on the thing. it's what drives polymorphism: a concept
  that stays the same while its form varies. the forms belong to whatever
  stays the same across them, not to a part of it.
- **a field is shared when its meaning is the same in every use.**
  foundationally the same, which the same name and type doesn't guarantee. a
  live note's node ("attached to this node") and a detached note's former
  node ("was attached to it") share a name and a type, but not a meaning, so
  each declares its own. a node's children and the document body's children
  mean the same thing (contained nodes, in document order), so they share a
  base.

## one meaning, one type

- **different meanings get different types.** when two uses of a field or
  type mean different things, they get different types, even if the shape is
  identical. a live passage's quote is a selector, searched for again after
  edits; a detached note's record of those words is a frozen fact, never
  searched for. sharing one type would invite code to search a node that no
  longer exists. this is the hard one to spot, because the types line up.
  it reaches primitives too: two strings with different meanings are two
  roles, not one string.
- **one concept, one type.** "a node in some document" is one type, used by a
  task's scope and by a link alike.

## build up, never subtract

- **types are composed from building blocks.** a node is its content (what
  kind of node it is, and what it says itself), its identity, and, if it
  holds other nodes, its children. an edit replaces the content block, a real
  type in its own right.
- **select, never subtract.** selection (`Pick`) shows provenance: "these
  fields are that type's, transferred from it"; a reference to a change is
  exactly the change's identifying fields, picked from the change.
  subtraction (`Omit`) defines a remainder by what's missing, which has no
  meaning of its own and silently absorbs anything later added to its
  source.
- **mechanisms are building blocks; uses/conventions compose from them.**
  foundational types model mechanisms, each on its own axis: how text looks
  (contrast), what text does (an action). what a combination is used for, or
  the convention it follows (a code span, an emphasis, a citation), is
  meaning composed from them downstream, outside the foundational type;
  entangling the two early forces every later use through one
  interpretation. a source format often fuses them (markdown's code is
  monospace plus highlight; its link is a look fused with an action), so the
  model takes inspiration from a format while staying free of it.
- **a concept's type is used directly.** an alias adds a hop, one more thing
  to read through.
- **a constraint that varies is a type parameter.** an active task is
  parameterized by the proposals it may hold. intersections are kept for
  where they're the mechanism itself (a brand).

## make illegal states unrepresentable

- **shape depends on state.** a draft task has nothing made for it, so it has
  no proposals at all; a finished task's proposals can only be final ones.
- **non-empty where empty means nothing.** a change always changes something,
  a brief always has a version, a proposal always has a round.
- **sequences with structure say so.** every round of a proposal but the last
  got a request for changes, and what the last may be depends on the state:
  a tuple with a rest element, then a typed last element.
- **a type parameter threads a variant through a structure.** one structure
  serves both: nodes inserted by a proposal carry draft ids, the same nodes
  in a document carry real ids, and an applied change carries only real ids.

## state machines

how a thing moves from one form to another is modeled as a state machine,
so the dynamics between types live in the types too: which forms exist,
which moves between them are legal, and what each move gives back.

- **each state is a variant.** the state is the variant's discriminant, and
  that state's data sits on the variant itself; groupings like waiting and
  final are unions of variants.
- **each transition is a function type.** it goes from the variant it takes
  to the variant it gives back, so only legal transitions type-check, and
  code that completes a task has to prove nothing is still waiting.

## parse, don't validate

- **the boundary turns untrusted data into meaning.** data from outside
  (files, command input) is parsed: checked *into* the precise types that say
  what it means. the type is then the proof, and nothing downstream checks
  again.
- **the parser checks everything the data must satisfy.** not just its shape:
  each value's constraints too, and the relations between instances.
- **a proof attests validity upstream, at the boundary.** what's intrinsic to
  the data (its shape, its values) stays valid for good, because data never
  changes once it's parsed. what relates it to something that can change (an
  id that existed, a sibling that was a child of its parent) was valid when
  parsed, and is consulted again wherever it matters.
- **a primitive's mark is a role or a proof.** a role says what a primitive
  means (a node's id, a passage's quote); a proof says what it passed (a
  URL, an ISO time, a whole number from 1). where the constraint is a format
  or grammar, the proof is named for it, not for a stand-in like "not
  empty".
- **proofs originate in one place.** only the parser declares a proof; a cast
  anywhere else could forge one. a role is declared where a value takes it
  on: by the parser, or where doctor makes a new one, like a fresh id.
- **how it works in typescript.** data not yet parsed is typed `unknown`.
  roles and proofs are both brands, compile-time only: an intersection with
  a phantom property keyed by a unique symbol that's declared, never
  created, so nothing at runtime has it and nothing outside its file can
  name it. the parser checks in layers: shape against the type, then each
  value's constraints, recorded with proofs, then relations.

## what types don't solve

the type system has a sweet spot: what's structural and stable, what a thing
is, the forms it takes, how it moves between them. some problems sit outside
it, in principle or in practice, and the urge to solve them in types anyway
is worth catching: a type stretched to cover them grows complicated, and
still can't promise what it claims. those are solved outside the type
system.

the balance itself, how much state is enumerated in types and how much stays
as data, is found through taste and downstream use: a piece of state is
lifted into the type when the uses that depend on it show it's worth it,
and stays as data while nothing does.

## still open

- **field naming**, which will revisit names called provisional along the way.
- **the link as a sibling of the run**, kept for now as the pragmatic shape
  though it's really an umbrella over runs.
- **which field states discriminate on**: their own, or the shared one.
