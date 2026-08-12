<script lang="ts">
	/**
	 * The jackpot screen: a plinko round played on a panel that slides down over the game.
	 *
	 * Self-contained on purpose — it knows nothing about the game underneath it, takes the award
	 * ladder and the balance as props, and is driven by one call:
	 *
	 *     await jackpot.play(multiplier);
	 *
	 * which resolves once the panel has slid away again. The award is settled BEFORE the screen
	 * opens; the player chooses where to drop from, and the plan the ball follows is built to reach
	 * the pocket that award belongs to from wherever they let go (see board.ts / pockets.ts).
	 */
	import { tick } from 'svelte';

	import PlinkoBoard from './PlinkoBoard.svelte';
	import { shapeForPockets } from './board';
	import { buildPocketLadder, pocketForAward } from './pockets';
	import type { PlinkoBoardApi } from './types';

	type Props = {
		/** The awards this round can pay, in any order. Duplicates are ignored. */
		awards: readonly number[];
		/** Balance readout, already formatted and signed by the host. */
		balance: string;
		balanceLabel?: string;
		title?: string;
		/** Panel backdrop. */
		background?: string;
		/** Tint for the title glow — the host passes the winning colour. */
		accent?: string;
		/** Written before the value on a pocket label, e.g. `x` for `x200`. */
		prefix?: string;
		hint?: string;
		sounds?: { peg?: () => void; drop?: () => void; land?: () => void };
		autoDropAfterMs?: number;
		onMenu?: () => void;
	};

	const props: Props = $props();

	/** Mirrored by `.jp-screen`'s transition — the panel is not on the DOM outside a round. */
	const SLIDE_IN_MS = 560;
	const SLIDE_OUT_MS = 440;
	/** How long the landed pocket is left up before the panel goes. */
	const HOLD_MS = 1500;
	/**
	 * How long the word is held over the table before the screen comes down for it.
	 *
	 * The jackpot is announced on the board the player is already looking at, and only then is the
	 * board taken away — so the thing that just happened lands before the thing that follows from
	 * it starts.
	 */
	const ANNOUNCE_MS = 2000;

	const DEFAULT_ACCENT = '#ffe14d';

	const ladder = $derived(buildPocketLadder(props.awards));
	const shape = $derived(shapeForPockets(ladder.count));

	let board = $state<PlinkoBoardApi>();
	let mounted = $state(false);
	let open = $state(false);
	let armed = $state(false);
	/** The word over the table, before the screen comes down over it. */
	let announcing = $state(false);
	let accent = $state(DEFAULT_ACCENT);

	const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
	/**
	 * Two frames: one for the panel to be laid out off-screen, one for the browser to have a
	 * starting transform to animate FROM. One is enough on paper and drops the slide in practice,
	 * because the style lands in the same paint as the mount.
	 *
	 * Timed out rather than awaited outright — a backgrounded tab serves no frames at all, and this
	 * sits in the middle of a book sequence that has to finish either way.
	 */
	const nextFrame = () =>
		new Promise<void>((resolve) => {
			let done = false;
			const finish = () => {
				if (done) return;
				done = true;
				resolve();
			};
			requestAnimationFrame(() => requestAnimationFrame(finish));
			setTimeout(finish, 120);
		});

	const round = async (award: number, options?: { accent?: string }): Promise<void> => {
		accent = options?.accent ?? props.accent ?? DEFAULT_ACCENT;
		mounted = true;
		announcing = true;
		await tick();
		await nextFrame();
		// Announced on the table first, then the screen comes down over the word still standing
		// there — which is why it is not faded out: the panel is what takes it away.
		await wait(ANNOUNCE_MS);
		open = true;
		await wait(SLIDE_IN_MS);
		announcing = false;

		const active = board;
		if (active) {
			armed = true;
			const startStep = await active.arm();
			armed = false;
			await active.drop(pocketForAward(ladder, award, startStep));
			await wait(HOLD_MS);
		}

		open = false;
		await wait(SLIDE_OUT_MS);
		board?.reset();
		armed = false;
		announcing = false;
		mounted = false;
	};

	/** Rounds run one after another. Two at once would have them fighting over the one ball. */
	let queue = Promise.resolve();

	/**
	 * Play one jackpot round for `award`, resolving when the screen has closed again.
	 *
	 * `award` is whatever the RGS settled — the pocket it maps to is picked on the side the player
	 * dropped from, so a ball released on the right runs to the right-hand pocket of a pair. The
	 * choice is real; the outcome was never in it.
	 */
	export const play = (award: number, options?: { accent?: string }): Promise<void> => {
		const next = queue.then(() => round(award, options));
		queue = next.catch(() => {});
		return next;
	};
</script>

{#if mounted}
	{#if announcing}
		<!-- The word, over the table the player is still looking at. It sits UNDER the screen, so
		     the panel coming down is what carries it away. -->
		<div class="jp-announce" style="--accent:{accent}">
			<span>{props.title ?? 'JACKPOT'}</span>
		</div>
	{/if}

	<!-- Covers the game entirely: it is a screen, not an overlay, so nothing underneath is
	     readable through it and nothing underneath can be touched. -->
	<div
		class="jp-screen"
		class:open
		style="--accent:{accent}; --slide-in:{SLIDE_IN_MS}ms; --slide-out:{SLIDE_OUT_MS}ms; --bg:url('{props.background ??
			'/img/background.png'}')"
	>
		<div class="jp-bg"></div>

		<div class="jp-hud">
			<div class="jp-balance">
				<div class="jp-balance-chip"></div>
				<div class="jp-balance-text">
					<span class="jp-hud-lbl">{props.balanceLabel ?? 'Balance'}</span>
					<span class="jp-hud-val">{props.balance}</span>
				</div>
			</div>
			<div class="jp-menu" onclick={() => props.onMenu?.()} aria-hidden="true"></div>
		</div>

		<div class="jp-title">{props.title ?? 'JACKPOT'}</div>

		<!-- Directly under the title, where it is read on the way down to the board rather than
		     found afterwards at the far edge of the screen. -->
		<div class="jp-hint" class:show={armed}>
			{props.hint ??
				'Hold ball then slide left and right to choose starting position, release to drop ball.'}
		</div>

		<div class="jp-board">
			<PlinkoBoard
				bind:this={board}
				{shape}
				{ladder}
				{accent}
				prefix={props.prefix ?? 'x'}
				sounds={props.sounds}
				autoDropAfterMs={props.autoDropAfterMs}
			/>
		</div>
	</div>
{/if}

<style>
	/* The announcement, dead centre of the table and wearing the same gold as the win readout —
	   the two are the game telling you it paid, so they are said in the same voice. Under the
	   screen's z-index on purpose: the panel sliding down is what takes the word off, rather than
	   it fading out and leaving a gap between the two. */
	.jp-announce {
		position: absolute;
		inset: 0;
		z-index: 59;
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: none;
	}
	.jp-announce span {
		font-family: 'DDIN', sans-serif;
		font-weight: 600;
		font-size: 6vw;
		line-height: 1;
		letter-spacing: 0.12em;
		text-indent: 0.12em;
		color: #f7de70;
		background: linear-gradient(#faab0a, #f3f353);
		-webkit-background-clip: text;
		background-clip: text;
		-webkit-text-fill-color: transparent;
		filter: drop-shadow(0 0.2vw 0.5vw rgba(0, 0, 0, 0.85))
			drop-shadow(0 0 1.4vw var(--accent, #ffe14d));
		animation: jp-announce-in 620ms cubic-bezier(0.2, 1.25, 0.35, 1) both;
	}
	/* Fades up and grows into place — it arrives rather than appearing. */
	@keyframes jp-announce-in {
		0% {
			opacity: 0;
			transform: scale(0.55);
		}
		100% {
			opacity: 1;
			transform: scale(1);
		}
	}

	/* Comes down over the game and goes back up the same way. Held off the DOM entirely between
	   rounds, so nothing here can take a tap meant for the table. */
	.jp-screen {
		position: absolute;
		inset: 0;
		z-index: 60;
		overflow: hidden;
		transform: translateY(-100%);
		transition: transform var(--slide-out) cubic-bezier(0.55, 0, 0.75, 0.3);
	}
	.jp-screen.open {
		transform: translateY(0);
		transition: transform var(--slide-in) cubic-bezier(0.2, 0.85, 0.3, 1);
	}
	/* The backdrop is its own layer so it can be darkened and vignetted without dimming the board
	   standing on it. */
	.jp-bg {
		position: absolute;
		inset: 0;
		background: var(--bg) no-repeat center / cover;
	}
	.jp-bg::after {
		content: '';
		position: absolute;
		inset: 0;
		background:
			radial-gradient(ellipse at 50% 42%, rgba(0, 0, 0, 0.12) 0%, rgba(0, 0, 0, 0.72) 100%),
			linear-gradient(180deg, rgba(6, 3, 0, 0.55) 0%, rgba(6, 3, 0, 0.3) 40%, rgba(6, 3, 0, 0.7) 100%);
	}

	/* HUD, matching the table's: balance top-left, menu top-right, on one shared mark size. */
	.jp-hud {
		--hud-mark: 3.2vw;
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		z-index: 4;
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		padding: 1vw 1.2vw;
		pointer-events: none;
	}
	.jp-balance {
		display: flex;
		align-items: center;
		gap: 0.7vw;
		font-family: 'Alexandria', sans-serif;
		text-shadow: 0 0.1vw 0.3vw rgba(0, 0, 0, 0.8);
	}
	.jp-balance-chip {
		width: var(--hud-mark);
		height: var(--hud-mark);
		flex: none;
		background: url('/img/chip_yellow.svg') no-repeat center / contain;
		filter: drop-shadow(0 0.1vw 0.2vw rgba(0, 0, 0, 0.6));
	}
	.jp-balance-text {
		display: flex;
		flex-direction: column;
	}
	.jp-hud-lbl {
		font-size: 0.95vw;
		font-weight: 500;
		letter-spacing: 0.05vw;
		text-transform: uppercase;
		color: #d6c6b4;
	}
	.jp-hud-val {
		font-size: 1.9vw;
		font-weight: 700;
		color: #ffe14d;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.jp-menu {
		width: var(--hud-mark);
		height: var(--hud-mark);
		cursor: pointer;
		pointer-events: auto;
		background: url('/img/menu_btn.svg') no-repeat center / contain;
	}

	/* The word, centred over the board. Tinted by `--accent` — the colour that took the triple —
	   so the screen carries something of the round that opened it. */
	.jp-title {
		position: absolute;
		top: 1.4vw;
		left: 0;
		right: 0;
		z-index: 3;
		text-align: center;
		font-family: 'Alexandria', sans-serif;
		font-weight: 700;
		font-size: 3.4vw;
		line-height: 1;
		letter-spacing: 0.28em;
		text-indent: 0.28em;
		color: #fff3c4;
		text-shadow:
			0 0 0.5vw rgba(0, 0, 0, 0.9),
			0 0 1.6vw var(--accent),
			0 0.2vw 0.5vw rgba(0, 0, 0, 0.8);
		opacity: 0;
	}
	/* Held back until the panel is actually coming down — a title that lands while the screen is
	   still off-stage has already been and gone by the time anyone can see it. */
	.jp-screen.open .jp-title {
		animation: jp-title-in 620ms cubic-bezier(0.2, 1.3, 0.35, 1) 240ms both;
	}
	@keyframes jp-title-in {
		0% {
			opacity: 0;
			transform: translateY(-1.4vw) scale(0.86);
		}
		100% {
			opacity: 1;
			transform: none;
		}
	}

	/* Everything from under the caption to the bottom edge belongs to the board, which sizes itself
	   to whatever box it is given (see board.ts). The side inset is what makes that box one the
	   board can actually FILL: a full-width strip here is far wider than a plinko field's natural
	   proportions, and the board would only centre itself in it and leave the rest empty. */
	/* Scaled by resizing the BOX rather than transforming the board: the board fills whatever box
	   it is given, so scaling the box on both axes scales the board with it — and it stays laid out
	   in real pixels, so pegs and labels stay crisp instead of being resampled.
	   70 x 45.65vw -> 0.7 -> 49 x 31.95vw -> 1.1 -> 53.9 x 35.15vw, kept centred in the space under
	   the caption. */
	.jp-board {
		position: absolute;
		left: 23.05vw;
		right: 23.05vw;
		top: 14.15vw;
		bottom: 6.95vw;
		z-index: 2;
	}

	.jp-hint {
		position: absolute;
		left: 12vw;
		right: 12vw;
		top: 5.6vw;
		z-index: 3;
		text-align: center;
		font-family: 'Alexandria', sans-serif;
		font-size: 1.05vw;
		letter-spacing: 0.04em;
		color: #e6d7bd;
		text-shadow: 0 0.1vw 0.3vw rgba(0, 0, 0, 0.85);
		opacity: 0;
		transition: opacity 260ms ease;
		pointer-events: none;
	}
	/* Fades in and holds steady. It is an instruction to read once, so it has no business
	   competing with the ball for attention — the ball is the thing that pulses. */
	.jp-hint.show {
		opacity: 1;
	}
</style>
