/**
 * Parsing for the line stream `watch.sh` prints.
 *
 * One delivered message is `<ts> | <team> | <from> → <to> | <body>`, where the
 * body has CR removed, LF written as `\n` and TAB as `\t`. That encoding is
 * lossy (a literal backslash-n reads the same as a newline), so the bridge
 * treats a line as a pointer and recovers the exact body from `api.sh`.
 * Watcher diagnostics start with `agmsg watch:`.
 */
const MESSAGE_LINE = /^(\S+) \| (.+?) \| (.+?) → (.+?) \| (.*)$/s;
const DIAGNOSTIC_PREFIX = 'agmsg watch:';
export function parseWatchLine(line) {
    const text = line.replace(/\r$/, '');
    if (text.trim() === '')
        return undefined;
    if (text.startsWith(DIAGNOSTIC_PREFIX)) {
        return { kind: 'diagnostic', text: text.slice(DIAGNOSTIC_PREFIX.length).trim() };
    }
    const match = MESSAGE_LINE.exec(text);
    if (match === null)
        return { kind: 'diagnostic', text };
    return { kind: 'message', at: match[1], team: match[2], from: match[3], to: match[4], escaped: match[5] };
}
/** The encoding `watch.sh` applies to a body. */
export function escapeBody(body) {
    return body.replace(/\r/g, '').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
}
/** Best-effort inverse of {@link escapeBody}, used only when no exact body is found. */
export function unescapeBody(escaped) {
    return escaped.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
}
/**
 * Splits a byte stream into complete lines, keeping a trailing partial line
 * until the rest of it arrives.
 */
export class LineSplitter {
    buffer = '';
    push(chunk) {
        this.buffer += chunk;
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() ?? '';
        return lines;
    }
    flush() {
        const rest = this.buffer;
        this.buffer = '';
        return rest === '' ? [] : [rest];
    }
}
