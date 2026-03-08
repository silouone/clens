import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import { resolve } from "node:path";

export default defineConfig({
	plugins: [solidPlugin()],
	root: "src/client",
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
		port: 3701,
		proxy: {
			"/api": {
				target: "http://localhost:3117",
				changeOrigin: true,
			},
			"/sse": {
				target: "http://localhost:3117",
				changeOrigin: true,
			},
		},
	},
});
