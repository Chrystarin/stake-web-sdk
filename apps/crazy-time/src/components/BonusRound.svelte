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
	import { staticCssUrl, staticUrl } from '../lib/staticUrl';
	import { adoptVideo, releaseVideo, type VideoKey } from '../lib/preloadAssets';

	import RoomPiratePlinko from './rooms/RoomPiratePlinko.svelte';
	import RoomBonusWheel from './rooms/RoomBonusWheel.svelte';
	import RoomChest from './rooms/RoomChest.svelte';
	import RoomOceanVoyageV2 from './rooms/RoomOceanVoyageV2.svelte';
	import MultiplierBurst from './rooms/MultiplierBurst.svelte';
	import RoomHint from './rooms/RoomHint.svelte';

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
		/** True for the whole time the screen is up. */
		onOpenChange?: (open: boolean) => void;
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
	 * A room brings its own backdrop, which then shows through whatever it plays on. Two rooms have
	 * a moving one (a video, see `roomVideo`); the Treasure Chest and Pirate Plinko have a still —
	 * the dragon's lair, and the beach at sunset — painted from the preload's resident copy the same
	 * way the table's backdrop is, in a cut for each orientation. A room with neither keeps the flat
	 * room-tinted gradient.
	 *
	 * Nothing depends on video playback: a browser that refuses leaves the gradient underneath showing.
	 */
	const ROOM_STILL: Partial<Record<Spot, { landscape: string; portrait: string }>> = {
		chest: {
			landscape: 'img/treasure_chest/background_landscape.webp',
			portrait: 'img/treasure_chest/background_portrait.webp',
		},
		piratePlinko: {
			landscape: 'img/pirate-plinko/background_landscape.webp',
			portrait: 'img/pirate-plinko/background_portrait.webp',
		},
	};
	const isVideoRoom = (spot: Spot): spot is VideoKey => spot === 'bonusWheel' || spot === 'oceanVoyage';
	/**
	 * The board every room's name is written on. Its plaque — the timber inside the rope — runs
	 * from 0.14 to 0.86 across and 0.26 to 0.70 down, read off the file; the text is laid in that
	 * opening rather than in the middle of the picture, which the skull at the top pulls off centre.
	 */
	const TITLE_FRAME = staticUrl('img/title_frame.png');
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
	 * The room's Top Slot multiplier, brought on once the screen is in — bought or landed on the
	 * wheel, whenever the Top Slot multiplied it. It is shown on a rope-framed board (`small_frame`),
	 * the words BONUS MULTIPLIER over the number (`multBoard`): up big in the middle of the room with
	 * a line under it saying what it does, left there to be read; then the line goes, and the whole
	 * board is carried up and shrunk onto the small copy of itself over the skull at the top of the
	 * title frame (`.ts`), which stays there for the round. The `.ts` board is laid out the whole time
	 * but kept invisible until the carried one lands on it, so the flight is aimed at the box it will
	 * actually occupy.
	 */
	let introShown = $state(false);
	/** The line under the big board, faded out (RoomHint's `shown`) just before the board moves. */
	let introSaid = $state(false);
	let tsLanded = $state(true);
	let introEl: HTMLElement | undefined = $state();
	let tsEl: HTMLElement | undefined = $state();
	/** The board the multiplier is shown on: `small_frame.png` cropped to its rope (1167×744). */
	const BOARD_ART = staticCssUrl('img/small_frame.webp');
	/** How long the whole board — and the line under it — is held up in the middle to be read; then
	    the line fades before the board moves. */
	const INTRO_HOLD_MS = 3000;
	const INTRO_SAID_OFF_MS = 300;
	const INTRO_FLY_MS = 750;
	/** What the multiplier does, under the big board: the Top Slot multiplies what the room pays.
	    Broken into two lines (RoomHint wants its lines given) so it fits a phone's width too. */
	const introLines = (multiplier: number) => ['Rewards are multiplied', `by x${multiplier} this round!`];

	const bringOnMultiplier = async () => {
		introShown = true;
		playSound('notify');
		await tick();
		introSaid = true;
		await waitForTimeout(INTRO_HOLD_MS);
		// The line under it goes first, so it is the board alone that moves.
		introSaid = false;
		await waitForTimeout(INTRO_SAID_OFF_MS);
		const from = introEl?.getBoundingClientRect();
		const to = tsEl?.getBoundingClientRect();
		if (introEl && from?.width && to?.width) {
			// Rects are on the screen, and the frame is zoomed to fit it: a translate is in the frame's
			// own pixels, so the distance is taken back out of the zoom (layout width vs drawn width).
			const zoom = introEl.offsetWidth ? from.width / introEl.offsetWidth : 1;
			const dx = (to.left + to.width / 2 - (from.left + from.width / 2)) / zoom;
			const dy = (to.top + to.height / 2 - (from.top + from.height / 2)) / zoom;
			playSound('whoosh');
			// The whole board — frame, words and number — carried up and shrunk onto its small copy.
			const frames = [
				{ translate: '0 0', scale: 1 },
				{ translate: `${dx}px ${dy}px`, scale: to.width / from.width },
			];
			await introEl
				.animate(frames, {
					duration: INTRO_FLY_MS,
					easing: 'cubic-bezier(0.32, 0.72, 0.24, 1)',
					fill: 'forwards',
				})
				.finished.catch(() => undefined);
		}
		tsLanded = true;
		introShown = false;
		playSound('pop');
	};

	context.eventEmitter.subscribeOnMount({
		bonusRound: async (event) => {
			const handed = entrance === 'wipe' || entrance === 'descend';
			enteredAs = handed && !enter ? 'slide' : entrance;
			held = enteredAs === 'wipe' || enteredAs === 'descend';
			// Every room the Top Slot multiplied brings its multiplier on (`bringOnMultiplier`) before it
			// plays — a bought room, whose Top Slot the table never showed, and a wheel landing alike.
			const intro = event.room.topSlotMultiplier > 1;
			tsLanded = !intro;
			introShown = false;
			onOpenChange?.(true);
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
				await waitForTimeout(700); // screen slide-in
			}
			try {
				if (intro) await bringOnMultiplier();
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
				onOpenChange?.(false);
			}
		},
	});
</script>

<!-- The multiplier's board: the rope-framed timber, BONUS MULTIPLIER across it and the number under.
     All in `em`, so whatever sets the font size sets the board's: big in the middle of the room
     (`.intro-card`), small over the skull (`.ts`). -->
{#snippet multBoard(multiplier: number)}
	<div class="board-art"></div>
	<div class="board-label">Bonus Multiplier</div>
	<div class="mult-badge">
		<span class="mult-stroke" aria-hidden="true">{multiplier}x</span>
		<span class="mult-fill">{multiplier}x</span>
	</div>
{/snippet}

{#if current}
	{@const spot = spotFor(current.room)}
	{@const colour = SPOT_COLOUR[spot]}
	{@const still = ROOM_STILL[spot]?.[portrait ? 'portrait' : 'landscape']}
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
		{#if still}
			<div class="room-still" style="--room-still:{staticCssUrl(still)}"></div>
		{/if}
		<div class="room-scrim"></div>

		<div class="header">
			<div class="plate" style="--title-frame:url('{TITLE_FRAME}')">
				<div class="title" style="font-size:{titleSizeVw(SPOT_LABEL[spot])}vw">
					{SPOT_LABEL[spot]}
				</div>
				{#if current.room.topSlotMultiplier > 1}
					<!-- Over the skull at the top of the sign: the multiplier's board, small, where the big one
					     brought on in the middle of the room lands and stays. -->
					<div
						class="ts mult-board"
						class:waiting={!tsLanded}
						bind:this={tsEl}
						style="--board-art:{BOARD_ART}"
					>
						{@render multBoard(current.room.topSlotMultiplier)}
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

		{#if introShown}
			<div class="intro-mult">
				<!-- The board, big, and under it what it does; the whole board is what flies (`introEl`). -->
				<div class="intro-card mult-board" bind:this={introEl} style="--board-art:{BOARD_ART}">
					{@render multBoard(current.room.topSlotMultiplier)}
				</div>
				<div class="intro-said">
					<RoomHint
						lines={introLines(current.room.topSlotMultiplier)}
						shown={introSaid}
						size="1.4vw"
						portraitSize="3.8vw"
					/>
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
	.room-still {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: var(--room-still) no-repeat center / cover;
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
	   art's 2.266 ratio. */
	.plate {
		position: relative;
		width: 28.6vw;
		aspect-ratio: 775 / 342;
		margin-bottom: -6.3%;
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
	/* The multiplier's small board, laid over the skull at the top of the sign, dead centre. Only the
	   size is set here — the board is `em`-based (`.mult-board`). Centred a little above the head's
	   own middle (0.235 of the picture), and small enough that its foot stays clear of the room's
	   name on the timber below it. */
	/* `.mult-board` is laid out `relative` (and comes later), so this names both to stay absolute. */
	.ts.mult-board {
		position: absolute;
		top: 20%;
		left: 50%;
		translate: -50% -50%;
		font-size: 1.7vw;
	}
	/* The words on the small board, a little larger against its number than on the big one: at this
	   size the big board's proportion leaves them too small to read. Still inside the rope. */
	.ts .board-label {
		font-size: 0.33em;
		letter-spacing: 0.02em;
	}
	/* Laid out but not shown, while the room's multiplier is still on its way up to it. */
	.ts.waiting {
		visibility: hidden;
	}
	/* The room's multiplier, up big in the middle before it is carried to `.ts`: the same size
	   as the round's result (`.centre-result`), popped in past its size and settled. */
	.intro-mult {
		position: absolute;
		inset: 0;
		z-index: 6;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.4vw;
		font-size: 8vw;
		pointer-events: none;
	}
	/* The big board pops in past its size and settles, words, number and all. */
	.intro-card {
		animation: intro-mult-in 520ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
	}
	/* The line under it takes its own size (RoomHint's `size`), not the board's. */
	.intro-said {
		font-size: 1rem;
	}
	/* The board, sized off the number (`em`): wide enough for the words across it and the number
	   under them on the planks inside the rope. */
	.mult-board {
		position: relative;
		width: 4em;
		aspect-ratio: 1167 / 744;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		/* The planks run from 0.12 to 0.9 of the picture's height: the words and the number are
		   centred on that rather than on the rope. */
		padding-top: 0.05em;
	}
	.board-art {
		position: absolute;
		inset: 0;
		background: var(--board-art) no-repeat center / 100% 100%;
		filter: drop-shadow(0 0.04em 0.08em rgba(0, 0, 0, 0.6));
	}
	/* BONUS MULTIPLIER, in the title frame's lettering (`.title`): gold, edged in dark brown, glowing. */
	.board-label {
		position: relative;
		margin-bottom: 0.08em;
		font-family: 'PiecesOfEight', 'Alexandria', sans-serif;
		font-size: 0.28em;
		font-weight: 400;
		letter-spacing: 0.04em;
		line-height: 1;
		text-transform: uppercase;
		white-space: nowrap;
		color: #f7c948;
		paint-order: stroke;
		-webkit-text-stroke: 0.12em #3a1c07;
		text-shadow:
			0 0 0.25em rgba(255, 216, 77, 0.85),
			0 0.06em 0.1em rgba(0, 0, 0, 0.9);
	}
	.mult-board .mult-badge {
		position: relative;
		white-space: nowrap;
		line-height: 1;
	}
	@keyframes intro-mult-in {
		from {
			scale: 0.2;
			opacity: 0;
		}
		40% {
			opacity: 1;
		}
		to {
			scale: 1;
			opacity: 1;
		}
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
		font-size: 4.5vw;
	}
	:global(.game.portrait) .footer {
		height: 11vw;
		/* The balance and the wager keep their corners over this screen; the footer's row sits above
		   the rail rather than on it, and the rooms were laid out against that. */
		margin-bottom: var(--rail-h, 0px);
	}
	:global(.game.portrait) .centre-result,
	:global(.game.portrait) .intro-mult {
		font-size: 19vw;
	}
	/* Pirate Plinko folds its footer away entirely, so there is nothing to lift off the rail. */
	:global(.game.portrait) .footer.folded {
		margin-bottom: 0;
	}
</style>
