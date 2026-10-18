import { Config } from './config.js';
import type { HostContext } from './host.js';
export { Config };
export type { Delivery } from './config.js';
export declare const name = "dsh-agmsg";
export declare const inject: string[];
/**
 * Wire the plugin.
 * @param ctx - cordis context with dsh's tools, agents and commands services.
 * @param config - validated plugin config.
 */
export declare function apply(ctx: HostContext, config?: Config): void;
