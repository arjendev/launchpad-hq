/**
 * Protocol constants for daemon ↔ HQ WebSocket communication.
 */

/** Current protocol version — bump on breaking changes */
export const PROTOCOL_VERSION = '1.0.0';

/** Default port for HQ server */
export const DEFAULT_HQ_PORT = 3000;

/** Heartbeat interval in milliseconds (daemon sends to HQ) */
export const HEARTBEAT_INTERVAL_MS = 15_000;

/** HQ considers daemon dead after this many missed heartbeats */
export const HEARTBEAT_TIMEOUT_MS = 45_000;

/** Initial reconnect delay in milliseconds */
export const RECONNECT_DELAY_MS = 1_000;

/** Maximum reconnect delay in milliseconds (backoff cap) */
export const RECONNECT_MAX_DELAY_MS = 30_000;

/** Backoff multiplier for reconnect attempts */
export const RECONNECT_BACKOFF_MULTIPLIER = 2;

/** Byte length of generated daemon tokens */
export const TOKEN_BYTE_LENGTH = 32;

/** WebSocket path for daemon connections */
export const DAEMON_WS_PATH = '/ws/daemon';

/** Custom WebSocket close code: authentication rejected (invalid token) */
export const WS_CLOSE_AUTH_REJECTED = 4001;

/** Custom WebSocket close code: authentication timed out */
export const WS_CLOSE_AUTH_TIMEOUT = 4002;

/** Maximum time (ms) for a daemon to complete the auth handshake */
export const AUTH_HANDSHAKE_TIMEOUT_MS = 15_000;
