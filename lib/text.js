const STATE_TEXT = {
    off: 'delivery off (check with agmsg_inbox)',
    starting: 'delivery starting',
    watching: 'receiving messages automatically',
    retrying: 'delivery restarting',
    failed: 'delivery stopped',
    stopped: 'delivery stopped',
};
export function describeSeat(seat, project) {
    if (seat === undefined)
        return `Not joined: this session has no agmsg identity (project ${project}).`;
    const detail = seat.detail === undefined || seat.state === 'watching' ? '' : ` — ${seat.detail}`;
    return [
        `Joined as ${seat.name} in ${seat.teams.join(', ')} (project ${seat.project}).`,
        `Delivery: ${STATE_TEXT[seat.state]}${detail}. Delivered so far: ${seat.delivered}.`,
    ].join('\n');
}
export function notInstalled(home) {
    return `agmsg is not installed at ${home}. Install it with \`npx agmsg\`, or set the plugin's agmsgHome option.`;
}
export function unknownTypeHint() {
    return 'agmsg does not know the "dsh" agent type yet. Run `/agmsg setup` in dsh-TUI (or scripts/install-agmsg-type.sh from the dsh-agmsg package) once, then retry.';
}
