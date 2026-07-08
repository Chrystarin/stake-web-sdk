import type { paths } from './schema';
import { fetcher } from 'utils-fetcher';

/**
 * HTTP 429 (rate limited) is retried with backoff. A 429 is rejected by the gateway *before* the
 * request is processed, so retrying is safe (no double-charge) and keeps a transient rate-limit burst
 * — e.g. rapid 1-ball plinko betting — from surfacing as an error. It also means a rate-limited
 * `/wallet/end-round` is not silently dropped: a dropped end-round leaves the round open on the RGS,
 * so the next `/wallet/play` fails with "player has an active round".
 */
const RATE_LIMIT_MAX_RETRIES = 4;
const RATE_LIMIT_BASE_BACKOFF_MS = 150;
const RATE_LIMIT_MAX_BACKOFF_MS = 5000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Read a response body WITHOUT ever throwing. Parses JSON when the body is JSON; otherwise wraps the
 * raw text in an RGS-style error object so callers receive a structured value instead of a
 * `SyntaxError`. (A gateway 429, for example, replies with the plain text "Too Many Requests", which
 * is not JSON — blindly calling `response.json()` on it threw and crashed the game to the fatal error
 * modal.) The `httpStatus` field lets callers classify the failure, e.g. `isRateLimitError`.
 */
async function readResponseBody(response: Response): Promise<unknown> {
	const text = await response.text().catch(() => '');
	if (text) {
		try {
			return JSON.parse(text);
		} catch {
			// Not JSON — fall through to the structured error wrapper below.
		}
	}
	if (response.ok && text === '') return undefined;
	return {
		error: response.status === 429 ? 'ERR_RATE_LIMIT' : `ERR_HTTP_${response.status}`,
		httpStatus: response.status,
		message: text || response.statusText || `HTTP ${response.status}`,
	};
}

/** Backoff before a 429 retry — honour a `Retry-After` header when present, else exponential + jitter. */
function rateLimitBackoffMs(response: Response, attempt: number): number {
	const retryAfter = Number(response.headers.get('retry-after'));
	if (Number.isFinite(retryAfter) && retryAfter >= 0) {
		return Math.min(retryAfter * 1000, RATE_LIMIT_MAX_BACKOFF_MS);
	}
	// ~150, 300, 600, 1200ms (+ up to 100ms jitter so concurrent clients don't retry in lockstep).
	const backoff = RATE_LIMIT_BASE_BACKOFF_MS * 2 ** attempt + Math.floor(Math.random() * 100);
	return Math.min(backoff, RATE_LIMIT_MAX_BACKOFF_MS);
}

async function requestWithRateLimitRetry(doFetch: () => Promise<Response>): Promise<unknown> {
	for (let attempt = 0; ; attempt++) {
		const response = await doFetch();
		if (response.status === 429 && attempt < RATE_LIMIT_MAX_RETRIES) {
			await sleep(rateLimitBackoffMs(response, attempt));
			continue;
		}
		if (!response.ok) console.error('[rgs] request failed', response.status, response.url);
		return readResponseBody(response);
	}
}

export const rgsFetcher = {
	post: async function post<
		T extends keyof paths,
		TResponse = paths[T]['post']['responses'][200]['content']['application/json'],
	>(options: {
		url: T;
		rgsUrl: string;
		variables?: paths[T]['post']['requestBody']['content']['application/json'];
	}): Promise<TResponse> {
		const data = await requestWithRateLimitRetry(() =>
			fetcher({
				method: 'POST',
				variables: options.variables,
				endpoint: `https://${options.rgsUrl}${options.url}`,
			}),
		);
		return data as TResponse;
	},
	get: async function get<
		T extends keyof paths,
		TResponse = paths[T]['get']['responses'][200]['content']['application/json'],
	>(options: { url: T; rgsUrl: string }): Promise<TResponse> {
		const data = await requestWithRateLimitRetry(() =>
			fetcher({
				method: 'GET',
				endpoint: `https://${options.rgsUrl}${options.url}`,
			}),
		);
		return data as TResponse;
	},
};
