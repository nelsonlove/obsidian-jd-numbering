/**
 * Canonical types for the LLM provider abstraction. `ProviderId` is the
 * single source of truth — adding a new provider means updating this union
 * and adding a registry entry in `provider.ts`.
 */

export type ProviderId = "anthropic" | "openai";

export interface LlmProvider {
	id: ProviderId;
	label: string;

	/** GET /v1/models — returns the user-visible model IDs. */
	listModels(apiKey: string): Promise<string[]>;

	/** Single-turn completion. Throws on HTTP error or malformed response. */
	complete(args: {
		apiKey: string;
		model: string;
		prompt: string;
		maxTokens?: number;
	}): Promise<string>;
}
