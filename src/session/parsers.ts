import { LINK_EVENT_TYPE_VALUES } from "../types";
import type { DistilledSession, LinkEvent } from "../types";

/**
 * Type guard: checks that a value is a non-null object.
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

/**
 * Valid link event type strings for runtime validation.
 * Derived from LINK_EVENT_TYPE_VALUES — can never drift from the type definition.
 */
const LINK_EVENT_TYPES: ReadonlySet<string> = new Set(LINK_EVENT_TYPE_VALUES);

/**
 * Type guard for LinkEvent.
 * Validates the minimal shape: must have numeric `t` and a valid `type` field.
 */
const isLinkEvent = (value: unknown): value is LinkEvent =>
	isRecord(value) &&
	typeof value.t === "number" &&
	typeof value.type === "string" &&
	LINK_EVENT_TYPES.has(value.type);

/**
 * Type guard for DistilledSession.
 * Validates the minimal required shape: session_id (string), stats (object),
 * backtracks (array), complete (boolean).
 */
const isDistilledSession = (value: unknown): value is DistilledSession =>
	isRecord(value) &&
	typeof value.session_id === "string" &&
	isRecord(value.stats) &&
	Array.isArray(value.backtracks) &&
	typeof value.complete === "boolean";

/**
 * Parse a JSON string as a DistilledSession, returning undefined on
 * parse failure or shape mismatch.
 */
export const parseDistilledSession = (json: string): DistilledSession | undefined => {
	try {
		const parsed: unknown = JSON.parse(json);
		return isDistilledSession(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
};

/**
 * Parse a single JSON line as a LinkEvent, returning undefined on
 * parse failure or shape mismatch.
 */
export const parseLinkEvent = (json: string): LinkEvent | undefined => {
	try {
		const parsed: unknown = JSON.parse(json);
		return isLinkEvent(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
};
