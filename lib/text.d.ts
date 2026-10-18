/** Shared human/model-facing wording. */
import type { SeatInfo } from './bridge.js';
export declare function describeSeat(seat: SeatInfo | undefined, project: string): string;
/**
 * One-line seat summary for `/agmsg`: dsh-TUI shows a command result on a
 * single line, so everything that matters goes first.
 */
export declare function seatLine(seat: SeatInfo | undefined): string;
/** Collapse multi-line script output into one line. */
export declare function oneLine(text: string): string;
export declare function notInstalled(home: string): string;
export declare function unknownTypeHint(): string;
