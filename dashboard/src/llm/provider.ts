/**
 * LLM provider registry. Each provider implements model listing and
 * single-turn completion against its own REST API. Network calls go
 * through Obsidian's `requestUrl()` to bypass renderer-process CORS.
 *
 * `ProviderId` and `LlmProvider` live in `./types.ts`.
 */

import type { LlmProvider, ProviderId } from "./types";
import { anthropic } from "./anthropic";
import { openai } from "./openai";

const REGISTRY: Record<ProviderId, LlmProvider> = {
	anthropic,
	openai,
};

export function getProvider(id: ProviderId): LlmProvider {
	return REGISTRY[id];
}

/** Derived from REGISTRY so adding a provider only requires updating the registry. */
export function listProviders(): { id: ProviderId; label: string }[] {
	return (Object.keys(REGISTRY) as ProviderId[]).map((id) => ({
		id,
		label: REGISTRY[id].label,
	}));
}

export type { LlmProvider, ProviderId } from "./types";
