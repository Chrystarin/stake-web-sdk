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
