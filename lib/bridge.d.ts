import { AgmsgClient } from './agmsg.js';
import type { ResolvedConfig } from './config.js';
import { type Agent, type Logger, type TuiStatus, type TuiToast } from './host.js';
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
    toast(): TuiToast | undefined;
    status(): TuiStatus | undefined;
}
export declare function projectOf(agent: Agent): string;
export declare class Bridge {
    readonly client: AgmsgClient;
    readonly config: ResolvedConfig;
    private readonly host;
    private readonly seats;
    private statusDispose;
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
    private stopWatcher;
    private onLine;
    private onStderr;
    private onWatcherExit;
    private flush;
    /** Swap each escaped watch body for the stored original when it can be matched. */
    private resolveBodies;
    private updateStatus;
}
