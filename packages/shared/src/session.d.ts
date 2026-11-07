import type { EventEnvelope } from "./events.js";
/**
 * Looks up an adapter-side session id inside an event envelope. Works
 * cross-runtime: it recognises the common key names produced by OpenCode
 * (`sessionId`, `opencodeSessionId`) and Codex (`externalSessionId`), never
 * by parsing terminal output.
 */
export declare function sessionIdFromEvent(event: EventEnvelope): string | undefined;
