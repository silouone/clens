import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync } from "node:fs";

const TEST_DIR = "/tmp/clens-test-concurrency";

beforeEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
	mkdirSync(`${TEST_DIR}/.clens/sessions`, { recursive: true });
});

afterEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("concurrent writes", () => {
	test("10 processes writing 100 events each produce 1000 valid lines", async () => {
		const processes: Promise<number>[] = [];

		for (let p = 0; p < 10; p++) {
			const proc = Bun.spawn(
				[
					"bun",
					"-e",
					`
        import { appendFileSync } from 'node:fs';
        for (let i = 0; i < 100; i++) {
          const event = JSON.stringify({ t: Date.now(), type: 'test', process: ${p}, index: i });
          appendFileSync('${TEST_DIR}/.clens/sessions/_links.jsonl', event + '\\n');
        }
      `,
				],
				{ stdout: "pipe", stderr: "pipe" },
			);
			processes.push(proc.exited);
		}

		await Promise.all(processes);

		const content = readFileSync(`${TEST_DIR}/.clens/sessions/_links.jsonl`, "utf-8").trim();
		const lines = content.split("\n").filter(Boolean);

		expect(lines.length).toBe(1000);

		// Verify all lines are valid JSON
		let validCount = 0;
		for (const line of lines) {
			try {
				JSON.parse(line);
				validCount++;
			} catch {
				// Corrupted line
			}
		}

		expect(validCount).toBe(1000);
	}, 30000); // 30s timeout
});
