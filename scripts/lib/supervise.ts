/**
 * Process supervision for the dev launcher.
 *
 * The original "FE won't launch" bug was orphaned grandchildren: `child.kill()`
 * reaps the direct child (vite) but leaves the `esbuild --service` daemons it
 * spawned alive. The fix is to own the whole process GROUP — spawn each child
 * DETACHED so it leads its own group, then signal the negative pid
 * (`process.kill(-pid, sig)`) to reap the entire subtree at teardown.
 *
 * We use Node's `child_process.spawn` (not Bun.spawn) specifically because
 * `{ detached: true }` gives a real, addressable process group on macOS.
 *
 * Grace windows use timers (setTimeout), never a blocking sleep.
 */
import { spawn, type ChildProcess } from "node:child_process";

// ── Types ──────────────────────────────────────────────────────────

type SpawnSupervisedOptions = {
	readonly cmd: string;
	readonly args: readonly string[];
	readonly label: string;
	readonly env?: Readonly<Record<string, string | undefined>>;
	readonly cwd?: string;
	/** Colorize the `[label]` log prefix. */
	readonly colorize?: (s: string) => string;
	/** Called with every non-empty output line (for readiness detection). */
	readonly onLine?: (line: string) => void;
};

type SupervisedChild = {
	readonly label: string;
	readonly child: ChildProcess;
	/** Process-group leader pid; signal `-pid` to reap the whole group. */
	readonly pid: number;
	/** Resolves with the exit code (or null on spawn error) when the child exits. */
	readonly exited: Promise<number | null>;
};

// ── Helpers ────────────────────────────────────────────────────────

const wait = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

/** Signal a whole process group (negative pid), swallowing ESRCH/EPERM. */
const killGroup = (pid: number, signal: NodeJS.Signals): void => {
	if (pid <= 1) return; // never signal pgid 0/1 (would hit our own group / init)
	try {
		process.kill(-pid, signal);
	} catch {
		// Group already gone or not permitted — nothing to reap.
	}
};

/**
 * Wrap an async fn so repeated calls share one execution. Teardown is funneled
 * through this from SIGINT, SIGTERM, and the fail-together watchers — it must
 * run exactly once.
 */
const onceAsync = <T>(fn: () => Promise<T>): (() => Promise<T>) => {
	// Single memo cell: the first call starts teardown; later calls reuse it.
	const cell: { promise?: Promise<T> } = {};
	return () => {
		cell.promise = cell.promise ?? fn();
		return cell.promise;
	};
};

// ── Spawn ──────────────────────────────────────────────────────────

/** Spawn a detached, group-leading child with piped, prefixed stdio. */
const spawnSupervised = (opts: SpawnSupervisedOptions): SupervisedChild => {
	const child = spawn(opts.cmd, [...opts.args], {
		detached: true, // own process group → group-reap catches grandchildren (esbuild)
		stdio: ["ignore", "pipe", "pipe"],
		env: { ...process.env, ...opts.env },
		...(opts.cwd ? { cwd: opts.cwd } : {}),
	});

	const prefix = opts.colorize ? opts.colorize(`[${opts.label}]`) : `[${opts.label}]`;
	const stream = (chunk: Buffer, sink: NodeJS.WriteStream): void => {
		chunk
			.toString()
			.split("\n")
			.filter((line) => line.trim().length > 0)
			.forEach((line) => {
				sink.write(`${prefix} ${line}\n`);
				opts.onLine?.(line);
			});
	};
	child.stdout?.on("data", (c: Buffer) => stream(c, process.stdout));
	child.stderr?.on("data", (c: Buffer) => stream(c, process.stderr));

	const exited = new Promise<number | null>((res) => {
		child.once("exit", (code) => res(code));
		child.once("error", () => res(null));
	});

	return { label: opts.label, child, pid: child.pid ?? -1, exited };
};

// ── Teardown ───────────────────────────────────────────────────────

/**
 * Reap every child's process GROUP: SIGTERM → grace window (timer) → SIGKILL.
 * Resolves once the grace/escalation has elapsed.
 */
const teardown = async (
	children: readonly SupervisedChild[],
	opts: { readonly graceMs?: number } = {},
): Promise<void> => {
	const graceMs = opts.graceMs ?? 3000;

	children.forEach((c) => killGroup(c.pid, "SIGTERM"));
	await Promise.race([Promise.all(children.map((c) => c.exited)), wait(graceMs)]);

	// Escalate: SIGKILL the group of anything that ignored SIGTERM.
	children.forEach((c) => killGroup(c.pid, "SIGKILL"));
	await Promise.race([Promise.all(children.map((c) => c.exited)), wait(1000)]);
};

/**
 * Register SIGINT / SIGTERM / exit handlers that all funnel through one
 * idempotent teardown. Returns the guarded teardown so the launcher can also
 * invoke it when a child dies unexpectedly (fail-together).
 */
const installSignalHandlers = (
	children: readonly SupervisedChild[],
	opts: { readonly graceMs?: number; readonly onTeardown?: () => void } = {},
): (() => Promise<void>) => {
	const guarded = onceAsync(async () => {
		opts.onTeardown?.();
		await teardown(children, opts);
	});

	const handleSignal = (): void => {
		void guarded().then(() => process.exit(0));
	};
	process.once("SIGINT", handleSignal);
	process.once("SIGTERM", handleSignal);

	// Last-resort synchronous reap (async teardown can't complete on 'exit').
	process.once("exit", () => children.forEach((c) => killGroup(c.pid, "SIGKILL")));

	return guarded;
};

export { spawnSupervised, teardown, installSignalHandlers, killGroup };
export type { SupervisedChild, SpawnSupervisedOptions };
