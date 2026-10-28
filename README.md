# dsh-agmsg

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) plugin that lets a dsh or [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) session join an [agmsg](https://github.com/fujibee/agmsg) team and exchange messages with Claude Code, Codex, Gemini CLI and other agents on the same machine.

agmsg is a local message bus built on bash and SQLite. Each agent CLI joins a team under an agent name and reads and writes the shared store through agmsg's scripts. This plugin makes a dsh session one more member of such a team:

- **Sending**: the model gets `agmsg_*` tools, and the person at the terminal gets a `/agmsg` command.
- **Receiving**: each joined session runs one agmsg `watch.sh`. Every new message is handed to the session's agent. An idle agent starts a turn; a busy agent sees the message at its next step. dsh-TUI shows the message as a bubble labelled with the sender.
- **Identity**: a dsh session registers with agmsg as agent type `dsh`. The plugin ships that type as an agmsg plugin driver.

```
Claude Code ──/agmsg send──▶ agmsg store (SQLite) ──watch.sh──▶ dsh-agmsg ──followup/steer──▶ dsh session
     ▲                                                                                              │
     └──────────── Monitor / Stop hook ◀── agmsg store ◀── send.sh ◀── agmsg_send tool ◀──────────────┘
```

## Requirements

- dsh 0.2.0-rc.1 or later. dsh-TUI 0.16 is optional; without it the plugin still works, minus the bubbles, toasts and status line.
- An agmsg install, 1.5 or later, with `bash` and `sqlite3`. The plugin looks for it in `~/.agents/skills/agmsg`, which is where `npx agmsg` puts it.
- Node.js `^22.19.0 || >=24`.

## Install

1. Add the plugin to your dsh profile. In dsh-TUI:

   ```
   /plugin install https://github.com/Punyo/dsh-agmsg.git
   ```

   Or from a shell:

   ```sh
   dsh plugin --profile dsh-tui add github:Punyo/dsh-agmsg
   ```

   Restart dsh-TUI afterwards. pnpm may report `Agent skills awaiting approval: dsh-agmsg`. That notice concerns pnpm linking the package's `skills/` folder into agent skill directories. The plugin does not need it: it registers its bundled skill with dsh at runtime.

2. Register the `dsh` agent type with agmsg. You do this once per agmsg install. In dsh-TUI:

   ```
   /agmsg setup
   ```

   This runs `scripts/install-agmsg-type.sh`. The script copies `agmsg-type/types/dsh` to `~/.agents/skills/agmsg/plugins/types/dsh` and trusts it with agmsg's own `plugin.sh trust types/dsh`. agmsg keeps its `plugins/` directory across `npx agmsg install --update`. You can also run the script directly:

   ```sh
   bash ~/.dsh/profiles/dsh-tui/node_modules/dsh-agmsg/scripts/install-agmsg-type.sh [agmsg-dir]
   ```

## Usage

### Join a team

Ask the model in plain words, for example: "Join the agmsg team `myteam` as `dsh-worker` and tell `cc-lead` you are ready." It calls `agmsg_join` and then `agmsg_send`.

You can also do it yourself:

```
/agmsg join myteam dsh-worker
```

A dsh identity is registered for the session's working directory. The next dsh session started in that directory re-attaches to it automatically, provided exactly one dsh identity exists there (`autoAttach`). Only one live session can hold an identity at a time; agmsg's actas lock enforces this.

### Talk to the dsh session from Claude Code

On the Claude Code side nothing changes. With agmsg delivery set to `monitor` or `turn`, messages from `dsh-worker` arrive like any other teammate's. Send to it with `/agmsg send dsh-worker <message>`.

### Model tools

| Tool | Purpose |
| --- | --- |
| `agmsg_status` | This session's identity and delivery state, known dsh identities for the project, and existing teams |
| `agmsg_join` | Join or create a team as a name and start receiving |
| `agmsg_send` | Send a message to one teammate (`to`, `message`, optional `team`) |
| `agmsg_inbox` | Read unread messages and mark them read (delivery is normally automatic) |
| `agmsg_members` | List a team's members with their agent types |
| `agmsg_history` | Recent history; does not change read state |

The plugin also registers a bundled `dsh-agmsg` skill that explains the workflow to the model.

### `/agmsg` command

| Command | Effect |
| --- | --- |
| `/agmsg` | One-line status: `agmsg: dsh-worker@myteam · receiving · 3 delivered` |
| `/agmsg setup` | Register the `dsh` agent type with agmsg |
| `/agmsg join <team> <name>` | Join and start receiving |
| `/agmsg attach [name]` | Re-attach this project's identity, or restart delivery |
| `/agmsg detach` | Stop receiving in this session; the membership stays |
| `/agmsg drop [name]` | Hand this session's claim on a role back, so another session can take it |
| `/agmsg send <to\|team:to> <message>` | Send as this session's identity |
| `/agmsg inbox` / `history [n]` / `members [team]` | Read state and roster |
| `/agmsg leave [team]` | Leave a team; this removes the agent name from it |

dsh-TUI prints a command's result on a single line, so these results are kept short. The model tools return the full listings.

## Configuration

Every option has a default. To override them, add a row to your profile's `cordis.patch.yml` (for example `~/.dsh/profiles/dsh-tui/cordis.patch.yml`). An override replaces the row's whole `config`, so restate every key you rely on:

```yaml
- id: dsh-agmsg
  config:
    agmsgHome: ''          # agmsg install dir; '' = ~/.agents/skills/agmsg
    autoAttach: true
    delivery: wake
    display: relay
```

| Key | Default | Meaning |
| --- | --- | --- |
| `agmsgHome` | `''` | agmsg install directory. Empty means `~/.agents/skills/agmsg`. |
| `storagePath` | `''` | Passed to the scripts as `AGMSG_STORAGE_PATH` when set. |
| `autoAttach` | `true` | On session start, attach the project's dsh identity if there is exactly one. |
| `team`, `name` | `''` | When both are set, every new session joins `team` as `name`. |
| `delivery` | `wake` | `wake`: start a turn when idle, steer a running turn. `inject`: deliver at the next step without waking. `off`: no watcher; use `agmsg_inbox`. |
| `display` | `relay` | `relay`: dsh-TUI shows the message as a sender-labelled bubble. `notice`: the model sees it and the transcript does not. `user`: attribute it as human input, with sender information in the text. |
| `batchMs` | `400` | Messages arriving within this window are delivered together. |
| `notify` | `true` | Show a dsh-TUI toast for each delivery. |
| `statusLine` | `true` | Show `agmsg <name>@<team>` in the dsh-TUI status line. |

Set `display: user` to keep sessions driven only by agmsg visible in dsh-TUI 0.16.1's session browser, which otherwise requires human input. This opts into `source.kind: user` instead of relay attribution: the sender, team, timestamp and the disclosure that the message came from teammates remain in the text, but the relay bubble label and sender-source metadata do not. Host features that distinguish human input from injected messages will treat it as human input. The default remains `relay`.

## How it works

- **Scripts only**: the plugin never opens agmsg's database. It runs the public scripts (`join.sh`, `send.sh`, `inbox.sh`, `history.sh`, `api.sh`, `watch.sh`, ...) with `execFile`. A message body travels on stdin (`send.sh --body -`), so nothing passes through a shell. Every call sets three environment variables:
  - `AGMSG_SELF_NAME=off`, so agmsg does not rename or type into the terminal pane the TUI draws in.
  - `AGMSG_AGENT_PID=<dsh pid>`, so locks and instance ids belong to the dsh process.
  - `AGMSG_RESOLVE_PROJECT=0`, so the session's cwd is used as the project as-is.
- **Delivery**:
  - Each joined root session owns one `watch.sh <sid>.<pid> <cwd> dsh <name>`. The `<pid>` part makes the watcher exit together with dsh.
  - `watch.sh` claims the role's actas lock under that same `<sid>.<pid>` and does not release it when it exits. Because the pid belongs to dsh, a claim left behind outlives the watcher and reads as "held by another session" for as long as the process runs. The plugin therefore hands the role back itself — after the watcher has exited — whenever a seat is dropped, detached, or replaced by a different name. `/agmsg drop [name]` releases a claim that outlived its watcher.
  - `watch.sh` advances agmsg's read cursor, which it shares with `inbox.sh`. The watcher's line encoding loses information, so the plugin fetches the exact body from `api.sh` before delivering.
  - If a watcher stops, it is restarted with backoff. After repeated failures the seat is marked failed and `/agmsg attach` retries.
- **Display**: dsh-TUI keeps plugin-sourced user messages out of the transcript. The default `relay` display uses dsh's adjacent-agent relay attribution (`agent-message` / `relay`) with a leading `Team message from <sender>:` block, which dsh-TUI renders as a labelled bubble. The sender id is a synthetic `agmsg:<team>/<name>`. The opt-in `user` display uses one ordinary user-input text block containing the full agmsg delivery, including its provenance disclosure.
- **TUI writes**: dsh-TUI accepts a status line or toast write only from the calling plugin's own activation. The plugin captures its activation context in `apply()` and makes every such write from it.

## Limitations

- agmsg cannot `spawn` a dsh session yet. Start dsh-TUI yourself and join from inside it.
- Only top-level sessions hold a seat. Subagents can call the tools, but they never receive messages.
- The `relay` display depends on how dsh-TUI 0.16 renders team messages. If a future version changes that, set `display: notice`.
- agmsg's own SKILL.md, written for Codex, may also be visible to dsh when dsh scans `~/.agents/skills`. Prefer the `agmsg_*` tools; they pass the right agent type and environment.

## Troubleshooting

- **`Unknown agent type: 'dsh'`**: run `/agmsg setup` for the agmsg install the plugin uses (`agmsgHome`).
- **Nothing arrives**: run `/agmsg`. A state other than `receiving` comes with a reason; for example, the identity is held by another session.
- **"cannot claim (held by other sessions)" for a role nobody is receiving**: a claim that outlived its watcher. Run `/agmsg drop <name>` in the session that last held it; the role is then free for another session. The plugin now releases roles itself, so this only affects claims left by an earlier version.
- **Debug log**: start dsh with `DSH_AGMSG_DEBUG=/path/to/file` to mirror the plugin's log to that file.

## Development

```sh
npm install
npm run build    # tsc -> lib/ (committed, because profiles install from git without building)
npm test         # unit tests plus end-to-end tests against real agmsg scripts
```

The end-to-end tests copy agmsg's scripts from `AGMSG_TEST_SOURCE` (default `~/.agents/skills/agmsg`) into a temporary directory, so they never touch real teams. To try the plugin in a scratch dsh profile, run `dsh plugin --profile <profile> add /path/to/dsh-agmsg`. This links the checkout.

To also check session-list eligibility and previews with an installed dsh-TUI package, run `DSH_TUI_TEST_ROOT=/path/to/@deepseek-harness-tui/dsh-tui npm test` after building. This compatibility test uses disposable compressed logs and does not change the TUI profile or real sessions; it is skipped when `DSH_TUI_TEST_ROOT` is unset.
