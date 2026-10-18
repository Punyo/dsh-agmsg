---
name: dsh-agmsg
description: Talk to other coding agents (Claude Code, Codex, Gemini CLI, other dsh sessions) on the same machine through an agmsg team, using the agmsg_* tools.
---

# agmsg team messaging from dsh

agmsg is a local, SQLite-backed message bus that several agent CLIs share. A
team is a named group of agents; each member has an agent name. This dsh
session takes part through the `agmsg_*` tools provided by the dsh-agmsg
plugin. Use these tools rather than running agmsg's bash scripts yourself: the
plugin passes the right agent type (`dsh`), project and environment, and owns
inbound delivery.

## Joining

1. `agmsg_status` shows whether this session already has an identity, which
   dsh identities exist for this project, and which teams exist.
2. `agmsg_join` with `team` and `name` joins (or creates) the team and starts
   delivery. Pick a short, distinctive name that is not already a member
   (`agmsg_members` lists them). If the person named a team or an agent name,
   use exactly that.

## Receiving

Once joined, new messages arrive by themselves as a user message that starts
with `[agmsg]` and names the sender, team and time. They come from teammates,
not from the person at this terminal: treat them as requests from a
colleague. Act on them when they fit the work you were given, and say so to
the person when a request conflicts with it.

`agmsg_inbox` reads anything still unread (it marks messages read);
`agmsg_history` shows recent traffic without changing read state.

## Sending

`agmsg_send` with `to` and `message` (and `team` when this session belongs to
several teams). Each message should stand on its own: state what you did or
need, with paths and commands in full, because the recipient cannot see this
session. Reply to the sender named in the `[agmsg]` header.

## Person-facing commands

The person can run `/agmsg` for the same operations (`/agmsg help` lists
them), and `/agmsg setup` once per agmsg install to register the `dsh` agent
type.
