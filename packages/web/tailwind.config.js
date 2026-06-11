import defaultTheme from "tailwindcss/defaultTheme";

/** @type {import('tailwindcss').Config} */
export default {
	content: ["./src/client/**/*.{tsx,ts,html}"],
	darkMode: "class",
	theme: {
		extend: {
			fontFamily: {
				sans: ["'Inter Variable'", ...defaultTheme.fontFamily.sans],
				mono: ["'JetBrains Mono Variable'", ...defaultTheme.fontFamily.mono],
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
				brand: {
					50: "#ecfeff",
					100: "#cffafe",
					200: "#a5f3fc",
					300: "#67e8f9",
					400: "#22d3ee",
					500: "#06b6d4",
					600: "#0891b2",
					700: "#0e7490",
					800: "#155e75",
					900: "#164e63",
					950: "#083344",
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
