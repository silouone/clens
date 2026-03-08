import { useNavigate, useParams } from "@solidjs/router";
import { createMemo, createSignal, ErrorBoundary, Show, type Component } from "solid-js";
import {
	createSessionDetail,
	createConversationStore,
	globalError,
	clearError,
} from "../lib/stores";
import { createBidirectionalLink } from "../lib/linking";
import { useKeyboard } from "../lib/keyboard";
import { SplitPane } from "../components/SplitPane";
import { SessionHeader } from "../components/SessionHeader";
import { ConversationPanel } from "../components/ConversationPanel";
import { DiffPanel } from "../components/DiffPanel";
import { ErrorFallback } from "../components/ErrorFallback";
import { AgentTree } from "../components/AgentTree";
import { BottomPanel } from "../components/BottomPanel";

// ── Loading skeleton ────────────────────────────────────────────────

const LoadingSkeleton: Component = () => (
	<div class="flex h-full items-center justify-center">
		<div class="flex flex-col items-center gap-3">
			<div class="h-8 w-8 animate-spin rounded-full border-2 border-gray-700 border-t-blue-500" />
			<span class="text-sm text-gray-500">Loading session...</span>
		</div>
	</div>
);

// ── Not distilled state ─────────────────────────────────────────────

const NotDistilledState: Component<{ readonly sessionId: string }> = (props) => (
	<div class="flex h-full items-center justify-center">
		<div class="text-center">
			<p class="text-lg font-medium text-gray-300">Session not distilled</p>
			<p class="mt-1 text-sm text-gray-500">
				Run <code class="rounded bg-gray-800 px-1.5 py-0.5 font-mono text-xs">clens distill {props.sessionId}</code> to generate analysis data.
			</p>
		</div>
	</div>
);

// ── Error banner ────────────────────────────────────────────────────

const ErrorBanner: Component<{
	readonly message: string;
	readonly onDismiss: () => void;
}> = (props) => (
	<div class="flex items-center justify-between border-b border-red-800/50 bg-red-900/20 px-4 py-2 text-sm text-red-400">
		<span>{props.message}</span>
		<button onClick={props.onDismiss} class="ml-4 text-red-500 hover:text-red-300">
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
	const [sessionDetail] = createSessionDetail(sessionId);
	const convStore = createConversationStore(sessionId);

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

	// ── Bidirectional linking ────────────────────────────────────

	const link = createBidirectionalLink(convStore.entries);

	// ── Keyboard navigation ─────────────────────────────────────

	const [focusedEntry, setFocusedEntry] = createSignal(-1);

	useKeyboard(() => [
		{
			key: "j",
			description: "Next entry",
			handler: () => {
				const next = Math.min(focusedEntry() + 1, convStore.entries().length - 1);
				setFocusedEntry(next);
				document
					.querySelector(`[data-entry-index="${next}"]`)
					?.scrollIntoView({ behavior: "smooth", block: "nearest" });
			},
		},
		{
			key: "k",
			description: "Previous entry",
			handler: () => {
				const prev = Math.max(focusedEntry() - 1, 0);
				setFocusedEntry(prev);
				document
					.querySelector(`[data-entry-index="${prev}"]`)
					?.scrollIntoView({ behavior: "smooth", block: "nearest" });
			},
		},
		{
			key: "Escape",
			description: "Go back",
			handler: () => navigate("/"),
		},
	]);

	// ── Phase click → scroll conversation to phase boundary ─────

	const handlePhaseClick = (phaseIndex: number) => {
		const entry = convStore.entries().find(
			(e) => e.type === "phase_boundary" && e.phase_index === phaseIndex,
		);
		if (!entry) return;

		const idx = convStore.entries().indexOf(entry);
		const el = document.querySelector(`[data-entry-index="${idx}"]`);
		el?.scrollIntoView({ behavior: "smooth", block: "start" });
	};

	// ── Lazy-load on scroll near bottom ─────────────────────────

	const handleScrollNearBottom = () => {
		if (convStore.hasMore() && !convStore.loading()) {
			convStore.loadMore();
		}
	};

	// ── Backtrack click → scroll conversation to backtrack position ──

	const handleBacktrackClick = (startT: number) => {
		const entry = convStore.entries().find(
			(e) => e.type === "backtrack" && e.t === startT,
		);
		if (!entry) return;
		const idx = convStore.entries().indexOf(entry);
		const el = document.querySelector(`[data-entry-index="${idx}"]`);
		el?.scrollIntoView({ behavior: "smooth", block: "center" });
	};

	return (
		<div class="flex h-[calc(100vh-49px)] flex-col">
			{/* Error banner */}
			<Show when={globalError()}>
				{(err) => (
					<ErrorBanner message={err().message} onDismiss={clearError} />
				)}
			</Show>

			{/* Back button */}
			<div class="flex items-center gap-2 border-b border-gray-800 px-4 py-1.5">
				<button
					onClick={() => navigate("/")}
					class="rounded px-2 py-1 text-xs text-gray-400 transition hover:bg-gray-800 hover:text-gray-200"
				>
					&larr; Sessions
				</button>
				<span class="text-xs text-gray-600">{params.id.slice(0, 12)}</span>
				<Show when={convStore.total() > 0}>
					<span class="text-xs text-gray-600">
						&middot; {convStore.entries().length}/{convStore.total()} entries
					</span>
				</Show>
			</div>

			{/* Main content */}
			<Show when={!sessionDetail.loading} fallback={<LoadingSkeleton />}>
				<Show when={!isNotDistilled()} fallback={<NotDistilledState sessionId={params.id} />}>
					<Show when={session()}>
						{(s) => (
							<>
								{/* Session header with timeline */}
								<SessionHeader
									session={s()}
									onPhaseClick={handlePhaseClick}
								/>

								{/* Body: sidebar + split pane + bottom panel */}
								<div class="flex flex-1 flex-col overflow-hidden">
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

										{/* Split pane: conversation | diff */}
										<div class="flex-1 overflow-hidden">
											<SplitPane
												left={
													<ErrorBoundary
														fallback={(err, reset) => (
															<ErrorFallback error={err} reset={reset} componentName="Conversation" variant="panel" />
														)}
													>
														<ConversationPanel
															entries={convStore.entries()}
															onToolClick={link.handleToolClick}
															scrollToFile={link.scrollToFileInConversation}
															flashSelector={link.flashSelector}
															onScrollNearBottom={handleScrollNearBottom}
															loading={convStore.loading()}
														/>
													</ErrorBoundary>
												}
												right={
													<ErrorBoundary
														fallback={(err, reset) => (
															<ErrorFallback error={err} reset={reset} componentName="Diff viewer" variant="panel" />
														)}
													>
														<DiffPanel
															fileMap={s().file_map}
															gitDiff={s().git_diff}
															editChains={s().edit_chains}
															highlightedFile={link.highlightedFile()}
															onFileClick={link.handleFileClick}
															scrollToFile={link.highlightedFile}
															flashSelector={link.flashSelector}
														/>
													</ErrorBoundary>
												}
											/>
										</div>
									</div>

									{/* Bottom panel with tabs */}
									<BottomPanel
										session={s()}
										isMultiAgent={isMultiAgent()}
										onBacktrackClick={handleBacktrackClick}
									/>
								</div>
							</>
						)}
					</Show>
				</Show>
			</Show>
		</div>
	);
};
