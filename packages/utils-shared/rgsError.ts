/**
 * Helpers for interpreting RGS `/wallet/*` error responses.
 *
 * An RGS error is thrown as the raw response body. Depending on the endpoint / gateway it may
 * carry the status code under `error` (string), a top-level `statusCode`, or `status.statusCode`,
 * plus an optional human-readable message and — importantly — sometimes the player's authoritative
 * `balance` (use it to re-sync a stale client balance after a rejected play).
 */

type RgsErrorLike = {
	error?: unknown;
	statusCode?: string;
	/** HTTP status attached by `rgsFetcher` when a non-JSON error body is wrapped (e.g. 429). */
	httpStatus?: number;
	message?: string;
	status?: { statusCode?: string; statusMessage?: string };
	balance?: { amount?: number };
};

function asRecord(error: unknown): RgsErrorLike {
	return (error && typeof error === 'object' ? error : {}) as RgsErrorLike;
}

/** Status code from any RGS error shape (`error` string, `statusCode`, or `status.statusCode`). */
export function getRgsErrorStatusCode(error: unknown): string {
	const e = asRecord(error);
	const direct =
		typeof e.error === 'string' ? e.error : (e.statusCode ?? e.status?.statusCode ?? '');
	return String(direct ?? '').toUpperCase();
}

/**
 * True when the RGS rejected a play because the player balance is too low (`ERR_IPB`).
 * Tolerant of message-only payloads and trailing-character variants (e.g. `ERR_IPBP`).
 */
export function isInsufficientBalanceError(error: unknown): boolean {
	const code = getRgsErrorStatusCode(error);
	if (code.startsWith('ERR_IPB')) return true;
	const e = asRecord(error);
	const haystack = `${code} ${String(e.message ?? '')} ${String(
		e.status?.statusMessage ?? '',
	)}`.toUpperCase();
	return haystack.includes('ERR_IPB') || haystack.includes('INSUFFICIENT');
}

/** Authoritative balance (API integer units) carried on some RGS error responses, if present. */
export function getRgsErrorBalanceApiAmount(error: unknown): number | undefined {
	const amount = asRecord(error).balance?.amount;
	return typeof amount === 'number' && Number.isFinite(amount) ? amount : undefined;
}

/**
 * True when the request was rejected because the client is sending too fast (HTTP 429). Recognises the
 * structured wrapper `rgsFetcher` builds for a non-JSON 429 body (`httpStatus: 429` / `ERR_RATE_LIMIT`)
 * as well as a plain "Too Many Requests" message. This is transient and safe to retry/ignore.
 */
export function isRateLimitError(error: unknown): boolean {
	const e = asRecord(error);
	if (e.httpStatus === 429) return true;
	const code = getRgsErrorStatusCode(error);
	if (code.includes('RATE_LIMIT') || code.includes('HTTP_429') || code === '429') return true;
	const haystack = `${code} ${String(e.message ?? '')} ${String(
		e.status?.statusMessage ?? '',
	)}`.toUpperCase();
	return haystack.includes('TOO MANY REQUESTS') || haystack.includes('RATE LIMIT');
}

/**
 * True when the RGS rejected a play because the session already has an open round ("player has an
 * active round"). Recoverable: the round can be resumed or closed and the next bet retried. Usually a
 * downstream effect of a dropped `/wallet/end-round` (see the 429 retry in `rgsFetcher`).
 */
export function isActiveRoundError(error: unknown): boolean {
	const e = asRecord(error);
	const haystack = `${getRgsErrorStatusCode(error)} ${String(e.message ?? '')} ${String(
		e.status?.statusMessage ?? '',
	)}`.toLowerCase();
	return haystack.includes('active round');
}
