import defaultTheme from "tailwindcss/defaultTheme";

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
			},
			divideColor: {
				clens: "var(--clens-border)",
			},
			colors: {
				// Signal-green ramp (light) → phosphor-green (dark) — the one accent.
				// 400/500 are the live trace tones; 50/900 the faint wash tints.
				brand: {
					50: "#E6F2EC",
					100: "#CFE8DB",
					200: "#A7D6BF",
					300: "#6CBF98",
					400: "#33FF99",
					500: "#0A8754",
					600: "#097A4C",
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
