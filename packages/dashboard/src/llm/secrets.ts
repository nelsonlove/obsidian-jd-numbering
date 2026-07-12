/**
 * Secret-store wrappers around `app.secretStorage` (Obsidian 1.11.4+).
 *
 * Keys live in the OS keychain via Electron's safeStorage — never in
 * data.json, never synced across devices. Each provider has a stable
 * secret ID; the SecretStorage API requires lowercase alphanumeric IDs
 * with optional dashes.
 */

import type { App } from "obsidian";
import type { ProviderId } from "./provider";

/**
 * Secret IDs follow the convention `{provider}-api-key` to share storage
 * with other plugins/scripts that already use this naming. Set via the
 * plugin's settings UI or directly with:
 *   app.secretStorage.setSecret("anthropic-api-key", "sk-ant-…")
 */
function secretId(provider: ProviderId): string {
	return `${provider}-api-key`;
}

export function getApiKey(app: App, provider: ProviderId): string | null {
	return app.secretStorage.getSecret(secretId(provider));
}

export function setApiKey(app: App, provider: ProviderId, key: string): void {
	// SecretStorage has no explicit delete API; setting an empty string is
	// the closest "clear" the API offers (the slot still appears in
	// `listSecrets()` but `getSecret()` returns ""). `hasApiKey()` treats
	// empty as absent.
	app.secretStorage.setSecret(secretId(provider), key);
}

export function hasApiKey(app: App, provider: ProviderId): boolean {
	const v = getApiKey(app, provider);
	return v !== null && v.trim().length > 0;
}
