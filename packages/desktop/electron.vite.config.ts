import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
	main: {
		plugins: [externalizeDepsPlugin({ exclude: ["@raise/backend", "@raise/shared"] })],
		build: {
			rollupOptions: {
				external: ["@earendil-works/pi-coding-agent"],
			},
		},
		resolve: {
			alias: {
				"@raise/backend": resolve(__dirname, "../backend/src/index.ts"),
				"@raise/shared": resolve(__dirname, "../shared/src/index.ts"),
			},
		},
	},
	preload: {
		plugins: [externalizeDepsPlugin({ exclude: ["@raise/shared"] })],
		build: {
			rollupOptions: {
				output: {
					format: "cjs",
					entryFileNames: "index.cjs",
				},
			},
		},
		resolve: {
			alias: {
				"@raise/shared": resolve(__dirname, "../shared/src/index.ts"),
			},
		},
	},
	renderer: {
		resolve: {
			alias: {
				"@raise/shared": resolve(__dirname, "../shared/src/index.ts"),
				"@renderer": resolve(__dirname, "src/renderer/src"),
			},
		},
		plugins: [react(), tailwindcss()],
	},
});
