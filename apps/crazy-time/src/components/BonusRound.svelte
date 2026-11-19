<script lang="ts">
	/**
	 * The bonus screen. Comes down over the table when the wheel lands on a room, plays the room
	 * out, shows what it paid, and lifts. The book's awaited `bonusRound` broadcast resolves when
	 * this is done, so the round waits for the room.
	 *
	 * A room the player was NOT in still plays (the tease is the point), with a banner saying so
	 * and no win line.
	 */
	import { tick } from 'svelte';
	import { waitForTimeout } from 'utils-shared/wait';

	import { getContext } from '../game/context';
	import { SPOT_LABEL, SPOT_COLOUR, type RoomSpot, type Spot } from '../game/constants';
	import type { BookEventRoom } from '../game/typesBookEvent';
	import { playSound, setMusicScene } from '../game/sound';
	import { isReplay } from '../game/replay';
	import { staticUrl } from '../lib/staticUrl';
	import { adoptVideo, releaseVideo, type VideoKey } from '../lib/preloadAssets';
	import type { SceneKey } from '../lib/spine/backdropScenes';

	import RoomPiratePlinko from './rooms/RoomPiratePlinko.svelte';
	import RoomBonusWheel from './rooms/RoomBonusWheel.svelte';
	import RoomChest from './rooms/RoomChest.svelte';
	import RoomOceanVoyageV2 from './rooms/RoomOceanVoyageV2.svelte';
	import MultiplierBurst from './rooms/MultiplierBurst.svelte';
	import SpineBackdrop from './SpineBackdrop.svelte';

	type Props = {
		/** Cash value of one chip. Nothing on this screen says money any more; kept for the caller. */
		chip: number;
		/** Tall viewport: the rooms that care lay themselves out differently. */
		portrait?: boolean;
		/**
		 * How the screen comes on.
		 * - `slide` (the default): down over the table from the top, behind the door's sound.
		 * - `lit`: the screen is already covered (the Treasure Chest's light, RoomReveal, or the
		 *   Bonus Wheel's ship's wheel, WheelReveal): the room goes up in place under it, with no
		 *   slide and no door, and the cover coming off is the entrance.
		 * - `wipe`: the screen goes up in place but clipped away to nothing, and `enter` draws it in
		 *   (Ocean Voyage's ship, VoyageReveal); the room starts once `enter` resolves.
		 * - `descend`: the screen goes up a whole frame BELOW the table, out of sight, and `enter`
		 *   brings the camera down onto it (Pirate Plinko's cannonball, PlinkoReveal); the room starts
		 *   once `enter` resolves.
		 */
		entrance?: 'slide' | 'lit' | 'wipe' | 'descend';
		/** Runs a `wipe` or `descend` entrance on the screen element. */
		enter?: (screen: HTMLElement) => Promise<void>;
		/**
		 * Asked as the screen is about to go: true once something has covered the screen for the way
		 * out (the Bonus Wheel's ship's wheel, WheelReveal), and the room is taken down in place under
		 * it, with no slide and no door — or once something has taken the screen off itself (Ocean
		 * Voyage's ship, wiping it away with VoyageReveal's `leave`). False keeps the slide.
		 */
		coverExit?: (room: RoomSpot, screen: HTMLElement | null) => Promise<boolean>;
		/**
		 * True for the whole time the screen is up. Opening, it may hand back the cover still coming
		 * off a `lit` screen: the room's title waits for it, so nothing starts under the cover.
		 */
		onOpenChange?: (open: boolean) => Promise<void> | void;
	};
	let {
		portrait = false,
		entrance = 'slide',
		enter,
		coverExit,
		onOpenChange,
	}: Props = $props();
	/** `entrance` as it stood when this screen went up: the light lifting must not start a slide. */
	let enteredAs = $state<'slide' | 'lit' | 'wipe' | 'descend'>('slide');
	/**
	 * An entrance still waiting on `enter`: the screen is held out of sight until it runs — clipped
	 * away for a wipe, a frame down for a descent.
	 */
	let held = $state(false);
	let screenEl: HTMLElement | undefined = $state();

	const context = getContext();

	/**
	 * `helm`: the Ocean Voyage, played at the ship's wheel (RoomOceanVoyageV2) — however it came up:
	 * the wheel landing on it, a buy, or a replay (which sails itself, as a room the player was not in
	 * does).
	 */
	let current = $state<{ room: BookEventRoom; covered: boolean; helm: boolean } | null>(null);
	/**
	 * A room is played by hand only by the player who covered it. A replay has nobody at the table
	 * (it is a recording being watched, often by someone else), so its rooms play themselves out
	 * the way an uncovered room does, rather than sitting on a pick timer at every step.
	 */
	const handsOn = $derived(Boolean(current?.covered) && !isReplay());
	let closing = $state(false);
	let result = $state<number | null>(null);
	/**
	 * A room's handle. `handTotal` is for a room that already shows its result somewhere when it
	 * settles (Ocean Voyage, on its barrel of gold): it gives up where that number is and hides it, so
	 * the result's burst can be taken off it (`resultFrom`) rather than appear beside it.
	 */
	let roomApi = $state<{ play: () => Promise<number>; handTotal?: () => DOMRect | null } | undefined>();
	/** Where the result's burst lifts off from (`MultiplierBurst`'s `from`), and whether it is up yet —
	    it is held unseen for the frame it takes to measure where it will rest. */
	let resultFrom = $state<{ x: number; y: number; scale: number } | null>(null);
	let resultShown = $state(true);
	let resultEl = $state<HTMLElement>();

	/**
	 * A room brings its own backdrop, which then shows through whatever it plays on. Ocean Voyage has
	 * a video (see `roomVideo`); the Bonus Wheel, Pirate Plinko and the Treasure Chest have the
	 * artist's Spine scenes — the deck in a storm, the beach at sunset, the dragon's lair
	 * (SpineBackdrop.svelte, `ROOM_SCENE`), in a cut for each orientation. A room with none keeps the
	 * flat room-tinted gradient.
	 *
	 * Nothing depends on video playback: a browser that refuses leaves the gradient underneath showing.
	 */
	const ROOM_SCENE: Partial<Record<Spot, { landscape: SceneKey; portrait: SceneKey }>> = {
		bonusWheel: { landscape: 'bonusLandscape', portrait: 'bonusPortrait' },
		piratePlinko: { landscape: 'plinkoLandscape', portrait: 'plinkoPortrait' },
		chest: { landscape: 'chestLandscape', portrait: 'chestPortrait' },
	};
	const isVideoRoom = (spot: Spot): spot is VideoKey => spot === 'oceanVoyage';
	/**
	 * The board every room's name is written on. Its plaque — the timber inside the rope — runs
	 * from 0.14 to 0.86 across and 0.26 to 0.70 down, read off the file; the text is laid in that
	 * opening rather than in the middle of the picture, which the skull at the top pulls off centre.
	 */
	const TITLE_FRAME = staticUrl('img/title_frame.webp');
	/**
	 * How big the room's name can be cut and still fit the timber.
	 *
	 * The names are not the same length — BONUS WHEEL is eleven characters and TREASURE CHEST
	 * fourteen — and
	 * one size for all of them either wastes the plaque or runs the long ones off it, which is what
	 * it was doing. So the short names take the cap and the long ones are stepped down to whatever
	 * the board will take. `0.7em` a character is measured off PiecesOfEight, rounded up a little so
	 * a wider-than-average name still lands inside the rope.
	 */
	const titleSizeVw = (label: string): number => {
		const plateVw = portrait ? 80.6 : 28.6;
		const capVw = portrait ? 9.4 : 3.6;
		// The writing surface is 0.72 of the picture across.
		return Math.min(capVw, (plateVw * 0.72) / (0.7 * label.length));
	};

	/**
	 * Puts the room's backdrop into `host`. The `<video>` is not written in the markup: it is ADOPTED
	 * from the intro preload (lib/preloadAssets.ts), which built one per room behind the splash and
	 * holds a decoded first frame in each — so the screen slides in over the room's scene, not over
	 * black while the clip cold-starts. The room keys ARE the preload's video keys. On close the
	 * element goes back to the preload's parking stage, paused, for the room's next visit.
	 */
	const roomVideo = (host: HTMLElement, spot: Spot) => {
		let showing: VideoKey | undefined;
		const show = (next: Spot) => {
			const key = isVideoRoom(next) ? next : undefined;
			if (showing === key) return;
			if (showing) releaseVideo(showing);
			showing = key;
			if (!key) return;
			const el = adoptVideo(key, host);
			if (el) el.className = 'room-video';
		};
		show(spot);
		return {
			update: show,
			destroy: () => {
				if (showing) releaseVideo(showing);
			},
		};
	};

	const spotFor = (room: BookEventRoom): RoomSpot =>
		room.type === 'piratePlinkoRoom'
			? 'piratePlinko'
			: room.type === 'bonusWheelRoom'
				? 'bonusWheel'
				: room.type === 'chestRoom'
					? 'chest'
					: 'oceanVoyage';

	/**
	 * The two beats at the end of a round: the landing on its own, and then the multiplier.
	 *
	 * Both are the same for a round the player was in and one they were only watching. The tease
	 * used to be cut shorter than the real thing, on the grounds that there is less to take in — but
	 * the result reads the same either way, and hurrying it only made the two look like different
	 * screens.
	 */
	const SETTLE_MS = 1000;
	const WIN_HOLD_MS = 3000;

	/**
	 * Put the result up. Mostly it bursts out of nothing in the middle of the screen. But a room that
	 * already shows the number (`handTotal`) has it taken off there instead: the burst is laid out
	 * unseen, the two are measured against each other, and it lifts off the room's number — which the
	 * room hides in the same frame — and flies in. Measured on screen and turned into the burst's own
	 * pixels (the game's CSS zoom is the ratio between the two).
	 */
	const showResult = async (paid: number) => {
		const hand = roomApi?.handTotal;
		if (!hand) {
			result = paid;
			return;
		}
		resultShown = false;
		result = paid;
		await tick();
		const burst = resultEl?.querySelector<HTMLElement>('.burst');
		const badge = burst?.querySelector<HTMLElement>('.mult-badge');
		const source = hand();
		if (burst && badge && source && source.height > 0) {
			const rest = burst.getBoundingClientRect();
			const zoom = rest.width / (burst.offsetWidth || rest.width) || 1;
			const size = badge.getBoundingClientRect().height || 1;
			resultFrom = {
				x: (source.left + source.width / 2 - (rest.left + rest.width / 2)) / zoom,
				y: (source.top + source.height / 2 - (rest.top + rest.height / 2)) / zoom,
				scale: source.height / size,
			};
		}
		resultShown = true;
	};

	/**
	 * The room's Top Slot multiplier — bought or landed on the wheel, whenever the Top Slot multiplied
	 * it: REWARD / MULTIPLIER over the number, all in the multiplier's own hand (`.mult-badge`), with
	 * no board behind them (`multTag`), each line the same width (`sameWidth`). It comes on over the room's name while the name is still big in
	 * the middle, and is slammed onto the middle of the sign's bottom rope (`copyTsEl`, the copy's
	 * `.ts`); from there it rides up into the header with the name, and the header's own `.ts` is
	 * shown when the two land.
	 */
	/**
	 * REWARD / MULTIPLIER / the number, each line cut to exactly the same width of LETTERING
	 * (`TAG_WIDTH_EM` of the tag's own font size), centred on the same line, so the three stack as one
	 * block. A line's box is no good for this: it carries air at both ends (`.mult-badge`'s padding
	 * and letter-spacing) and every glyph its own side bearings, which grow with the size — the big
	 * number came out visibly narrower and off to one side. So the ink is measured instead
	 * (`measureText`'s bounding box, at 100px in the line's own font), each line is sized to bring
	 * its ink to the width, and nudged sideways by however far its ink sits off its box's middle.
	 * All of it in em, so it holds at any size the tag is drawn at and only has to be worked out
	 * once the font has loaded.
	 */
	const TAG_WIDTH_EM = 3.4;
	/** `.mult-badge` (table.scss): padding before the first letter, and letter-spacing, in em. */
	const BADGE_PAD_EM = 0.06;
	const BADGE_SPACING_EM = 0.06;
	let inkCtx: CanvasRenderingContext2D | null | undefined;
	/** A line's lettering in em of its own size: how wide, and how far its middle sits off the box's. */
	const inkOf = (line: HTMLElement): { width: number; offset: number } | null => {
		const fill = line.querySelector<HTMLElement>('.mult-fill');
		if (!fill) return null;
		inkCtx ??= document.createElement('canvas').getContext('2d');
		if (!inkCtx) return null;
		const style = getComputedStyle(fill);
		inkCtx.font = `${style.fontWeight} 100px ${style.fontFamily}`;
		const raw = fill.textContent ?? '';
		const text = style.textTransform === 'uppercase' ? raw.toUpperCase() : raw;
		const m = inkCtx.measureText(text);
		const gaps = BADGE_SPACING_EM * (text.length - 1);
		const left = -m.actualBoundingBoxLeft / 100 + BADGE_PAD_EM;
		const right = m.actualBoundingBoxRight / 100 + gaps + BADGE_PAD_EM;
		const box = BADGE_PAD_EM + m.width / 100 + BADGE_SPACING_EM * text.length;
		return { width: right - left, offset: box / 2 - (left + right) / 2 };
	};
	const sameWidth = (node: HTMLElement) => {
		const fit = () => {
			for (const line of node.querySelectorAll<HTMLElement>('.tag-line')) {
				const ink = inkOf(line);
				if (!ink || ink.width <= 0) continue;
				const size = TAG_WIDTH_EM / ink.width;
				line.style.fontSize = `${size.toFixed(4)}em`;
				line.style.translate = `${ink.offset.toFixed(4)}em 0`;
			}
		};
		fit();
		void document.fonts?.ready.then(fit);
	};
	let tsLanded = $state(true);
	let slamShown = $state(false);
	let slamEl: HTMLElement | undefined = $state();
	let copyTsEl: HTMLElement | undefined = $state();
	/** How long the name is up on its own before the multiplier comes on over it. */
	const MULT_AFTER_TITLE_MS = 2000;
	const SLAM_POP_MS = 320;
	const SLAM_HOLD_MS = 600;
	const SLAM_MS = 340;
	/** After the hit, before the name (multiplier and all) goes up to the header. */
	const SLAM_SETTLE_MS = 700;

	const slamMultiplier = async () => {
		slamShown = true;
		await tick();
		const el = slamEl;
		const target = copyTsEl;
		if (el && target) {
			playSound('notify');
			await el
				.animate(
					[
						{ scale: 0.3, opacity: 0 },
						{ scale: 1.12, opacity: 1, offset: 0.65 },
						{ scale: 1, opacity: 1 },
					],
					{ duration: SLAM_POP_MS, easing: 'ease-out', fill: 'forwards' },
				)
				.finished.catch(() => undefined);
			await waitForTimeout(SLAM_HOLD_MS);
			const from = el.getBoundingClientRect();
			const to = target.getBoundingClientRect();
			if (from.width && to.width) {
				// On the screen, through the frame's zoom: the translate is in the frame's own pixels.
				const zoom = el.offsetWidth ? from.width / el.offsetWidth : 1;
				const dx = (to.left + to.width / 2 - (from.left + from.width / 2)) / zoom;
				const dy = (to.top + to.height / 2 - (from.top + from.height / 2)) / zoom;
				playSound('whoosh', 1.2, 0.7);
				// Gathering speed all the way in: a slam, not a glide.
				await el
					.animate(
						[
							{ translate: '0 0', scale: 1, opacity: 1 },
							{ translate: `${dx}px ${dy}px`, scale: to.width / from.width, opacity: 1 },
						],
						{ duration: SLAM_MS, easing: 'cubic-bezier(0.6, 0, 0.9, 0.5)', fill: 'forwards' },
					)
					.finished.catch(() => undefined);
			}
		}
		tsLanded = true;
		slamShown = false;
		playSound('boom', 1.1, 0.8);
		// The sign takes the hit, and the multiplier flashes as it sticks.
		titleEl?.animate(
			[
				{ translate: '0 0' },
				{ translate: '0 2.5%' },
				{ translate: '0 -1.2%' },
				{ translate: '0 0.5%' },
				{ translate: '0 0' },
			],
			{ duration: 380, easing: 'ease-out' },
		);
		copyTsEl?.animate(
			[
				{ scale: 1.3, filter: 'brightness(2.2)' },
				{ scale: 1, filter: 'brightness(1)' },
			],
			{ duration: 420, easing: 'ease-out' },
		);
		await waitForTimeout(SLAM_SETTLE_MS);
	};

	/**
	 * The room's name, before anything else in it moves: a copy of the title frame stands big in the
	 * middle of the room over a dimmed backdrop from the screen's first frame, so it comes on WITH the
	 * entrance (slid, wiped or dropped in with the screen, or uncovered under the cover). Once the
	 * entrance is over it glows for a beat, then is carried up and shrunk onto the real frame in the
	 * header (`plateEl`),
	 * which is laid out the whole time but kept invisible until the copy lands on it. The real one
	 * never moves, so everything the rooms measure against it (Pirate Plinko's cannon tuck, the
	 * voyage's caption) is where it will be from the first frame.
	 */
	let titleShown = $state(false);
	let titleLanded = $state(true);
	let titleEl: HTMLElement | undefined = $state();
	let titleDimEl: HTMLElement | undefined = $state();
	let plateEl: HTMLElement | undefined = $state();
	/** The beat the name is held in the middle once the entrance is over, before it moves. */
	const TITLE_HOLD_MS = 600;
	/**
	 * How much bigger the name stands in the middle than in the header: 1.75 in landscape, 1.08 in
	 * portrait (where the plate is already most of the screen across) — unless the screen is too short
	 * to fit the name AND the multiplier held under it (`.mult-slam`), when both come down together.
	 *
	 * Everything here is in vw, against the screen's height in vw (`screenRatio` x 100). From the middle
	 * down: half the sign (its height is its width over 2.373), a gap (`SLAM_GAP_VW`), and the held
	 * multiplier, about 4.3em tall at `SLAM_OVER` times the size it lands at (`.ts`: 1.7vw, 6.6vw in
	 * portrait, x the same `titleBig`) — all of which scale with `titleBig`, so it is solved for.
	 */
	const SLAM_GAP_VW = 2;
	const SLAM_OVER = 1.15;
	let screenRatio = $state(0.5625);
	const titleBig = $derived.by(() => {
		const [plate, ts, cap] = portrait ? [80.6, 6.6, 1.08] : [28.6, 1.7, 1.75];
		const perBig = plate / 2.373 / 2 + 4.3 * ts * SLAM_OVER;
		const room = 50 * screenRatio - SLAM_GAP_VW - 1.5;
		return Math.max(0.6, Math.min(cap, room / perBig));
	});
	$effect(() => {
		const el = screenEl;
		if (!el) return;
		const measure = () => {
			if (el.offsetWidth) screenRatio = el.offsetHeight / el.offsetWidth;
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	});
	const TITLE_FLY_MS = 720;

	const bringOnTitle = async (multiplied: boolean, upAt: number) => {
		// Already up, in the middle, since the screen was (see the `bonusRound` handler).
		titleLanded = false;
		titleShown = true;
		await tick();
		const el = titleEl;
		const plate = plateEl;
		if (el && plate) {
			const big = titleBig;
			if (multiplied) {
				// The name has been up since the screen's first frame; the multiplier comes on two
				// seconds after that, and never before the entrance is over.
				await waitForTimeout(Math.max(0, MULT_AFTER_TITLE_MS - (performance.now() - upAt)));
				await slamMultiplier();
			} else {
				el.classList.add('emph');
				await waitForTimeout(TITLE_HOLD_MS);
				el.classList.remove('emph');
			}
			const from = el.getBoundingClientRect();
			const to = plate.getBoundingClientRect();
			if (from.width && to.width) {
				// Rects are on the screen, and the frame is zoomed to fit it: the translate is in the
				// frame's own pixels, so the distance is taken back out of the zoom. The plate is
				// unscaled, so its drawn width over its layout width IS the zoom.
				const zoom = plate.offsetWidth ? to.width / plate.offsetWidth : 1;
				const dx = (to.left + to.width / 2 - (from.left + from.width / 2)) / zoom;
				const dy = (to.top + to.height / 2 - (from.top + from.height / 2)) / zoom;
				playSound('whoosh');
				titleDimEl?.animate([{ opacity: 1 }, { opacity: 0 }], {
					duration: TITLE_FLY_MS,
					fill: 'forwards',
				});
				await el
					.animate(
						[
							{ translate: '0 0', scale: big },
							{ translate: `${dx}px ${dy}px`, scale: 1 },
						],
						{
							duration: TITLE_FLY_MS,
							easing: 'cubic-bezier(0.32, 0.72, 0.24, 1)',
							fill: 'forwards',
						},
					)
					.finished.catch(() => undefined);
			}
		}
		titleLanded = true;
		tsLanded = true;
		titleShown = false;
		slamShown = false;
		playSound('pop');
	};

	context.eventEmitter.subscribeOnMount({
		bonusRound: async (event) => {
			const handed = entrance === 'wipe' || entrance === 'descend';
			enteredAs = handed && !enter ? 'slide' : entrance;
			held = enteredAs === 'wipe' || enteredAs === 'descend';
			// Every room the Top Slot multiplied brings its multiplier on (`slamMultiplier`) before it
			// plays — a bought room, whose Top Slot the table never showed, and a wheel landing alike.
			const intro = event.room.topSlotMultiplier > 1;
			tsLanded = !intro;
			slamShown = false;
			// Hidden from the first frame: the name is brought on once the screen is in.
			// The name is up in the middle from the first frame: it comes on with the screen.
			titleLanded = false;
			titleShown = true;
			const titleUpAt = performance.now();
			const opening = onOpenChange?.(true);
			result = null;
			resultFrom = null;
			resultShown = true;
			closing = false;
			const helm = event.room.type === 'oceanVoyageRoom';
			current = { room: event.room, covered: event.covered, helm };
			// The table track rides out under the door and the room's own comes up behind it.
			setMusicScene(spotFor(event.room));
			if (enteredAs === 'slide') playSound('doorClose');
			await tick();
			if (held && enter && screenEl) {
				// However the entrance goes, the screen is not left out of sight behind it.
				await enter(screenEl).catch(() => undefined);
				held = false;
			} else {
				held = false;
				// The screen sliding in — or, under a cover, the cover coming all the way off it.
				await Promise.all([waitForTimeout(700), Promise.resolve(opening).catch(() => undefined)]);
			}
			try {
				// Nothing in the room starts — no clock, no pick — until the name and the multiplier are
				// both up where they stay: the room's `play` is what starts its clock.
				await bringOnTitle(intro, titleUpAt);
				// A room resolves the moment it settles — for Pirate Plinko that is the frame the ball drops
				// into the pocket, with the card lit and the land sound going. The number is held back
				// from that frame rather than printed over it: the landing gets a beat of its own,
				// then the win comes up, then it is left up long enough to actually be read.
				const paid = (await roomApi?.play()) ?? event.room.total;
				await waitForTimeout(SETTLE_MS);
				await showResult(paid);
				await waitForTimeout(WIN_HOLD_MS);
			} finally {
				const covered = await coverExit?.(spotFor(event.room), screenEl ?? null).catch(() => false);
				setMusicScene('base');
				if (!covered) {
					closing = true;
					playSound('doorOpen');
					await waitForTimeout(450);
				}
				current = null;
				closing = false;
				titleShown = false;
				titleLanded = true;
				// The round (and its win) waits for the way out to finish: an icon flown home onto the
				// table's wheel, say.
				await Promise.resolve(onOpenChange?.(false)).catch(() => undefined);
			}
		},
	});
</script>

<!-- The multiplier: BONUS MULTIPLIER over the number, in the multiplier's own hand and no board.
     All in `em`, so whatever sets the font size sets its size: big in the middle (`.mult-slam`),
     small over the skull (`.ts`). -->
{#snippet multTag(multiplier: number)}
	{#each ['Reward', 'Multiplier', `${multiplier}x`] as line, index (index)}
		<div class="mult-badge tag-line" class:tag-value={index === 2}>
			<span class="mult-stroke" aria-hidden="true">{line}</span>
			<span class="mult-fill">{line}</span>
		</div>
	{/each}
{/snippet}

{#if current}
	{@const spot = spotFor(current.room)}
	{@const colour = SPOT_COLOUR[spot]}
	{@const scene = ROOM_SCENE[spot]?.[portrait ? 'portrait' : 'landscape']}
	<!-- What the room paid, as a multiplier over the middle of the screen, in the Treasure Chest's
	     own burst (`MultiplierBurst`). The chest writes it on its last chest instead, so it is left
	     out here. No cash: the win is the balance's to report, not this screen's. -->
	{@const centreSays = result !== null && current.room.type !== 'chestRoom'}
	<div
		class="screen"
		class:closing
		class:lit={enteredAs !== 'slide'}
		class:wiping={held && enteredAs === 'wipe'}
		class:descending={held && enteredAs === 'descend'}
		class:helm={current.helm}
		bind:this={screenEl}
		style="--room-base:{colour.base}; --room-deep:{colour.deep}">
		<div class="room-video-host" use:roomVideo={spot}></div>
		{#if scene}
			<SpineBackdrop {scene} />
		{/if}
		<div class="room-scrim"></div>

		<div class="header" class:multiplied={current.room.topSlotMultiplier > 1}>
			<div
				class="plate"
				class:waiting={!titleLanded}
				bind:this={plateEl}
				style="--title-frame:url('{TITLE_FRAME}')"
			>
				<div class="title" style="font-size:{titleSizeVw(SPOT_LABEL[spot])}vw">
					{SPOT_LABEL[spot]}
				</div>
				{#if current.room.topSlotMultiplier > 1}
					<!-- Under the middle of the sign's bottom rope, where the multiplier was slammed onto the name
					     in the middle of the room, and rode up with it. -->
					<div class="ts mult-tag" class:waiting={!tsLanded} use:sameWidth>
						{@render multTag(current.room.topSlotMultiplier)}
					</div>
				{/if}
			</div>
			<!-- Hung off the bottom of the sign rather than stacked under it, so the header is always
			     exactly as tall as the plaque — which is what the cannon behind it measures its tuck
			     against, and it would otherwise be pushed down by a line of text. -->
			{#if !current.covered}
				<div class="badges">
					<div class="not-in">You were not in this bonus</div>
				</div>
			{/if}
		</div>

		<div class="stage">
			{#if current.room.type === 'piratePlinkoRoom'}
				<RoomPiratePlinko
					bind:this={roomApi}
					room={current.room}
					interactive={handsOn}
					{portrait}
					caught={enteredAs === 'descend'}
				/>
			{:else if current.room.type === 'bonusWheelRoom'}
				<RoomBonusWheel bind:this={roomApi} room={current.room} interactive={handsOn} />
			{:else if current.room.type === 'chestRoom'}
				<RoomChest bind:this={roomApi} room={current.room} interactive={handsOn} {portrait} />
			{/if}
		</div>

		<!-- Ocean Voyage takes the whole screen, under the header's multiplier and above the backdrop,
		     rather than the stage: its sea runs edge to edge. -->
		{#if current.helm && current.room.type === 'oceanVoyageRoom'}
			<div class="helm-layer">
				<RoomOceanVoyageV2
					bind:this={roomApi}
					room={current.room}
					interactive={handsOn}
					{portrait}
				/>
			</div>
		{/if}

		<!-- Empty now, but it keeps its height: the rooms' layouts (the wheel's frame, the chest's lift
		     off the floor) are measured against it. -->
		<div
			class="footer"
			class:folded={current.room.type === 'piratePlinkoRoom'}
		></div>

		{#if titleShown}
			<!-- The room's name, big in the middle first (`bringOnTitle`); the copy is what flies. -->
			<div class="title-intro">
				<div class="title-dim" bind:this={titleDimEl}></div>
				<div
					class="plate title-copy"
					bind:this={titleEl}
					style="--title-frame:url('{TITLE_FRAME}'); scale:{titleBig}"
				>
					<div class="title" style="font-size:{titleSizeVw(SPOT_LABEL[spot])}vw">
						{SPOT_LABEL[spot]}
					</div>
					{#if current.room.topSlotMultiplier > 1}
						<div class="ts mult-tag" class:waiting={!tsLanded} bind:this={copyTsEl} use:sameWidth>
							{@render multTag(current.room.topSlotMultiplier)}
						</div>
					{/if}
				</div>
			</div>
		{/if}

		{#if slamShown}
			<!-- The multiplier, up big over the name before it is slammed onto it (`slamMultiplier`). -->
			<div
				class="mult-slam"
				style="--big:{titleBig}; --slam-over:{SLAM_OVER}; --slam-gap:{SLAM_GAP_VW}vw"
			>
				<div class="mult-tag" bind:this={slamEl} use:sameWidth>
					{@render multTag(current.room.topSlotMultiplier)}
				</div>
			</div>
		{/if}

		{#if centreSays && result !== null}
			<div class="centre-result" bind:this={resultEl}>
				<MultiplierBurst value={result} rays shown={resultShown} from={resultFrom} />
			</div>
		{/if}
	</div>
{/if}

<style>
	.screen {
		position: absolute;
		inset: 0;
		z-index: 30;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: space-between;
		padding: 1.2vw 2vw 1.4vw;
		background:
			radial-gradient(
				ellipse at 50% 30%,
				color-mix(in srgb, var(--room-base) 55%, transparent) 0%,
				transparent 60%
			),
			linear-gradient(180deg, #120a18 0%, #05030a 100%);
		animation: screen-in 650ms cubic-bezier(0.2, 0.9, 0.2, 1) both;
	}
	.screen.lit {
		animation: none;
	}
	/* Up, but not yet drawn in: the wipe (VoyageReveal's `cross`) animates the clip off it. */
	.screen.wiping {
		clip-path: inset(0 0 0 100%);
	}
	/* Up, but a frame down, under the table: the camera coming down (PlinkoReveal's `fall`)
	   animates `translate` off it. */
	.screen.descending {
		translate: 0 100%;
	}
	.screen.closing {
		animation: screen-out 450ms ease-in both;
	}
	/* A room's own backdrop, over the flat gradient and under everything else. The scrim is what
	   keeps the title, the win line and the pocket labels readable over moving footage — without it
	   the video decides, frame by frame, how legible the round is. */
	.room-video-host {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}
	/* :global — the element is appended by `roomVideo`, so it never receives this component's scope. */
	.room-video-host :global(.room-video) {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: center;
	}
	.room-scrim {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background:
			radial-gradient(
				ellipse at 50% 40%,
				rgba(0, 0, 0, 0.15) 0%,
				rgba(0, 0, 0, 0.55) 70%,
				rgba(0, 0, 0, 0.75) 100%
			),
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--room-deep) 35%, transparent) 0%,
				transparent 45%
			);
	}
	/* The round's own furniture sits above the backdrop. A positioned element paints over static
	   ones whatever the DOM order, so these have to be positioned too rather than merely later. */
	.header,
	.stage,
	.footer {
		position: relative;
		z-index: 1;
	}
	/* Above the stage, not merely after it: Pirate Plinko stands its cannon up behind the plaque and
	   the top of the barrel is meant to disappear under the timber. */
	.header {
		z-index: 2;
	}
	@keyframes screen-in {
		from {
			transform: translateY(-100%);
		}
		to {
			transform: translateY(0);
		}
	}
	@keyframes screen-out {
		from {
			transform: translateY(0);
			opacity: 1;
		}
		to {
			transform: translateY(-100%);
			opacity: 0.6;
		}
	}
	/* Ocean Voyage runs edge to edge under the header, which hangs its title frame over the sky just
	   as every other room's does. */
	.helm-layer {
		position: absolute;
		inset: 0;
		z-index: 1;
	}
	.header {
		text-align: center;
		font-family: 'Alexandria', sans-serif;
	}
	/* The plaque, sized off its own art so the rope never stretches.
	
	   The picture carries empty air under the skulls — they stop at 0.857 of its height and the
	   rest is glow — so the box is pulled up by that much. Without it the header would end where
	   the FILE ends rather than where the sign does, and anything meant to sit under the sign, or
	   to disappear behind it, would be measuring against nothing. The margin is a share of the
	   WIDTH, which is what a percentage margin resolves against: 0.143 of the height over the
	   art's 2.373 ratio (1220x514, the glow below its foot 0.134 of the height). */
	.plate {
		position: relative;
		width: 28.6vw;
		aspect-ratio: 1220 / 514;
		margin-bottom: -5.6%;
		background: var(--title-frame) no-repeat center / 100% 100%;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	/* The room's name, cut in the game's own hand. Gold on a dark brown edge, a shadow dropped
	   under it and a yellow glow around it — the glow is listed FIRST so it paints over the
	   shadow rather than under it. `paint-order` keeps the stroke behind the glyph where a
	   browser honours it; where it does not, an edge this thin still reads as an edge. */
	.title {
		/* Laid INSIDE the timber rather than nudged towards it. The dark plank runs from 0.237 to
		   0.763 of the picture — measured off the file, not guessed — so its middle is 0.5, and this
		   band is centred 0.012 BELOW that: enough to sit low on the plank, not enough to crowd the
		   bottom rope. Both edges move together, so the text stays centred in the band and only the
		   band moves.

		   What this replaced was a percentage MARGIN, which resolves against the WIDTH — on a 2.27:1
		   sign that is more than twice the lift it looks like, which is why the text once sat high. */
		position: absolute;
		left: 14%;
		right: 14%;
		top: 22%;
		bottom: 19.6%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: 'PiecesOfEight', 'Alexandria', sans-serif;
		font-weight: 400;
		letter-spacing: 0.08vw;
		line-height: 1;
		white-space: nowrap;
		color: #f7c948;
		paint-order: stroke;
		/* In `em`, so it holds the same weight whatever size the name was cut at — a stroke fixed in vw
		   came out nearly twice as heavy on TREASURE CHEST as on BONUS WHEEL. */
		-webkit-text-stroke: 0.12em #3a1c07;
		text-shadow:
			0 0 0.55vw rgba(255, 216, 77, 0.85),
			0 0.18vw 0.3vw rgba(0, 0, 0, 0.9);
	}
	/* Hard up under the sign: the bottom rope runs at 0.819 of the picture and the skulls end at
	   0.857, so this starts between them and reads as stuck to the timber rather than floating
	   below it. */
	.badges {
		position: absolute;
		top: 88%;
		left: 50%;
		translate: -50% 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.3vw;
	}
	/* The multiplier over the skull at the top of the sign, dead centre. Only the size is set here —
	   the tag is `em`-based (`.mult-tag`). */
	/* Over the middle of the sign's bottom edge: the words start on the bottom planks and lie across
	   the rope (0.62-0.82 of the picture), and the number hangs under it. */
	.ts.mult-tag {
		position: absolute;
		top: 62%;
		left: 50%;
		translate: -50% 0;
		font-size: 1.7vw;
	}
	/* Hung under the sign's bottom rope, so the not-in line goes under it rather than over it. */
	.header.multiplied .badges {
		top: 116%;
	}
	/* Laid out but not shown, while the room's multiplier is still on its way up to it. */
	/* Laid out but not shown, while the room's name is still on its way up to it. */
	.plate.waiting {
		visibility: hidden;
	}
	/* The name, up big in the middle of the room before it is carried to the header. */
	.title-intro {
		position: absolute;
		inset: 0;
		z-index: 7;
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: none;
	}
	.title-dim {
		position: absolute;
		inset: 0;
		background: radial-gradient(
			ellipse at 50% 50%,
			rgba(0, 0, 0, 0.35) 0%,
			rgba(0, 0, 0, 0.7) 75%
		);
	}
	/* With no margin: centred on its own box, which is the box the real plate's rect is. */
	.title-copy {
		margin: 0;
	}
	/* Held up in the middle: a warm glow breathing round the sign. */
	.title-copy:global(.emph) {
		animation: title-glow 600ms ease-in-out both;
	}
	@keyframes title-glow {
		0%,
		100% {
			filter: drop-shadow(0 0 0 rgba(255, 210, 90, 0));
		}
		45% {
			filter: drop-shadow(0 0 1.6vw rgba(255, 210, 90, 0.85));
		}
	}
	:global(html[data-tier='lite']) .title-copy:global(.emph) {
		animation: none;
	}
	.ts.waiting {
		visibility: hidden;
	}
	/* The multiplier, held under the sign before it is slammed up onto it: hung a gap below the name's
	   foot (the name stands in the middle at `titleBig`, `--big`; half of it is 28.6vw / 2.373 / 2 =
	   6.03vw of it), a little bigger than the size it lands at on the sign (`.ts`, at the same
	   `--big`), so the slam is a stamp rather than a grow. `titleBig` is worked out so this fits on
	   the screen. Placed with the layer, not a translate, because the slam animates the tag's own
	   `translate`. */
	.mult-slam {
		position: absolute;
		left: 0;
		right: 0;
		top: calc(50% + 6.03vw * var(--big) + var(--slam-gap));
		z-index: 8;
		display: flex;
		justify-content: center;
		pointer-events: none;
	}
	.mult-slam .mult-tag {
		font-size: calc(1.7vw * var(--big) * var(--slam-over));
	}
	.mult-slam .mult-tag {
		opacity: 0;
	}
	/* BONUS MULTIPLIER over the number, both in the multiplier's own hand: the words are the same
	   letters, smaller. */
	.mult-tag {
		display: flex;
		flex-direction: column;
		align-items: center;
		line-height: 1;
		white-space: nowrap;
	}
	/* Each line's size is set by `sameWidth`; these only close up the stack. */
	.mult-tag .tag-line {
		line-height: 1;
		margin-bottom: 0.04em;
	}
	.not-in {
		font-size: 0.9vw;
		color: #d6c6b4;
	}
	.stage {
		display: flex;
		align-items: center;
		justify-content: center;
		flex: 1;
		min-height: 0;
	}
	.footer {
		height: 4.6vw;
	}
	/* Pirate Plinko gives the footer's height back to the stage. */
	.footer.folded {
		height: 0;
	}
	/* The result, dead centre on the screen and over everything the rooms draw. Sized to come out
	   the same as the Treasure Chest's number on its grown last chest (a quarter of a chest column,
	   times its zoom). */
	.centre-result {
		position: absolute;
		inset: 0;
		z-index: 5;
		display: grid;
		place-items: center;
		font-size: 8vw;
		pointer-events: none;
	}

	/* ---- Portrait ----------------------------------------------------------------------------
	   Everything here is authored in vw, and a portrait vw is about a third of a landscape one, so
	   the sign and its lettering are scaled back up to come out the same size on the screen. */
	:global(.game.portrait) .plate {
		width: 80.6vw;
	}
	:global(.game.portrait) .title {
		letter-spacing: 0.21vw;
	}
	:global(.game.portrait) .not-in {
		font-size: 2.2vw;
	}
	:global(.game.portrait) .ts {
		/* Bigger here, so started a little lower to keep the words off the room's name. */
		top: 67%;
		font-size: 6.6vw;
	}
	:global(.game.portrait) .footer {
		height: 11vw;
		/* The balance and the wager keep their corners over this screen; the footer's row sits above
		   the rail rather than on it, and the rooms were laid out against that. */
		margin-bottom: var(--rail-h, 0px);
	}
	:global(.game.portrait) .centre-result {
		font-size: 19vw;
	}
	/* The sign is 80.6vw across in portrait: 16.98vw from its middle to its foot at 1x. */
	:global(.game.portrait) .mult-slam {
		top: calc(50% + 16.98vw * var(--big) + var(--slam-gap));
	}
	:global(.game.portrait) .mult-slam .mult-tag {
		font-size: calc(6.6vw * var(--big) * var(--slam-over));
	}
	/* Pirate Plinko folds its footer away entirely, so there is nothing to lift off the rail. */
	:global(.game.portrait) .footer.folded {
		margin-bottom: 0;
	}
</style>
