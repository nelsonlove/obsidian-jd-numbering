import esbuild from "esbuild";
import { readFileSync } from "fs";

const prod = process.argv[2] === "production";
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: ["obsidian", "electron", "fs", "path", "os", "@codemirror/*", "@lezer/*"],
	format: "cjs",
	target: "es2022",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
	define: {
		"process.env.PLUGIN_VERSION": JSON.stringify(manifest.version),
	},
});

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
