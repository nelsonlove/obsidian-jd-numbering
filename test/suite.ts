// Headless unit tests for the folder-note conventions. Run via `npm test`
// (test/run.mjs bundles this with a stubbed `obsidian` and executes it).
import { canonicalFolderNoteId, DEFAULT_CONFIG } from "../src/jd";
import { classifyFolderNote, deriveParsedId, FolderMaps, JdNote, VaultScan } from "../src/scan";
import { checkNote } from "../src/lint";
import { renderIndex } from "../src/indexNote";

const cfg = DEFAULT_CONFIG;
let failures = 0;

function eq(actual: unknown, expected: unknown, msg: string): void {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a !== e) {
		failures++;
		console.error(`FAIL  ${msg}\n        expected ${e}\n        got      ${a}`);
	} else {
		console.log(`ok    ${msg}`);
	}
}

// --- canonicalFolderNoteId -------------------------------------------------
eq(canonicalFolderNoteId("00-09", cfg), "00-09", "area token -> area id");
eq(canonicalFolderNoteId("04", cfg), "04.00", "category token -> AC.00");
eq(canonicalFolderNoteId("00", cfg), "00.00", "category 00 -> 00.00");
eq(canonicalFolderNoteId("06.11", cfg), null, "content id token -> null");
eq(canonicalFolderNoteId("92021", cfg), null, "expanded item token -> null");
eq(canonicalFolderNoteId("nope", cfg), null, "garbage token -> null");

// --- classifyFolderNote ----------------------------------------------------
const maps: FolderMaps = {
	areaFolders: new Map([["00-09", "00-09 System"]]),
	categoryFolders: new Map([
		["00", "00-09 System/00 System management"],
		["03", "00-09 System/03 Obsidian"],
		["04", "00-09 System/04 Obsidian tooling"],
	]),
};
eq(classifyFolderNote(true, "00-09 System", maps), "area", "area folder note");
eq(classifyFolderNote(true, "00-09 System/00 System management", maps), "category", "category folder note");
eq(classifyFolderNote(false, "00-09 System", maps), null, "not a folder note -> null");
eq(
	classifyFolderNote(true, "70-79 Hobbies & media/75 Games/X/CAOS commands/04 CD Player", maps),
	null,
	"deep content folder note -> null"
);

// --- deriveParsedId (filename-canonical) -----------------------------------
const rawOf = (basename: string, parentPath: string, parentName: string): string | null =>
	deriveParsedId(basename, parentPath, parentName, maps, cfg)?.raw ?? null;

eq(rawOf("00-09 System", "00-09 System", "00-09 System"), "00-09", "area folder note -> A0-A9");
eq(rawOf("00 System management", "00-09 System/00 System management", "00 System management"), "00.00", "category folder note -> AC.00");
eq(rawOf("03.11 Foo", "00-09 System/03 Obsidian", "03 Obsidian"), "03.11", "content note -> AC.YY");
eq(rawOf("03.05 Agents", "00-09 System/03 Obsidian/03.05 Agents", "03.05 Agents"), "03.05", "id-level folder note -> AC.YY (not AC.00)");
eq(rawOf("04 CD Player", "70-79 Hobbies & media/75 Games/X/CAOS commands/04 CD Player", "04 CD Player"), null, "deep content folder note -> not a JD id");
eq(rawOf("random thoughts", "10-19 Personal", "10-19 Personal"), null, "non-JD note -> null");

// --- checkNote -------------------------------------------------------------
function fakeNote(o: {
	basename: string;
	parentPath: string;
	parentName: string;
	isRedirect?: boolean;
}): JdNote {
	return {
		file: {
			path: `${o.parentPath}/${o.basename}.md`,
			basename: o.basename,
			name: `${o.basename}.md`,
			parent: { path: o.parentPath, name: o.parentName },
		},
		parsed: deriveParsedId(o.basename, o.parentPath, o.parentName, maps, cfg),
		nameId: o.basename.split(" ")[0],
		title: o.basename,
		isRedirect: o.isRedirect ?? false,
		isFolderNote: o.basename === o.parentName,
	} as unknown as JdNote;
}
const codes = (n: JdNote): string[] => checkNote(n, maps, cfg).map((f) => f.code);

// A correctly-placed category folder note is clean.
eq(
	codes(fakeNote({ basename: "00 System management", parentPath: "00-09 System/00 System management", parentName: "00 System management" })).length,
	0,
	"correct category folder note: no findings"
);

// A correctly-placed area folder note is clean.
eq(
	codes(fakeNote({ basename: "00-09 System", parentPath: "00-09 System", parentName: "00-09 System" })).length,
	0,
	"correct area folder note: no findings"
);

// A content note in the right category folder is clean.
eq(
	codes(fakeNote({ basename: "03.11 Foo", parentPath: "00-09 System/03 Obsidian", parentName: "03 Obsidian" })).length,
	0,
	"content note in correct folder: no findings"
);

// A content note under the wrong category folder -> folder-mismatch.
eq(
	codes(fakeNote({ basename: "03.11 Foo", parentPath: "00-09 System/00 System management", parentName: "00 System management" })).includes("folder-mismatch"),
	true,
	"content note in wrong folder -> folder-mismatch"
);

// A filename shaped like an attempted decimal id but invalid -> malformed-id (error).
{
	const f = checkNote(
		fakeNote({ basename: "03.2 Foo", parentPath: "00-09 System/03 Obsidian", parentName: "03 Obsidian" }),
		maps,
		cfg
	).find((x) => x.code === "malformed-id");
	eq(!!f, true, "attempted decimal id but invalid -> malformed-id");
	eq(f?.level, "error", "malformed-id is an error");
}

// Ordinary digit-leading titles must NOT be flagged malformed.
eq(
	codes(fakeNote({ basename: "12 Monkeys review", parentPath: "70-79 Media", parentName: "70-79 Media" })).includes("malformed-id"),
	false,
	"plain digit-leading title -> not malformed"
);
eq(
	codes(fakeNote({ basename: "3.14 Pi day", parentPath: "70-79 Media", parentName: "70-79 Media" })).includes("malformed-id"),
	false,
	"single-digit dotted title -> not malformed"
);

// A deep content folder note (04 CD Player) must NOT be flagged as a JD id.
eq(
	codes(fakeNote({ basename: "04 CD Player", parentPath: "70-79 Hobbies & media/75 Games/X/CAOS commands/04 CD Player", parentName: "04 CD Player" })).length,
	0,
	"deep content folder note: no findings"
);

// --- renderIndex: category home is a header, not a content row --------------
{
	const scan = {
		...maps,
		notes: [
			fakeNote({ basename: "04 Obsidian tooling", parentPath: "00-09 System/04 Obsidian tooling", parentName: "04 Obsidian tooling" }),
			fakeNote({ basename: "04.18 execute-code", parentPath: "00-09 System/04 Obsidian tooling", parentName: "04 Obsidian tooling" }),
		],
	} as unknown as VaultScan;
	const md = renderIndex(null as never, cfg, scan);
	eq(md.includes("`04.18`"), true, "index lists content id 04.18");
	eq(md.includes("`04.00`"), false, "index does NOT list the category home 04.00 as its own row");
}

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
process.exitCode = failures === 0 ? 0 : 1;
