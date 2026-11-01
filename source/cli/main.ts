import { readFile } from "node:fs/promises";

const usage = `doctor: the agent's side of doctor's tasks

Working on doctor's tasks is a loop: run doctor wait, take the step its "next"
gives you, and run doctor wait again. On a task, propose every change it needs,
one proposal per independent change, then submit it: it completes once each
proposal is accepted or rejected, and comes back to you if any is sent back for
changes.

  doctor wait [--for <s>]  wait for your turn: a task to work on, or proposals sent
                           back for changes. Answers as doctor task does, with "turn" and
                           "next", the step to take. With --for, it gives up after that
                           many seconds, answering { "turn": "human", ... }
  doctor task              the active task: its instruction, and for each document in
                           its scope the scoped nodes and the document's base version
  doctor document [<id>]   a whole document as JSON, with its base version; without an
                           id, the active task's first document
  doctor propose <file>    propose changes; the file, or - for standard input, holds
                             { "document": <id>, "base": <version>, "operations": [...] }
                           where base is the version you read the document at
  doctor submit            hand the active task over for review, once you've proposed
                           everything it needs; with nothing left to review, it
                           completes

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
  const until = Date.now() + patience;
  for (;;) {
    try {
      const response = await fetch(new URL(path, endpoint), {
        method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (response.status === 401) return unanswered(401, `doctor doesn't know this terminal's token: ${outOfDate}`);
      return { status: response.status, body: await response.json() };
    } catch (someError) {
      const again = method === "GET" || refused(someError);
      if (!again || Date.now() >= until) {
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
    case "submit":
      return call("POST", "submit", undefined);
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
