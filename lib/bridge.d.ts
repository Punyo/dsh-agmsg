import { AgmsgClient } from './agmsg.js';
import type { ResolvedConfig } from './config.js';
import { type InboundMessage } from './format.js';
export type { InboundMessage };
import { type Agent, type Logger, type UserMessage } from './host.js';
export type WatchState = 'off' | 'starting' | 'watching' | 'retrying' | 'failed' | 'stopped';
export interface SeatInfo {
    readonly sessionId: string;
    readonly project: string;
    readonly name: string;
    readonly teams: readonly string[];
    readonly state: WatchState;
    readonly detail?: string;
    readonly delivered: number;
}
export interface BridgeHost {
    readonly log: Logger;
    /** The live agent currently bound to a session id, if any. */
    agent(sessionId: string): Agent | undefined;
    /** Run outside any tool-call initiator, as dsh's own timers do. */
    detached<T>(op: () => T): T;
    /** Show a transient notice (dsh-TUI toast) when a TUI is present. */
    notify(text: string, options?: {
        color?: 'success' | 'warning' | 'error';
        timeoutMs?: number;
    }): void;
    /** Publish or clear this plugin's status-line text; false when no TUI. */
    setStatus(text: string | undefined): boolean;
}
export declare function projectOf(agent: Agent): string;
/**
 * The instance id a seat's watcher claims its roles under: the agmsg session
 * key plus this dsh process's pid. The pid is the process, not the watcher, so
 * the claim outlives any single watcher — which is exactly why the bridge has
 * to hand its roles back instead of relying on the claim dying with the child.
 */
export declare function instanceToken(sessionId: string): string;
/**
 * Build the user message for one delivery batch.
 *
 * `relay` borrows dsh's adjacent-agent relay attribution (`agent-message` /
 * `relay`) with a leading `Team message from <label>:` block, the shape
 * dsh-TUI renders as a labelled bubble; the sender id is a synthetic
 * `agmsg:<team>/<name>` because the sender is not a dsh session. `notice` is
 * a plugin-owned source that dsh-TUI keeps out of the transcript.
 */
export declare function deliveryMessage(messages: readonly InboundMessage[], display: 'relay' | 'notice'): UserMessage;
export declare class Bridge {
    readonly client: AgmsgClient;
    readonly config: ResolvedConfig;
    private readonly host;
    private readonly seats;
    /**
     * Hand-backs in flight, keyed by (token, team, name). A role that is claimed
     * again before its release runs cancels that release: detach-then-rejoin
     * hands the same role to a fresh watcher of the same session, and removing
     * the claim afterwards would take the role away from it.
     */
    private readonly pendingReleases;
    private disposed;
    constructor(client: AgmsgClient, config: ResolvedConfig, host: BridgeHost);
    info(sessionId: string): SeatInfo | undefined;
    /** Resolve which team a send targets for this seat. */
    teamFor(sessionId: string, team: string | undefined): {
        name: string;
        team: string;
    };
    /** A new agent appeared: rebind an existing seat or attach one if configured. */
    onAgentCreated(agent: Agent): Promise<void>;
    /**
     * An agent went away. A session that continues under a new agent (compaction,
     * clear) keeps its seat; a session that ended releases it.
     */
    onAgentDisposed(agent: Agent): void;
    /**
     * Attach the identity this project already has, when it is unambiguous.
     * @returns the attached name, or a reason nothing was attached.
     */
    attachExisting(agent: Agent, name?: string): Promise<{
        attached?: string;
        reason?: string;
    }>;
    /** Join (or re-join) a team as `name` and attach this session to it. */
    join(agent: Agent, team: string, name: string): Promise<string>;
    /** Stop delivery for a session and forget its seat (registration stays). */
    detach(sessionId: string): boolean;
    /**
     * Give this session's claim on a role back, and stop serving it.
     *
     * The recovery path for a claim that outlived its watcher: releasing works
     * only for the recorded owner, which is the session that left it behind. A
     * role another live session holds is left alone — dropping that one is its
     * session's business, not ours.
     */
    drop(agent: Agent, name?: string): Promise<string>;
    /** Hand one (team, role) pair back, e.g. after `leave` dropped the membership. */
    release(sessionId: string, team: string, name: string): Promise<void>;
    /** Restart a seat's watcher, e.g. after a failure was fixed. */
    restart(sessionId: string): boolean;
    dispose(): void;
    private bind;
    /**
     * Start the seat's watcher outside any tool-call initiator, so the child's
     * callbacks and timers do not inherit the agent that happened to join.
     */
    private startWatcher;
    private spawnWatcher;
    /** Detach the seat and stop its watcher, returning the child that was killed. */
    private stopSeat;
    /**
     * Hand a seat's roles back once its watcher is really gone.
     *
     * Nothing here can reach a claim made by a watcher of this same session that
     * replaced this seat (see `pendingReleases`), and a release that fails only
     * costs the role its place in the pool — the claim still disappears with the
     * dsh process, so this is not retried.
     */
    private releaseSeat;
    private cancelRelease;
    private stopWatcher;
    private onLine;
    private onStderr;
    private onWatcherExit;
    private flush;
    /** Swap each escaped watch body for the stored original when it can be matched. */
    private resolveBodies;
    /** Re-publish the status line, e.g. once the TUI's status service appears. */
    refreshStatus(): void;
    private updateStatus;
}
