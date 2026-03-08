import { useNavigate, useParams } from "@solidjs/router";
import { createEffect, createMemo, createSignal, onCleanup, Show, type Component } from "solid-js";
import {
	createSessionDetail,
	sessionList,
	globalError,
	clearError,
} from "../lib/stores";
import { api } from "../lib/api";
import { lastDistilledSessionId } from "../lib/events";
import { useKeyboard } from "../lib/keyboard";
import { SessionHeader } from "../components/SessionHeader";
import { AgentTree } from "../components/AgentTree";
import { SessionOverview } from "../components/SessionOverview";
import { formatDuration } from "../lib/format";

// ── Loading skeleton ────────────────────────────────────────────────

const LoadingSkeleton: Component = () => (
	<div class="flex h-full items-center justify-center">
		<div class="flex flex-col items-center gap-3">
			<div class="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500 dark:border-gray-700" />
			<span class="text-sm text-gray-500">Loading session...</span>
		</div>
	</div>
);

// ── Not distilled state ─────────────────────────────────────────────

const NotDistilledState: Component<{
	readonly sessionId: string;
	readonly onDistill: () => void;
}> = (props) => {
	const [distilling, setDistilling] = createSignal(false);
	const [error, setError] = createSignal<string | undefined>();
	const [refetchTriggered, setRefetchTriggered] = createSignal(false);
	// let required: timer reference reassigned by setInterval/clearInterval
	let pollTimer: ReturnType<typeof setInterval> | undefined;
	// let required: timer reference reassigned by setTimeout/clearTimeout
	let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

	const stopPolling = () => {
		if (pollTimer) { clearInterval(pollTimer); pollTimer = undefined; }
		if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = undefined; }
		setDistilling(false);
	};

	// Clean up timers on unmount (e.g. when parent switches to distilled view)
	onCleanup(stopPolling);

	// SSE-driven: when distill_complete fires for this session, refetch immediately
	createEffect(() => {
		if (lastDistilledSessionId() === props.sessionId && distilling() && !refetchTriggered()) {
			setRefetchTriggered(true);
			props.onDistill();
			stopPolling();
		}
	});

	const summary = createMemo(() => {
		const sessions = sessionList() ?? [];
		return sessions.find((s) => s.session_id === props.sessionId);
	});

	const handleDistill = async () => {
		setDistilling(true);
		setError(undefined);
		setRefetchTriggered(false);
		try {
			const res = await api.api.commands.sessions[":sessionId"].distill.$post({
				param: { sessionId: props.sessionId },
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({ error: "Unknown error" }));
				setError("error" in body ? String(body.error) : `HTTP ${res.status}`);
				setDistilling(false);
				return;
			}
			// Poll for completion as fallback (SSE is primary signal, guard against double-refetch)
			pollTimer = setInterval(() => { if (!refetchTriggered()) props.onDistill(); }, 3000);
			// Stop polling after 2 minutes max
			timeoutTimer = setTimeout(stopPolling, 120_000);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setDistilling(false);
		}
	};

	return (
		<div class="flex h-full items-center justify-center">
			<div class="max-w-md rounded-lg border border-gray-200 bg-gray-50 p-8 text-center dark:border-gray-700 dark:bg-gray-900/50">
				<div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
					<span class="text-2xl">&#128270;</span>
				</div>
				<h2 class="text-lg font-semibold text-gray-800 dark:text-gray-200">Session not yet analyzed</h2>
				<p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
					Run distillation to unlock conversation view, diffs, backtracks, and more.
				</p>
				<div class="mt-4 flex items-center justify-center gap-3">
					<div class="rounded-md bg-gray-100 px-4 py-3 dark:bg-gray-800">
						<code class="font-mono text-sm text-emerald-600 dark:text-emerald-400">
							clens distill {props.sessionId.slice(0, 8)}
						</code>
					</div>
					<span class="text-xs text-gray-400">or</span>
					<button
						onClick={handleDistill}
						disabled={distilling()}
						class="rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-emerald-500 dark:hover:bg-emerald-600"
					>
						{distilling() ? "Distilling..." : "Distill now"}
					</button>
				</div>
				<Show when={distilling()}>
					<div class="mt-3 flex items-center justify-center gap-2 text-sm text-gray-500">
						<div class="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-emerald-500" />
						<span>Analyzing session...</span>
					</div>
				</Show>
				<Show when={error()}>
					{(e) => (
						<p class="mt-3 text-sm text-red-500">{e()}</p>
					)}
				</Show>
				<Show when={summary()}>
					{(s) => (
						<div class="mt-5 flex justify-center gap-6 text-xs text-gray-500">
							<span>{s().event_count} events</span>
							<span>{formatDuration(s().duration_ms)}</span>
							<Show when={s().git_branch}>
								<span class="rounded bg-gray-100 px-1.5 py-0.5 font-mono dark:bg-gray-800">{s().git_branch}</span>
							</Show>
						</div>
					)}
				</Show>
			</div>
		</div>
	);
};

// ── Error banner ────────────────────────────────────────────────────

const ErrorBanner: Component<{
	readonly message: string;
	readonly onDismiss: () => void;
}> = (props) => (
	<div class="flex items-center justify-between border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-400">
		<span>{props.message}</span>
		<button onClick={props.onDismiss} class="ml-4 text-red-400 hover:text-red-600 dark:text-red-500 dark:hover:text-red-300">
			Dismiss
		</button>
	</div>
);

// ── Main component ──────────────────────────────────────────────────

export const SessionView: Component = () => {
	const params = useParams<{ id: string }>();
	const navigate = useNavigate();

	// ── Data resources ──────────────────────────────────────────

	const sessionId = () => params.id;
	const [sessionDetail, { refetch: refetchDetail }] = createSessionDetail(sessionId);

	// ── Derived state ───────────────────────────────────────────

	const session = createMemo(() => {
		const detail = sessionDetail();
		if (detail?.status === "ready") return detail.data;
		return undefined;
	});

	const isNotDistilled = createMemo(() => sessionDetail()?.status === "not_distilled");

	const isMultiAgent = createMemo(() => {
		const agents = session()?.agents;
		return agents !== undefined && agents.length > 1;
	});

	// ── Re-distill handler ──────────────────────────────────────

	const handleRedistill = async () => {
		const res = await api.api.commands.sessions[":sessionId"].distill.$post({
			param: { sessionId: params.id },
		});
		if (!res.ok) return;
		// Poll for completion (SSE will also trigger refetch via lastDistilledSessionId)
		await new Promise((resolve) => setTimeout(resolve, 2000));
		refetchDetail();
	};

	// Watch for SSE distill_complete for this session
	createEffect(() => {
		if (lastDistilledSessionId() === params.id) {
			refetchDetail();
		}
	});

	// ── Keyboard navigation ─────────────────────────────────────

	useKeyboard(() => [
		{
			key: "Escape",
			description: "Go back",
			handler: () => navigate("/"),
		},
	]);

	return (
		<div class="flex h-[calc(100vh-49px)] flex-col">
			{/* Error banner */}
			<Show when={globalError()}>
				{(err) => (
					<ErrorBanner message={err().message} onDismiss={clearError} />
				)}
			</Show>

			{/* Back button */}
			<div class="flex items-center gap-2 border-b border-gray-200 px-4 py-1.5 dark:border-gray-800">
				<button
					onClick={() => navigate("/")}
					class="rounded px-2 py-1 text-xs text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
				>
					&larr; Sessions
				</button>
				<span class="text-xs text-gray-400 dark:text-gray-600">{params.id.slice(0, 12)}</span>
			</div>

			{/* Main content */}
			<Show when={!sessionDetail.loading} fallback={<LoadingSkeleton />}>
				<Show when={!isNotDistilled()} fallback={<NotDistilledState sessionId={params.id} onDistill={refetchDetail} />}>
					<Show when={session()}>
						{(s) => (
							<>
								{/* Session header with timeline + re-distill */}
								<SessionHeader session={s()} onRedistill={handleRedistill} />

								{/* Body: optional agent tree sidebar + overview */}
								<div class="flex flex-1 overflow-hidden">
									{/* Multi-agent sidebar */}
									<Show when={isMultiAgent() && s().agents}>
										{(agents) => (
											<AgentTree
												agents={agents()}
												sessionId={params.id}
											/>
										)}
									</Show>

									{/* Session overview */}
									<div class="flex-1 overflow-y-auto p-4">
										<SessionOverview
											session={s()}
											sessionId={params.id}
											isMultiAgent={isMultiAgent()}
										/>
									</div>
								</div>
							</>
						)}
					</Show>
				</Show>
			</Show>
		</div>
	);
};
