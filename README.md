# doctor

Reads, edits and annotates documents beside an agent such as Claude Code. A
VS Code extension for code-server: its document editor and task dashboard
are webviews, and the agent works in VS Code's own terminal.

So far documents can be created and read: "doctor: new document" makes one,
and the editor renders any `*.doctor.json`, or says why it can't. Editing,
notes and tasks come next.

## Develop

On the host, build and start the development container (it needs the shared
base image; see `../.apple-container/README.md`):

    ./.environment/scripts/buildContainer.sh
    ./.environment/scripts/startContainer.sh

Open code-server at http://localhost:8085 and, in its terminal, run:

    cd ~/project
    bun install
    bun run installExtension

then reload the window (Developer: Reload Window). In code-server:

- any `*.doctor.json` file opens in doctor's document editor;
- "doctor: open the task dashboard" opens the dashboard as an editor tab;
- "Terminal: Create New Terminal in Editor Area" puts a terminal beside them.

While you edit stylesheets, `bun run watchCssTypes` in a second terminal
keeps their types current. `bun install` writes `bun.lock`, which is
committed.

## Scripts

| Script                     | What it does                                             |
|----------------------------|----------------------------------------------------------|
| `bun run makeCssTypes`     | writes each CSS module's declaration, `Shell.module.d.css.ts` beside `Shell.module.css` |
| `bun run watchCssTypes`    | the same, again whenever a stylesheet changes             |
| `bun run check`            | type-checks scripts/, the extension, the webviews and source/shared/, each against its own tsconfig |
| `bun run buildExtension`   | bundles the extension and its webviews into `build/extension/`, and packs them as `build/doctor-<version>.vsix` |
| `bun run installExtension` | builds the extension and installs it into this container's code-server |

## Layout

    source/extension/   the extension, in VS Code's Node extension host: its
                        server, the document editor and the dashboard;
                        manifest.json becomes the extension's package.json
    source/webview/     the webviews, in the browser: Preact with hooks, CSS
                        modules in styles/, one entry point per webview in
                        entries/
    source/shared/      what both import: the domain's types (domain.ts), the
                        protocol between them, and parsing
    scripts/            the project's own tools: building and installing the
                        extension, makeCssTypes.ts
    notes/              how types are built (type-construction.md)
    notes/experiments/  write-ups of experiments, like vscode-extension.md
    samples/            documents to try doctor on, like sample.doctor.json

Every part is checked against `tsconfig.base.json`'s rules plus only what
that part may use: the extension gets Node's and VS Code's APIs and no DOM,
the webviews get the DOM and nothing else, `source/shared/` gets neither, and
scripts/ gets Bun's APIs.

The project folder is case-insensitive (it's a macOS volume), so two files
whose names differ only in case can't sit side by side.

## Design

What doctor is built from, and why:

- **A VS Code extension.** VS Code supplies the terminal, the layout and
  everything around them; doctor adds a document editor (a custom editor for
  `*.doctor.json`) and a task dashboard (a webview panel).
- **One endpoint.** The extension runs an HTTP and WebSocket server on
  `127.0.0.1`, at a free port. Webviews reach it through code-server's proxy
  (`vscode.env.asExternalUri`), and the agent's command reaches it directly.
  Each kind of caller, the human or the agent, has its own token; every new
  terminal gets the agent's in `DOCTOR_TOKEN`, with the address in
  `DOCTOR_ENDPOINT`.
- **Every boundary is parsed.** Messages, webview configs and files are
  checked with Valibot into the domain's types, through a helper written
  against the Standard Schema interface.
- **Bun is the development tooling**: package manager, bundler and script
  runner. Nothing that ships runs on it: the extension runs in VS Code's Node
  host, the webviews in the browser.
- **CSS modules** come from Bun's bundler, and their types from
  `scripts/makeCssTypes.ts`, since TypeScript 7 dropped the editor plugins
  that typed them before.
- **TypeScript 7**, with the strict flags in `tsconfig.base.json`, and only
  syntax that erasing the types leaves as plain JavaScript.
