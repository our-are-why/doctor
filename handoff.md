# handoff

notes for a new Claude session working in this project's container. read
this first, then `README.md`, which has the layout, the scripts and the design
in short. this file has the reasons behind them, what's untested, and what's
next. the setup session's memory doesn't carry over (`~/.claude` lives inside
each container), so this file is the record.

a second session (2026-10-30) has since run the setup (it works) and the
`Bun.Terminal` spike, written up in `notes/experiments/pty-terminal.md`.

## what this project is

doctor: a focused developer tool, not a SaaS. one user, local, in a container.
a dynamic single-page app in the browser for reading and annotating markdown,
beside one terminal for working with an agent (Claude Code by default). it
ships as a single Linux binary (runtime, server and app in one file) that will
likely become this container's main app.

the annotation model isn't designed yet. it's designed next, from scratch,
with the user.

## state: set up, never run

the setup session (2026-10-30) ran in another container that had no Bun, so
nothing here has been run or type-checked. first:

    bun install
    bun run check
    bun run startServer          # http://localhost:3004 should show "doctor"
    bun run build && ./build/doctor

if auto mode blocks `bun install` (it downloads code), ask the user to run it.
`bun install` writes `bun.lock`; commit it.

likeliest to need fixes, since they were taken from docs, not tested:

- `bun build` taking `--compile` and `--production` together (the `build`
  script)
- Bun's bundler picking up `jsxImportSource: "preact"` from
  `source/client/tsconfig.json`
- TypeScript 7 accepting every option in `tsconfig.base.json` (`module:
  Preserve`, `allowArbitraryExtensions`, `erasableSyntaxOnly`, target
  `ES2024`, lib `DOM.Iterable`)
- `scripts/makeCssTypes.ts`, never run: Lightning CSS's `transform()` as its
  `index.d.ts` describes it, `Bun.Glob`, and `node:fs`'s `watch` with
  `recursive` under Bun
- the editor: TypeScript 7 ships only a native `tsc`, no tsserver, so
  code-server's TypeScript support probably runs its own bundled version.
  `bun run check` is the authority

the project isn't a git repo yet; ask before `git init`.

## stack, as decided

| what                                      | version                           |
|-------------------------------------------|-----------------------------------|
| Bun (runtime, bundler, PTY, compiler)     | 1.4.4                             |
| TypeScript (native compiler)              | 7.0.2                             |
| Preact, hooks only                        | 11.1.0                            |
| Valibot (validation)                      | 1.5.0                             |
| @xterm/xterm, @xterm/headless             | 6.0.0                             |
| @xterm/addon-serialize                    | 0.14.0                            |
| lightningcss (dev: CSS module types only) | 1.33.0                            |
| @types/bun                                | 1.4.4                             |
| ports                                     | code-server 8085, doctor 3004     |

versions are exact pins; `bunfig.toml` makes `bun add` pin exactly too.

## why it's built this way

### runtime: Bun, after ruling out Go and Node

- **Go is out.** the user built a Go PTY server before,
  [suprasole](https://github.com/fur-tea-laser/suprasole) (see
  `suprasole-server_LEGACY/issues/` and `documentation/`), and the holes were
  in Go's runtime and standard library, not in creack/pty:
  - `syscall.ForkExec` vforks, so a `chdir` or `execve` stuck on a dead
    filesystem stalls the whole runtime;
  - `wait4` can't be interrupted;
  - `TIOCSCTTY` is passed 1, which lets it steal a terminal;
  - signal dispositions are inherited.

  getting it right took an arm64 assembly spawn helper. don't suggest Go for
  this.
- **Node + node-pty was the runner-up.** node-pty 1.2 (beta) has the
  strengths:
  - a real `fork()`;
  - signal dispositions reset;
  - `pause()`/`resume()`, which xterm.js's flow control expects.

  stable 1.1.0 is worse: macOS's `spawn-helper` ships without its exec bit,
  and there are no Linux prebuilds. the weak spot is the single binary: Node's
  SEA, with the native add-on unpacked at run time, and Node's docs warn that
  SEAs built in Linux arm64 containers can fail to load add-ons. node-pty
  also blocks one thread per PTY in `waitpid`.
- **Bun 1.4 won.** 1.4 is a Rust rewrite, from 2026-08. it has:
  - a built-in PTY (`Bun.spawn({ terminal })`, since 1.3.5), so there's no
    native add-on;
  - `bun build --compile` with the app embedded;
  - pidfd-based reaping on the event loop, which holds no thread.

  it fits because doctor runs one PTY, and what runs in it is mostly an
  agent's TUI, which doesn't flood.

`Bun.Terminal`'s limits, read in its source (`src/jsc/bindings/bun-spawn.cpp`,
`src/runtime/api/bun/Terminal.rs`, `src/io/PipeReader.rs`), and what doctor
does about each:

- **vfork, with `chdir` and `execve` inside the window.** a directory on a
  hung filesystem freezes Bun's JS thread, and the project folders here are
  virtiofs mounts from the Mac. so never pass `cwd`: spawn
  `env -C <dir> …`, and the vfork window only execs `/usr/bin/env` from the
  image.
- **no pause.** the reader reads until `EAGAIN`, and `Terminal` exposes no
  pause, though the reader has one internally (`IS_PAUSED`). a program
  therefore runs as fast as the server takes its output. `@xterm/headless`
  parses in 12 ms slices behind `setTimeout` and throws once 50 MB is pending
  ("write data discarded, use flow control to avoid losing data"). so the
  server copy gets a size cap: past it, drop output and mark the gap. worth
  filing a Bun issue for `terminal.pause()`/`resume()`.
- **smaller ones.** the child inherits the parent thread's signal mask, and
  a failed `TIOCSCTTY` is silently ignored.
- **the way back.** if floods turn out to matter in practice, return to
  node-pty, whose pause is what xterm.js's flow control is built on.

### one terminal, independent of the harness

- **one PTY only**, running `bash -lc '<harness>; exec bash -l'` with
  `claude` as the default (configurable). quitting the agent leaves a shell,
  switching harnesses is typing another command, and raw commands work
  directly.
- **the terminal is the only link to the agent.** text goes in as a
  bracketed paste, only when the program has turned bracketed paste on (the
  server copy's `modes.bracketedPasteMode` says). the agent's work comes out
  through the files it edits. harness-specific hooks are optional extras.
- **Claude Code's stream-json mode and the Agent SDK were considered and
  rejected.** the user wants to switch harnesses freely and doesn't trust
  subscription support for headless use to last. facts as of 2026-10-30:
  - signed in with a plan, `claude -p` and the Agent SDK draw from
    subscription limits;
  - Anthropic announced moving them to a separate credit from 2026-06-15,
    then paused that;
  - on 2026-10-07, Max and Team plans gained API credits that cover `-p` only
    with an API key;
  - Claude Code's docs say `--bare`, which never reads the subscription
    login, will become the default for `-p`.
- **a server-side copy of the terminal** (`@xterm/headless` plus
  `addon-serialize`) restores the screen after a reload or reconnect, with the
  cap above. reloads are frequent: Bun's hot reload has no Preact refresh, so
  every component edit reloads the page.
- **one writer.** a new tab takes over, and the old one goes read-only. the
  active tab sets the terminal's size.

### the pipe: one WebSocket

- **WebTransport was the user's first idea.** every browser has it (Safari
  since 26.4), but no server runtime here does. Bun has experimental HTTP/3
  (`http3: true`, since 1.3.14), and WebTransport is an open request
  ([oven-sh/bun#13656](https://github.com/oven-sh/bun/issues/13656)). it would
  also need TLS with an ECDSA P-256 certificate valid for under 14 days,
  pinned by hash, plus a UDP port. revisit if Bun ships it.
- **shaped so that a later switch only changes the transport:**
  - text frames carry JSON control messages, one Valibot
    `v.variant("type", …)`, with request ids for replies and server pushes for
    file changes;
  - binary frames carry the terminal's bytes, `[u32 channel][bytes]` (with one
    PTY, the channel may not be needed);
  - the browser grants the terminal credits as xterm.js draws, so its output
    can't crowd out control messages.
- **WebSockets are built into `Bun.serve`**, which signals when it can send
  more through its `drain` callback.

### frontend

- **Preact 11, hooks only.** the user rejects signals outright; don't
  propose them.
- **no Vite.** Bun's HTML imports bundle the app in development and into the
  binary.
- **CSS modules from Bun's bundler** (a port of Lightning CSS): a default
  export only, no named imports. write class names as identifiers
  (`.doubleBar`), so they read as `styles.doubleBar`.
- **types from `scripts/makeCssTypes.ts`**, which writes `X.module.d.css.ts`
  (gitignored) beside each stylesheet. this is needed because TypeScript 7
  dropped language-service plugins.

### TypeScript

- **TypeScript 7's native compiler**, with the strict flags in
  `tsconfig.base.json`.
- **`erasableSyntaxOnly`:** no enums (use string unions or `as const`
  objects), no namespaces with runtime code, no parameter properties, no
  `import =` / `export =`. type-only imports use `import type`. imports name
  the file, `.ts` extension included. no tsconfig `paths`; use package.json
  `"imports"` instead.
- **a config per part.** the client gets the DOM and JSX but none of Bun's
  APIs; the server and scripts get Bun's APIs and no DOM. `source/shared/`
  gets a config with neither once it has a file (a config with no input
  files fails `tsc`).
- **validate every boundary.** anything read from disk or the socket is
  `unknown` until Valibot checks it, through a small Standard Schema helper
  so the library can change later. no `any`, no `as`.

### container

- **Bun comes from its official image.** the `Containerfile` copies `bun`
  from `oven/bun:1.4.4-slim`, pinned by the multi-arch index digest taken
  from the registry. Docker Hub's tag API lists single-architecture digests
  first, so its first one is the wrong one to pin.
- **ports:** code-server on 8085, doctor on 3004, published on the Mac's
  127.0.0.1 only. the server listens on 0.0.0.0 inside the container, so the
  published port reaches it.

## before the terminal goes in

these are also in `README.md`:

- **spawn through `env -C <dir>`**, never with a working directory (see
  above).
- **check the `Origin` of every WebSocket upgrade.** any page open in the
  browser can open a WebSocket to localhost, and doctor's would hand it a
  shell.
- **run doctor behind dumb-init** once it's the container's main app.
  orphaned processes re-parent to PID 1, which nothing else would reap, and
  PID 1 ignores SIGTERM unless it handles it. code-server's entrypoint already
  does `exec dumb-init …`.

## next

1. make the setup run (the list under "state").
2. spike `Bun.Terminal` in this container, in the spirit of suprasole's
   contract tests. check:
   - the child's `SigBlk`/`SigIgn` in `/proc/self/status`;
   - its open file descriptors;
   - its session and controlling terminal (`ps -o sid,pgid,tpgid,tty`);
   - a bad directory passed through `env -C`;
   - resize reaching the program (SIGWINCH);
   - event-loop lag and Ctrl-C latency while `yes` floods;
   - teardown.

   the setup session couldn't run this: there was no Bun, and auto mode
   blocked downloading it.
3. design the annotation model with the user.
4. build the terminal, then the pipe, then the app.

## how the user likes to work

- **quick, casual messages.** read for intent, and confirm direction before
  big moves.
- **honest pushback and recommendations**, not surveys of options. say so
  when a path looks wrong.
- **verify, don't assert.** the setup session called creack/pty "fine" and
  was rightly corrected. claims about runtimes, PTYs and processes should
  come from source or a test, marked as verified or inferred.
- **deep systems knowledge** (process spawning, signals, PTYs): talk at that
  level.
- **strong types matter.** they joke about the quality of TypeScript typing
  in training data. strict flags, no escape hatches.
- **git:** no Co-Authored-By or "Generated with Claude" lines in commits or
  PRs.
- **naming:** marketing's website uses `VARIANT_BaseName` component names
  (`HTML_HomePage`, `BAR_Divider`), `Props_X` types, `someX` callback
  parameters and camelCase task names (doctor's scripts follow the last one).
  the setup used plain `App` and `main.tsx`; ask whether to adopt the rest.

## references

- Bun:
  - [single-file executables](https://bun.com/docs/compiler/executables.md)
  - [full-stack apps](https://bun.com/docs/bundler/fullstack.md)
  - [CSS modules](https://bun.com/docs/bundler/css.md)
  - [`terminal` in `Bun.spawn`](https://bun.com/docs/runtime/child-process)
  - [HTTP/3](https://bun.com/docs/runtime/http/server)
- xterm.js [`WriteBuffer.ts`](https://github.com/xtermjs/xterm.js/blob/master/src/common/input/WriteBuffer.ts):
  the 50 MB limit and the 12 ms slices
- node-pty:
  - [typings](https://github.com/microsoft/node-pty/blob/main/typings/node-pty.d.ts)
    (`pause`, `resume`, `handleFlowControl`)
  - [#919](https://github.com/microsoft/node-pty/issues/919) (1.1.0's
    spawn-helper)
  - [#632](https://github.com/microsoft/node-pty/issues/632) (no Bun support)
- Node's [single executable applications](https://nodejs.org/api/single-executable-applications.html)
- Claude Code:
  - [headless mode](https://code.claude.com/docs/en/headless)
  - [legal and compliance](https://code.claude.com/docs/en/legal-and-compliance.md)
  - [Agent SDK with a Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
