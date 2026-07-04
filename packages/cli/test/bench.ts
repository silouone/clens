import { mkdirSync, rmSync } from "node:fs";

const HOOK_BINARY = "./bin/clens-hook";
const ITERATIONS = 100;
const TEMP_DIR = "/tmp/clens-bench";

// Test payloads
const smallPayload = JSON.stringify({
	session_id: "bench-small",
	hook_event_name: "PreToolUse",
	tool_name: "Bash",
	tool_input: { command: "ls" },
	tool_use_id: "t1",
	cwd: TEMP_DIR,
	transcript_path: "/tmp/t.jsonl",
	permission_mode: "default",
});

const mediumPayload = JSON.stringify({
	session_id: "bench-medium",
	hook_event_name: "PostToolUse",
	tool_name: "Edit",
	tool_input: {
		file_path: "/Users/test/project/src/component.tsx",
		old_string: "const x = 1;\nconst y = 2;\nreturn x + y;",
		new_string: "const result = calculateSum(a, b);\nreturn result;",
	},
	tool_response: "File edited successfully. 3 lines replaced.",
	tool_use_id: "t2",
	cwd: TEMP_DIR,
	transcript_path: "/tmp/t.jsonl",
	permission_mode: "default",
});

const largeContent = "x".repeat(50_000);
const largePayload = JSON.stringify({
	session_id: "bench-large",
	hook_event_name: "PostToolUse",
	tool_name: "Write",
	tool_input: { file_path: "/tmp/large.ts", content: largeContent },
	tool_response: "File written.",
	tool_use_id: "t3",
	cwd: TEMP_DIR,
	transcript_path: "/tmp/t.jsonl",
	permission_mode: "default",
});

interface BenchResult {
	scenario: string;
	payload_size: string;
	iterations: number;
	p50_ms: number;
	p95_ms: number;
	p99_ms: number;
	mean_ms: number;
}

async function runBench(
	scenario: string,
	payload: string,
	iterations: number,
): Promise<BenchResult> {
	const times: number[] = [];

	// Warmup
	for (let i = 0; i < 3; i++) {
		const proc = Bun.spawn([HOOK_BINARY, "PreToolUse"], {
			stdin: new Response(payload),
			stdout: "pipe",
			stderr: "pipe",
		});
		await proc.exited;
	}

	// Benchmark
	for (let i = 0; i < iterations; i++) {
		const start = Bun.nanoseconds();
		const proc = Bun.spawn([HOOK_BINARY, "PreToolUse"], {
			stdin: new Response(payload),
			stdout: "pipe",
			stderr: "pipe",
		});
		await proc.exited;
		const elapsed = (Bun.nanoseconds() - start) / 1_000_000; // ms
		times.push(elapsed);
	}

	times.sort((a, b) => a - b);

	const p50 = times[Math.floor(times.length * 0.5)];
	const p95 = times[Math.floor(times.length * 0.95)];
	const p99 = times[Math.floor(times.length * 0.99)];
	const mean = times.reduce((a, b) => a + b, 0) / times.length;

	return {
		scenario,
		payload_size: `${(payload.length / 1024).toFixed(1)}KB`,
		iterations,
		p50_ms: Math.round(p50 * 100) / 100,
		p95_ms: Math.round(p95 * 100) / 100,
		p99_ms: Math.round(p99 * 100) / 100,
		mean_ms: Math.round(mean * 100) / 100,
	};
}

async function main() {
	console.log("clens hook benchmark");
	console.log("=".repeat(60));

	// Setup
	rmSync(TEMP_DIR, { recursive: true, force: true });
	mkdirSync(`${TEMP_DIR}/.clens/sessions`, { recursive: true });

	const results: BenchResult[] = [];

	results.push(await runBench("Small (Bash)", smallPayload, ITERATIONS));
	results.push(await runBench("Medium (Edit)", mediumPayload, ITERATIONS));
	results.push(await runBench("Large (Write 50KB)", largePayload, ITERATIONS));

	// Print results
	console.log("\nResults:");
	console.log("-".repeat(80));
	console.log(
		"Scenario".padEnd(25) +
			"Size".padEnd(10) +
			"p50".padEnd(10) +
			"p95".padEnd(10) +
			"p99".padEnd(10) +
			"Mean",
	);
	console.log("-".repeat(80));

	for (const r of results) {
		console.log(
			r.scenario.padEnd(25) +
				r.payload_size.padEnd(10) +
				`${r.p50_ms}ms`.padEnd(10) +
				`${r.p95_ms}ms`.padEnd(10) +
				`${r.p99_ms}ms`.padEnd(10) +
				`${r.mean_ms}ms`,
		);
	}

	console.log("-".repeat(80));

	// Check targets
	const maxP95 = Math.max(...results.map((r) => r.p95_ms));
	if (maxP95 < 5) {
		console.log(`\n✅ TARGET MET: p95 ${maxP95}ms < 5ms target`);
	} else if (maxP95 < 10) {
		console.log(`\n⚠️  ACCEPTABLE: p95 ${maxP95}ms < 10ms acceptable threshold`);
	} else {
		console.log(`\n❌ TARGET MISSED: p95 ${maxP95}ms > 10ms threshold`);
	}

	// Cleanup
	rmSync(TEMP_DIR, { recursive: true, force: true });
}

main();
