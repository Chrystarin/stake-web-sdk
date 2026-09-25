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
	import RoomOceanVoyage from './rooms/RoomOceanVoyage.svelte';
	import MultiplierBurst from './rooms/MultiplierBurst.svelte';

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
		 * it, with no slide and no door. False keeps the slide.
		 */
		coverExit?: (room: RoomSpot) => Promise<boolean>;
		/** True for the whole time the screen is up. */
		onOpenChange?: (open: boolean) => void;
	};
	let { portrait = false, entrance = 'slide', enter, coverExit, onOpenChange }: Props = $props();
	/** `entrance` as it stood when this screen went up: the light lifting must not start a slide. */
	let enteredAs = $state<'slide' | 'lit' | 'wipe' | 'descend'>('slide');
	/**
	 * An entrance still waiting on `enter`: the screen is held out of sight until it runs — clipped
	 * away for a wipe, a frame down for a descent.
	 */
	let held = $state(false);
	let screenEl: HTMLElement | undefined = $state();

	const context = getContext();

	let current = $state<{ room: BookEventRoom; covered: boolean } | null>(null);
	/**
	 * A room is played by hand only by the player who covered it. A replay has nobody at the table
	 * (it is a recording being watched, often by someone else), so its rooms play themselves out
	 * the way an uncovered room does, rather than sitting on a pick timer at every step.
	 */
	const handsOn = $derived(Boolean(current?.covered) && !isReplay());
	let closing = $state(false);
	let result = $state<number | null>(null);
	let roomApi = $state<{ play: () => Promise<number> } | undefined>();

	/**
	 * A room brings its own backdrop, which then shows through whatever it plays on. Three rooms have
	 * a moving one (a video, see `roomVideo`); the Treasure Chest has a still, the dragon's lair,
	 * painted from the preload's resident copy the same way the table's backdrop is, in a cut for
	 * each orientation. A room with neither keeps the flat room-tinted gradient.
	 *
	 * Nothing depends on video playback: a browser that refuses leaves the gradient underneath showing.
	 */
	const ROOM_STILL: Partial<Record<Spot, { landscape: string; portrait: string }>> = {
		chest: {
			landscape: 'img/treasure_chest/background_landscape.webp',
			portrait: 'img/treasure_chest/background_portrait.webp',
		},
	};
	const isVideoRoom = (spot: Spot): spot is VideoKey =>
		spot === 'piratePlinko' || spot === 'bonusWheel' || spot === 'oceanVoyage';
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

	context.eventEmitter.subscribeOnMount({
		bonusRound: async (event) => {
			const handed = entrance === 'wipe' || entrance === 'descend';
			enteredAs = handed && !enter ? 'slide' : entrance;
			held = enteredAs === 'wipe' || enteredAs === 'descend';
			onOpenChange?.(true);
			result = null;
			closing = false;
			current = { room: event.room, covered: event.covered };
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
				// A room resolves the moment it settles — for Pirate Plinko that is the frame the ball drops
				// into the pocket, with the card lit and the land sound going. The number is held back
				// from that frame rather than printed over it: the landing gets a beat of its own,
				// then the win comes up, then it is left up long enough to actually be read.
				const paid = (await roomApi?.play()) ?? event.room.total;
				await waitForTimeout(SETTLE_MS);
				result = paid;
				await waitForTimeout(WIN_HOLD_MS);
			} finally {
				const covered = await coverExit?.(spotFor(event.room)).catch(() => false);
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
					<!-- Struck over the skull at the top of the sign, written the way every other
					     multiplier in the game is written rather than announced in a pill of its own. -->
					<div class="ts mult-badge">
						<span class="mult-stroke" aria-hidden="true">{current.room.topSlotMultiplier}x</span>
						<span class="mult-fill">{current.room.topSlotMultiplier}x</span>
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

		<div class="stage" class:over-plaque={current.room.type === 'oceanVoyageRoom'}>
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
				<RoomChest bind:this={roomApi} room={current.room} interactive={handsOn} />
			{:else}
				<RoomOceanVoyage bind:this={roomApi} room={current.room} interactive={handsOn} {portrait} />
			{/if}
		</div>

		<!-- Empty now, but it keeps its height: the rooms' layouts (the wheel's frame, the chest's lift
		     off the floor) are measured against it. -->
		<div
			class="footer"
			class:folded={current.room.type === 'piratePlinkoRoom'}
			class:over-stage={current.room.type === 'oceanVoyageRoom'}
		></div>

		{#if centreSays && result !== null}
			<div class="centre-result">
				<MultiplierBurst value={result} rays />
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
	/* The one room that stands something ON the plaque rather than behind it: Ocean Voyage hangs
	   its caption off the bottom of the sign, over the rope. Nothing else in that room reaches the
	   header, so the whole stage can go over it. */
	.stage.over-plaque {
		z-index: 3;
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
	/* Laid over the skull at the top of the sign, dead centre. Only the size is set here — the badge
	   is `em`-based, and everything else about how a multiplier looks lives in table.scss so the
	   table and this screen cannot drift apart. */
	.ts {
		position: absolute;
		/* The head's own middle, read off the file: the bandana crosses it at 0.155 of the picture and
		   the jaw ends at 0.315, so the centre is 0.235 and this rounds it. The CROSSBONES are not
		   what to centre on — they spread wider and sit higher (knobs at 0.115), and aiming at them
		   lands the numeral up on the cranium. Both axes are shifted by half the badge rather than by
		   a guess, so the number stays on the skull whatever it is: `15x` and `2x` are not the same
		   width. */
		top: 24%;
		left: 50%;
		translate: -50% -50%;
		font-size: 2.4vw;
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
		font-size: 6vw;
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
	/* Pirate Plinko folds its footer away entirely, so there is nothing to lift off the rail. */
	:global(.game.portrait) .footer.folded {
		margin-bottom: 0;
	}
	/* Ocean Voyage stretches its board down the whole stage in portrait, and a footer row under it
	   was a band of empty water for all but the last second of the round. So the stage runs down to
	   the rail and the win line lands over the foot of the board instead — the harbour strip, which
	   the ship has left by the time there is a win to show. Over the stage, since the stage itself
	   stands over the header; and never in the way of a buoy while it is invisible. */
	:global(.game.portrait) .stage.over-plaque {
		margin-bottom: var(--rail-h, 0px);
	}
	:global(.game.portrait) .footer.over-stage {
		position: absolute;
		left: 0;
		right: 0;
		bottom: calc(1.4vw + var(--rail-h, 0px));
		margin-bottom: 0;
		z-index: 4;
		pointer-events: none;
	}
</style>
