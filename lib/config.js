import z from '@deepseek-ai/schemastery';
// Explicit annotation: the inferred schema type is not portable in
// declaration output. `Schemastery` is schemastery's global interface.
export const Config = z.object({
    agmsgHome: z.string().default('').description('agmsg install directory; empty means ~/.agents/skills/agmsg.'),
    storagePath: z.string().default('').description('AGMSG_STORAGE_PATH override; empty leaves it unset.'),
    autoAttach: z.boolean().default(true).description('Re-attach a session whose project already has one dsh identity.'),
    team: z.string().default('').description('Team to join on session start (requires name).'),
    name: z.string().default('').description('Agent name to join the team as on session start.'),
    delivery: z.union(['wake', 'inject', 'off']).default('wake').description('Inbound delivery: wake, inject, or off.'),
    display: z.union(['relay', 'notice']).default('relay').description('relay shows inbound messages in the dsh-TUI transcript; notice keeps them model-only.'),
    batchMs: z.natural().default(400).description('Window (ms) for batching messages into one delivery.'),
    notify: z.boolean().default(true).description('Show a dsh-TUI toast when messages arrive.'),
    statusLine: z.boolean().default(true).description('Show the agmsg identity in the dsh-TUI status line.'),
});
export function resolveConfig(config = {}) {
    return {
        agmsgHome: config.agmsgHome ?? '',
        storagePath: config.storagePath ?? '',
        autoAttach: config.autoAttach ?? true,
        team: config.team ?? '',
        name: config.name ?? '',
        delivery: config.delivery ?? 'wake',
        display: config.display ?? 'relay',
        batchMs: config.batchMs ?? 400,
        notify: config.notify ?? true,
        statusLine: config.statusLine ?? true,
    };
}
