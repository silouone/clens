import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import { resolve } from "node:path";

// The dev launcher (scripts/dev.ts) is the sole port authority: it allocates a
// free API port and a free web port, then injects them so the proxy targets the
// API the launcher actually bound. Falls back to the historical defaults when
// run standalone (`vite dev` with no launcher).
const apiPort = Number(process.env.CLENS_API_PORT) || 3117;
const webPort = Number(process.env.CLENS_WEB_PORT) || 3701;

export default defineConfig({
	plugins: [solidPlugin()],
	root: "src/client",
	publicDir: "public",
	build: {
		outDir: resolve(__dirname, "dist"),
		emptyOutDir: true,
		assetsDir: "assets",
		rollupOptions: {
			output: {
				entryFileNames: "assets/[name]-[hash].js",
				chunkFileNames: "assets/[name]-[hash].js",
				assetFileNames: "assets/[name]-[hash][extname]",
			},
		},
	},
	server: {
		port: webPort,
		// Fail loudly rather than silently drifting to another port — the launcher
		// has already opened the browser at exactly `webPort`.
		strictPort: true,
		proxy: {
			"/api": {
				target: `http://localhost:${apiPort}`,
				changeOrigin: true,
			},
			"/sse": {
				target: `http://localhost:${apiPort}`,
				changeOrigin: true,
			},
		},
	},
});
