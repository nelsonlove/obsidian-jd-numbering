// Headless test runner: bundle the suite with a stubbed `obsidian`, then run it.
import esbuild from "esbuild";
import { writeFileSync } from "fs";
import { pathToFileURL } from "url";
import path from "path";

const outFile = path.resolve("test/.suite.out.mjs");

const result = await esbuild.build({
	entryPoints: ["test/suite.ts"],
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
	alias: { obsidian: "./test/stub-obsidian.ts" },
	logLevel: "warning",
});

writeFileSync(outFile, result.outputFiles[0].text);
await import(pathToFileURL(outFile).href);
