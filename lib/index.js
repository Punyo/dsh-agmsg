/**
 * dsh-agmsg: lets a DeepSeek Harness (dsh / dsh-TUI) session join an agmsg
 * team and exchange messages with Claude Code, Codex and other agents.
 *
 * - model-facing tools `agmsg_status`, `agmsg_join`, `agmsg_send`,
 *   `agmsg_inbox`, `agmsg_members`, `agmsg_history`;
 * - inbound delivery: one agmsg `watch.sh` per joined session, each message
 *   handed to the session's agent (see ./bridge.ts);
 * - the `/agmsg` slash command, a bundled skill, and dsh-TUI toast/status
 *   output when those optional services are present.
 * @module dsh-agmsg
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AgmsgClient, defaultHome } from './agmsg.js';
import { Bridge } from './bridge.js';
import { createCommand } from './command.js';
import { Config, resolveConfig } from './config.js';
import { isRootAgent } from './host.js';
import { createTools } from './tools.js';
export { Config };
export const name = 'dsh-agmsg';
export const inject = ['tools', 'agents', 'commands'];
const SKILL_PATH = fileURLToPath(new URL('../skills/dsh-agmsg/SKILL.md', import.meta.url));
function registerSkill(ctx) {
    const skills = ctx.get('skills', false);
    if (skills === undefined)
        return;
    try {
        const source = readFileSync(SKILL_PATH, 'utf8');
        const content = source.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
        const description = /^description:\s*(.+)$/m.exec(source)?.[1]?.trim()
            ?? 'Message other agents through an agmsg team with the agmsg_* tools.';
        skills.register({
            name: 'dsh-agmsg',
            description,
            content,
            path: 'skills/dsh-agmsg/SKILL.md',
            source: 'bundled',
            provider: 'dsh-agmsg',
        });
    }
    catch (error) {
        ctx.logger('agmsg').warn('agmsg: bundled skill not registered: %s', error.message);
    }
}
/**
 * Wire the plugin.
 * @param ctx - cordis context with dsh's tools, agents and commands services.
 * @param config - validated plugin config.
 */
export function apply(ctx, config = {}) {
    const resolved = resolveConfig(config);
    const log = ctx.logger('agmsg');
    const client = new AgmsgClient({
        home: resolved.agmsgHome === '' ? defaultHome() : resolved.agmsgHome,
        storagePath: resolved.storagePath,
    });
    const bridge = new Bridge(client, resolved, {
        log,
        agent: id => ctx.agents.get(id),
        detached: op => ctx.agents.withoutInitiator(op),
        toast: () => ctx.get('tuiToast', false),
        status: () => ctx.get('tuiStatus', false),
    });
    if (!client.installed())
        log.warn('agmsg: no agmsg install at %s; tools will report how to install it', client.home);
    for (const definition of createTools(bridge))
        ctx.tools.register(definition);
    ctx.commands.register(createCommand(bridge));
    registerSkill(ctx);
    ctx.on('agent/created', ({ agent }) => {
        void bridge.onAgentCreated(agent);
        return undefined;
    });
    ctx.on('agent/disposed', ({ agent }) => {
        bridge.onAgentDisposed(agent);
    });
    // The TUI may have opened its session before this row activated.
    for (const agent of ctx.agents.list()) {
        if (isRootAgent(agent))
            void bridge.onAgentCreated(agent);
    }
    ctx.effect(() => () => bridge.dispose(), 'dsh-agmsg bridge');
}
