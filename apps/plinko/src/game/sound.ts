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
	| 'peg'
	| 'rouletteTick'
	| 'placeChip'
	| 'clickingFail'
	| 'startAutoPlay'
	| 'openPopup'
	| 'clickUIButton'
	// Fired once per coin as it merges into the balance coin. See CoinFountain.
	| 'coinFlip'
	// Coin (featured) peg hit. See PlinkoBoard.
	| 'coinPeg'
	// A coin-shuffle bed played once when a win's coins start spawning. Two windows of the SAME file:
	// a short 0–1.5s slice for 1-ball rapid wins, a longer 2–4s slice for 10/20/50-ball drops.
	| 'coinShuffleSingle'
	| 'coinShuffleMulti'
	// Bonus congratulations screen: a closing-door thud as the screen slides down and an
	// opening-door creak as it slides back up. Both are sprite windows of their source clip
	// (see EnableSound). See BonusRoulette.
	| 'doorClose'
	| 'doorOpen'
	// Bonus level-up overlay: a chime played the instant the LEVEL x / +free-balls card pops. The
	// source file has ~3.17s of leading silence, so it's loaded as a sprite window that starts at the
	// onset (see EnableSound) — the sound fires immediately with no dead air.
	| 'bonusLevelUp';

/** A [startMs, durationMs] slice of the source file to play instead of the whole thing. */
export type SoundSprite = [startMs: number, durationMs: number];

export type LoadSoundOptions = { volume?: number; sprite?: SoundSprite };

const howls = new Map<SoundEffectName, Howl>();
// Names whose Howl was built with a sprite window — those must be played by sprite id, not bare.
const SPRITE_ID = 'seg';
const spriteSounds = new Set<SoundEffectName>();

export function loadPlinkoSound(
	name: SoundEffectName,
	url: string,
	options: LoadSoundOptions = {},
): void {
	if (howls.has(name)) return;
	const { volume = 1, sprite } = options;
	try {
		howls.set(
			name,
			new Howl({
				src: [url],
				volume,
				// Play only a slice of the file when a sprite window is given (e.g. seconds 0–1.5 vs 2–4
				// of the same coin-shuffle sample). Howler indexes sprites in milliseconds.
				...(sprite ? { sprite: { [SPRITE_ID]: sprite } } : {}),
				onloaderror: (_id, err) => {
					console.warn(`[plinko] sound "${name}" failed to load (${url})`, err);
				},
			}),
		);
		if (sprite) spriteSounds.add(name);
	} catch (err) {
		console.warn(`[plinko] sound "${name}" could not be created`, err);
	}
}

export function playPlinkoSound(name: SoundEffectName, rate = 1): void {
	const howl = howls.get(name);
	if (!howl) return;
	// A sprite sound must be triggered by its window id so only that slice plays.
	const id = spriteSounds.has(name) ? howl.play(SPRITE_ID) : howl.play();
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
