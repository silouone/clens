import defaultTheme from "tailwindcss/defaultTheme";

/**
 * Live signal-green tone resolved from the single `--clens-brand` token so it
 * tracks the active theme (light: signal #0A8754, dark: phosphor #33FF99) — one
 * accent, never a static second green. `color-mix` keeps Tailwind opacity
 * modifiers (e.g. `brand-500/60`) working; a bare `var()` drops them silently.
 */
const brandTone = ({ opacityValue }) =>
	opacityValue === undefined
		? "var(--clens-brand)"
		: `color-mix(in srgb, var(--clens-brand) calc(${opacityValue} * 100%), transparent)`;

/** @type {import('tailwindcss').Config} */
export default {
	content: ["./src/client/**/*.{tsx,ts,html}"],
	darkMode: "class",
	theme: {
		extend: {
			fontFamily: {
				sans: ["'IBM Plex Sans Variable'", "'IBM Plex Sans'", ...defaultTheme.fontFamily.sans],
				mono: ["'IBM Plex Mono'", ...defaultTheme.fontFamily.mono],
			},
			animation: {
				"fade-in": "fadeIn 200ms ease-out",
				"page-fade": "pageFade 150ms ease-out",
				shimmer: "shimmer 1.5s infinite",
				dropdown: "dropdown 150ms ease-out",
			},
			keyframes: {
				fadeIn: {
					from: { opacity: "0", transform: "translateY(4px)" },
					to: { opacity: "1", transform: "translateY(0)" },
				},
				pageFade: {
					from: { opacity: "0" },
					to: { opacity: "1" },
				},
				shimmer: {
					"0%": { transform: "translateX(-100%)" },
					"100%": { transform: "translateX(100%)" },
				},
				dropdown: {
					from: { opacity: "0", transform: "scale(0.95) translateY(-4px)" },
					to: { opacity: "1", transform: "scale(1) translateY(0)" },
				},
			},
			textColor: {
				primary: "var(--clens-text-primary)",
				secondary: "var(--clens-text-secondary)",
				muted: "var(--clens-text-muted)",
			},
			borderColor: {
				clens: "var(--clens-border)",
				// Neutral stronger hairline for generic hover affordances — keeps the
				// signal-green accent reserved for live/active/ok (FE-24). Driven from
				// the tick-ruler token so it tracks the active theme.
				strong: "var(--clens-tick)",
			},
			divideColor: {
				clens: "var(--clens-border)",
			},
			colors: {
				// Signal-green accent — the ONE accent (live / active / ok).
				// The live trace tones (400/500/600) are driven from the single
				// `--clens-brand` token so dark mode shows exactly one green
				// (phosphor #33FF99) and light mode one green (signal #0A8754) —
				// no static second green bleeding across themes (FE-3). The
				// color-mix function form preserves Tailwind opacity modifiers
				// (e.g. `brand-500/60`) which a bare `var()` would silently drop.
				// 50–300 / 700–950 stay static faint wash tints (currently unused).
				brand: {
					50: "#E6F2EC",
					100: "#CFE8DB",
					200: "#A7D6BF",
					300: "#6CBF98",
					400: brandTone,
					500: brandTone,
					600: brandTone,
					700: "#086B43",
					800: "#0E2A1E",
					900: "#0E2A1E",
					950: "#08160F",
				},
				surface: {
					DEFAULT: "var(--clens-surface)",
					raised: "var(--clens-surface-raised)",
					overlay: "var(--clens-surface-overlay)",
					hover: "var(--clens-surface-hover)",
					selected: "var(--clens-surface-selected)",
					muted: "var(--clens-surface-muted)",
					inset: "var(--clens-surface-inset)",
				},
				muted: "var(--clens-muted)",
				accent: "var(--clens-accent)",
			},
			boxShadow: {
				card: "var(--clens-shadow-card)",
			},
			ringColor: {
				card: "var(--clens-ring-card)",
			},
			fontVariantNumeric: {
				tabular: "tabular-nums",
			},
		},
	},
	plugins: [],
};
