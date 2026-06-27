/* @refresh reload */
import { Route, Router, useParams, useNavigate } from "@solidjs/router";
import { onMount, type Component } from "solid-js";
import { render } from "solid-js/web";
import { App } from "./App";
import { SessionList } from "./pages/SessionList";
import { SessionDetail } from "./pages/SessionDetail";
import { WorkUnitDetail } from "./pages/WorkUnitDetail";
import { SettingsPage } from "./pages/SettingsPage";
import { SHOW_WORK_UNITS } from "./lib/feature-flags";
import { UsagePage } from "./pages/UsagePage";
import { InsightsPage } from "./pages/InsightsPage";
import "@fontsource-variable/ibm-plex-sans";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "diff2html/bundles/css/diff2html.min.css";
import "./index.css";

// ── Legacy route redirects ──────────────────────────────────────────

/** Redirect /session/:id/team -> /session/:id?view=team */
const TeamRedirect: Component = () => {
	const params = useParams<{ id: string }>();
	const navigate = useNavigate();
	onMount(() => navigate(`/session/${params.id}?view=team`, { replace: true }));
	return null;
};

/** Redirect /session/:id/agent/:agentId -> /session/:id?view=agent&agent=:agentId */
const AgentRedirect: Component = () => {
	const params = useParams<{ id: string; agentId: string }>();
	const navigate = useNavigate();
	onMount(() => navigate(`/session/${params.id}?view=agent&agent=${params.agentId}`, { replace: true }));
	return null;
};

// Work Units is feature-flagged off (SHOW_WORK_UNITS). When hidden, the
// /work-unit/:id route falls back to a redirect home so the feature is
// unreachable by direct URL. The WorkUnitDetail page stays imported and intact —
// flipping SHOW_WORK_UNITS to true restores the original route component.
const WorkUnitRoute = SHOW_WORK_UNITS ? WorkUnitDetail : (() => {
	const navigate = useNavigate();
	onMount(() => navigate("/", { replace: true }));
	return null;
}) as Component;

// ── Root ─────────────────────────────────────────────────────────────

const root = document.getElementById("root");

if (!root) {
	throw new Error("Root element #root not found");
}

render(
	() => (
		<Router root={App}>
			<Route path="/" component={SessionList} />
			<Route path="/session/:id" component={SessionDetail} />
			<Route path="/work-unit/:id" component={WorkUnitRoute} />
			<Route path="/usage" component={UsagePage} />
			<Route path="/insights" component={InsightsPage} />
			<Route path="/settings" component={SettingsPage} />
			<Route path="/session/:id/team" component={TeamRedirect} />
			<Route path="/session/:id/agent/:agentId" component={AgentRedirect} />
		</Router>
	),
	root,
);
