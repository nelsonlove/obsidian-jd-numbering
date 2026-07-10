// Headless unit tests for the folder-note conventions. Run via `npm test`
// (test/run.mjs bundles this with a stubbed `obsidian` and executes it).
import { canonicalFolderNoteId, parseJdId, DEFAULT_CONFIG } from "../src/jd";
import { classifyFolderNote, FolderMaps, JdNote } from "../src/scan";
import { checkNote } from "../src/lint";

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

// --- checkNote -------------------------------------------------------------
function fakeNote(o: {
	basename: string;
	parentPath: string;
	parentName: string;
	frontId: string | null;
}): JdNote {
	return {
		file: {
			path: `${o.parentPath}/${o.basename}.md`,
			basename: o.basename,
			name: `${o.basename}.md`,
			parent: { path: o.parentPath, name: o.parentName },
		},
		frontId: o.frontId,
		parsed: o.frontId ? parseJdId(o.frontId, cfg) : null,
		nameId: o.basename.split(" ")[0],
		title: o.basename,
		isRedirect: false,
		isFolderNote: o.basename === o.parentName,
	} as unknown as JdNote;
}
const codes = (n: JdNote): string[] => checkNote(n, maps, cfg).map((f) => f.code);

// category folder note with the correct AC.00 prop -> no folder-note findings
eq(
	codes(fakeNote({ basename: "00 System management", parentPath: "00-09 System/00 System management", parentName: "00 System management", frontId: "00.00" })).includes("folder-note-id-mismatch"),
	false,
	"correct category folder note: no mismatch"
);

// category folder note whose prop disagrees (03 Obsidian carrying 02.00)
eq(
	codes(fakeNote({ basename: "03 Obsidian", parentPath: "00-09 System/03 Obsidian", parentName: "03 Obsidian", frontId: "02.00" })).includes("folder-note-id-mismatch"),
	true,
	"category folder note wrong prop -> folder-note-id-mismatch"
);

// category folder note missing its prop entirely
{
	const c = codes(fakeNote({ basename: "00 System management", parentPath: "00-09 System/00 System management", parentName: "00 System management", frontId: null }));
	eq(c.includes("missing-folder-note-id"), true, "category folder note no prop -> missing-folder-note-id");
	eq(c.includes("missing-frontmatter-id"), false, "category folder note: not double-flagged");
}

// area folder note correct / missing
eq(
	codes(fakeNote({ basename: "00-09 System", parentPath: "00-09 System", parentName: "00-09 System", frontId: "00-09" })).some((c) => c.startsWith("missing-folder-note") || c === "folder-note-id-mismatch"),
	false,
	"correct area folder note: clean"
);
eq(
	codes(fakeNote({ basename: "00-09 System", parentPath: "00-09 System", parentName: "00-09 System", frontId: null })).includes("missing-folder-note-id"),
	true,
	"area folder note no prop -> missing-folder-note-id"
);

// content note filename/prop mismatch still works, and isn't treated as a folder note
{
	const c = codes(fakeNote({ basename: "01.13 Apple Notes", parentPath: "00-09 System/01 Capture & triage", parentName: "01 Capture & triage", frontId: "01.12" }));
	eq(c.includes("filename-mismatch"), true, "content note filename/prop mismatch still flagged");
	eq(c.includes("folder-note-id-mismatch"), false, "content note not treated as folder note");
}

// deep content folder note (04 CD Player) must NOT be flagged as a JD category
eq(
	codes(fakeNote({ basename: "04 CD Player", parentPath: "70-79 Hobbies & media/75 Games/X/CAOS commands/04 CD Player", parentName: "04 CD Player", frontId: null })).some((c) => c.startsWith("missing-")),
	false,
	"deep content folder note: no missing-id warnings"
);

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
process.exitCode = failures === 0 ? 0 : 1;
