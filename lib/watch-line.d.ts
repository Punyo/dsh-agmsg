/**
 * Parsing for the line stream `watch.sh` prints.
 *
 * One delivered message is `<ts> | <team> | <from> → <to> | <body>`, where the
 * body has CR removed, LF written as `\n` and TAB as `\t`. That encoding is
 * lossy (a literal backslash-n reads the same as a newline), so the bridge
 * treats a line as a pointer and recovers the exact body from `api.sh`.
 * Watcher diagnostics start with `agmsg watch:`.
 */
export interface WatchMessage {
    readonly kind: 'message';
    readonly at: string;
    readonly team: string;
    readonly from: string;
    readonly to: string;
    /** The body exactly as printed (escaped). */
    readonly escaped: string;
}
export interface WatchDiagnostic {
    readonly kind: 'diagnostic';
    readonly text: string;
}
export type WatchLine = WatchMessage | WatchDiagnostic;
export declare function parseWatchLine(line: string): WatchLine | undefined;
/** The encoding `watch.sh` applies to a body. */
export declare function escapeBody(body: string): string;
/** Best-effort inverse of {@link escapeBody}, used only when no exact body is found. */
export declare function unescapeBody(escaped: string): string;
/**
 * Splits a byte stream into complete lines, keeping a trailing partial line
 * until the rest of it arrives.
 */
export declare class LineSplitter {
    private buffer;
    push(chunk: string): string[];
    flush(): string[];
}
