/**
 * Orphan / zombie process doctor.
 *
 * Enumerates dev-server processes (the API server, `vite dev`, and the
 * `esbuild --service` daemons vite spawns), classifies each as killable or
 * unkillable, and can clean up the killable ones. The patterns are a parameter,
 * NOT a hardcoded constant — production passes the dev-server patterns; tests
 * pass a unique sentinel so they can never match (or kill) a real process.
 *
 * Hard rule: NEVER spin-retry on an unkillable (uninterruptible-wait) process.
 * On macOS a wedged `esbuild --service` enters `U`/`UE` state and cannot be
 * killed by any signal — the only remedy is a reboot. We report and advise.
 */

// ── Types ──────────────────────────────────────────────────────────

/** Whether a process can be terminated with a signal, or needs a reboot. */
type OrphanState = "killable" | "unkillable";

type OrphanProcess = {
	readonly pid: number;
	readonly ppid: number;
	/** Raw `ps` stat field, e.g. "S", "R+", "UE". */
	readonly stat: string;
	/** The matched pattern label (which kind of process this is). */
	readonly type: string;
	readonly command: string;
	readonly port?: number;
	readonly state: OrphanState;
};

/** Result of a cleanup pass. */
type CleanResult = {
	readonly cleaned: readonly OrphanProcess[];
	readonly unkillable: readonly OrphanProcess[];
};

// ── Default production patterns ────────────────────────────────────

/**
 * Substrings identifying the dev-server process tree. Order matters: the first
 * match wins and becomes the process `type`. NEVER hardcode these inside the
 * detection/clean functions — they take patterns as an argument so tests can
 * scope detection to a sentinel.
 */
const DEFAULT_ORPHAN_PATTERNS = [
	"esbuild --service",
	"vite dev",
	"src/server/index",
] as const;

const GRACE_MS = 1500;

// ── Pure helpers ───────────────────────────────────────────────────

/** Parse one `ps -axo pid=,ppid=,stat=,command=` line. */
const parsePsLine = (line: string): { pid: number; ppid: number; stat: string; command: string } | undefined => {
	const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
	if (!match) return undefined;
	const pid = Number(match[1]);
	const ppid = Number(match[2]);
	if (!Number.isFinite(pid) || !Number.isFinite(ppid)) return undefined;
	return { pid, ppid, stat: match[3], command: match[4] };
};

/** The first pattern whose substring appears in the command, if any. */
const matchType = (command: string, patterns: readonly string[]): string | undefined =>
	patterns.find((p) => command.includes(p));

/**
 * Classify by `ps` stat. The leading state char `U` is uninterruptible wait
 * (macOS); such a process ignores every signal until the kernel releases it —
 * treat as unkillable (reboot to clear). Everything else is killable.
 */
const classifyStat = (stat: string): OrphanState => (/U/.test(stat) ? "unkillable" : "killable");

/** Parse `lsof -nP -iTCP -sTCP:LISTEN -FpPn` output into a pid → listening port map. */
const parseLsofPorts = (raw: string): ReadonlyMap<number, number> => {
	const lines = raw.split("\n");
	// lsof -F groups fields by process: a `p<pid>` line precedes its `n<addr>` lines.
	const { map } = lines.reduce(
		(acc, line) => {
			if (line.startsWith("p")) {
				const pid = Number(line.slice(1));
				return { map: acc.map, pid: Number.isFinite(pid) ? pid : acc.pid };
			}
			if (line.startsWith("n") && acc.pid !== undefined) {
				const portMatch = line.match(/:(\d+)$/);
				if (portMatch && !acc.map.has(acc.pid)) {
					return { map: new Map(acc.map).set(acc.pid, Number(portMatch[1])), pid: acc.pid };
				}
			}
			return acc;
		},
		{ map: new Map<number, number>(), pid: undefined as number | undefined },
	);
	return map;
};

// ── Side effects: process introspection ────────────────────────────

/** Run a command, returning stdout (empty string on any failure). */
const runCapture = async (cmd: readonly string[]): Promise<string> => {
	try {
		const proc = Bun.spawn([...cmd], { stdout: "pipe", stderr: "ignore" });
		const out = await new Response(proc.stdout).text();
		await proc.exited;
		return out;
	} catch {
		return "";
	}
};

/** Map of pid → listening TCP port (best-effort; empty if lsof is unavailable). */
const readListenPorts = async (): Promise<ReadonlyMap<number, number>> => {
	const raw = await runCapture(["lsof", "-nP", "-iTCP", "-sTCP:LISTEN", "-FpPn"]);
	return raw ? parseLsofPorts(raw) : new Map();
};

/**
 * Enumerate processes whose command matches any of `patterns`.
 * Excludes this process and the ps invocation itself.
 */
const enumerateOrphans = async (
	patterns: readonly string[] = DEFAULT_ORPHAN_PATTERNS,
): Promise<readonly OrphanProcess[]> => {
	const [psOut, ports] = await Promise.all([
		runCapture(["ps", "-axo", "pid=,ppid=,stat=,command="]),
		readListenPorts(),
	]);

	return psOut
		.split("\n")
		.map(parsePsLine)
		.filter((row): row is NonNullable<typeof row> => row !== undefined)
		.filter((row) => row.pid !== process.pid)
		.flatMap((row) => {
			const type = matchType(row.command, patterns);
			if (type === undefined) return [];
			const port = ports.get(row.pid);
			return [
				{
					pid: row.pid,
					ppid: row.ppid,
					stat: row.stat,
					type,
					command: row.command,
					...(port !== undefined ? { port } : {}),
					state: classifyStat(row.stat),
				} satisfies OrphanProcess,
			];
		});
};

// ── Side effects: termination ──────────────────────────────────────

/** True if the process still exists (signal 0 probe). */
const isAlive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

/** Send a signal, swallowing ESRCH (already gone) and EPERM. */
const trySignal = (pid: number, signal: NodeJS.Signals): void => {
	try {
		process.kill(pid, signal);
	} catch {
		// Already exited or not permitted — nothing to do.
	}
};

const wait = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

/**
 * SIGTERM → grace window (via timer, never a blocking sleep) → SIGKILL.
 * Resolves true if the process is gone afterwards.
 */
const terminate = async (pid: number, graceMs: number): Promise<boolean> => {
	trySignal(pid, "SIGTERM");
	await wait(graceMs);
	if (!isAlive(pid)) return true;
	trySignal(pid, "SIGKILL");
	await wait(200);
	return !isAlive(pid);
};

/**
 * Clean up killable orphans matching `patterns`. Unkillable
 * (uninterruptible-wait) processes are NEVER retried — they are returned for the
 * caller to surface a reboot advisory.
 */
const clean = async (
	patterns: readonly string[] = DEFAULT_ORPHAN_PATTERNS,
	opts: { readonly graceMs?: number } = {},
): Promise<CleanResult> => {
	const graceMs = opts.graceMs ?? GRACE_MS;
	const found = await enumerateOrphans(patterns);

	const killable = found.filter((p) => p.state === "killable");
	const unkillable = found.filter((p) => p.state === "unkillable");

	const results = await Promise.all(
		killable.map(async (p) => ({ proc: p, gone: await terminate(p.pid, graceMs) })),
	);

	return {
		cleaned: results.filter((r) => r.gone).map((r) => r.proc),
		unkillable,
	};
};

export {
	enumerateOrphans,
	clean,
	classifyStat,
	parsePsLine,
	parseLsofPorts,
	matchType,
	DEFAULT_ORPHAN_PATTERNS,
};
export type { OrphanProcess, OrphanState, CleanResult };
