# pty terminal notes

what a spike of Bun's built-in terminal (`Bun.spawn({ terminal })`) found in
this project's container on 2026-10-30, with Bun 1.4.4. **verified** means
run here; **inferred** means reasoned from docs, source or other results, not
tested.

**verdict: not a deal-breaker.**

**method.** throwaway Bun scripts, spawning through
`env -C /home/coder/project …` into `Bun.spawn({ terminal })`, as doctor
will. no `strace` in the image, so the vfork itself wasn't observed.

## the child (verified)

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

## resize (verified)

`terminal.resize()` reaches the program as SIGWINCH with the new size
(100×30 → 132×43 → 80×24, read back with `stty size`).

## floods (verified)

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

## XOFF/XON (verified)

- sending ^S when the copy's backlog passes 4 MB and ^Q under 1 MB kept it
  ≤ 5.3 MB with nothing dropped; the program ran at the parse rate.
- `terminal.inputFlags` and `localFlags` follow the program's mode live from
  doctor's side: `stty raw` turns IXON and ICANON off, `stty sane ixon` back
  on.
- doctor can clear IXANY from its side (`inputFlags &= ~IXANY`); the child's
  `stty -a` then shows `-ixany`.

## teardown (verified)

- `terminal.close()` hangs up: bash dies of SIGHUP and takes its background
  and foreground jobs with it; the `exit` callback fires at once.
- interactive bash ignores SIGTERM: `proc.kill()` with its default does
  nothing. SIGHUP ends it.
- doctor killed with SIGKILL: the kernel closes the PTY master and everything
  under it ends. no orphans.
- PID 1 here is code-server's `dumb-init`.

## recommendations

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
- **handle SIGTERM in doctor** once it's the container's main app: close the
  terminal, then exit. neither the dev server nor the binary handles it yet.
- **turn the spike into contract tests** once the terminal code exists: the
  child's signals, fds and session; resize; the flood numbers as limits;
  teardown.
- worth filing with Bun: `terminal.pause()`/`resume()`.
