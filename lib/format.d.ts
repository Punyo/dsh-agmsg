/** Text the agent and the person see for inbound agmsg traffic. */
export interface InboundMessage {
    readonly id?: string;
    readonly team: string;
    readonly from: string;
    readonly to: string;
    readonly at: string;
    readonly body: string;
}
/**
 * The model-facing text for one delivery batch. It names the sender, team
 * and time for each message and ends with how to answer, because the session
 * may never have used the agmsg tools before.
 */
export declare function formatDelivery(messages: readonly InboundMessage[]): string;
/** A one-line preview for toasts and summaries. */
export declare function preview(text: string, max?: number): string;
