/**
 * Liveness counters the board engine keeps for the `?vitals=1` overlay (`lib/devVitalsOverlay.ts`).
 *
 * A plain mutable object rather than state: the engine writes it from inside the frame loop and the
 * overlay reads it once a second, and neither should pull the other's module graph in. It exists so a
 * device run can tell "the board's ticker is dead" apart from "the page is dead" or "the stream
 * stalled" from the on-screen readout alone — BrowserStack's remote Web Inspector cannot be relied on
 * (its frontend crashes against the device's WebKit build), so this is the only console we get.
 */
export const boardVitals = {
	/** `performance.now()` of the last engine ticker callback (0 until the first drop). */
	lastTickAt: 0,
	/** Whether a drop is animating right now (`isAnimating`), mirrored for the overlay. */
	animating: false,
	/** Frame steps that threw and were contained. */
	stepErrors: 0,
	/** Host callbacks (peg / coin / landing) that threw and were contained. */
	callbackErrors: 0,
	/** Times `reviveStalledTicker` had to re-arm the frame loop. */
	revives: 0,
	/** Board WebGL context lost / restored counts. */
	contextLost: 0,
	contextRestored: 0,
};
