import { hasActiveRgsSession } from './plinkoSessionMeters';

/**
 * Provably-fair invariant guard.
 *
 * On a live RGS session every outcome that affects the payout — the ball's landing slot, the bonus /
 * free-spin wheel segment, every bonus ball — MUST come from the server-served book. The client must
 * never roll its own dice for those. The engine and roulette components keep `Math.random()` fallbacks
 * for dev / local / story playback (where there is no book); this guard makes sure none of those
 * fallbacks is ever silently reached during a real RGS session, where it would break provable fairness.
 *
 * Behaviour:
 *   - No live RGS session (dev / local / story / replay): no-op — the random fallback is legitimate.
 *   - Live RGS session: a violation. Logs an error (with context) always, then throws in DEV so any
 *     QA / CI run against the RGS fails loudly before publish. In production it does NOT throw — the
 *     pre-existing fallback still runs so a live player is never crashed mid-round; we surface the bug
 *     (console + any error reporting) rather than degrade the session.
 */
export function assertAuthoritativeOutcome(
	context: string,
	details?: Record<string, unknown>,
): void {
	if (!hasActiveRgsSession()) return;
	const message = `[plinko] provably-fair violation: client-random outcome on a live RGS session (${context})`;
	console.error(message, details ?? {});
	if (import.meta.env.DEV) {
		throw new Error(message);
	}
}
