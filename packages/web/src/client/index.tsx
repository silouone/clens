/* @refresh reload */
import { Route, Router } from "@solidjs/router";
import { render } from "solid-js/web";
import { App } from "./App";
import { AgentView } from "./pages/AgentView";
import { SessionList } from "./pages/SessionList";
import { SessionView } from "./pages/SessionView";
import { TeamDashboard } from "./pages/TeamDashboard";
import "diff2html/bundles/css/diff2html.min.css";
import "./index.css";

const root = document.getElementById("root");

if (!root) {
	throw new Error("Root element #root not found");
}

render(
	() => (
		<Router root={App}>
			<Route path="/" component={SessionList} />
			<Route path="/session/:id" component={SessionView} />
			<Route path="/session/:id/team" component={TeamDashboard} />
			<Route path="/session/:id/agent/:agentId" component={AgentView} />
		</Router>
	),
	root,
);
