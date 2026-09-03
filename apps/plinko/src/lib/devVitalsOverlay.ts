/**
 * TEMPORARY dev-only on-screen page-vitals overlay (?vitals=1) — the graphics/liveness sibling of
 * `devAudioDebug.ts` (?audioDebug=1).
 *
 * Built to answer ONE question from a BrowserStack video alone (iOS DevTools are plan-gated):
 * when the game "freezes" or "crashes" on a device, WHICH of these actually happened?
 *
 *   1. The BrowserStack STREAM stalled (their player throttles when its browser tab loses focus):
 *      the overlay's `up` counter is frozen on the video, and after refocusing it JUMPS — while the
 *      event log shows NO suspension. The game itself never stopped.
 *   2. iOS SUSPENDED the page (tab backgrounded / screen off): the log shows `SUSPENDED ~Ns` from
 *      the watchdog-gap detector on resume, then everything ticks on. Not a crash.
 *   3. iOS KILLED the page under memory pressure (jetsam) and Safari reloaded it: the overlay comes
 *      back with a FRESH `load` stamp and zeroed counters — the one signature a reload can't hide.
 *   4. The game genuinely broke: `up` ticks (page alive) while `raf` reads STALLED (render loop
 *      dead), or the `board` line shows anim=1 with its tick age growing (the Pixi ticker died — the
 *      engine now contains step errors and re-arms it, and counts both), or the log shows a JS
 *      error / a webglcontextlost, or a `flow` flag is stuck.
 *
 * DELETE (or leave query-gated) once the iOS freeze reports are resolved.
 */
import { stateGame } from '../game/stateGame.svelte';
import { boardVitals } from '../plinko-engine/boardVitals';

const MAX_LOG = 12;

export function installVitalsOverlay(): () => void {
	if (typeof document === 'undefined') return () => {};

	const box = document.createElement('pre');
	box.style.cssText = [
		'position:fixed',
		'bottom:0',
		'left:0',
		'z-index:2147483647',
		'margin:0',
		'padding:4px 6px',
		'max-width:96vw',
		'font:9px/1.35 monospace',
		'color:#7df',
		'background:rgba(0,0,0,0.72)',
		'pointer-events:none',
		'white-space:pre-wrap',
		'word-break:break-all',
	].join(';');
	document.body.appendChild(box);

	const loadedAt = new Date();
	const t0 = performance.now();
	const navType =
		(performance.getEntriesByType?.('navigation')?.[0] as PerformanceNavigationTiming | undefined)
			?.type ?? '?';

	const log: string[] = [];
	const stamp = () => ((performance.now() - t0) / 1000).toFixed(1).padStart(7);
	// The log survives a reload in sessionStorage, so when iOS kills the page (jetsam) and Safari
	// reloads it, the overlay comes back showing the PREVIOUS page's last events under `prev:` — the
	// only way to see what was happening right before a memory kill, since the kill itself leaves
	// no trace in the new page. Best-effort: storage can throw in private mode / after a kill.
	const PREV_KEY = 'plinkoVitalsPrevLog';
	let prevLines: string[] = [];
	try {
		const raw = sessionStorage.getItem(PREV_KEY);
		if (raw) prevLines = (JSON.parse(raw) as string[]).slice(-4);
	} catch {
		/* ignore */
	}
	function push(line: string) {
		log.push(`${stamp()} ${line}`);
		if (log.length > MAX_LOG) log.shift();
		try {
			sessionStorage.setItem(PREV_KEY, JSON.stringify(log));
		} catch {
			/* ignore */
		}
	}
	push(`loaded (nav=${navType})`);

	// ── rAF heartbeat ─────────────────────────────────────────────────────────
	// Counts frames continuously; the panel derives frames-per-interval from it. A page that is
	// alive (timers ticking) but with rAF at 0 while VISIBLE = the render pipeline is dead — the
	// desktop "visible tab, wedged compositor" state, or a genuinely hung graphics stack.
	let rafTotal = 0;
	let rafAlive = true;
	const rafTick = () => {
		rafTotal += 1;
		if (rafAlive) requestAnimationFrame(rafTick);
	};
	requestAnimationFrame(rafTick);

	// ── Error + context-loss taps ─────────────────────────────────────────────
	const onError = (e: ErrorEvent) => push(`ERROR ${String(e.message).slice(0, 90)}`);
	const onRejection = (e: PromiseRejectionEvent) =>
		push(`REJECTION ${String(e.reason).slice(0, 90)}`);

	// Safari reports every failed fetch as a bare "TypeError: Load failed" with no URL — useless for
	// triage from a video. Wrap fetch so the overlay can NAME the resource that failed.
	const origFetch = window.fetch.bind(window);
	window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
		const p = origFetch(input, init);
		p.catch((err: unknown) => {
			const url =
				typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
			push(`FETCH FAIL ${String(url).slice(-70)} (${String(err).slice(0, 40)})`);
		});
		return p;
	}) as typeof window.fetch;

	// Surface the game's own console warnings (e.g. "No local books for ballsPerDrop=50") — on a
	// device without DevTools they are otherwise invisible, and they explain "nothing happened".
	const origWarn = console.warn.bind(console);
	console.warn = (...args: unknown[]) => {
		push(`WARN ${args.map((a) => String(a)).join(' ').slice(0, 110)}`);
		origWarn(...args);
	};
	// `webglcontextlost` does not bubble, but capture phase still visits the target from window —
	// one listener covers every canvas in the game, present and future.
	let glLost = 0;
	const onCtxLost = (e: Event) => {
		glLost += 1;
		const el = e.target as HTMLElement | null;
		push(`WEBGL LOST #${glLost} (${el?.parentElement?.className?.toString().slice(0, 30) ?? '?'})`);
	};
	const onVis = () => push(`visibility=${document.visibilityState}`);
	const onHide = (e: PageTransitionEvent) => push(`pagehide persisted=${e.persisted ? 1 : 0}`);
	const onShow = (e: PageTransitionEvent) => push(`pageshow persisted=${e.persisted ? 1 : 0}`);
	window.addEventListener('error', onError);
	window.addEventListener('unhandledrejection', onRejection);
	window.addEventListener('webglcontextlost', onCtxLost, true);
	document.addEventListener('visibilitychange', onVis);
	window.addEventListener('pagehide', onHide);
	window.addEventListener('pageshow', onShow);

	// ── Out-of-band heartbeat ─────────────────────────────────────────────────
	// Pings a throwaway listener on the dev machine (port 9777, reachable from a BrowserStack
	// device via the bs-local tunnel) every 5 s with this page's identity and uptime. The listener's
	// log is liveness ground truth that no frozen video stream can fake: pings continuing through a
	// "freeze" prove the device page kept running; pings stopping (or restarting under a new load
	// id) timestamp a real freeze or reload to the second. no-cors: the response is opaque and
	// irrelevant — only the request's arrival matters. Fully best-effort; nothing depends on it.
	// Only where a listener can exist: the dev machine reached directly or through the bs-local
	// tunnel. On the published game host it would just be a failing request every 5 s.
	const hbHost = /^(localhost|127\.0\.0\.1|bs-local\.com)$/.test(location.hostname);
	const hbId = `${loadedAt.getTime().toString(36)}`;
	const hbTimer = setInterval(() => {
		if (!hbHost) return;
		const up = Math.round((performance.now() - t0) / 1000);
		// origFetch, not the tapped window.fetch — a missing listener must not spam FETCH FAIL lines.
		origFetch(`//${location.hostname}:9777/hb?id=${hbId}&up=${up}&raf=${rafTotal}`, {
			mode: 'no-cors',
			cache: 'no-store',
		}).catch(() => {});
	}, 5000);

	// ── Panel + suspension watchdog ───────────────────────────────────────────
	// The 1s timer doubles as the suspension detector: iOS freezing the page freezes this timer,
	// so a wall-clock gap between ticks is exactly how long the page was suspended.
	let lastTick = performance.now();
	let lastRafTotal = 0;
	const fmtUp = () => {
		const s = Math.floor((performance.now() - t0) / 1000);
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	};
	const timer = setInterval(() => {
		const now = performance.now();
		const gap = now - lastTick;
		if (gap > 3000) push(`SUSPENDED ~${Math.round(gap / 1000)}s (timers frozen, now resumed)`);
		lastTick = now;

		const rafInInterval = rafTotal - lastRafTotal;
		lastRafTotal = rafTotal;
		const rafStatus =
			document.visibilityState !== 'visible'
				? 'hidden'
				: rafInInterval > 0
					? 'LIVE'
					: 'STALLED';

		const g = stateGame;
		const lines = [
			`VITALS load=${loadedAt.toLocaleTimeString()} nav=${navType}  up=${fmtUp()}`,
			`raf=${rafInInterval}/s total=${rafTotal} ${rafStatus}   vis=${document.visibilityState}   glLost=${glLost}`,
			`flow spin=${g.freeSpinRouletteOpen ? 1 : 0} bonusWheel=${g.bonusRouletteOpen ? 1 : 0} flowIP=${g.rouletteFlowInProgress ? 1 : 0} submit=${g.isSubmitting ? 1 : 0} drop=${g.dropRoundActive ? 1 : 0} auto=${g.autoPlayStarted ? g.autoRoundsDisplay : '-'} bonusBalls=${g.bonusBallsRemaining}`,
			// The board's OWN frame loop, separate from the page rAF above: `anim=1` with `tick` growing
			// past ~2 s while `raf` is LIVE = the Pixi ticker died (stepErr/revives say why and whether it
			// was re-armed); gl=lost/restored counts a reaped board context, which paints nothing.
			`board tick=${boardVitals.lastTickAt ? `${((performance.now() - boardVitals.lastTickAt) / 1000).toFixed(1)}s ago` : 'never'} anim=${boardVitals.animating ? 1 : 0} stepErr=${boardVitals.stepErrors} cbErr=${boardVitals.callbackErrors} revives=${boardVitals.revives} gl=${boardVitals.contextLost}/${boardVitals.contextRestored}`,
			'── events ──',
			...log,
			...(prevLines.length ? ['── prev page (before reload) ──', ...prevLines] : []),
		];
		box.textContent = lines.join('\n');
	}, 1000);

	return () => {
		rafAlive = false;
		clearInterval(timer);
		clearInterval(hbTimer);
		window.fetch = origFetch;
		console.warn = origWarn;
		window.removeEventListener('error', onError);
		window.removeEventListener('unhandledrejection', onRejection);
		window.removeEventListener('webglcontextlost', onCtxLost, true);
		document.removeEventListener('visibilitychange', onVis);
		window.removeEventListener('pagehide', onHide);
		window.removeEventListener('pageshow', onShow);
		box.remove();
	};
}
