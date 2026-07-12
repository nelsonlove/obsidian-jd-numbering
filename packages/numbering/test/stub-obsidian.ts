// Minimal stand-ins for the `obsidian` module so pure logic (jd/scan/lint) can
// be bundled and run headlessly. Only what the imported code references at load
// time needs to exist; the tests fabricate note/map objects directly.
export class App {}
export class TFile {}
export class TFolder {}
export class Notice {
	constructor(_message?: string) {}
}
export function normalizePath(p: string): string {
	return p;
}
