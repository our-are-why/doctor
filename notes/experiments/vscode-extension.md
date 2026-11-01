# vscode extension

whether doctor works as a VS Code extension inside this container's
code-server (VS Code 1.141.0, served to the browser), checked on 2026-10-31
with a throwaway extension installed from a hand-built `.vsix`. everything
below is verified unless marked otherwise.

**verdict: it works, and the layout doctor wants is reachable.**

## where the extension runs

- in a Node extension host **on the server** (Node 24.21.0, linux), even
  though the UI is in the browser: `uiKind` is web, `remoteName` is
  `localhost:8085`, `appHost` is `server-distro`.
- so Node's `fs`, sockets and child processes are all available: file
  storage and a local socket for the agent's command work as in any Node
  extension. (vscode.dev-style web extensions, which run in the browser with
  no Node, are a different thing and not what code-server runs.)
- installing: `code-server --install-extension <file>.vsix` installs into
  the running server; a new extension activated at once, an updated one
  after reloading the window.

## what was checked

- **a custom editor** for `*.doctor.json`: opens in a webview, runs scripts,
  and passes messages both ways with the extension host. after a reload,
  VS Code restored the open custom editor tab by itself.
- **a webview view in the panel**: works, but the panel shows one container
  at a time, so it can't sit beside the terminal there.
- **the layout, in the editor area instead**: `vscode.setEditorLayout` split
  the editor area into the document on the left (60%) and, on the right, a
  webview panel (the dashboard) above a terminal opened as an editor tab
  (`createTerminal({ location: { viewColumn } })`). all three resize, and the
  extension sets it up with one command.
- **text into a terminal**: `Terminal.sendText(text, false)` types without
  running. that's the mechanism for handing a task's brief to the agent.

## one endpoint for every client

the extension can run its own HTTP and WebSocket server (here a bare
`node:http` server on `127.0.0.1:4004`), and every client can use it:

- **the agent's command**, inside the container, calls `127.0.0.1:4004`
  directly.
- **webviews**, in the browser, get an address from
  `vscode.env.asExternalUri("http://127.0.0.1:4004/")`, which in code-server
  is its own proxy path, `http://localhost:8085/proxy/4004/`. a fetch and a
  WebSocket from a webview both reached the extension's server.
- a webview's origin is code-server's own (`http://localhost:8085`), so the
  proxy is same-origin to it, and the browser sends code-server's login
  cookie: the WebSocket upgrade arrived with it. without the cookie, the
  proxy redirects to `/login`, so the proxied path is behind code-server's
  password.
- inferred, not checked: an extension can set environment variables for every
  integrated terminal (`environmentVariableCollection`), which is how the
  agent's command would find the endpoint and a token.

## what it changes

- the terminal is VS Code's: no PTY, no server-side copy, no flow control
  of our own (see `pty-terminal.md`, now background only).
- the runtime is VS Code's Node extension host, not Bun; Bun can stay as
  bundler, checker and test runner.
- the client is webviews, talking to the extension's own server through
  code-server's proxy; the single binary becomes a `.vsix`.
- the domain types carry over unchanged.

## not checked

- whether a layout the extension sets survives a reload without running the
  command again (inferred: VS Code restores editor layouts, but webview
  panels need a serializer to come back with content).
- the environment variables reaching terminals.
