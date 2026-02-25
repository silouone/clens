// Transcript entry types (Claude Code internal format)
export interface TranscriptEntry {
	readonly uuid: string;
	readonly parentUuid: string | null;
	readonly sessionId: string;
	readonly type: "user" | "assistant" | "progress" | "file-history-snapshot";
	readonly timestamp: string;
	readonly message?: {
		readonly role: "user" | "assistant";
		readonly content: string | readonly TranscriptContentBlock[];
		readonly model?: string;
		readonly id?: string;
		readonly usage?: {
			readonly input_tokens?: number;
			readonly output_tokens?: number;
			readonly cache_read_input_tokens?: number;
			readonly cache_creation_input_tokens?: number;
		};
	};
	readonly data?: Readonly<Record<string, unknown>>;
	readonly toolUseID?: string;
	readonly parentToolUseID?: string;
}

export type TranscriptContentBlock =
	| { readonly type: "thinking"; readonly thinking: string; readonly signature?: string }
	| { readonly type: "text"; readonly text: string }
	| { readonly type: "tool_use"; readonly id: string; readonly name: string; readonly input: Readonly<Record<string, unknown>> }
	| { readonly type: "tool_result"; readonly tool_use_id: string; readonly content: string | readonly Record<string, unknown>[]; readonly is_error?: boolean };

export interface TranscriptReasoning {
	readonly t: number;
	readonly thinking: string;
	readonly tool_use_id?: string;
	readonly tool_name?: string;
	readonly intent_hint?: "planning" | "debugging" | "research" | "deciding" | "general";
	readonly truncated?: boolean;
}

export interface TranscriptUserMessage {
	readonly t: number;
	readonly content: string;
	readonly is_tool_result: boolean;
	readonly message_type?: "prompt" | "command" | "system" | "teammate" | "image";
	readonly teammate_name?: string;
	readonly image_path?: string;
}
