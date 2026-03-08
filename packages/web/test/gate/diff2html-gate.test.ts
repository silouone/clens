import { describe, expect, test } from "bun:test";
import { html } from "diff2html";

const SAMPLE_DIFF = `--- a/hello.ts
+++ b/hello.ts
@@ -1,3 +1,3 @@
 const greet = () => {
-  return "hello";
+  return "hello, world";
 };`;

describe("diff2html gate test", () => {
	test("parses unified diff into HTML", () => {
		const result = html(SAMPLE_DIFF, { outputFormat: "side-by-side" });

		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
	});

	test("HTML contains diff structure markers", () => {
		const result = html(SAMPLE_DIFF, { outputFormat: "side-by-side" });

		expect(result).toContain("d2h-wrapper");
		expect(result).toContain("d2h-file-header");
		expect(result).toContain("hello.ts");
	});

	test("HTML contains addition and deletion markers", () => {
		const result = html(SAMPLE_DIFF, { outputFormat: "side-by-side" });

		expect(result).toContain("d2h-ins");
		expect(result).toContain("d2h-del");
	});

	test("HTML contains actual diff content", () => {
		const result = html(SAMPLE_DIFF, { outputFormat: "side-by-side" });

		expect(result).toContain("hello");
		// diff2html inserts <ins>/<del> tags within changed content
		expect(result).toContain(", world");
	});

	test("works with line-by-line output format", () => {
		const result = html(SAMPLE_DIFF, { outputFormat: "line-by-line" });

		expect(result).toContain("d2h-wrapper");
		expect(result).toContain("d2h-ins");
		expect(result).toContain("d2h-del");
	});
});
