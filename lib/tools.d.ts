/**
 * Model-facing agmsg tools. Each call acts for the calling session: its
 * project is the session's cwd and its identity is the session's seat.
 */
import type { Bridge } from './bridge.js';
import type { ToolDefinition } from './host.js';
export declare function createTools(bridge: Bridge): ToolDefinition[];
