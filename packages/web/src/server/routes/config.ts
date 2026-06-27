import { Hono } from "hono"
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { isSubscriptionPlan, type WebClensConfig } from "../../shared/types"

// ── Validation helpers ────────────────────────────────────────────
//
// `config.plan` (SubscriptionPlan) replaces the old `config.pricing` (PricingTier).
// We keep reading legacy `pricing` for back-compat but always write the new `plan`.

const DEFAULT_CONFIG: WebClensConfig = { capture: true }

/** Read a legacy `pricing` tier value if present (kept only for back-compat surfacing). */
const readLegacyPricing = (value: unknown): WebClensConfig["pricing"] =>
	value === "api" || value === "max" || value === "auto" ? value : undefined

// ── Read / Write helpers ──────────────────────────────────────────

const readConfig = (projectDir: string): WebClensConfig => {
	const configPath = `${projectDir}/.clens/config.json`
	if (!existsSync(configPath)) return DEFAULT_CONFIG
	try {
		const raw: unknown = JSON.parse(readFileSync(configPath, "utf-8"))
		if (typeof raw !== "object" || raw === null) return DEFAULT_CONFIG
		const obj: Readonly<Record<string, unknown>> = raw as Readonly<Record<string, unknown>>
		const capture = typeof obj.capture === "boolean" ? obj.capture : true
		const plan = isSubscriptionPlan(obj.plan) ? obj.plan : undefined
		const pricing = readLegacyPricing(obj.pricing)
		return {
			capture,
			...(plan ? { plan } : {}),
			...(pricing ? { pricing } : {}),
		}
	} catch {
		return DEFAULT_CONFIG
	}
}

const validateConfigBody = (
	body: unknown,
): { readonly ok: true; readonly config: WebClensConfig } | { readonly ok: false; readonly error: string } => {
	if (typeof body !== "object" || body === null) {
		return { ok: false, error: "Request body must be a JSON object" }
	}

	const obj: Readonly<Record<string, unknown>> = body as Readonly<Record<string, unknown>>

	if ("capture" in obj && typeof obj.capture !== "boolean") {
		return { ok: false, error: "\"capture\" must be a boolean" }
	}

	if ("plan" in obj && obj.plan !== undefined && !isSubscriptionPlan(obj.plan)) {
		return { ok: false, error: "\"plan\" must be one of: pro, max5x, max20x, api" }
	}

	const capture = typeof obj.capture === "boolean" ? obj.capture : true
	const plan = isSubscriptionPlan(obj.plan) ? obj.plan : undefined
	// Preserve a legacy `pricing` only if no new `plan` was supplied — once a plan is
	// chosen it is the source of truth and the legacy tier is dropped on write.
	const pricing = plan ? undefined : readLegacyPricing(obj.pricing)

	return {
		ok: true,
		config: {
			capture,
			...(plan ? { plan } : {}),
			...(pricing ? { pricing } : {}),
		},
	}
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
