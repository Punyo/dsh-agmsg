export type Delivery = 'wake' | 'inject' | 'off';
/** Plugin configuration; every key has a default so a bare row works. */
export interface Config {
    /** agmsg install directory. Empty means `~/.agents/skills/agmsg`. */
    agmsgHome?: string;
    /** `AGMSG_STORAGE_PATH` override for the agmsg scripts. Empty means unset. */
    storagePath?: string;
    /** Re-attach a session whose project already has exactly one dsh identity. */
    autoAttach?: boolean;
    /** Join this team on session start (together with `name`). */
    team?: string;
    /** Agent name to join `team` as on session start. */
    name?: string;
    /**
     * How inbound messages reach the agent: `wake` starts a turn when idle and
     * steers a running turn, `inject` waits for the next step without waking,
     * `off` runs no watcher (use agmsg_inbox manually).
     */
    delivery?: Delivery;
    /** Collect messages arriving within this window into one delivery. */
    batchMs?: number;
    /** Show a TUI toast for each delivery when dsh-TUI is present. */
    notify?: boolean;
    /** Show the session identity in the dsh-TUI status line. */
    statusLine?: boolean;
}
export type ResolvedConfig = Required<Config>;
export declare const Config: Schemastery<Config>;
export declare function resolveConfig(config?: Config): ResolvedConfig;
