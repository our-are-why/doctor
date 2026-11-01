import { readFile } from "node:fs/promises";

const usage = `doctor: the agent's side of doctor's tasks

  doctor task              the active task: its instruction, and for each document in
                           its scope the scoped nodes and the document's base version
  doctor document [<id>]   a whole document as JSON, with its base version; without an
                           id, the active task's first document
  doctor propose <file>    propose changes; the file, or - for standard input, holds
                             { "document": <id>, "base": <version>, "operations": [...] }
                           where base is the version you read the document at
  doctor submit            hand the active task back for review

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
            a list item or a section, whose heading is its text
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

async function call(method: string, path: string, body: unknown): Promise<number> {
  const endpoint = process.env["DOCTOR_ENDPOINT"];
  const token = process.env["DOCTOR_TOKEN"];
  if (endpoint === undefined || token === undefined) {
    console.log(JSON.stringify({ issues: ["DOCTOR_ENDPOINT isn't set: use a terminal VS Code opened after doctor started"] }));
    return 1;
  }
  const response = await fetch(new URL(path, endpoint), {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).catch((someError: unknown) => new Response(JSON.stringify({ issues: [`doctor isn't answering: ${String(someError)}`] }), { status: 503 }));
  console.log(JSON.stringify(await response.json(), null, 2));
  return response.ok ? 0 : 1;
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
