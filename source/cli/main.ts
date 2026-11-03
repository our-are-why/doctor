import { readFile } from "node:fs/promises";

// a command's arguments: the value after each flag it knows, and the rest
function flagsOf(given: Array<string>, known: Array<string>): { flags: Map<string, Array<string>>; rest: Array<string> } {
  const flags = new Map<string, Array<string>>();
  const rest: Array<string> = [];
  for (let at = 0; at < given.length; at += 1) {
    const each = given[at] ?? "";
    const value = given[at + 1];
    if (known.includes(each) && value !== undefined) {
      flags.set(each, [value]);
      at += 1;
    } else {
      rest.push(each);
    }
  }
  return { flags, rest };
}

const usage = `doctor: the agent's side of doctor's tasks

Working on doctor's tasks is a loop: run doctor wait, take the step its "next"
gives you, and run doctor wait again. A task is its requests: what's asked of
you, each with the places it targets. A request's targets say where it's
aimed, not what you may change: a move, a restructure or a change it leads to
elsewhere, in any document, is part of answering it. A request without
targets is about every document in the project, unless its words narrow it
("in spike"). Answer the requests with proposals, one per independent change,
then submit the task: it completes once each proposal is accepted or rejected,
and comes back to you if any is sent back for changes.

  doctor wait [--for <s>]  wait for your turn: a task to work on, or proposals sent
                           back for changes. Answers as doctor task does, with "turn" and
                           "next", the step to take. With --for, it gives up after that
                           many seconds, answering { "turn": "human", ... }. A proposal
                           sent back says what should change in its "feedback", and may
                           have "passages", notes on words of the text it proposed: each
                           the "words", the text "within" which they are, "at" where in
                           it they start (in characters, as the same words can be there
                           more than once), and the "note".
                           One edited by the person reviewing it has "edited", its
                           operations as they left them: revise from those, keeping
                           their edits. Revise it as the same proposal, with doctor propose
  doctor task              the active task: its "requests", each with its "text" and
                           "targets", each target shown as it is now: a "document"
                           with all its "blocks", a "node", or a "passage" of a text
                           with its "words"; and "documents", each document targeted
                           with its base version
  doctor documents         every document in the project, with its id and title
  doctor document [<id>]   a whole document as JSON, with its base version; without an
                           id, the active task's first targeted document
  doctor propose <file>    propose changes; the file, or - for standard input, holds
                             { "document": <id>, "base": <version>,
                               "answers": [<request id>, ...], "operations": [...],
                               "rationale": <text>, "changes": <text> }
                           where base is the version you read the document at,
                           answers names the requests the proposal answers,
                           rationale says why it's this change, and, revising a
                           proposal, changes says what this round changed; a
                           revision without a rationale keeps the one before
  doctor summarize [--document <id>] [--headline <line>] <text>
                           say where the active task stands, as a whole, or in one
                           document: what changes there, as its effect on the
                           document, not a list of the proposals, which show
                           themselves. Each replaces the last of
                           its kind, so say it as it is now, not as news. The
                           headline says it in one short line, shown where there's
                           room for little more: what the work does or means, not
                           counts or states, which doctor shows beside it
  doctor submit [--summary <text> [--headline <line>] | --note <text>]
                           hand the active task over for review, once you've proposed
                           everything it needs; with nothing left to review, it
                           completes. The summary, shown with the task, says where
                           it stands as a whole: what it does, or why nothing needed
                           changing; give it the first time, and again only when that
                           picture changes. What a revision did goes in its proposal's
                           "changes", not here. A note is a word on this hand-over
                           alone, kept with it, never shown as the summary

Everything is JSON. When doctor refuses something, it answers { "issues": [...] }
and the command exits 1.

Operations, applied in order:

  { "kind": "write", "holder": <holder>, "text": <the text's new characters> }
      marks on the old text stay on the characters that survive
  { "kind": "style", "holder": <holder>, "overlay": [<mark>, ...] }
  { "kind": "edit", "node": <id>, "content": <content> }
      content is { "kind": "code", "language": { "kind": "stated", "name": "ts" }
      or { "kind": "unstated" }, "code": "..." }, or
      { "kind": "list", "order": "ordered" | "unordered" }
  { "kind": "insert", "at": <position>, "subtree": <node> }
  { "kind": "delete", "node": <id> }
  { "kind": "move", "node": <id>, "to": <position> }

  holder    { "kind": "title" } or { "kind": "node", "node": <id> }, a paragraph,
            a list item, a section, whose heading is its text, or a quote,
            whose reference is its text: where its words come from, empty
            when that isn't said
  mark      { "kind": "contrast", "contrast": "bold" | "italic" | "monospace" |
            "highlighted" | "struck", "from": <n>, "to": <n> } or
            { "kind": "link", "target": <target>, "from": <n>, "to": <n> },
            offsets counting Unicode code points
  position  { "kind": "first", "parent": <parent> } or
            { "kind": "after", "parent": <parent>, "sibling": <id> }
  parent    { "kind": "body" } or { "kind": "node", "node": <id> }
  node      as doctor document shows them; a node you add is named new-<something>,
            like "new-summary", which other operations can name too
`;

interface _Answer_Cli_ {
  status: number;
  body: unknown;
}

const unanswered = (status: number, issue: string): _Answer_Cli_ => ({ status, body: { issues: [issue] } });

const outOfDate = "if VS Code was reloaded since this terminal opened and doctor moved, open a new terminal";

// how long doctor is waited for when it can't be reached: long enough to
// see a window reload through
const patience = 15_000;
const apart = 500;

// A request is tried again only if that can't do it twice: one that only
// reads, or one whose connection was refused before it was sent.
const refused = (someError: unknown) =>
  someError instanceof Error &&
  someError.cause instanceof Error &&
  "code" in someError.cause &&
  someError.cause.code === "ECONNREFUSED";

async function request(method: string, path: string, body: unknown): Promise<_Answer_Cli_> {
  const endpoint = process.env["DOCTOR_ENDPOINT"];
  const token = process.env["DOCTOR_TOKEN"];
  if (endpoint === undefined || token === undefined) {
    return unanswered(503, "DOCTOR_ENDPOINT isn't set: use a terminal VS Code opened after doctor started");
  }
  // counted from the first of a run of failures: an attempt that was being
  // answered a while before it failed, as a wait is, starts a fresh run
  let until: Array<number> = [];
  for (;;) {
    const tried = Date.now();
    try {
      const response = await fetch(new URL(path, endpoint), {
        method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (response.status === 401) return unanswered(401, `doctor doesn't know this terminal's token: ${outOfDate}`);
      return { status: response.status, body: await response.json() };
    } catch (someError) {
      until = until.length === 0 || Date.now() - tried > apart ? [Date.now() + patience] : until;
      const again = method === "GET" || refused(someError);
      if (!again || until.some((each) => Date.now() >= each)) {
        return unanswered(503, `doctor isn't answering at ${endpoint}: ${outOfDate} (${String(someError)})`);
      }
      await new Promise((resolve) => setTimeout(resolve, apart));
    }
  }
}

function print(answer: _Answer_Cli_): number {
  console.log(JSON.stringify(answer.body, null, 2));
  return answer.status >= 200 && answer.status < 300 ? 0 : 1;
}

async function call(method: string, path: string, body: unknown): Promise<number> {
  return print(await request(method, path, body));
}

const humansTurn = (body: unknown) => typeof body === "object" && body !== null && "turn" in body && body.turn === "human";

// doctor's endpoint answers a wait within a minute, so this asks again until
// it's the agent's turn, or until --for's seconds are up
async function wait(seconds: Array<number>): Promise<number> {
  const until = seconds.map((each) => Date.now() + each * 1000);
  for (;;) {
    const left = until.map((each) => Math.max(each - Date.now(), 0));
    const answer = await request("GET", `wait${left.map((each) => `?for=${each}`).join("")}`, undefined);
    if (!humansTurn(answer.body) || until.some((each) => Date.now() >= each)) return print(answer);
  }
}

async function readInput(name: string): Promise<Array<unknown>> {
  const text = await readFile(name === "-" ? "/dev/stdin" : name, "utf8");
  try {
    return [JSON.parse(text)];
  } catch (someError) {
    console.log(JSON.stringify({ issues: [`${name === "-" ? "standard input" : name} isn't JSON: ${String(someError)}`] }));
    return [];
  }
}

async function run(args: Array<string>): Promise<number> {
  const [command, argument] = args;
  switch (command) {
    case "wait": {
      const [flag, value] = args.slice(1);
      if (flag === undefined) return wait([]);
      const seconds = Number(value);
      if (flag !== "--for" || !Number.isFinite(seconds) || seconds <= 0) {
        console.log(JSON.stringify({ issues: ["doctor wait takes --for <seconds>, a number above 0, or nothing"] }));
        return 1;
      }
      return wait([seconds]);
    }
    case "task":
      return call("GET", "task", undefined);
    case "documents":
      return call("GET", "documents", undefined);
    case "document":
      return call("GET", `document/${argument ?? ""}`, undefined);
    case "propose": {
      if (argument === undefined) {
        console.log(JSON.stringify({ issues: ["name the file holding the proposal, or - for standard input"] }));
        return 1;
      }
      const [payload] = await readInput(argument);
      return payload === undefined ? 1 : call("POST", "propose", payload);
    }
    case "submit": {
      const { flags, rest } = flagsOf(args.slice(1), ["--summary", "--note", "--headline"]);
      const [summary] = flags.get("--summary") ?? [];
      const [note] = flags.get("--note") ?? [];
      const [headline = ""] = flags.get("--headline") ?? [];
      if (rest.length > 0 || (summary === undefined && note === undefined && flags.size > 0) || (summary !== undefined && note !== undefined)) {
        console.log(JSON.stringify({ issues: ["doctor submit takes --summary <text> with --headline <line> if you like, --note <text>, or nothing"] }));
        return 1;
      }
      if (summary !== undefined) return call("POST", "submit", { summary, headline });
      if (note !== undefined) return call("POST", "submit", { note });
      return call("POST", "submit", undefined);
    }
    case "summarize": {
      const { flags, rest } = flagsOf(args.slice(1), ["--document", "--headline"]);
      const [summary] = rest;
      const [document] = flags.get("--document") ?? [];
      const [headline = ""] = flags.get("--headline") ?? [];
      if (summary === undefined || summary.trim() === "" || rest.length > 1) {
        console.log(JSON.stringify({ issues: ["doctor summarize takes a summary, with --document <id> for a document's, and --headline <line> if you like"] }));
        return 1;
      }
      return call("POST", "summarize", document === undefined ? { summary, headline } : { document, summary, headline });
    }
    case "help":
    case undefined:
      console.log(usage);
      return 0;
    default:
      console.log(usage);
      return 1;
  }
}

void run(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
