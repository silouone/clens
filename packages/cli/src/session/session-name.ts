import type { NameSource } from "../types";

/** Max length of a computed display name before truncation (R2). */
const MAX_NAME_LENGTH = 60;

/**
 * Strip Claude Code harness noise from a raw user prompt:
 *  - `<system-reminder>…</system-reminder>` blocks (multiline)
 *  - `<command-name>`, `<command-message>`, `<command-args>` wrapper TAGS only
 *    (the inner text — e.g. the slash command itself — is KEPT, mirroring CC).
 * Collapses all remaining whitespace runs to single spaces and trims.
 */
const stripHarnessNoise = (raw: string): string =>
	raw
		// Remove entire system-reminder blocks (non-greedy, dotall via [\s\S]).
		.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, " ")
		// Remove command-* wrapper tags but keep their inner content.
		.replace(/<\/?command-(?:name|message|args)>/g, " ")
		.replace(/\s+/g, " ")
		.trim();

/**
 * Truncate to MAX_NAME_LENGTH characters, appending an ellipsis when the input
 * is longer. Counts by code points so the result never exceeds the limit.
 */
const truncateName = (name: string): string => {
	const chars = [...name];
	if (chars.length <= MAX_NAME_LENGTH) return name;
	return `${chars.slice(0, MAX_NAME_LENGTH - 1).join("")}…`;
};

/**
 * Compute a deterministic display name from a session's first user prompt.
 * Strips harness noise, collapses whitespace, keeps slash-command text, and
 * truncates to ≤ 60 characters with an ellipsis. Returns `null` when the prompt
 * is missing or reduces to nothing after cleaning (R2/R3/R4). Pure, zero-network.
 */
export const computeSessionName = (firstPrompt: string | null | undefined): string | null => {
	if (typeof firstPrompt !== "string") return null;
	const cleaned = stripHarnessNoise(firstPrompt);
	if (cleaned.length === 0) return null;
	return truncateName(cleaned);
};

/** A trimmed non-empty string, or null. */
const nonEmpty = (value: string | null | undefined): string | null => {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
};

export interface DisplayNameInputs {
	readonly label?: string | null;
	readonly customTitle?: string | null;
	readonly computed?: string | null;
	readonly id: string;
}

export interface ResolvedDisplayName {
	readonly display_name: string;
	readonly name_source: NameSource;
}

/**
 * Resolve a session's display name by precedence (R1/R5):
 *   user label > Claude Code custom-title > computed first-prompt > short id.
 * Whitespace-only candidates are treated as absent (R8). The short id is the
 * first 8 characters of the session id and is always a valid final fallback (R4).
 * Pure function — unit-tested against the precedence table.
 */
export const resolveDisplayName = (inputs: DisplayNameInputs): ResolvedDisplayName => {
	const label = nonEmpty(inputs.label);
	if (label) return { display_name: label, name_source: "label" };

	const customTitle = nonEmpty(inputs.customTitle);
	if (customTitle) return { display_name: customTitle, name_source: "custom_title" };

	const computed = nonEmpty(inputs.computed);
	if (computed) return { display_name: computed, name_source: "computed" };

	return { display_name: inputs.id.slice(0, 8), name_source: "id" };
};
