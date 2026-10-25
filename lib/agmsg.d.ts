/**
 * Thin client over agmsg's public bash scripts.
 *
 * agmsg's contract is "read through api.sh, write through send.sh/join.sh/
 * leave.sh"; the database is never opened here. Every script runs through
 * `execFile` with an argv array, and message bodies travel on stdin
 * (`send.sh --body -`), so no text ever crosses a shell.
 */
import { type ChildProcess } from 'node:child_process';
/** The agmsg agent type a dsh session registers as. */
export declare const AGENT_TYPE = "dsh";
export interface ClientOptions {
    /** agmsg install directory (the one holding `scripts/`). */
    readonly home: string;
    /** Optional `AGMSG_STORAGE_PATH` override. */
    readonly storagePath?: string;
    /** Per-call timeout for one-shot scripts. */
    readonly timeoutMs?: number;
}
export interface ScriptResult {
    readonly code: number;
    readonly stdout: string;
    readonly stderr: string;
}
export declare class AgmsgError extends Error {
    readonly result?: ScriptResult | undefined;
    constructor(message: string, result?: ScriptResult | undefined);
}
/** Parsed `whoami.sh` answer. */
export type Whoami = {
    readonly kind: 'single';
    readonly agent: string;
    readonly teams: string[];
} | {
    readonly kind: 'multiple';
    readonly agents: string[];
    readonly teams: string[];
} | {
    readonly kind: 'suggest';
    readonly agents: string[];
    readonly teams: string[];
    readonly availableTeams: string[];
} | {
    readonly kind: 'not-joined';
    readonly availableTeams: string[];
};
export interface StoredMessage {
    readonly id: string;
    readonly team: string;
    readonly from: string;
    readonly to: string;
    readonly body: string;
    readonly at: string;
}
export interface Member {
    readonly name: string;
    readonly types: string[];
    readonly project?: string;
}
export declare function defaultHome(): string;
/** Expand a leading `~/` the way a person writes it in YAML. */
export declare function expandHome(path: string): string;
/** Parse the single `key=value ...` line `whoami.sh` prints. */
export declare function parseWhoami(output: string): Whoami;
/** Parse `api.sh` JSONL output, skipping anything that is not a JSON object. */
export declare function parseJsonl<T>(output: string): T[];
export declare class AgmsgClient {
    readonly home: string;
    readonly scripts: string;
    private readonly storagePath;
    private readonly timeoutMs;
    constructor(options: ClientOptions);
    /** Whether the configured directory looks like an agmsg install. */
    installed(): boolean;
    /**
     * Environment for every script call. `AGMSG_SELF_NAME=off` keeps agmsg from
     * naming or typing into the terminal pane the TUI is drawing in;
     * `AGMSG_AGENT_PID` ties instance ids and actas locks to this dsh process
     * instead of whatever agent CLI happens to be an ancestor; the project path
     * is the session's cwd, used verbatim.
     */
    env(): NodeJS.ProcessEnv;
    /** Run one script to completion. Never rejects; inspect `code`. */
    run(script: string, args: readonly string[], options?: {
        input?: string;
        signal?: AbortSignal;
    }): Promise<ScriptResult>;
    /** Run a bash snippet with `$1..` bound to `args`. */
    private bash;
    private exec;
    private ok;
    whoami(project: string): Promise<Whoami>;
    /** Every (team, agent) registered for this project as a dsh agent. */
    identities(project: string): Promise<Array<{
        team: string;
        agent: string;
    }>>;
    join(team: string, name: string, project: string): Promise<string>;
    leave(team: string, name: string): Promise<string>;
    /** Remove only this (project, dsh) registration of `name`. */
    reset(project: string, name: string, sessionId: string): Promise<string>;
    /**
     * Hand this instance's actas claims on the given roles back to the pool.
     *
     * `watch.sh` claims a per-(team, agent) lock when it starts and does not
     * release one when it exits. The claim names `<sid>.<pid>`, and the pid is
     * this dsh process, which outlives every watcher: without an explicit
     * release the role reads as "held by another session" for as long as dsh
     * runs, and no peer can claim it. Release is owner-checked inside agmsg, so
     * a pair this instance does not own is left exactly as found.
     */
    releaseRoles(token: string, pairs: ReadonlyArray<{
        team: string;
        agent: string;
    }>): Promise<void>;
    send(team: string, from: string, to: string, body: string): Promise<string>;
    /** `inbox.sh` output; it marks the shown messages read. */
    inbox(team: string, name: string): Promise<string>;
    history(team: string, name: string, limit: number): Promise<string>;
    members(team: string): Promise<Member[]>;
    teams(): Promise<string[]>;
    /** Most recent messages to or from `name`, oldest first, with exact bodies. */
    messages(team: string, name: string, limit: number): Promise<StoredMessage[]>;
    /**
     * Start `watch.sh` for one seat. `token` is the instance id `<sid>.<pid>`
     * that the watcher claims its roles under, and that `releaseRoles` later
     * matches; the bridge computes it once so both sides agree.
     */
    watch(token: string, project: string, name: string): ChildProcess;
}
