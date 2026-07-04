/* @refresh reload */
import { Route, Router, useLocation, useNavigate, useParams } from "@solidjs/router";
import { type Component, createEffect, onMount } from "solid-js";
import { render } from "solid-js/web";
import { App } from "./App";
import { sessionList } from "./lib/stores";
import { InsightsPage } from "./pages/InsightsPage";
import { SessionDetail } from "./pages/SessionDetail";
import { SessionList } from "./pages/SessionList";
import { SettingsPage } from "./pages/SettingsPage";
import { UsagePage } from "./pages/UsagePage";
import "@fontsource-variable/ibm-plex-sans";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "diff2html/bundles/css/diff2html.min.css";
import "./index.css";

// ── Legacy route redirects ──────────────────────────────────────────

/** Redirect /session/:id/agent/:agentId -> /session/:id?view=agent&agent=:agentId */
const AgentRedirect: Component = () => {
	const params = useParams<{ id: string; agentId: string }>();
	const navigate = useNavigate();
	onMount(() =>
		navigate(`/session/${params.id}?view=agent&agent=${params.agentId}`, { replace: true }),
	);
	return null;
};

// ── Short-id session route (FE-2) ───────────────────────────────────

const SESSION_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Wraps /session/:id. When the id is a short prefix (e.g. an 8-char id from a list
 * link) rather than a full UUID, resolve it to the canonical full id from the
 * already-loaded session list and redirect (FE-2). Canonicalizing the URL means
 * every downstream fetch + `params.id === session_id` lookup in SessionDetail uses
 * the full id. The server resolves the prefix too, so SessionDetail still loads
 * while the redirect settles; a never-resolved id falls through to its own 404.
 */
const SessionDetailRoute: Component = () => {
	const params = useParams<{ id: string }>();
	const navigate = useNavigate();
	const location = useLocation();
	createEffect(() => {
		const id = params.id;
		if (SESSION_UUID_RE.test(id)) return;
		const sessions = sessionList();
		if (!sessions) return; // list still loading — server-side resolution covers the fetch
		const match = sessions.find((s) => s.session_id.startsWith(id));
		if (match && match.session_id !== id) {
			navigate(`/session/${match.session_id}${location.search}`, { replace: true });
		}
	});
	return <SessionDetail />;
};

// ── Root ─────────────────────────────────────────────────────────────

const root = document.getElementById("root");

if (!root) {
	throw new Error("Root element #root not found");
}

render(
	() => (
		<Router root={App}>
			<Route path="/" component={SessionList} />
			<Route path="/session/:id" component={SessionDetailRoute} />
			<Route path="/usage" component={UsagePage} />
			<Route path="/insights" component={InsightsPage} />
			<Route path="/settings" component={SettingsPage} />
			<Route path="/session/:id/agent/:agentId" component={AgentRedirect} />
		</Router>
	),
	root,
);
