/**
 * Structural views of the dsh and dsh-TUI services this plugin touches.
 *
 * The plugin imports nothing from dsh at runtime: a profile may resolve the
 * plugin from a linked checkout whose node_modules has no dsh packages, and
 * every optional seam is probed with `ctx.get(name, false)`. These shapes
 * mirror the installed 0.2.0-rc API (dsh-agent, dsh-tools, dsh-commands,
 * dsh-skill, dsh-tui toast/status) closely enough for the calls made here.
 */
/** True for a top-level session; subagent children never hold a seat. */
export function isRootAgent(agent) {
    const header = agent.session.header;
    return header.origin !== 'subagent'
        && header.parentSession === undefined
        && (header.delegationDepth ?? 0) === 0;
}
