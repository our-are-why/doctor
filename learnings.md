# learnings

what the second session (2026-10-30) found, tried and recommends, in this
project's container. `handoff.md` is the setup session's record; where they
disagree, this file is newer. **verified** means run here; **inferred** means
reasoned from docs, source or other results, not tested.

## setup: works

verified:

- `bun install` pinned all 14 packages and wrote `bun.lock` (Bun 1.4.4 was
  already in the image).
- `bun run check` passes, and really checks. probe files with deliberate
  errors were caught: a misspelled CSS module class, `Bun` in the client,
  `document` in the server, an `enum`, unchecked indexing in both.
- `bun run startServer` serves the page; the user reached it from the Mac at
  localhost:3004. the bundle uses Preact's JSX runtime (so Bun reads
  `jsxImportSource` from `source/client/tsconfig.json`) and scopes the CSS
  module's class names.
- `bun run build` accepts `--compile` and `--production` together. the
  104 MB `build/doctor`, run from `/tmp`, serves its embedded bundle.
- `scripts/makeCssTypes.ts` writes the declaration (one-shot mode).

found along the way:

- **`tsc` only runs through `bun run` or `bunx`.** TypeScript 7's `bin/tsc`
  is a `#!/usr/bin/env node` launcher, and the image has no `node`; `bun run`
  puts its own `node` on the PATH.
- **import extensions aren't enforced.** `import { App } from "./App"`
  type-checks: `moduleResolution: "bundler"` accepts extensionless imports,
  and `allowImportingTsExtensions` only permits extensions. enforcing the
  convention needs a lint rule or a check script.
- **neither the dev server nor the binary handles SIGTERM**; it just kills
  them (exit 143).
- **the container's own IP answers on 3004** (192.168.64.20, from inside).
  inferred, untested: the Mac may reach that IP directly, bypassing the
  127.0.0.1 publishing, which makes the WebSocket `Origin` check matter more.
- **lead, untested:** `bun-types` ships a `CLAUDE.md` saying `bun check`
  type-checks with the same errors as `tsc`. it might replace `tsc` and the
  `node` shim.

untested: `bun run watchCssTypes` (recursive `fs.watch` under Bun), and
code-server's TypeScript support.

## HMR: off, decided with the user

**symptom.** in the browser: `ReferenceError: import_App_module is not
defined`. Bun 1.4.4's HMR bundle drops `App.tsx`'s import of
`App.module.css` from the module's import list but still uses the binding.

**experiments** (a copy of the client served from a scratch server on port
3099; verified):

| variant                                          | result          |
|--------------------------------------------------|-----------------|
| `development: { hmr: true }`                     | import dropped  |
| `development: { hmr: false }`                    | works           |
| production (`development: false`, and the binary)| works           |
| HMR, without `App.module.d.css.ts`               | import dropped  |
| HMR, stylesheet beside `App.tsx`                 | import dropped  |
| HMR, stylesheet also imported by the entry       | dropped in both |
| HMR, `import * as styles`                        | binding dropped |

1.4.4 is the newest Bun release (22 Oct). no matching issue found
([#47397](https://github.com/oven-sh/bun/issues/47397) is a different CSS
modules problem).

**decision.** `development: { hmr: false }` in `source/server/main.ts`. the
user doesn't trust HMR anyway and prefers dev matching production, which
no-HMR bundles do (`chunk-*.js` with the class map inlined, like the
binary's). the cost: refresh by hand after an edit (the server does rebundle,
verified), and the browser's console no longer prints in the server's
terminal (both went over HMR's WebSocket).

**follow-ups.** file the bug with Bun (a minimal repro is a stylesheet module
imported by one component). automatic reloads could come back as a dev-only
"reload" message over doctor's own WebSocket.

## `Bun.Terminal` spike: not a deal-breaker

**method.** throwaway Bun scripts, spawning through
`env -C /home/coder/project …` into `Bun.spawn({ terminal })`, as doctor
will. no `strace` in the image, so the vfork itself wasn't observed.

### the child (verified)

- **signals:** nothing blocked or ignored. Bun's own threads ignore PIPE and
  XFSZ, and the child gets them back at default. (the thread that blocks
  everything is mimalloc's scavenger, not the one that spawns.) GNU `env`
  9.7 can reset dispositions (`--default-signal`) but not unblock.
- **file descriptors:** only 0–2. with a listening socket, both ends of a
  WebSocket, an epoll and an eventfd open in the parent, none reach the
  child.
- **session:** the child is session leader, with the PTY as controlling
  terminal (`/dev/tty` opens, TPGID matches), and an interactive bash has
  job control. so `TIOCSCTTY` worked.
- **termios:** `iutf8`, `isig`, `icanon`, `onlcr` on, `ixany` on by
  default.
- **bad directory:** `env -C /nonexistent` fails at once, exit 125. Bun's own
  `cwd` throws `ENOENT … posix_spawn` synchronously.
- **untested:** a *hung* directory (needs FUSE). `env -C` stays the plan.

### resize (verified)

`terminal.resize()` reaches the program as SIGWINCH with the new size
(100×30 → 132×43 → 80×24, read back with `stty size`).

### floods (verified)

an interactive bash runs a flood for 5–10 s. measured: read rate, JS thread
lag (drift of a 10 ms interval), HTTP latency from a separate `curl` loop
(standing in for the browser), memory, and Ctrl-C to a working prompt
(`echo MARK$((40+2))` printing). once only counting bytes, once feeding
`@xterm/headless` like doctor's server copy.

| flood                    | copy     | read     | lag max | HTTP max | Ctrl-C | copy's backlog          |
|--------------------------|----------|----------|---------|----------|--------|-------------------------|
| `yes`                    | none     | 17.5 MB/s| 19 ms   | 17 ms    | 9 ms   | –                       |
| `yes`                    | headless | 12 MB/s  | 30 ms   | 35 ms    | 16 ms  | ≤ 0.1 MB                |
| dense colour (SGR)       | headless | 75 MB/s  | 22 ms   | 30 ms    | 17 ms  | ≤ 0.7 MB                |
| clears + cursor moves    | headless | 33 MB/s  | 27 ms   | 33 ms    | 30 ms  | +12 MB/s, overflowed    |
| clears + moves, XOFF/XON | headless | 22.6 MB/s| 26 ms   | –        | 15 ms  | ≤ 5.3 MB, 0 dropped     |

the floods: `yes`; `yes "$(printf "\e[1;31mR\e[0;32mG\e[38;5;208mO\e[48;2;10;20;30mT\e[0m\e[3;7mi\e[0m")"`;
`yes "$(printf "\e[H\e[2J\e[5;10H\e[44m status \e[0m\e[12;3H\e[Kbody line\e[20;1H\e[1m> \e[0m\e[?25l\e[?25h")"`.

what that shows:

- **responsiveness holds.** Bun reads about one kernel PTY buffer (50–120 KB)
  per event-loop turn, and xterm parses in 12 ms slices, so the thread stays
  free. a busy thread also slows the program: the kernel buffer fills and
  the program blocks in `write()`. memory stays flat unless the copy falls
  behind.
- **the copy falls behind on screen-heavy output.** xterm parses clears and
  cursor moves at ~20 MB/s (the rate the backlog drained at, inferred). its
  backlog passed 50 MB in ~5 s and xterm threw "write data discarded, use
  flow control to avoid losing data": 730 chunks, ~88 MB, lost. plain text
  and colour keep up.
- **raw `yes` is slow because of the kernel**, not Bun (inferred): `onlcr`
  turns every `\n` of a 2-byte line into `\r\n`; longer lines read faster.
- **`data()` buffers aren't reused** between callbacks, so queuing them is
  safe.

### XOFF/XON (verified)

- sending ^S when the copy's backlog passes 4 MB and ^Q under 1 MB kept it
  ≤ 5.3 MB with nothing dropped; the program ran at the parse rate.
- `terminal.inputFlags` and `localFlags` follow the program's mode live from
  doctor's side: `stty raw` turns IXON and ICANON off, `stty sane ixon` back
  on.
- doctor can clear IXANY from its side (`inputFlags &= ~IXANY`); the child's
  `stty -a` then shows `-ixany`.

### teardown (verified)

- `terminal.close()` hangs up: bash dies of SIGHUP and takes its background
  and foreground jobs with it; the `exit` callback fires at once.
- interactive bash ignores SIGTERM: `proc.kill()` with its default does
  nothing. SIGHUP ends it.
- doctor killed with SIGKILL: the kernel closes the PTY master and everything
  under it ends. no orphans.
- PID 1 here is code-server's `dumb-init`.

## recommendations

terminal:

- **end the shell with `terminal.close()` or SIGHUP**, never SIGTERM.
- **throttle cooked-mode floods with XOFF/XON**, from the server copy's
  backlog (4 MB / 1 MB worked). send ^S only while `inputFlags` has IXON,
  since a raw-mode program reads ^S as a keystroke. clear IXANY so
  keystrokes don't undo it. caveat: doctor's ^Q could undo a ^S the user
  typed.
- **keep the cap for raw-mode programs** (TUIs, the agent): drop past it,
  mark the gap, and nudge a redraw by resizing away and back (TUIs redraw on
  SIGWINCH; inferred). they repaint more than they flood, so it should be
  rare (inferred).
- the browser leg (credits over the WebSocket) wasn't tested; a slow browser
  needs the same cap or the same XOFF.
- **turn the spike into contract tests** once the terminal code exists: the
  child's signals, fds and session; resize; the flood numbers as limits;
  teardown.
- worth filing with Bun: `terminal.pause()`/`resume()`.

project:

- **file the HMR bug** with Bun, and re-test HMR on the next release.
- **enforce import extensions** with a check script or lint rule, if the
  convention matters.
- **handle SIGTERM** in doctor once it's the container's main app (close the
  terminal, then exit).
- **try `bun check`** as a `tsc` replacement.
