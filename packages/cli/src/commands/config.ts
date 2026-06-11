import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { ClensConfig, PricingTier } from "../types";
import { readGlobalConfig, writeGlobalConfig, isValidGlobalMode } from "../session/registry";
import { bold, cyan, dim } from "./shared";

const VALID_PRICING_TIERS: readonly PricingTier[] = ["api", "max", "auto"] as const;

const isValidPricingTier = (value: string): value is PricingTier =>
	(VALID_PRICING_TIERS as readonly string[]).includes(value);

const readConfig = (projectDir: string): ClensConfig => {
	const configPath = `${projectDir}/.clens/config.json`;
	if (!existsSync(configPath)) return { capture: true };
	try {
		const raw: unknown = JSON.parse(readFileSync(configPath, "utf-8"));
		if (typeof raw !== "object" || raw === null) return { capture: true };
		const obj = raw as Record<string, unknown>;
		const capture = typeof obj.capture === "boolean" ? obj.capture : true;
		const pricing = typeof obj.pricing === "string" && isValidPricingTier(obj.pricing)
			? obj.pricing
			: undefined;
		return { capture, ...(pricing ? { pricing } : {}) };
	} catch {
		return { capture: true };
	}
};

const writeConfig = (projectDir: string, config: ClensConfig): void => {
	const configPath = `${projectDir}/.clens/config.json`;
	writeFileSync(configPath, JSON.stringify(config, null, 2));
};

export const configCommand = (args: {
	readonly projectDir: string;
	readonly pricing?: string;
	readonly globalMode?: string;
	readonly json: boolean;
}): void => {
	// Handle --global-mode: read/write global config (not per-project)
	if (args.globalMode !== undefined) {
		if (!isValidGlobalMode(args.globalMode)) {
			throw new Error(
				`Invalid global mode "${args.globalMode}". Valid values: repository, project\n` +
				`  ${dim("repository")} — group sessions by git repo root (default)\n` +
				`  ${dim("project")}    — every .clens/ directory is its own source`,
			);
		}
		const globalConfig = readGlobalConfig();
		const updated = { ...globalConfig, global_mode: args.globalMode };
		writeGlobalConfig(updated);
		console.log(`Global mode set to ${bold(cyan(args.globalMode))}.`);
		return;
	}

	const config = readConfig(args.projectDir);

	// If --pricing is provided, update the pricing tier
	if (args.pricing !== undefined) {
		if (!isValidPricingTier(args.pricing)) {
			throw new Error(
				`Invalid pricing tier "${args.pricing}". Valid values: ${VALID_PRICING_TIERS.join(", ")}`,
			);
		}
		const updated: ClensConfig = { ...config, pricing: args.pricing };
		writeConfig(args.projectDir, updated);
		console.log(`Pricing tier set to ${bold(cyan(args.pricing))}.`);
		return;
	}

	// Show current config (local + global)
	const globalConfig = readGlobalConfig();

	if (args.json) {
		console.log(JSON.stringify({ local: config, global: globalConfig }, null, 2));
		return;
	}

	const lines = [
		bold("clens config"),
		"",
		`  ${dim("Local (per-project):")}`,
		`    ${dim("capture:")}      ${config.capture}`,
		`    ${dim("pricing:")}      ${config.pricing ?? "api (default)"}`,
		...(config.events ? [`    ${dim("events:")}       ${config.events.join(", ")}`] : []),
		"",
		`  ${dim("Global (~/.clens/):")}`,
		`    ${dim("global_mode:")}  ${globalConfig.global_mode}`,
	];
	console.log(lines.join("\n"));
};
