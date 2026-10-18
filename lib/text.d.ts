/** Shared human/model-facing wording. */
import type { SeatInfo } from './bridge.js';
export declare function describeSeat(seat: SeatInfo | undefined, project: string): string;
export declare function notInstalled(home: string): string;
export declare function unknownTypeHint(): string;
