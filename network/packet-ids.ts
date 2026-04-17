/**
 * Raw packet IDs used in the proxy's connection state machine.
 *
 * These are hardcoded protocol constants, not from defined-packets.gen.ts.
 * Grouped by connection state for clarity.
 */

// ── Login State ──────────────────────────────────────────────────────────────
export const LOGIN_START = 0x00;
export const LOGIN_DISCONNECT = 0x00;
export const ENCRYPTION_RESPONSE = 0x01;
export const LOGIN_SUCCESS = 0x02;
export const LOGIN_ACKNOWLEDGED = 0x03;
export const SET_COMPRESSION = 0x03;

// ── Configuration State ──────────────────────────────────────────────────────
export const CLIENT_SETTINGS = 0x00;
export const CONFIG_DISCONNECT = 0x02;
export const FINISH_CONFIGURATION = 0x03;
export const KEEP_ALIVE_CONFIG = 0x04;
export const KNOWN_PACKS = 0x07;

// ── Play State (Client → Server) ────────────────────────────────────────────
export const INVENTORY_CLICK = 0x11;
export const EDIT_BOOK = 0x17;
export const CHAT_SESSION_UPDATE = 0x09;

// ── Handshake ────────────────────────────────────────────────────────────────
export const HANDSHAKE_STATUS = 1;
export const HANDSHAKE_LOGIN = 2;

// ── Timeouts / Delays (ms) ──────────────────────────────────────────────────
export const SERVER_SWITCH_DISCONNECT_DELAY = 2000;
export const TAB_LIST_SEND_DELAY = 100;
export const INTERACT_RATE_LIMIT_MS = 100;
