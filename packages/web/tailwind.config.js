import defaultTheme from "tailwindcss/defaultTheme";

/** @type {import('tailwindcss').Config} */
export default {
	content: ["./src/client/**/*.{tsx,ts,html}"],
	darkMode: "class",
	theme: {
		extend: {
			fontFamily: {
				sans: [...defaultTheme.fontFamily.sans],
			},
			animation: {
				"fade-in": "fadeIn 200ms ease-out",
				"page-fade": "pageFade 150ms ease-out",
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
			},
			colors: {
				brand: {
					50: "#eff6ff",
					100: "#dbeafe",
					200: "#bfdbfe",
					300: "#93c5fd",
					400: "#60a5fa",
					500: "#3b82f6",
					600: "#2563eb",
					700: "#1d4ed8",
					800: "#1e40af",
					900: "#1e3a8a",
					950: "#172554",
				},
				surface: {
					DEFAULT: "var(--clens-surface)",
					raised: "var(--clens-surface-raised)",
					overlay: "var(--clens-surface-overlay)",
				},
				muted: "var(--clens-muted)",
				accent: "var(--clens-accent)",
			},
			fontVariantNumeric: {
				tabular: "tabular-nums",
			},
		},
	},
	plugins: [],
};
