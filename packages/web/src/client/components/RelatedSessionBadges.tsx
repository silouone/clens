import { For, Show, type Component } from "solid-js";
import { A } from "@solidjs/router";
import { ArrowRight } from "lucide-solid";

// ── Types ────────────────────────────────────────────────────────────

type RelatedSession = {
	readonly session_id: string;
	readonly session_name?: string;
	readonly phase: string;
	readonly role: string;
	readonly start_time: number;
};

type RelatedSessionBadgesProps = {
	readonly currentSessionId: string;
	readonly relatedSessions: readonly RelatedSession[];
	readonly specPath?: string;
};

// ── Pure helpers ─────────────────────────────────────────────────────

const formatRelativeTime = (currentTime: number, otherTime: number): string => {
	const diffMs = Math.abs(currentTime - otherTime);
	const minutes = Math.round(diffMs / 60_000);
	const hours = Math.round(diffMs / 3_600_000);
	const days = Math.round(diffMs / 86_400_000);

	const suffix = otherTime < currentTime ? "before" : "after";

	if (minutes < 60) return `${minutes}m ${suffix}`;
	if (hours < 24) return `${hours}h ${suffix}`;
	return `${days}d ${suffix}`;
};

const badgeLabel = (
	currentRole: string | undefined,
	otherSession: RelatedSession,
): string => {
	// If current session is a consumer (build), show "Planned by" for the creator
	if (otherSession.role === "creator") return "Planned by";
	// If current session is a creator (plan), show "Built by" for consumers
	if (otherSession.role === "consumer") {
		const phase = otherSession.phase;
		if (phase === "review" || phase === "test") return "Reviewed by";
		return "Built by";
	}
	return "Related";
};

// ── Component ────────────────────────────────────────────────────────

export const RelatedSessionBadges: Component<RelatedSessionBadgesProps> = (props) => {
	const otherSessions = () =>
		props.relatedSessions.filter((s) => s.session_id !== props.currentSessionId);

	const currentSession = () =>
		props.relatedSessions.find((s) => s.session_id === props.currentSessionId);

	return (
		<Show when={otherSessions().length > 0}>
			<div class="mt-2 flex flex-wrap items-center gap-2">
				<For each={otherSessions()}>
					{(session) => (
						<A
							href={`/session/${session.session_id}`}
							class="group inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 transition hover:border-violet-300 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-900/20 dark:text-violet-300 dark:hover:border-violet-700 dark:hover:bg-violet-900/30"
						>
							<span class="text-violet-500 dark:text-violet-400">
								{badgeLabel(currentSession()?.role, session)}
							</span>
							<span class="max-w-[160px] truncate">
								{session.session_name ?? session.session_id.slice(0, 8)}
							</span>
							<Show when={currentSession()} keyed>
								{(current) => (
									<span class="text-[10px] text-violet-400 dark:text-violet-500">
										{formatRelativeTime(current.start_time, session.start_time)}
									</span>
								)}
							</Show>
							<ArrowRight class="h-3 w-3 text-violet-400 transition group-hover:translate-x-0.5 dark:text-violet-500" />
						</A>
					)}
				</For>
			</div>
		</Show>
	);
};
