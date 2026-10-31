# doctor

Reads and annotates markdown, beside one terminal for working with an agent
such as Claude Code. A Bun server and a Preact app in the browser, shipped as
a single Linux binary.

So far it's the project's setup: the server serves a placeholder page, and
nothing else is built yet.

## Develop

On the host, build and start the development container (it needs the shared
base image; see `../.apple-container/README.md`):

    ./.environment/scripts/buildContainer.sh
    ./.environment/scripts/startContainer.sh

Open code-server at http://localhost:8085 and, in its terminal, run:

    cd ~/project
    bun install
    bun run startServer

doctor is then at http://localhost:3004. While you edit stylesheets,
`bun run watchCssTypes` in a second terminal keeps their types current.
`bun install` writes `bun.lock`, which is committed.

## Scripts

| Script                  | What it does                                            |
|-------------------------|---------------------------------------------------------|
| `bun run startServer`   | serves doctor for development: the app is bundled as it's requested and rebundled when its files change (refresh the page; HMR is off, see `source/server/main.ts`), and the server reloads when its own files do |
| `bun run makeCssTypes`  | writes each CSS module's declaration, `App.module.d.css.ts` beside `App.module.css` |
| `bun run watchCssTypes` | the same, again whenever a stylesheet changes            |
| `bun run check`         | type-checks scripts/, the app, the server and source/shared/, each against its own tsconfig |
| `bun run build`         | compiles doctor, app included, into one binary for linux-arm64: `build/doctor` |

## Layout

    source/client/   the browser app: Preact with hooks, CSS modules in styles/
    source/server/   the server
    source/shared/   what both import: the domain's types, in domain.ts
    scripts/         the project's own tools, like makeCssTypes.ts
    notes/           how types are built (type-construction.md)
    notes/experiments/  write-ups of experiments, like pty-terminal.md

Every part is checked against `tsconfig.base.json`'s rules plus only what
that part may use: the app gets the DOM and none of Bun's APIs, the server
and scripts get Bun's APIs and no DOM, and `source/shared/` gets neither.

## Design

What doctor is built from, and why:

- **Bun** compiles the server, the app and the runtime into one binary, and
  has a PTY built in, so no native add-on has to be unpacked at run time.
- **One terminal.** doctor runs a single PTY with
  `bash -lc '<harness>; exec bash -l'`, `claude` being the default harness.
  Quitting the agent leaves a shell, and switching harnesses is typing
  another command.
- **The terminal is doctor's only link to the agent**, so any harness works.
  doctor hands text to the agent as a bracketed paste, and sees the agent's
  work through the files it edits.
- **A copy of the terminal on the server** (`@xterm/headless`) restores the
  screen after a reload or a reconnect. Bun's PTY can't pause reading, so the
  copy has a size cap: past it, output is dropped, and the gap is marked. One
  tab writes at a time; a new tab takes over.
- **One WebSocket** carries everything: JSON control messages, checked with
  Valibot, and the terminal's bytes as binary frames. The browser grants the
  terminal credits, so its output can't crowd out the rest.
- **CSS modules** come from Bun's bundler, and their types from
  `scripts/makeCssTypes.ts`, since TypeScript 7 dropped the editor plugins
  that typed them before.
- **TypeScript 7**, with the strict flags in `tsconfig.base.json`, and only
  syntax that erasing the types leaves as plain JavaScript.

## Before the terminal goes in

- Spawn through `env -C <dir>`, never with a working directory. Bun spawns
  with vfork and changes directory inside it, so a hung filesystem would
  freeze doctor, and the project folders here are virtiofs mounts from the
  Mac.
- Check the `Origin` of every WebSocket upgrade. Any page open in the browser
  can open a WebSocket to localhost, and doctor's would hand it a shell.
- Once doctor is the container's main app, run it behind dumb-init, so the
  shell's orphaned processes get reaped.
