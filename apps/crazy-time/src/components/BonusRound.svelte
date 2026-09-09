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
	import { SPOT_LABEL, SPOT_COLOUR, type Spot } from '../game/constants';
	import type { BookEventRoom } from '../game/typesBookEvent';
	import { playSound } from '../game/sound';
	import { staticUrl } from '../lib/staticUrl';

	import RoomPlinko from './rooms/RoomPlinko.svelte';
	import RoomWheel from './rooms/RoomWheel.svelte';
	import RoomChest from './rooms/RoomChest.svelte';
	import RoomTower from './rooms/RoomTower.svelte';

	type Props = {
		/** Cash value of one chip, for the win line. */
		chip: number;
		sign: string;
		/** Tall viewport: the rooms that care lay themselves out differently. */
		portrait?: boolean;
		/** True for the whole time the screen is up. */
		onOpenChange?: (open: boolean) => void;
	};
	let { chip, sign, portrait = false, onOpenChange }: Props = $props();

	const context = getContext();

	let current = $state<{ room: BookEventRoom; covered: boolean } | null>(null);
	let closing = $state(false);
	let result = $state<number | null>(null);
	let roomApi = $state<{ play: () => Promise<number> } | undefined>();

	/**
	 * A room can bring its own moving backdrop, which then shows through whatever it plays on. Only
	 * Plinko has one; the rest keep the flat room-tinted gradient, and a room with no entry here
	 * simply gets no video element.
	 *
	 * `muted` and `playsinline` are what let it start on its own — see `Background.svelte` for why.
	 * Nothing depends on playback: a browser that refuses leaves the gradient underneath showing.
	 */
	/**
	 * The board every room's name is written on. Its plaque — the timber inside the rope — runs
	 * from 0.14 to 0.86 across and 0.26 to 0.70 down, read off the file; the text is laid in that
	 * opening rather than in the middle of the picture, which the skull at the top pulls off centre.
	 */
	const TITLE_FRAME = staticUrl('img/title_frame.png');
	/**
	 * How big the room's name can be cut and still fit the timber.
	 *
	 * The names are not the same length — PLINKO is six characters and TREASURE CHEST fourteen — and
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

	const ROOM_VIDEO: Partial<Record<Spot, string>> = {
		plinko: staticUrl('videos/animated_background_plinko.mp4'),
	};

	const spotFor = (room: BookEventRoom): Spot =>
		room.type === 'plinkoBonus'
			? 'plinko'
			: room.type === 'wheelBonus'
				? 'wheel'
				: room.type === 'chestBonus'
					? 'chest'
					: 'tower';

	const fmt = (value: number) =>
		value >= 1000 ? `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k` : value.toFixed(2);

	context.eventEmitter.subscribeOnMount({
		bonusRound: async (event) => {
			onOpenChange?.(true);
			result = null;
			closing = false;
			current = { room: event.room, covered: event.covered };
			playSound('doorClose');
			await tick();
			await waitForTimeout(700); // screen slide-in
			try {
				result = (await roomApi?.play()) ?? event.room.total;
				await waitForTimeout(event.covered ? 2200 : 1400);
			} finally {
				closing = true;
				playSound('doorOpen');
				await waitForTimeout(450);
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
	{@const video = ROOM_VIDEO[spot]}
	<div class="screen" class:closing style="--room-base:{colour.base}; --room-deep:{colour.deep}">
		{#if video}
			<!-- svelte-ignore a11y_media_has_caption -- decor: the file carries no audio track -->
			<video class="room-video" src={video} autoplay muted loop playsinline preload="auto"></video>
			<div class="room-scrim"></div>
		{/if}

		<div class="header">
			<div class="plate" style="--title-frame:url('{TITLE_FRAME}')">
				<div class="title" style="font-size:{titleSizeVw(SPOT_LABEL[spot])}vw">
					{SPOT_LABEL[spot]}
				</div>
				{#if current.room.topSlotMultiplier > 1}
					<!-- Pinned to the corner of the sign, written the way every other multiplier in the
					     game is written rather than announced in a pill of its own. -->
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

		<div class="stage">
			{#if current.room.type === 'plinkoBonus'}
				<!-- Plinko shows what it paid in the middle of its own board rather than on the
				     screen's footer: the board is the biggest thing on the screen and the last place
				     anyone is looking is under it. -->
				<RoomPlinko
					bind:this={roomApi}
					room={current.room}
					interactive={current.covered}
					covered={current.covered}
					{portrait}
					{result}
					cash={result === null ? '' : `${sign}${fmt(result * chip)}`}
				/>
			{:else if current.room.type === 'wheelBonus'}
				<RoomWheel bind:this={roomApi} room={current.room} />
			{:else if current.room.type === 'chestBonus'}
				<RoomChest bind:this={roomApi} room={current.room} interactive={current.covered} />
			{:else}
				<RoomTower bind:this={roomApi} room={current.room} />
			{/if}
		</div>

		<div
			class="footer"
			class:shown={result !== null && current.room.type !== 'plinkoBonus'}
			class:folded={current.room.type === 'plinkoBonus'}
		>
			{#if result !== null && current.room.type !== 'plinkoBonus'}
				<div class="mult">x{result}</div>
				{#if current.covered}
					<div class="cash">WIN {sign}{fmt(result * chip)}</div>
				{:else}
					<div class="cash muted">would have paid {sign}{fmt(result * chip)} per chip</div>
				{/if}
			{/if}
		</div>
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
	.screen.closing {
		animation: screen-out 450ms ease-in both;
	}
	/* A room's own backdrop, over the flat gradient and under everything else. The scrim is what
	   keeps the title, the win line and the pocket labels readable over moving footage — without it
	   the video decides, frame by frame, how legible the round is. */
	.room-video {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: center;
		pointer-events: none;
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
	/* Above the stage, not merely after it: Plinko stands its cannon up behind the plaque and
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
		/* Laid INSIDE the timber rather than nudged towards it: the plaque's writing surface runs
		   from 0.173 to 0.757 of the picture, so the text is pinned to that band and centred in it.
		   The margin this replaces was a percentage, which resolves against the WIDTH — on a 2.27:1
		   sign that is more than twice the lift it looked like, which is why the text sat high. */
		position: absolute;
		left: 14%;
		right: 14%;
		top: 17.3%;
		bottom: 24.3%;
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
		   came out nearly twice as heavy on TREASURE CHEST as on PLINKO. */
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
	/* Perched on the sign's top-right corner, half on the rope and half off it. Only the size is
	   set here — the badge is `em`-based, and everything else about how a multiplier looks lives
	   in table.scss so the table and this screen cannot drift apart. */
	.ts {
		position: absolute;
		/* On the rope corner, not floating above the file's empty top margin: the sign's own top edge
		   is at 0.117 of the picture, so anything anchored to 0 lands in the glow above it. */
		top: 10%;
		right: 2%;
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
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		font-family: 'Alexandria', sans-serif;
		opacity: 0;
		transition: opacity 300ms ease;
	}
	.footer.shown {
		opacity: 1;
	}
	/* Plinko says it on its own board, so the footer gives its height back to the stage. */
	.footer.folded {
		height: 0;
	}
	.mult {
		font-size: 2.6vw;
		font-weight: 700;
		color: #ffe14d;
		line-height: 1;
		text-shadow: 0 0.2vw 0.6vw rgba(0, 0, 0, 0.8);
	}
	.cash {
		font-size: 1.1vw;
		font-weight: 600;
		color: #fff;
	}
	.cash.muted {
		color: #9aa3b4;
		font-weight: 400;
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
	}
	:global(.game.portrait) .mult {
		font-size: 6.4vw;
	}
	:global(.game.portrait) .cash {
		font-size: 2.8vw;
	}
</style>
