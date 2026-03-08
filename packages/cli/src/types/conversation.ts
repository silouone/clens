// ConversationEntry — discriminated union for web conversation view

export interface UserPromptEntry {
	readonly type: "user_prompt";
	readonly t: number;
	readonly text: string;
	readonly index: number;
}

export interface ThinkingEntry {
	readonly type: "thinking";
	readonly t: number;
	readonly text: string;
	readonly intent: string;
	readonly duration_ms?: number;
}

export interface ToolCallEntry {
	readonly type: "tool_call";
	readonly t: number;
	readonly tool_name: string;
	readonly tool_use_id: string;
	readonly file_path?: string;
	readonly args_preview: string;
}

export interface ToolResultEntry {
	readonly type: "tool_result";
	readonly t: number;
	readonly tool_use_id: string;
	readonly tool_name: string;
	readonly outcome: "success" | "failure";
	readonly error?: string;
}

export interface BacktrackEntry {
	readonly type: "backtrack";
	readonly t: number;
	readonly backtrack_type: string;
	readonly attempt: number;
	readonly reverted_tool_ids: readonly string[];
}

export interface PhaseBoundaryEntry {
	readonly type: "phase_boundary";
	readonly t: number;
	readonly phase_name: string;
	readonly phase_index: number;
}

export type ConversationEntry =
	| UserPromptEntry
	| ThinkingEntry
	| ToolCallEntry
	| ToolResultEntry
	| BacktrackEntry
	| PhaseBoundaryEntry;
