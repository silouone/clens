import type { TranscriptEntry, TranscriptUserMessage } from "../types";

const classifyMessageType = (content: string): TranscriptUserMessage["message_type"] => {
	if (content.includes("<command-name>") || content.includes("<command-message>")) return "command";
	if (content.includes("<teammate-message")) return "teammate";
	if (content.includes("[Image:") || content.includes("screenshot")) return "image";
	if (content.includes("<local-command") || content.includes("<system-reminder")) return "system";
	return "prompt";
};

const extractTeammateName = (content: string): string | undefined => {
	const match = content.match(/<teammate-message[^>]*\bname="([^"]+)"/);
	return match?.[1];
};

const extractImagePath = (content: string): string | undefined => {
	const match = content.match(/\[Image:\s*([^\]]+)\]/);
	return match?.[1]?.trim();
};

const buildMessage = (t: number, rawContent: string): TranscriptUserMessage => {
	const content = rawContent.slice(0, 2000);
	const message_type = classifyMessageType(rawContent);
	const base: TranscriptUserMessage = { t, content, is_tool_result: false, message_type };

	if (message_type === "teammate") {
		const teammateName = extractTeammateName(rawContent);
		return teammateName ? { ...base, teammate_name: teammateName } : base;
	}

	if (message_type === "image") {
		const imagePath = extractImagePath(rawContent);
		return imagePath ? { ...base, image_path: imagePath } : base;
	}

	return base;
};

export const extractUserMessages = (entries: readonly TranscriptEntry[]): readonly TranscriptUserMessage[] =>
	entries.flatMap((entry): TranscriptUserMessage[] => {
		if (entry.type !== "user" || !entry.message) return [];

		const t = new Date(entry.timestamp).getTime();
		const { content } = entry.message;

		if (typeof content === "string") {
			return [buildMessage(t, content)];
		}

		if (Array.isArray(content)) {
			return content.flatMap((block): TranscriptUserMessage[] => {
				if (block.type === "tool_result") return [];
				if (block.type === "text") return [buildMessage(t, block.text)];
				return [];
			});
		}

		return [];
	});
