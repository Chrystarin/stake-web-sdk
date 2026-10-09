/**
 * ══ THE DEVICE'S DRAWING BUDGET ═══════════════════════════════════════════════════════════════
 *
 * Which of two budgets this device plays on:
 *
 *   `full` — everything the game can do.
 *   `lite` — the same game, with the per-frame GPU work a weak phone cannot afford taken off it:
 *            the table's three-layer parallax backdrop becomes its flat still, the idle sways and
 *            glow pulses stop, blend modes and the animated blur filters come off, the Ocean Voyage's
 *            water holds still, the coin fountain throws half as many coins on a 1x canvas, and the
 *            Pixi canvases (the splash logo, the chest's dragon) draw at 1x. Nothing about a ROUND
 *            changes: every book plays the same beats at the same times; only the decoration is
 *            cheaper. The rules themselves live where the decoration does, keyed off the
 *            `data-tier` attribute this module keeps on `<html>` (`:global(html[data-tier='lite'])`)
 *            and off {@link device} for the few that are JavaScript.
 *
 * How the budget is chosen, in order:
 *   1. `?tier=lite` / `?tier=full` in the URL — for QA on a device. `full` also pins it: the frame
 *      watch below will not downgrade a pinned device.
 *   2. The previous page load's verdict, kept in sessionStorage: a lite device stays lite through a
 *      reload (Stake reloads the iframe now and then), so it never pays the full budget twice.
 *   3. What the device says about itself, read before anything paints: touch hardware with a phone-
 *      sized screen AND either 4 or fewer CPU cores or (where Chrome says) 4 GB or less of memory is
 *      lite from the first frame. iOS says neither, and a phone that passes this can still be weak,
 *      which is what the next step is for.
 *   4. The frame watch ({@link watchFrameRate}, started by Game.svelte once the table is up): a few
 *      seconds of animation-frame timings on the idle table. A touch device that cannot hold ~42 fps
 *      with nothing but the idle decoration running goes lite for the session — and so does an iPhone
 *      in Low Power Mode, whose 30 fps frame cap is exactly the signal. It only ever downgrades.
 *
 * `window.crazyTimeDeviceTier()` reads the verdict and its reason from a production console.
 */

export type DeviceTier = 'full' | 'lite';

export type DeviceSnapshot = {
	tier: DeviceTier;
	/** Why the tier is what it is: `url`, `session`, `static`, `frames`, or `default`. */
	reason: string;
	/** Touch hardware (any size). */
	touch: boolean;
	/** Touch hardware and a phone-sized screen: every iPhone, no iPad (see {@link isPhoneScreen}). */
	phone: boolean;
	/** An iPhone or iPad. */
	ios: boolean;
	/** `navigator.hardwareConcurrency`, where known. */
	cores?: number;
	/** `navigator.deviceMemory` in GB (Chrome only; capped at 8 by the browser), where known. */
	memoryGb?: number;
	/** The idle table's median frame interval in ms, once the watch has run. */
	frameMs?: number;
	/** How many frame intervals the watch judged on (0: the window was void). */
	frameSamples?: number;
};

const STORAGE_KEY = 'crazy-time:tier';

const inBrowser = typeof window !== 'undefined' && typeof navigator !== 'undefined';

/** Touch hardware: `maxTouchPoints` is not spoofed by "Desktop site", unlike the user agent. */
export const isTouchDevice = (): boolean => {
	if (!inBrowser) return false;
	if (navigator.maxTouchPoints > 0) return true;
	return typeof window.matchMedia === 'function' && window.matchMedia('(any-pointer: coarse)').matches;
};

/**
 * Touch hardware plus a long screen edge of ≤ 960 CSS px: every iPhone (max 932) and no iPad (min
 * 1024) — the same rule One-Eyed Willy's Plinko picks its phone art by. Read off `screen`, not the
 * viewport, so it is stable through a rotation: the preloader and the components must name the same
 * files for the whole session.
 */
export const isPhoneScreen = (): boolean => {
	if (!inBrowser || !isTouchDevice()) return false;
	const { width, height } = window.screen;
	return Math.max(width || 0, height || 0) <= 960;
};

/** An iPhone or iPad — iPadOS reports itself as a Mac, but a Mac has no touch points. */
export const isIos = (): boolean => {
	if (!inBrowser) return false;
	const ua = navigator.userAgent || '';
	if (/iP(hone|ad|od)/.test(ua)) return true;
	return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
};

const readUrlTier = (): DeviceTier | undefined => {
	if (!inBrowser) return undefined;
	try {
		const raw = new URLSearchParams(window.location.search).get('tier')?.toLowerCase();
		return raw === 'lite' || raw === 'full' ? raw : undefined;
	} catch {
		return undefined;
	}
};

const readSessionTier = (): DeviceTier | undefined => {
	if (!inBrowser) return undefined;
	try {
		return window.sessionStorage.getItem(STORAGE_KEY) === 'lite' ? 'lite' : undefined;
	} catch {
		return undefined;
	}
};

const detect = (): DeviceSnapshot => {
	const base: DeviceSnapshot = {
		tier: 'full',
		reason: 'default',
		touch: isTouchDevice(),
		phone: isPhoneScreen(),
		ios: isIos(),
	};
	if (!inBrowser) return base;
	const cores = navigator.hardwareConcurrency;
	const memoryGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
	if (typeof cores === 'number' && cores > 0) base.cores = cores;
	if (typeof memoryGb === 'number' && memoryGb > 0) base.memoryGb = memoryGb;

	const fromUrl = readUrlTier();
	if (fromUrl) return { ...base, tier: fromUrl, reason: 'url' };
	if (readSessionTier()) return { ...base, tier: 'lite', reason: 'session' };
	if (base.phone) {
		const fewCores = base.cores !== undefined && base.cores <= 4;
		const littleMemory = base.memoryGb !== undefined && base.memoryGb <= 4;
		if (fewCores || littleMemory) {
			return {
				...base,
				tier: 'lite',
				reason: `static: ${base.cores ?? '?'} cores, ${base.memoryGb ?? '?'} GB`,
			};
		}
	}
	return base;
};

/** The verdict, live: components read `device.tier`; the frame watch may flip it to `lite` once. */
export const device = $state<DeviceSnapshot>(detect());

/** Whether `?tier=full` pinned the budget, so the frame watch must leave it alone. */
const pinned = readUrlTier() === 'full';

const publish = () => {
	if (!inBrowser) return;
	document.documentElement.dataset.tier = device.tier;
	(window as unknown as { crazyTimeDeviceTier?: () => DeviceSnapshot }).crazyTimeDeviceTier = () => ({
		...device,
	});
};

/** Go lite for the rest of the session. Idempotent; never goes back up. */
export const downgradeToLite = (reason: string): void => {
	if (device.tier === 'lite') return;
	device.tier = 'lite';
	device.reason = reason;
	publish();
	try {
		window.sessionStorage.setItem(STORAGE_KEY, 'lite');
	} catch {
		/* storage is a convenience */
	}
};

publish();

/** `true` on the reduced budget. A plain read for code that runs once; templates read `device.tier`. */
export const isLite = (): boolean => device.tier === 'lite';

/**
 * Backing-store pixels per CSS pixel for a Pixi canvas. Capped at 2 everywhere (a full-screen 3x
 * canvas is a lot of memory for a spine), and 1 on the reduced budget.
 */
export const pixiResolution = (): number => {
	if (!inBrowser) return 1;
	if (isLite()) return 1;
	return Math.min(2, window.devicePixelRatio || 1);
};

/* ── The frame watch ─────────────────────────────────────────────────────────────────────────── */

/** Frames after the start before timings count: the table's first seconds are decode and upload. */
const WATCH_WARMUP_MS = 2_000;
/** How long the timings are taken over. */
const WATCH_WINDOW_MS = 4_000;
/**
 * A gap this long is a stalled renderer, not a slow frame: thrown away. Generous, because the
 * device this is for is the one whose frames ARE long — a phone crawling at a frame a second must
 * still be seen. A tab put in the background is not what this guards against: that voids the whole
 * window the moment it happens (`visibilitychange` below), so every gap that reaches here was
 * measured on a tab that stayed in front.
 */
const WATCH_GAP_MAX_MS = 3000;
/**
 * Fewer samples than this and the window is void. Only a tab that got (almost) no frames at all is
 * meant to fall under it: four seconds at the slowest crawl worth measuring is a dozen frames.
 */
const WATCH_MIN_SAMPLES = 12;
/** The verdict is given on a timer if the frames themselves are too starved to deliver it. */
const WATCH_BACKSTOP_MS = WATCH_WARMUP_MS + WATCH_WINDOW_MS + 1_500;
/** Median frame interval past which the device is lite: just under 42 fps. */
const WATCH_MEDIAN_MS = 24;
/** Or this share of frames past 33 ms (two 60 Hz frames) — a device that stutters rather than crawls. */
const WATCH_SLOW_SHARE = 0.25;
const WATCH_SLOW_MS = 33;

/**
 * Time the idle table's animation frames for a few seconds and go lite if they are too slow. Touch
 * devices only: that is where the budget bites, and a desktop with a throttled or shared GPU would
 * be the wrong device to switch. Returns a stop function; harmless to call more than once.
 */
export const watchFrameRate = (): (() => void) => {
	if (!inBrowser || pinned || device.tier === 'lite' || !device.touch) return () => {};
	let raf = 0;
	let stopped = false;
	const start = performance.now();
	let last = 0;
	const samples: number[] = [];
	let backstop: number | undefined;
	// A tab that goes to the background at any point gets no honest frames: void the window.
	const onVisibility = () => {
		if (document.hidden) stop();
	};
	const stop = () => {
		stopped = true;
		cancelAnimationFrame(raf);
		window.clearTimeout(backstop);
		document.removeEventListener('visibilitychange', onVisibility);
	};
	const finish = () => {
		if (stopped) return;
		stop();
		device.frameSamples = samples.length;
		if (samples.length < WATCH_MIN_SAMPLES) return;
		const sorted = [...samples].sort((a, b) => a - b);
		const median = sorted[Math.floor(sorted.length / 2)];
		const slowShare = samples.filter((ms) => ms > WATCH_SLOW_MS).length / samples.length;
		device.frameMs = Math.round(median * 10) / 10;
		if (median > WATCH_MEDIAN_MS || slowShare > WATCH_SLOW_SHARE) {
			downgradeToLite(`frames: median ${device.frameMs} ms, ${Math.round(slowShare * 100)}% over ${WATCH_SLOW_MS} ms`);
		}
	};
	const tick = (now: number) => {
		if (stopped) return;
		if (document.hidden) {
			stop();
			return;
		}
		const sinceStart = now - start;
		if (last && sinceStart > WATCH_WARMUP_MS) {
			const gap = now - last;
			if (gap < WATCH_GAP_MAX_MS) samples.push(gap);
		}
		last = now;
		if (sinceStart > WATCH_WARMUP_MS + WATCH_WINDOW_MS) {
			finish();
			return;
		}
		raf = requestAnimationFrame(tick);
	};
	if (document.hidden) return () => {};
	document.addEventListener('visibilitychange', onVisibility);
	raf = requestAnimationFrame(tick);
	backstop = window.setTimeout(finish, WATCH_BACKSTOP_MS);
	return stop;
};
