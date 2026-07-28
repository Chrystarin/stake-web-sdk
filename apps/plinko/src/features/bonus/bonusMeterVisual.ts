/**
 * RENDERED fill of the bonus/energy meter — i.e. what the player can actually see right now.
 *
 * `stateGame.bonusMeterValue / bonusMeterMax` is the LOGICAL fill; the meter draws it through an eased
 * animation (`BONUS_METER_FILL_SPEED_PER_SECOND`, ~556ms for a full sweep), so the two are routinely
 * out of step. The in-bonus level-up must only celebrate once the bar has visibly COMPLETED, so the
 * orchestrator waits on this (the drawn value) rather than on the logical one.
 *
 * `BonusMeterEngine` publishes here on every fill update; there is exactly one meter instance (it is
 * permanently mounted — see the comment on `.bonus-meter-wrap` in Game.svelte), so a module-level
 * value is enough.
 */

/** Treat "within a fifth of a percent of full" as full — the eased settle never lands exactly on 1. */
const FULL_EPSILON = 0.002;

/** Longest a caller will wait for the bar to finish filling before giving up (a full sweep is ~556ms).
 *  Guards against the meter not drawing at all — failed texture load, unmounted engine, hidden tab. */
const RENDERED_FULL_TIMEOUT_MS = 1500;

let renderedProgress = 0;

/** Called by `BonusMeterEngine` each time it redraws the fill. */
export function reportBonusMeterRenderedProgress(value: number): void {
	renderedProgress = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

export function bonusMeterRenderedProgress(): number {
	return renderedProgress;
}

export function isBonusMeterRenderedFull(): boolean {
	return renderedProgress >= 1 - FULL_EPSILON;
}

/** Resolves once the bar has DRAWN itself full (or the timeout elapses, so a non-drawing meter can
 *  never stall the bonus flow). */
export function waitForBonusMeterRenderedFull(
	timeoutMs = RENDERED_FULL_TIMEOUT_MS,
): Promise<void> {
	return new Promise((resolve) => {
		if (isBonusMeterRenderedFull()) {
			resolve();
			return;
		}
		let settled = false;
		const finish = () => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve();
		};
		// A wall-clock timer, not a deadline checked inside the rAF loop: rAF is throttled to a stop in a
		// backgrounded tab, which would otherwise park the level-up forever.
		const timer = setTimeout(finish, timeoutMs);
		const check = () => {
			if (settled) return;
			if (isBonusMeterRenderedFull()) {
				finish();
				return;
			}
			requestAnimationFrame(check);
		};
		requestAnimationFrame(check);
	});
}
