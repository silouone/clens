import { Hono } from "hono"
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs"
import type { ClensConfig, PricingTier } from "@clens/cli"

// ── Validation helpers ────────────────────────────────────────────

const VALID_PRICING_TIERS: readonly PricingTier[] = ["api", "max", "auto"] as const

const isValidPricingTier = (value: string): value is PricingTier =>
	VALID_PRICING_TIERS.includes(value as PricingTier)

const DEFAULT_CONFIG: ClensConfig = { capture: true }

// ── Read / Write helpers ──────────────────────────────────────────

const readConfig = (projectDir: string): ClensConfig => {
	const configPath = `${projectDir}/.clens/config.json`
	if (!existsSync(configPath)) return DEFAULT_CONFIG
	try {
		const raw: unknown = JSON.parse(readFileSync(configPath, "utf-8"))
		if (typeof raw !== "object" || raw === null) return DEFAULT_CONFIG
		const obj = raw as Record<string, unknown>
		const capture = typeof obj.capture === "boolean" ? obj.capture : true
		const pricing =
			typeof obj.pricing === "string" && isValidPricingTier(obj.pricing)
				? obj.pricing
				: undefined
		return { capture, ...(pricing ? { pricing } : {}) }
	} catch {
		return DEFAULT_CONFIG
	}
}

const validateConfigBody = (
	body: unknown,
): { readonly ok: true; readonly config: ClensConfig } | { readonly ok: false; readonly error: string } => {
	if (typeof body !== "object" || body === null) {
		return { ok: false, error: "Request body must be a JSON object" }
	}

	const obj = body as Record<string, unknown>

	if ("capture" in obj && typeof obj.capture !== "boolean") {
		return { ok: false, error: "\"capture\" must be a boolean" }
	}

	if ("pricing" in obj && obj.pricing !== undefined) {
		if (typeof obj.pricing !== "string" || !isValidPricingTier(obj.pricing)) {
			return { ok: false, error: `"pricing" must be one of: ${VALID_PRICING_TIERS.join(", ")}` }
		}
	}

	const capture = typeof obj.capture === "boolean" ? obj.capture : true
	const pricing =
		typeof obj.pricing === "string" && isValidPricingTier(obj.pricing)
			? obj.pricing
			: undefined

	return { ok: true, config: { capture, ...(pricing ? { pricing } : {}) } }
}

// ── Config route factory ──────────────────────────────────────────

const createConfigRoute = (projectDir: string) =>
	new Hono()
		// GET /api/config — read current config
		.get("/", (c) => {
			const config = readConfig(projectDir)
			return c.json(config)
		})
		// PUT /api/config — update config
		.put("/", async (c) => {
			const body: unknown = await c.req.json()
			const result = validateConfigBody(body)

			if (!result.ok) {
				return c.json({ error: result.error, code: "VALIDATION_ERROR" as const }, 400)
			}

			const configDir = `${projectDir}/.clens`
			const configPath = `${configDir}/config.json`

			mkdirSync(configDir, { recursive: true })
			writeFileSync(configPath, JSON.stringify(result.config, null, 2))

			return c.json(result.config)
		})

export { createConfigRoute }
