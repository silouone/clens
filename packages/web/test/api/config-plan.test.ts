import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createApp } from "../../src/server/app";

// Coverage for the subscription-plan config field (task 1.6, AC6):
//  - GET surfaces a stored `plan`
//  - GET maps a legacy `pricing` tier for back-compat (no `plan` written yet)
//  - PUT persists `plan` and drops the legacy `pricing` once a plan is chosen
//  - PUT rejects an invalid plan

const TEST_DIR = "/tmp/clens-config-plan-test";
const CONFIG_PATH = `${TEST_DIR}/.clens/config.json`;

const app = () => createApp({ token: "test", mode: "development", projectDir: TEST_DIR });

const writeConfig = (obj: unknown): void => {
	mkdirSync(`${TEST_DIR}/.clens`, { recursive: true });
	writeFileSync(CONFIG_PATH, JSON.stringify(obj));
};

describe("config plan field (AC6)", () => {
	beforeEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
		mkdirSync(`${TEST_DIR}/.clens`, { recursive: true });
	});

	afterAll(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	test("GET surfaces a stored plan", async () => {
		writeConfig({ capture: true, plan: "max5x" });
		const res = await app().request("/api/config");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.plan).toBe("max5x");
	});

	test("GET keeps legacy `pricing` readable for back-compat", async () => {
		writeConfig({ capture: true, pricing: "max" });
		const res = await app().request("/api/config");
		const body = await res.json();
		// The new plan field is absent (not yet chosen) but the legacy tier is preserved
		// so the client can map it (max → max20x) for display.
		expect(body.plan).toBeUndefined();
		expect(body.pricing).toBe("max");
	});

	test("PUT persists plan and drops the legacy pricing tier", async () => {
		writeConfig({ capture: true, pricing: "auto" });
		const res = await app().request("/api/config", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ capture: true, pricing: "auto", plan: "max20x" }),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.plan).toBe("max20x");
		expect(body.pricing).toBeUndefined();

		// Persisted to disk too.
		expect(existsSync(CONFIG_PATH)).toBe(true);
		const onDisk = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
		expect(onDisk.plan).toBe("max20x");
		expect(onDisk.pricing).toBeUndefined();
	});

	test("PUT rejects an unknown plan value", async () => {
		const res = await app().request("/api/config", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ capture: true, plan: "enterprise" }),
		});
		expect(res.status).toBe(400);
	});
});
