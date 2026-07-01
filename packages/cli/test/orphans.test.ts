import { describe, test, expect, afterEach } from "bun:test";
import {
	enumerateOrphans,
	clean,
	classifyStat,
	parsePsLine,
	parseLsofPorts,
	matchType,
} from "../../../scripts/lib/orphans";

// Doctor detection/clean tests. SAFETY: we NEVER use the real production
// patterns ("vite dev", "esbuild --service", "src/server/index") here — those
// could match a developer's live processes. Every live test scopes detection to
// a UNIQUE per-test sentinel that only our own planted dummy carries.

const wait = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

const sentinel = (): string => `CLENS_DOCTOR_TEST_SENTINEL_${crypto.randomUUID().replace(/-/g, "")}`;

/** Plant a long-lived dummy process carrying `tag` in its argv (no blocking sleep). */
const plantDummy = (tag: string) =>
	// `setInterval` keeps it alive; the tag rides in argv so `ps` shows it.
	Bun.spawn(["bun", "-e", "setInterval(() => {}, 1000000)", tag], {
		stdout: "ignore",
		stderr: "ignore",
		stdin: "ignore",
	});

/** Poll a predicate until true or timeout (recursion + timer, no loops/sleep). */
const waitUntil = async (predicate: () => Promise<boolean>, timeoutMs: number): Promise<boolean> => {
	const deadline = Date.now() + timeoutMs;
	const poll = async (): Promise<boolean> => {
		if (await predicate()) return true;
		if (Date.now() >= deadline) return false;
		await wait(100);
		return poll();
	};
	return poll();
};

const planted: { proc?: ReturnType<typeof plantDummy> } = {};

afterEach(() => {
	// Belt-and-suspenders: ensure no dummy survives a test.
	try {
		planted.proc?.kill("SIGKILL");
	} catch {
		// already gone
	}
	planted.proc = undefined;
});

// ── Pure helpers ───────────────────────────────────────────────────

describe("orphans: pure helpers", () => {
	test("classifyStat treats uninterruptible (U/UE) as unkillable, others killable", () => {
		// Simulated only — we never actually wedge a process into U state.
		expect(classifyStat("UE")).toBe("unkillable");
		expect(classifyStat("U")).toBe("unkillable");
		expect(classifyStat("S")).toBe("killable");
		expect(classifyStat("R+")).toBe("killable");
		expect(classifyStat("S+")).toBe("killable");
	});

	test("parsePsLine extracts pid/ppid/stat/command", () => {
		const row = parsePsLine("  1234   1  S+   bun --watch run src/server/index.ts --port 3117");
		expect(row).toBeDefined();
		expect(row?.pid).toBe(1234);
		expect(row?.ppid).toBe(1);
		expect(row?.stat).toBe("S+");
		expect(row?.command).toBe("bun --watch run src/server/index.ts --port 3117");
	});

	test("parsePsLine returns undefined for a header / garbage line", () => {
		expect(parsePsLine("PID PPID STAT COMMAND")).toBeUndefined();
		expect(parsePsLine("")).toBeUndefined();
	});

	test("matchType returns the first matching pattern label", () => {
		expect(matchType("node /x/esbuild --service 0.1.2", ["vite dev", "esbuild --service"])).toBe(
			"esbuild --service",
		);
		expect(matchType("bun run unrelated", ["vite dev"])).toBeUndefined();
	});

	test("parseLsofPorts maps pid → listening port from lsof -F output", () => {
		const raw = ["p3117", "n127.0.0.1:3117", "p4242", "n*:5500"].join("\n");
		const map = parseLsofPorts(raw);
		expect(map.get(3117)).toBe(3117);
		expect(map.get(4242)).toBe(5500);
	});
});

// ── Live detection / clean (sentinel-scoped) ───────────────────────

describe("orphans: detection & clean (sentinel)", () => {
	test("detects a planted dummy carrying the sentinel and clean() removes it", async () => {
		const tag = sentinel();
		planted.proc = plantDummy(tag);

		const detected = await waitUntil(
			async () => (await enumerateOrphans([tag])).length > 0,
			5000,
		);
		expect(detected).toBe(true);

		const found = await enumerateOrphans([tag]);
		expect(found.length).toBe(1);
		expect(found[0]?.type).toBe(tag);
		expect(found[0]?.state).toBe("killable");

		const result = await clean([tag], { graceMs: 300 });
		expect(result.cleaned.length).toBe(1);
		expect(result.unkillable.length).toBe(0);

		const gone = await waitUntil(async () => (await enumerateOrphans([tag])).length === 0, 5000);
		expect(gone).toBe(true);
	});

	test("a sentinel that matches nothing finds and cleans nothing (scoping)", async () => {
		const tag = sentinel(); // never planted
		const found = await enumerateOrphans([tag]);
		expect(found.length).toBe(0);

		const result = await clean([tag]);
		expect(result.cleaned.length).toBe(0);
		expect(result.unkillable.length).toBe(0);
	});

	test("detection scoped to one sentinel ignores a different planted process", async () => {
		const tagA = sentinel();
		const tagB = sentinel();
		planted.proc = plantDummy(tagA);

		await waitUntil(async () => (await enumerateOrphans([tagA])).length > 0, 5000);

		// Searching for an unrelated sentinel must not match the planted one.
		const found = await enumerateOrphans([tagB]);
		expect(found.length).toBe(0);
	});
});
