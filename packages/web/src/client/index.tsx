/* @refresh reload */
import { Route, Router, useParams, useNavigate } from "@solidjs/router";
import { onMount, type Component } from "solid-js";
import { render } from "solid-js/web";
import { App } from "./App";
import { SessionList } from "./pages/SessionList";
import { SessionDetail } from "./pages/SessionDetail";
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
			<Route path="/session/:id/team" component={TeamRedirect} />
			<Route path="/session/:id/agent/:agentId" component={AgentRedirect} />
		</Router>
	),
	root,
);
