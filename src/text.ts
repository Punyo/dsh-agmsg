/** Shared human/model-facing wording. */
import type { SeatInfo } from './bridge.js'

const STATE_TEXT: Record<SeatInfo['state'], string> = {
  off: 'delivery off (check with agmsg_inbox)',
  starting: 'delivery starting',
  watching: 'receiving messages automatically',
  retrying: 'delivery restarting',
  failed: 'delivery stopped',
  stopped: 'delivery stopped',
}

export function describeSeat(seat: SeatInfo | undefined, project: string): string {
  if (seat === undefined) return `Not joined: this session has no agmsg identity (project ${project}).`
  const detail = seat.detail === undefined || seat.state === 'watching' ? '' : ` — ${seat.detail}`
  return [
    `Joined as ${seat.name} in ${seat.teams.join(', ')} (project ${seat.project}).`,
    `Delivery: ${STATE_TEXT[seat.state]}${detail}. Delivered so far: ${seat.delivered}.`,
  ].join('\n')
}

const STATE_SHORT: Record<SeatInfo['state'], string> = {
  off: 'delivery off',
  starting: 'starting',
  watching: 'receiving',
  retrying: 'restarting',
  failed: 'delivery stopped',
  stopped: 'stopped',
}

/**
 * One-line seat summary for `/agmsg`: dsh-TUI shows a command result on a
 * single line, so everything that matters goes first.
 */
export function seatLine(seat: SeatInfo | undefined): string {
  if (seat === undefined) return 'agmsg: not joined · /agmsg join <team> <name>'
  const detail = seat.detail === undefined || seat.state === 'watching' ? '' : ` (${seat.detail})`
  return `agmsg: ${seat.name}@${seat.teams.join(',')} · ${STATE_SHORT[seat.state]}${detail} · ${seat.delivered} delivered`
}

/** Collapse multi-line script output into one line. */
export function oneLine(text: string): string {
  return text.split('\n').map(line => line.trim()).filter(Boolean).join(' · ')
}

export function notInstalled(home: string): string {
  return `agmsg is not installed at ${home}. Install it with \`npx agmsg\`, or set the plugin's agmsgHome option.`
}

export function unknownTypeHint(): string {
  return 'agmsg does not know the "dsh" agent type yet. Run `/agmsg setup` in dsh-TUI (or scripts/install-agmsg-type.sh from the dsh-agmsg package) once, then retry.'
}
