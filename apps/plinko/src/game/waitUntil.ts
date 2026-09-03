/**
 * Resolve once `done()` reports true, or `maxMs` has passed — whichever comes first.
 *
 * The condition is re-checked on every animation frame AND on a coarse timer. The frame check is what
 * makes a visible game settle on the exact frame its state flips; the timer is what keeps the deadline
 * honest when frames stop. iOS parks `requestAnimationFrame` whenever the page is not being painted —
 * tab covered, screen off, low-power mode, the Stake iframe scrolled out of view — while timers keep
 * running (throttled). The board's hidden driver lands the balls off a timer for exactly that case, but
 * a wait whose deadline was only ever evaluated from inside its rAF loop never fired there: the round
 * sat unsettled, with every control locked, until the next painted frame — and an Autobet run with it.
 */
export function waitUntil(done: () => boolean, maxMs: number, pollMs = 100): Promise<void> {
	return new Promise((resolve) => {
		if (done()) {
			resolve();
			return;
		}
		const started = Date.now();
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const finish = () => {
			if (settled) return;
			settled = true;
			if (timer !== undefined) clearTimeout(timer);
			resolve();
		};
		const check = () => {
			if (settled) return;
			if (done() || Date.now() - started >= maxMs) finish();
		};
		const frame = () => {
			check();
			if (!settled) requestAnimationFrame(frame);
		};
		const tick = () => {
			check();
			if (!settled) timer = setTimeout(tick, pollMs);
		};
		requestAnimationFrame(frame);
		timer = setTimeout(tick, pollMs);
	});
}
