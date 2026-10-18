/**
 * The `/agmsg` slash command: the person's direct control surface.
 *
 * dsh-TUI shows a command's result on one line, so every result is a single
 * line with the essentials first; full listings stay with the model tools.
 */
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { notInstalled, oneLine, seatLine, unknownTypeHint } from './text.js';
const INSTALLER = fileURLToPath(new URL('../scripts/install-agmsg-type.sh', import.meta.url));
const USAGE = '/agmsg [status] · setup · join <team> <name> · attach [name] · detach · send <to|team:to> <message> · inbox · members [team] · history [limit] · leave [team]';
function ok(text) {
    return { kind: 'success', text };
}
function fail(text) {
    return { kind: 'error', text };
}
function runInstaller(home) {
    return new Promise((resolve) => {
        execFile('bash', [INSTALLER, home], { encoding: 'utf8', timeout: 60_000 }, (error, stdout, stderr) => {
            const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
            resolve({ code, output: `${stdout}${stderr}`.trim() });
        });
    });
}
export function createCommand(bridge) {
    return {
        name: 'agmsg',
        description: 'agmsg team messaging: status, setup, join, send, inbox, members, history',
        input: { hint: 'status|setup|join <team> <name>|attach|detach|send <to> <message>|inbox|members|history|leave|help' },
        async handler({ agent, rawInput }) {
            const input = rawInput.trim();
            const space = input.search(/\s/);
            const sub = (space < 0 ? input : input.slice(0, space)).toLowerCase();
            const rest = space < 0 ? '' : input.slice(space).trim();
            const words = rest === '' ? [] : rest.split(/\s+/);
            const sessionId = agent.session.id;
            const client = bridge.client;
            if (sub === 'help')
                return ok(USAGE);
            if (sub === 'setup') {
                if (!client.installed())
                    return fail(notInstalled(client.home));
                const result = await runInstaller(client.home);
                // The installer prints its verdict last; lead with it on the one line.
                const summary = oneLine(result.output.split('\n').reverse().join('\n'));
                return result.code === 0 ? ok(summary) : fail(summary);
            }
            if (!client.installed())
                return fail(notInstalled(client.home));
            try {
                switch (sub) {
                    case '':
                    case 'status':
                        bridge.refreshStatus();
                        return ok(seatLine(bridge.info(sessionId)));
                    case 'join': {
                        if (words.length !== 2)
                            return fail('usage: /agmsg join <team> <name>');
                        await bridge.join(agent, words[0], words[1]);
                        return ok(seatLine(bridge.info(sessionId)));
                    }
                    case 'attach': {
                        const seat = bridge.info(sessionId);
                        if (seat !== undefined && (words[0] === undefined || words[0] === seat.name)) {
                            bridge.restart(sessionId);
                            return ok(`agmsg: restarted delivery for ${seat.name}`);
                        }
                        const result = await bridge.attachExisting(agent, words[0]);
                        return result.attached === undefined
                            ? fail(`agmsg: ${result.reason} · /agmsg join <team> <name>`)
                            : ok(seatLine(bridge.info(sessionId)));
                    }
                    case 'detach':
                        return bridge.detach(sessionId) ? ok('agmsg: stopped delivery for this session') : fail('agmsg: this session is not attached');
                    case 'send': {
                        if (words.length < 2)
                            return fail('usage: /agmsg send <to> <message>');
                        const target = words[0];
                        const body = rest.slice(target.length).trim();
                        const colon = target.indexOf(':');
                        const to = colon < 0 ? target : target.slice(colon + 1);
                        const { name, team } = bridge.teamFor(sessionId, colon < 0 ? undefined : target.slice(0, colon));
                        return ok(await client.send(team, name, to, body));
                    }
                    case 'inbox': {
                        const seat = bridge.info(sessionId);
                        if (seat === undefined)
                            return fail('agmsg: not joined · /agmsg join <team> <name>');
                        const parts = [];
                        for (const team of seat.teams)
                            parts.push(`[${team}] ${oneLine(await client.inbox(team, seat.name))}`);
                        return ok(parts.join(' · '));
                    }
                    case 'members': {
                        const { team } = bridge.teamFor(sessionId, words[0]);
                        const members = await client.members(team);
                        return ok(`${team}: ${members.map(member => `${member.name} (${member.types.join(', ')})`).join(', ') || 'no members'}`);
                    }
                    case 'history': {
                        const seat = bridge.info(sessionId);
                        if (seat === undefined)
                            return fail('agmsg: not joined · /agmsg join <team> <name>');
                        const parsed = Number.parseInt(words[0] ?? '5', 10);
                        const limit = Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
                        const parts = [];
                        for (const team of seat.teams)
                            parts.push(`[${team}] ${oneLine(await client.history(team, seat.name, limit))}`);
                        return ok(parts.join(' · '));
                    }
                    case 'leave': {
                        const { name, team } = bridge.teamFor(sessionId, words[0]);
                        const output = await client.leave(team, name);
                        const seat = bridge.info(sessionId);
                        if (seat !== undefined && seat.teams.length <= 1)
                            bridge.detach(sessionId);
                        else if (seat !== undefined)
                            await bridge.attachExisting(agent, name);
                        return ok(oneLine(output));
                    }
                    default:
                        return fail(`agmsg: unknown subcommand "${sub}" · ${USAGE}`);
                }
            }
            catch (error) {
                const message = oneLine(error.message);
                return fail(/Unknown agent type/.test(message) ? `${message} · ${unknownTypeHint()}` : message);
            }
        },
    };
}
