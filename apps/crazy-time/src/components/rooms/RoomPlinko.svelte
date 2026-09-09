<script lang="ts">
	/**
	 * Plinko room: Colour Dice's jackpot plinko board (`src/plinko`), played inside the bonus
	 * screen this game already has.
	 *
	 * The board is the whole room — no title, no HUD, no slide of its own — because `BonusRound`
	 * supplies all of that. What comes over is the part that matters: a real Galton fall onto a
	 * ladder of pockets, with the player choosing where to let the ball go.
	 *
	 * The award is still the book's. `room.board` is the paytable with the Top Slot already in it,
	 * and the math writes it as a palindrome — cheapest in the middle, dearest at both edges — so
	 * it rebuilds as exactly the ladder the module wants. The pocket the ball is sent to is chosen
	 * from `room.total` and the side the player dropped from, which is the mirror twin of the
	 * book's own `slot` at worst: same value, shorter path. `room.dropZone` goes unused, because
	 * choosing where to drop from is now the player's job.
	 */
	import { PlinkoBoard, buildPocketLadder, pocketForAward, shapeForPockets } from '../../plinko';
	import type { PlinkoBoardApi } from '../../plinko';
	import type { BookEventPlinkoBonus } from '../../game/typesBookEvent';
	import { playSound } from '../../game/sound';
	import { staticPath } from '../../lib/staticUrl';

	type Props = {
		room: BookEventPlinkoBonus;
		/** False when the player was not in this bonus: the ball lets itself go. */
		interactive?: boolean;
	};
	let { room, interactive = true }: Props = $props();

	/** How long the ball waits for a player who is there, and for one who is only watching. */
	const HELD_MS = 12000;
	const TEASE_MS = 700;

	/**
	 * A lit bomb falls instead of a ball. `cx`/`cy`/`d` are the sphere inside `bomb.png`, measured
	 * off the file (centre 206.5, 304.5 of 512; 414 across), so the bomb strikes the pegs on its
	 * body while the fuse and its sparks hang off the top-right without pushing it around.
	 */
	const BOMB = {
		src: staticPath('img/plinko/bomb.png'),
		cx: 0.403,
		cy: 0.595,
		d: 0.809,
		// The board is sized by its 13 pockets, which leaves a ball too small to read a drawing in.
		scale: 1.9,
	};
	/**
	 * The glow behind it. The bomb is nearly black on a dark field over a dark video, so the light
	 * is what makes it findable — an ember, in the colour of the fuse rather than of the room.
	 */
	const GLOW = '#ff8a1f';
	/** Open enough for the video to read through, closed enough for the pegs to stay legible. */
	const FIELD_OPACITY = 0.42;

	/**
	 * A pocket card is about five characters wide, and the Top Slot can put a x15 in front of a
	 * 400 — so the thousands are written the way the rest of the game writes them, as `k`.
	 */
	const label = (value: number): string =>
		value >= 1000 ? `x${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k` : `x${value}`;

	const ladder = $derived(buildPocketLadder(room.board));
	const shape = $derived(shapeForPockets(ladder.count));

	let board = $state<PlinkoBoardApi>();
	let armed = $state(false);

	export const play = async (): Promise<number> => {
		const active = board;
		if (!active) return room.total;
		armed = true;
		const startStep = await active.arm();
		armed = false;
		await active.drop(pocketForAward(ladder, room.total, startStep));
		return room.total;
	};
</script>

<div class="plinko">
	<div class="board">
		<PlinkoBoard
			bind:this={board}
			{shape}
			{ladder}
			accent={GLOW}
			art={BOMB}
			fieldOpacity={FIELD_OPACITY}
			format={label}
			autoDropAfterMs={interactive ? HELD_MS : TEASE_MS}
			sounds={{
				drop: () => playSound('whoosh'),
				peg: () => playSound('peg', 0.9 + Math.random() * 0.2),
				land: () => playSound('merge'),
			}}
		/>
	</div>
	<div class="hint" class:shown={armed && interactive}>
		Hold the ball and slide to choose where it drops from — let go to release.
	</div>
</div>

<style>
	.plinko {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		width: 46vw;
		height: 100%;
	}
	/* The board fills whatever it is given, in both directions — see `layoutBoard`. The hint keeps
	   its line below it whether or not it is showing, so the board does not resize when it does. */
	.board {
		position: relative;
		flex: 1;
		width: 100%;
		min-height: 0;
	}
	.hint {
		height: 1.6vw;
		display: flex;
		align-items: center;
		font-family: 'Alexandria', sans-serif;
		font-size: 0.8vw;
		color: #d6c6b4;
		text-align: center;
		opacity: 0;
		transition: opacity 250ms ease;
	}
	.hint.shown {
		opacity: 1;
	}
</style>
