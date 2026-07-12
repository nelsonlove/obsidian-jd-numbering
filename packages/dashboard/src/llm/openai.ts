/**
 * OpenAI Chat Completions client. Uses Obsidian's `requestUrl()` to
 * bypass renderer-process CORS.
 */

import { requestUrl } from "obsidian";
import type { LlmProvider } from "./types";

const API_BASE = "https://api.openai.com/v1";
const DEFAULT_MAX_TOKENS = 1024;

export const openai: LlmProvider = {
	id: "openai",
	label: "OpenAI",

	async listModels(apiKey: string): Promise<string[]> {
		const res = await requestUrl({
			url: `${API_BASE}/models`,
			method: "GET",
			headers: {
				Authorization: `Bearer ${apiKey}`,
			},
			throw: false,
		});
		if (res.status >= 400) {
			throw new Error(`OpenAI ${res.status}: ${extractError(res.json)}`);
		}
		if (!res.json || !Array.isArray(res.json.data)) {
			throw new Error(`OpenAI 200 but unexpected response shape: ${truncate(res.text, 200)}`);
		}
		const ids: string[] = res.json.data.map((m: { id: string }) => m.id);
		// Filter out non-chat models (embeddings, audio, image gen) — keep
		// anything that looks like a chat model. Heuristic but covers the
		// common cases without hardcoding model names that change quarterly.
		return ids
			.filter((id) => !/^(text-embedding|whisper|tts|dall-e|davinci|babbage|omni-moderation)/.test(id))
			.sort();
	},

	async complete({ apiKey, model, prompt, maxTokens }): Promise<string> {
		const res = await requestUrl({
			url: `${API_BASE}/chat/completions`,
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				model,
				max_tokens: maxTokens ?? DEFAULT_MAX_TOKENS,
				messages: [{ role: "user", content: prompt }],
			}),
			throw: false,
		});
		if (res.status >= 400) {
			throw new Error(`OpenAI ${res.status}: ${extractError(res.json)}`);
		}
		const content = res.json?.choices?.[0]?.message?.content;
		if (typeof content !== "string" || !content.trim()) {
			throw new Error(`OpenAI 200 but no choice content: ${truncate(res.text, 200)}`);
		}
		return content.trim();
	},
};

function truncate(s: string | undefined, n: number): string {
	if (!s) return "(empty body)";
	return s.length > n ? `${s.slice(0, n)}…` : s;
}

function extractError(body: unknown): string {
	if (body && typeof body === "object" && "error" in body) {
		const err = (body as { error: { message?: string } }).error;
		if (err?.message) return err.message;
	}
	return "unknown error";
}
