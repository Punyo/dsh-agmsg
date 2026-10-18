/** Text the agent and the person see for inbound agmsg traffic. */

export interface InboundMessage {
  readonly id?: string
  readonly team: string
  readonly from: string
  readonly to: string
  readonly at: string
  readonly body: string
}

/**
 * The model-facing text for one delivery batch. It names the sender, team
 * and time for each message and ends with how to answer, because the session
 * may never have used the agmsg tools before.
 */
export function formatDelivery(messages: readonly InboundMessage[]): string {
  const first = messages[0]
  if (first === undefined) return ''
  const count = messages.length
  const lines: string[] = [
    `[agmsg] ${count} new message${count === 1 ? '' : 's'} for ${first.to}:`,
  ]
  for (const message of messages) {
    lines.push('', `From ${message.from} (team ${message.team}, ${message.at}):`, message.body)
  }
  const senders = new Map<string, InboundMessage>()
  for (const message of messages) senders.set(`${message.team}\u0000${message.from}`, message)
  const targets = [...senders.values()].map(message => `to "${message.from}", team "${message.team}"`)
  lines.push(
    '',
    `These came from teammates over agmsg, not from the person at this terminal. Reply with the agmsg_send tool (${targets.join('; ')}) when a response is needed.`,
  )
  return lines.join('\n')
}

/** A one-line preview for toasts and summaries. */
export function preview(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}
