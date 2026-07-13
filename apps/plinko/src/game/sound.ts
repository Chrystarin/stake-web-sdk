import { Howl, Howler } from 'howler';

// A 50-ball drop fires the 'pocket' sound ~50 times in quick succession. When Howler falls back to
// HTML5 audio (e.g. Web Audio locked inside the Stake iframe), those rapid plays exhaust the default
// 10-node HTML5 pool → "HTML5 Audio pool exhausted, returning potentially locked audio object". Raise
// the pool so concurrent plays each get their own node.
Howler.html5PoolSize = 60;

export type SoundEffectName =
	| 'bet'
	| 'win'
	| 'pocket'
	| 'placeChip'
	| 'clickingFail'
	| 'startAutoPlay'
	| 'openPopup'
	| 'clickUIButton';

const howls = new Map<SoundEffectName, Howl>();

export function loadPlinkoSound(name: SoundEffectName, url: string): void {
	if (howls.has(name)) return;
	try {
		howls.set(
			name,
			new Howl({
				src: [url],
				volume: 1,
				onloaderror: (_id, err) => {
					console.warn(`[plinko] sound "${name}" failed to load (${url})`, err);
				},
			}),
		);
	} catch (err) {
		console.warn(`[plinko] sound "${name}" could not be created`, err);
	}
}

export function playPlinkoSound(name: SoundEffectName, rate = 1): void {
	const howl = howls.get(name);
	if (!howl) return;
	const id = howl.play();
	// Per-instance rate so overlapping plays (a 50-ball drop) each keep their own pitch. Rate
	// doubles = one octave up; leave the default untouched so a plain play() is unchanged.
	if (id != null && rate !== 1) {
		howl.rate(rate, id);
	}
}

/**
 * Map a landed pocket multiplier to a playback rate so the 'pocket' sound is higher-pitched on
 * bigger payouts. Logarithmic because board multipliers span a huge, low-clustered range
 * (0×–100×, up to ~600× in buy modes) — a linear map would leave every low pocket sounding
 * identical. Clamped to Howler's safe rate window. mult 0 → ~0.85 (low), 5 → ~1.26,
 * 100 → ~1.9, and it keeps climbing gently past the top board value.
 */
export function pocketPitchForMultiplier(multiplier: number): number {
	const rate = 0.85 + 0.2275 * Math.log(1 + Math.max(0, multiplier));
	return Math.min(2.4, Math.max(0.5, rate));
}
