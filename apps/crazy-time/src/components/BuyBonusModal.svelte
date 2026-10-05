<script lang="ts">
	/**
	 * The Buy Bonus screen, ported from apps/plinko's BuyBonusModal: one card per room buy, each
	 * priced at the current chip, with the tray's own chips on the screen itself so the prices
	 * re-price live. Activate hands the buy to the game, which raises the Yes/No prompt.
	 *
	 * The look and the grid are the Plinko ones (four cards, panel frame, gold plates, PiecesOfEight
	 * title); what changed is the content of a card: the room's own badge instead of a chest, and its
	 * max win instead of a free-ball count. Any Bonus is not a card: it sits in its own bar under the
	 * chip, in the chip's frame, with just its name, price and Activate.
	 *
	 * A card's badge is the room's own icon, and it behaves like the one on the wheel and the bet
	 * tiles: hovering Activate plays the room's motion on it, a bought room is walked into by that
	 * badge popping out of its card (the caller flies it, off `artRect`, while `lifted` keeps the
	 * card's own copy hidden). The way back out ends on the table, on the room's wedge.
	 */
	import { tick } from 'svelte';
	import { stateBet } from 'state-shared';

	import {
		BUY_MODES,
		BUY_MODE_NAMES,
		ICON_MOTION_MS,
		ROOM_ICON,
		buyPrice,
		maxWinForMode,
		motionOf,
		type RoomSpot,
	} from '../game/constants';
	import { stateGame, stateGameDerived } from '../game/stateGame.svelte';
	import { playSound } from '../game/sound';
	import { staticUrl } from '../lib/staticUrl';
	import Chip from './Chip.svelte';
	import { formatBalance, formatMoney } from '../game/currency';
	import { CHIP_FLIGHT_MS, CHIP_GROW_MS, CHIP_TRAVEL_MS } from '../game/chips';

	type Props = {
		open: boolean;
		/** Disabled while a round is in progress (can't buy mid-round). */
		disabled?: boolean;
		/**
		 * A room buy is out and its book not back yet: the screen stays up, and cannot be closed,
		 * until the game takes the player straight into the room.
		 */
		busy?: boolean;
		/** The room whose badge is off its card — in the air, or in the room — so the card shows none. */
		lifted?: RoomSpot | null;
		/**
		 * How the screen goes when `open` drops: 'pan' (the player closed it) at once, since the
		 * caller has already panned it off the left-hand edge (Game.svelte `panBuy`, which also brings
		 * it in); 'fade' (a bought room took over, or the buy failed) is the plain short fade it
		 * always had.
		 */
		exit?: 'pan' | 'fade';
		onClose: () => void;
		onActivate: (mode: string) => void;
	};
	const props: Props = $props();

	/** Gone at once once panned off, or a short fade for any way out but the player's. */
	const leave = (_node: Element) =>
		props.exit === 'pan' ? { duration: 0 } : { duration: 220, css: (t: number) => `opacity: ${t}` };

	/** A line under each title, in the rooms' own voice. */
	const TAGLINE: Record<string, string> = {
		buy_any: 'THE WHEEL PICKS ONE\nOF THE FOUR BONUSES',
		buy_tc: 'TREASURE CHESTS AWAIT,\nONE IS DESTINED FOR YOU',
		buy_pp: 'SHOOT THE CANNONBALL\nDOWN THE PEG BOARD',
		buy_ov: 'SAIL THE SEAS,\nEARN RICHES',
		buy_bw: 'SPIN THE WHEEL\nOF MULTIPLIERS',
	};

	/** The four room buys get cards; the buy that can land on any room gets the bar under the chip. */
	const CARD_MODES = BUY_MODE_NAMES.filter((mode) => BUY_MODES[mode].rooms.length === 1);
	const ANY_MODE = BUY_MODE_NAMES.find((mode) => BUY_MODES[mode].rooms.length > 1);
	/** The Random Bonus bar is hidden for now; the buy itself stays in the math and the game. */
	const SHOW_ANY_BONUS = false;
	const anyShown = Boolean(ANY_MODE) && SHOW_ANY_BONUS;

	const roomOf = (mode: string) => BUY_MODES[mode].rooms[0] as RoomSpot;
	const art = (mode: string) => staticUrl(ROOM_ICON[roomOf(mode)].src);

	const artEls: Partial<Record<RoomSpot, HTMLImageElement>> = $state({});
	const cardEls: Partial<Record<RoomSpot, HTMLElement>> = $state({});

	/**
	 * Room `room`'s badge as it is drawn on its card, in client pixels: the art is `object-fit:
	 * contain` in its slot, so the picture is the slot's box shrunk to the drawing's own shape.
	 */
	export const artRect = (room: RoomSpot): DOMRect | null => {
		const img = artEls[room];
		const box = img?.getBoundingClientRect();
		if (!img || !box?.width || !box.height) return null;
		const aspect = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
		const w = Math.min(box.width, box.height * aspect);
		const h = w / aspect;
		return new DOMRect(box.left + (box.width - w) / 2, box.top + (box.height - h) / 2, w, h);
	};

	/** The screen itself, for the caller to carry along with a room's way in or out. */
	let backdropEl: HTMLElement | undefined = $state();
	export const backdrop = () => backdropEl ?? null;

	/**
	 * Hovering a card's Activate plays its badge's motion once through, the one it plays on the wheel
	 * and on its bet tile (`motionOf`, whose classes are Game.svelte's global `motion-*`). Mouse only,
	 * as on the tiles: a touch press here is the buy itself. A cue while it is playing is let go.
	 */
	let moving = $state<Partial<Record<RoomSpot, boolean>>>({});
	const motionTimers: Partial<Record<RoomSpot, ReturnType<typeof setTimeout>>> = {};
	function onActivateHover(event: PointerEvent, mode: string) {
		if (event.pointerType !== 'mouse' || props.disabled || !affordable(mode)) return;
		const room = roomOf(mode);
		if (moving[room]) return;
		moving[room] = true;
		motionTimers[room] = setTimeout(
			() => (moving[room] = false),
			ICON_MOTION_MS[motionOf(room)],
		);
	}

	const stakes = $derived(stateGameDerived.stakeOptions());
	const chip = $derived(stateGame.stake);

	/**
	 * The chip rail windows the tray the way the table's own tray does: the selected chip in the
	 * middle, its neighbours stepping down in size and strength, the window sliding as the choice
	 * moves. Seven at a time, as the tray shows them, on every screen.
	 */
	const RAIL_CHIPS = 7;
	const rail = $derived.by(() => {
		const total = stakes.length;
		const windowSize = Math.min(RAIL_CHIPS, total);
		const selected = Math.max(0, stakes.indexOf(chip));
		const start = Math.max(0, Math.min(selected - Math.floor(windowSize / 2), total - windowSize));
		return {
			windowSize,
			start,
			chips: stakes.map((value, index) => ({
				value,
				index,
				depth: Math.min(Math.abs(index - selected), 2),
				selected: index === selected,
				shown: index >= start && index < start + windowSize,
			})),
		};
	});

	/**
	 * The chip a room buy puts down on its card. On Yes it is flown off the rail onto the card's
	 * Activate button, at the rail's own chip size, by the very flight the table's chips fly onto
	 * their tiles (the global `chip-flight` and game/chips.ts timings: a swell, an arc across, a
	 * settle), and it stays there until the screen goes. The caller holds the room's entrance until
	 * `placeChip` resolves, so the badge only pops out once it is down.
	 */
	let cardChip = $state<{
		room: RoomSpot;
		value: number;
		index: number;
		/** Where it lands on the card, and where it takes off from, relative to that. */
		x: number;
		y: number;
		dx: number;
		dy: number;
		size: number;
		/** In the air: the table's `chip-flight`, in the table's flying-chip shadow. */
		flying: boolean;
	} | null>(null);
	let cardChipEl: HTMLElement | undefined = $state();

	export const placeChip = async (room: RoomSpot): Promise<void> => {
		const card = cardEls[room];
		const button = card?.querySelector('.bb-activate');
		const rail = backdropEl?.querySelector('.bb-chips .chip.selected');
		const index = stakes.indexOf(chip);
		if (!card || !button || !rail || index < 0) return;
		const cardBox = card.getBoundingClientRect();
		const buttonBox = button.getBoundingClientRect();
		const railBox = rail.getBoundingClientRect();
		// The rail chip's own size: its layout width, before the selected chip's 1.1 lift.
		const size = (rail as HTMLElement).offsetWidth;
		if (!cardBox.width || !size) return;
		// Down on the middle of the card's Activate button.
		const x = buttonBox.left + buttonBox.width / 2 - cardBox.left;
		const y = buttonBox.top + buttonBox.height / 2 - cardBox.top;
		const dx = railBox.left + railBox.width / 2 - (cardBox.left + x);
		const dy = railBox.top + railBox.height / 2 - (cardBox.top + y);
		cardChip = { room, value: chip, index, x, y, dx, dy, size, flying: true };
		// The table's two sounds, on the table's beats: the whoosh as it takes off, the pop as it
		// touches down.
		const sounds = [
			setTimeout(() => playSound('whoosh'), CHIP_GROW_MS),
			setTimeout(() => playSound('pop'), CHIP_GROW_MS + CHIP_TRAVEL_MS),
		];
		await tick();
		const el = cardChipEl;
		if (!el) {
			sounds.forEach(clearTimeout);
			return;
		}
		// Down when the flight ends — or, should the event never come (a background tab), when it
		// would have.
		await new Promise<void>((done) => {
			const timer = setTimeout(done, CHIP_FLIGHT_MS + 100);
			el.addEventListener(
				'animationend',
				() => {
					clearTimeout(timer);
					done();
				},
				{ once: true },
			);
		});
		if (cardChip?.room === room) cardChip.flying = false;
	};

	// Each time the screen comes up it starts with no chip on any card. Cleared on the way up rather
	// than the way down, so the chip fades out with the screen instead of vanishing mid-fade.
	$effect(() => {
		if (props.open) cardChip = null;
	});

	function pickChip(value: number) {
		if (props.disabled || value === chip) return;
		if (stateGameDerived.selectStake(value) === null) return;
		playSound('click');
	}

	const formatMult = (value: number) => `${value.toLocaleString('en-US')}x`;

	const price = (mode: string) => buyPrice(mode) * chip;
	const affordable = (mode: string) => price(mode) > 0 && price(mode) <= stateBet.balanceAmount;

	function close() {
		if (props.busy) return;
		playSound('click');
		props.onClose();
	}

	function activate(mode: string) {
		if (props.disabled || !affordable(mode)) return;
		props.onActivate(mode);
	}

	/**
	 * Activate fires on the PRESS, not the release (iOS: `click` is synthesised on touchend and is
	 * dropped after a swipe). The trailing click the browser still fires is swallowed within a short
	 * window; a click with no recent press (keyboard, assistive tech) still activates.
	 */
	const ACTIVATE_TRAILING_CLICK_WINDOW_MS = 800;
	let lastPointerActivateAt = -Infinity;

	function onActivatePointerDown(event: PointerEvent, mode: string) {
		if (!event.isPrimary) return;
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		lastPointerActivateAt = performance.now();
		activate(mode);
	}

	function onActivateClick(mode: string) {
		if (performance.now() - lastPointerActivateAt < ACTIVATE_TRAILING_CLICK_WINDOW_MS) return;
		activate(mode);
	}
</script>

{#if props.open}
	<div
		class="bb-backdrop"
		class:busy={props.busy}
		role="presentation"
		onclick={close}
		bind:this={backdropEl}
		out:leave
		style:--bb-bg-landscape={`url("${staticUrl('img/buy-bonus/background_landscape.webp')}")`}
		style:--bb-bg-portrait={`url("${staticUrl('img/buy-bonus/background_portrait.webp')}")`}
	>
		<!-- Landscape only: the captain, standing on the right of her cabin, with the column to her left. -->
		<img class="bb-character" src={staticUrl('img/buy-bonus/character.webp')} alt="" aria-hidden="true" />

		<div class="bb-modal" class:no-any={!anyShown} role="dialog" aria-label="Buy Bonus" onclick={(event) => event.stopPropagation()}>
			<button type="button" class="bb-close" aria-label="Close" onclick={close}>
				<img src={staticUrl('img/buy-bonus/close_btn.webp')} alt="" aria-hidden="true" />
			</button>

			<!-- The shadow is a copy of the word behind it (see `.bb-title-shadow`). -->
			<h2 class="bb-title"><span class="bb-title-shadow" aria-hidden="true">Buy Bonus</span>Buy Bonus</h2>

			<!-- The bet, chosen off the table's own chips. Every price below is cost x chip, so picking
			     another chip re-prices all five cards. A chip the balance does not cover is greyed out. -->
			<div class="bb-bet-row">
				<div class="bb-chips" class:locked={props.disabled} role="group" aria-label="Chip value">
					<div class="bb-chips-viewport" style="--slots:{rail.windowSize}">
						<div class="bb-chips-rail" style="--offset:{rail.start}">
							{#each rail.chips as c (c.value)}
								<div class="bb-chip-slot" class:shown={c.shown} style="--depth:{c.depth}">
									<Chip
										value={c.value}
										index={c.index}
										count={stakes.length}
										selected={c.selected}
										disabled={!stateGameDerived.canAffordStake(c.value)}
										onclick={() => pickChip(c.value)}
									/>
								</div>
							{/each}
						</div>
					</div>
				</div>
			</div>

			<!-- Random Bonus: the cards' own panel turned on its side, holding only the name, the price
			     and Activate, stacked. The frame is a pre-rotated copy of the art, not a CSS rotate. -->
			{#if ANY_MODE && anyShown}
				<div class="bb-any">
					<img class="bb-any-frame" src={staticUrl('img/buy-bonus/buy_bonus_panel_landscape.webp')} alt="" aria-hidden="true" />
					<h3 class="bb-any-title">{BUY_MODES[ANY_MODE].label}</h3>
					<p class="bb-card-desc bb-any-desc">{TAGLINE[ANY_MODE]}</p>
					<div class="bb-any-price">{formatMoney(price(ANY_MODE))}</div>
					<button
						type="button"
						class="bb-activate"
						disabled={props.disabled || !affordable(ANY_MODE)}
						onpointerdown={(event) => onActivatePointerDown(event, ANY_MODE)}
						onclick={() => onActivateClick(ANY_MODE)}
					>
						<img class="bb-activate-bg" src={staticUrl('img/buy-bonus/buy_bonus_button.webp')} alt="" aria-hidden="true" />
						<img class="bb-activate-bg bb-activate-bg--hover" src={staticUrl('img/buy-bonus/buy_bonus_button_hover.webp')} alt="" aria-hidden="true" />
						<span class="bb-activate-text">Activate</span>
					</button>
				</div>
			{/if}

			<div class="bb-cards">
				{#each CARD_MODES as mode (mode)}
					<div class="bb-card" bind:this={cardEls[roomOf(mode)]}>
						<img class="bb-card-frame" src={staticUrl('img/buy-bonus/buy_bonus_panel.webp')} alt="" aria-hidden="true" />
						{#if cardChip && cardChip.room === roomOf(mode)}
							<div
								class="bb-card-chip"
								bind:this={cardChipEl}
								class:flying={cardChip.flying}
								style="left:{cardChip.x}px; top:{cardChip.y}px; --chip-size:{cardChip.size}px; --from-x:{cardChip.dx}px; --from-y:{cardChip.dy}px; --to-x:0px; --to-y:0px; --flight-ms:{CHIP_FLIGHT_MS}ms"
								inert
								aria-hidden="true"
							>
								<Chip value={cardChip.value} index={cardChip.index} count={stakes.length} />
							</div>
						{/if}
						<div class="bb-card-inner">
							<h3 class="bb-card-title">{BUY_MODES[mode].label}</h3>
							<p class="bb-card-desc">{TAGLINE[mode]}</p>
							<div class="bb-card-art-slot" aria-hidden="true">
								<div class="bb-card-art-wrap" class:lifted={props.lifted === roomOf(mode)}>
									<img
										class="bb-card-art {moving[roomOf(mode)] ? `motion-${motionOf(roomOf(mode))}` : ''}"
										src={art(mode)}
										alt=""
										bind:this={artEls[roomOf(mode)]}
									/>
								</div>
							</div>
							<div class="bb-card-total">
								<span class="bb-free">{formatMult(maxWinForMode(mode))}</span>
								<span class="bb-free-label">Max Win</span>
							</div>
							<div class="bb-price">{formatMoney(price(mode))}</div>
							<button
								type="button"
								class="bb-activate"
								disabled={props.disabled || !affordable(mode)}
								onpointerenter={(event) => onActivateHover(event, mode)}
								onpointerdown={(event) => onActivatePointerDown(event, mode)}
								onclick={() => onActivateClick(mode)}
							>
								<img class="bb-activate-bg" src={staticUrl('img/buy-bonus/buy_bonus_button.webp')} alt="" aria-hidden="true" />
								<img class="bb-activate-bg bb-activate-bg--hover" src={staticUrl('img/buy-bonus/buy_bonus_button_hover.webp')} alt="" aria-hidden="true" />
								<span class="bb-activate-text">Activate</span>
							</button>
						</div>
					</div>
				{/each}
			</div>

			<!-- `stateBet.balanceAmount`, the very figure the prices are tested against. -->
			<p class="bb-balance">Balance: {formatBalance(stateBet.balanceAmount)}</p>
		</div>
	</div>
{/if}

<style>
	/* This is the one modal in the game that is allowed to SCROLL — and a scrolling overlay has two mobile
	   traps that a merely-centred one doesn't. Both are handled here; see the two notes below.
	   It should no longer ever need to: the PORTRAIT FIT block at the bottom of this stylesheet solves the
	   tier cards against the viewport's height, so the column fits by construction. The scroll stays as
	   the safety net behind that, which is exactly why these two traps still have to be kept shut — if it
	   ever does fire, it has to fire correctly.

	   ⚠️ Whatever you change, keep the pair intact: `svh` alone still leaves the top of an overflowing
	   column unreachable, and the `margin: auto` alone still centres inside a box taller than the
	   screen. QA hit both together on Brave for Android (the title scrolled off above the viewport and
	   the close button sat under the toolbar) while Chrome looked fine — Chrome's toolbar auto-hides, so
	   the column happened to fit and neither trap fired. */
	.bb-backdrop {
		position: fixed;
		inset: 0;
		/* (1) A `position: fixed` box is laid out against the LAYOUT viewport, which on Android Chromium
		   is the browser-chrome-HIDDEN height — so with a toolbar on screen (Brave keeps one that Chrome
		   hides on scroll) `inset: 0` describes a box taller than what the player can actually see, and
		   the part of it under the toolbar is simply unreachable. `svh` is the chrome-MAXIMISED height,
		   i.e. the smallest the visible area can ever be, so the overlay fits every chrome state of
		   every browser. Same unit and same reasoning as `.game-root` / `.plinko-app-shell`, which is
		   also why the strip this leaves uncovered when the toolbar does hide is a non-issue: the game
		   root ends there too, and what shows through is the flat dark body colour. Left after `inset` so a browser without `svh` keeps exactly the old behaviour.
		   `border-box` is required with it — there is no global box-sizing reset in this app, so a
		   content-box height of 100svh plus this padding would overflow the screen by the padding. */
		height: 100svh;
		box-sizing: border-box;
		/* Under the reveals (60): a bought room's badge flies out of its card over this screen. */
		z-index: 55;
		display: flex;
		/* (2) NOT `align-items: center` — that is the classic centred-scroll-container trap. When the
		   column is taller than the backdrop, centring splits the overflow evenly above and below, and
		   the half above is unscrollable: `scrollTop` cannot go negative, so the title and close button
		   are gone for good. `flex-start` here plus `margin: auto` on `.bb-modal` centres exactly as
		   before while it fits (auto margins split the free space) and falls back to top-aligned the
		   moment it doesn't (auto margins resolve to zero against negative free space), which keeps the
		   top of the column reachable. */
		align-items: flex-start;
		justify-content: center;
		/* The captain's cabin, one cut per orientation (the portrait one is swapped in below). On the
		   backdrop itself, so it neither scrolls with the column nor lags the screen when a bought room
		   pans it away. Black under it for the frame before the art paints. */
		background-color: #000;
		background-image: var(--bb-bg-landscape);
		background-position: center;
		background-size: cover;
		background-repeat: no-repeat;
		/* The safe-area insets are what hold the close button clear of a notch/cutout or a gesture bar;
		   `viewport-fit=cover` is set in app.html, so without them the overlay draws under both. They
		   add nothing (0px) on a desktop or an iframe, so the tuned landscape budget is untouched — see
		   the portrait override below for the one place that asks for more than 3vh. */
		padding: calc(3vh + env(safe-area-inset-top, 0px)) calc(2vw + env(safe-area-inset-right, 0px))
			calc(3vh + env(safe-area-inset-bottom, 0px)) calc(2vw + env(safe-area-inset-left, 0px));
		/* The shorthand above, restated as one value both FIT blocks at the foot of this stylesheet can
		   subtract from `100svh`. Declared here rather than per-orientation so it can never drift from
		   the padding it describes; portrait re-states it because it raises the top to a floor. */
		--bb-pad-y: calc(6vh + env(safe-area-inset-top, 0px) + env(safe-area-inset-bottom, 0px));
		overflow: auto;
		/* Keeps a flick inside the modal from chaining to the document once this list hits its end —
		   that chained scroll is what makes a mobile browser re-show its toolbar mid-gesture, resizing
		   the visible area under the player's finger. */
		overscroll-behavior: contain;
	}

	/* Portrait/mobile only: the close button hangs 8ui-px ABOVE the modal box (see `.bb-close`), so the
	   backdrop's own top padding is all that stands between it and the browser's toolbar. 3vh is ample
	   on a tall phone in the abstract, but this states an absolute floor so the button keeps a full
	   finger's clearance rather than a fraction of whatever the viewport happens to be. Portrait only
	   because landscape's vertical budget is spent to ~5px at the 1024×576 reference frame (see the
	   notes on `.bb-bet-row` and `.bb-balance`) and must not be charged for this. */
	@media (max-aspect-ratio: 1/1) {
		.bb-backdrop {
			background-image: var(--bb-bg-portrait);
			/* PORTRAIT UI SCALE. The root only scales --ui-px in LANDSCAPE (see +layout.svelte) — portrait
			   holds it at a flat 1px, which is why this column used to be a fixed 667px tall no matter how
			   short the viewport was, and why anything under ~730px of height scrolled. Re-pointing the
			   unit here makes the whole modal a uniform scale of its portrait reference self, exactly the
			   way the landscape rule does for 1024×576: every absolute length in this file is stated in
			   --ui-px, so one declaration moves the title, the four gaps, the balance and (through
			   --bb-card-w below) the tier cards together.
			   812 is the height this portrait layout was tuned at (375×812), and the `1px` cap is what
			   keeps a taller phone rendering EXACTLY as it does today — this only ever shrinks.
			   WIDTH is deliberately absent: the column's width budget is already 96vw (see `.bb-modal`),
			   so a second width term would double-count it and shrink the chrome on narrow phones for no
			   reason. Scoped to `.bb-backdrop`, so it reaches this modal's subtree and nothing else —
			   neither GameHud.scss nor BetPerBallField.svelte reads --ui-px. */
			--ui-px: min(1px, calc(100svh / 812));
			/* The backdrop's own vertical padding, restated as a value the card budget below can read, so
			   the two can never drift. Mirrors the shorthand in the base rule plus the floor below. */
			--bb-pad-y: calc(
				max(3vh, calc(34 * var(--ui-px))) + env(safe-area-inset-top, 0px) + 3vh +
					env(safe-area-inset-bottom, 0px)
			);
			padding-top: calc(max(3vh, calc(34 * var(--ui-px))) + env(safe-area-inset-top, 0px));
			/* The other scrollbar, and a portrait-only one. `.bb-close::after` pads the X's TAP target 8ui-px
			   past the button, which itself hangs 8ui-px past the modal's corner — 16ui-px of reach against
			   the 2vw the backdrop keeps on that side. Landscape has 20px of it and swallows the overhang;
			   portrait has ~8px, so the tap target stuck out and `overflow: auto` answered with a horizontal
			   scrollbar over an invisible box. Clipping X costs nothing: it trims dead hit area that was off
			   the side of the screen anyway, and the visible X still sits inside the viewport. */
			overflow-x: hidden;
		}
	}

	/* Every absolute length in this modal (px AND rem — rem is just as fixed, the app never rescales the
	   root font-size) is stated in --ui-px, so the tier grid is a uniform scale of its 1024×576 reference
	   self. Left raw, the cards keep their full-size chrome on Stake's 400×225 popout and the four tiers
	   no longer fit the frame. */
	.bb-modal {
		position: relative;
		/* The height the Random Bonus bar spends in the column, in --ui-px (133 tall, 16 below), for the
		   two FIT budgets to charge; 0 while the bar is hidden (`SHOW_ANY_BONUS`). */
		--bb-any-space: 149;
		/* Held as a variable because the portrait card budget has to divide it between the columns, and a
		   literal `100%` cannot be used there — that value is divided down into a font scale on `.bb-card`,
		   where a percentage would resolve against the font size instead of the grid. */
		--bb-modal-width: min(calc(1100 * var(--ui-px)), 96vw);
		width: var(--bb-modal-width);
		/* Carries the vertical centring that used to be `align-items: center` on the backdrop — and the
		   reason it moved (the top of an overflowing column being unreachable) is written up there.
		   Horizontally it does nothing the backdrop's `justify-content` wasn't already doing. */
		margin: auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		/* NO `gap` — deliberately. The column used to space its four blocks with `gap: 35.2ui-px` and
		   then trim that back with NEGATIVE margins on the bet row and the balance line. iOS Safari
		   (iPhone 15 / iOS 26.6, in the Stake Engine iframe and in a plain page alike) does not paint
		   the part of a flex item that a negative top margin pulls into the gap before it: the bet
		   plaque lost its top band and drop shadow, clipped dead straight at the row's un-margined
		   position, while every layout box measured exactly as Chromium's. Setting the row's margin to
		   0, hiding the title above it, or zeroing this gap each restored the paint — so the spacing
		   is now carried entirely by POSITIVE margins on the items (`.bb-bet-row`, `.bb-balance`),
		   which produce the same geometry to the pixel (measured on the device: row 72.1..138.5,
		   cards 151.7, balance 595.5 at 393×639 before and after). Do not reintroduce `gap` here. */
	}

	/* The buy is out: the close goes (nothing to back out of now) until the room takes over. */
	.bb-backdrop.busy .bb-close {
		visibility: hidden;
	}
	.bb-close {
		position: absolute;
		top: calc(-8 * var(--ui-px)); /* -0.5rem */
		right: calc(-8 * var(--ui-px));
		width: calc(41.6 * var(--ui-px)); /* 2.6rem */
		height: calc(41.6 * var(--ui-px));
		border: none;
		background: none;
		cursor: pointer;
		padding: 0;
		z-index: 2;
	}
	/* The X art is 41.6ui-px square, which lands under the ~44px a thumb needs and reads as "missed the
	   button" on a phone. This pads the HIT area out to ~58ui-px without touching how big the X draws —
	   growing the button itself would scale the delivered art with it. Cheap insurance rather than the
	   main fix: what actually put this button out of reach on Brave was the backdrop above it. */
	.bb-close::after {
		content: '';
		position: absolute;
		inset: calc(-8 * var(--ui-px));
	}
	.bb-close img {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	.bb-title {
		margin: 0;
		font-family: 'PiecesOfEight', serif;
		font-weight: 400;
		font-size: clamp(calc(32 * var(--ui-px)), 5vw, calc(54.4 * var(--ui-px))); /* 2rem … 3.4rem */
		letter-spacing: 0.02em;
		color: #f6c54a;
		/* A dark brown outline OUTSIDE the letters: `paint-order` lays the stroke under the fill, so half
		   of its 0.12em is hidden by the glyph and 0.06em shows round it, without thinning the gold.
		   (Where paint-order is not honoured on HTML text the stroke paints over the fill instead, which
		   only makes the edge read heavier.) In em, so it stays the same share of the title at every
		   size. */
		-webkit-text-stroke: 0.12em #3a1d0b;
		paint-order: stroke fill;
		/* A slight warm glow round the outlined word: a tight bright pass and a wide soft one. */
		text-shadow:
			0 0 0.18em rgba(255, 214, 120, 0.5),
			0 0 0.5em rgba(246, 168, 32, 0.38);
		/* Its own stacking context, so the shadow copy's z -1 puts it behind this word and nothing
		   else. `relative` places that copy in portrait, where the title is in the column's flow;
		   landscape makes it `absolute`, which serves as well. */
		position: relative;
		z-index: 0;
	}
	/* The shadow beneath the title — a crisp dark copy of the letters just under them and a soft one
	   that drops further. It cannot be a text-shadow on the title itself: the outline and the fill are
	   painted as two passes, each with its own shadows, so the fill's shadow lands ON the outline. So
	   it is a second copy of the word laid exactly under the first, same face and outline but painted
	   transparent, so all that shows of it is its shadow — which then falls behind the whole outlined
	   word. */
	.bb-title-shadow {
		position: absolute;
		inset: 0;
		z-index: -1;
		color: transparent;
		-webkit-text-stroke-color: transparent;
		/* The outline already reaches 0.06em past the letters, so the crisp copy drops twice that to
		   show clearly below it. */
		text-shadow:
			0 0.13em 0 rgba(18, 7, 1, 0.95),
			0 0.24em 0.2em rgba(0, 0, 0, 0.85);
		pointer-events: none;
		user-select: none;
	}

	/* Plain white readout under the tier grid — no plaque, no gold, so it reads as information rather
	   than as a fifth control. Sized between the card tagline and the free-ball count, and in --ui-px
	   like the rest of this modal so it scales with the frame (see the note on .bb-modal). */
	.bb-balance {
		/* 19.2ui-px = the column's 35.2ui-px (2.2rem) block gap less the 16ui-px this line used to trim
		   off it as a negative margin (same shared budget as the bet row — see the note there): the full
		   2.2rem under a 4-row column would push it past the reference frame. Stated as a positive margin
		   because the modal no longer has a `gap` — see `.bb-modal`. */
		margin: calc(19.2 * var(--ui-px)) 0 0;
		font-family: 'Alexandria', sans-serif;
		font-weight: 600;
		font-synthesis: none;
		font-size: clamp(calc(18 * var(--ui-px)), 2.1vw, calc(28 * var(--ui-px)));
		letter-spacing: -0.01em;
		color: #ffffff;
		text-shadow: 0 calc(2 * var(--ui-px)) calc(4 * var(--ui-px)) rgba(0, 0, 0, 0.85);
		white-space: nowrap;
	}

	.bb-cards {
		/* Grid shape, restated as data so the portrait fit block at the bottom of this file can solve a
		   card size against it without having to know which of the two grids is in play. */
		--bb-cols: 4;
		--bb-rows: 1;
		--bb-card-gap: calc(19.2 * var(--ui-px)); /* 1.2rem */
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: var(--bb-card-gap);
		width: 100%;
	}

	.bb-card {
		position: relative;
		aspect-ratio: 0.74;
		display: flex;
		/* ⚠️ Load-bearing on WebKit, and the reason this modal used to scroll on iOS while every
		   Chromium browser fitted. `aspect-ratio` only sets a box's PREFERRED size: a grid item still
		   carries `min-height: auto`, i.e. a floor of its own min-content height, and a floor taller
		   than the ratio simply wins — which pushed the card ~57ui-px past its ratio, twice over in
		   the portrait two-row grid, and overflowed the viewport by about the height of the balance
		   line and a button row. Zeroing the floor lets the ratio hold on both engines.
		   (The chest is out of flow now, so it can no longer be what raises that floor — but the
		   remaining rows still can on a narrow card, and the ratio is what every art percentage in
		   this file is stated against, so this must stay.) */
		min-height: 0;
	}

	/* The buy's chip on its card (`placeChip`), centred on its point by `transform` so the flight is
	   free to animate `translate` and `scale`. Over the rail it takes off from (`.bb-bet-row` is 3).
	   Put down exactly as the table puts a chip on a tile: the global `chip-flight` (Game.svelte) in
	   the table's flying-chip shadow, then the table's placed-chip shadow once it is down. */
	.bb-card-chip {
		position: absolute;
		z-index: 4;
		transform: translate(-50%, -50%);
		pointer-events: none;
		filter: drop-shadow(0 0.15vw 0.25vw rgba(0, 0, 0, 0.5));
	}
	.bb-card-chip.flying {
		animation: chip-flight var(--flight-ms) both;
		filter: drop-shadow(0 0.2vw 0.35vw rgba(0, 0, 0, 0.55));
	}

	.bb-card-frame {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: fill;
		pointer-events: none;
		user-select: none;
	}

	.bb-card-inner {
		position: relative;
		z-index: 1;
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		/* Design metrics: 24px of air above the title and 25px below the button on the 324×442 reference
		   card. ⚠️ Percentage padding resolves against the containing block's WIDTH on every side, top
		   and bottom included — so those two are 24/324 and 25/324, NOT /442. The 4% sides are what let
		   the two-line tagline run to ~90% of the card the way the design does; the button no longer
		   takes its width from this box (see .bb-activate), so widening it costs nothing there. */
		padding: 7.4% 4% 7.7%;
		gap: calc(4.48 * var(--ui-px)); /* 0.28rem */
	}

	.bb-card-title {
		margin: 0;
		font-family: 'PiecesOfEight', serif;
		font-weight: 400;
		/* px/vw based (NOT rem): the game halves the root font-size on narrow screens, so a rem title
		 * clamps tiny. 55px on the design's 324px-wide card = 0.17 of the card. The vw term is what actually holds
		 * that ratio: in landscape the card is 22.59vw wide (see the .bb-cards grid against
		 * --bb-modal-width), so 0.17 × 22.59 = 3.84vw. The --ui-px cap takes over past ~1146px, where
		 * the modal stops growing and the card settles at 260.6ui-px — 0.17 of which is 44. */
		/* Plinko's 44 cap and 3.84vw, cut to 37 and 3.2vw for this game's longer names: TREASURE, the
		 * widest word, measures 5.37em, and on the 231.36ui-px reference card the text column is
		 * 212.9ui-px, so 37 is what leaves it ~5% of air instead of running into the panel's rim. */
		font-size: clamp(calc(24 * var(--ui-px)), 3.2vw, calc(37 * var(--ui-px)));
		/* 52/55 in the design — tighter than a default, which is what keeps a two-word title like
		 * "Super Fury" from eating the tagline's row. */
		line-height: 0.95;
		color: #ffffff;
		text-shadow: 0 calc(4 * var(--ui-px)) calc(4 * var(--ui-px)) rgba(0, 0, 0, 0.8);
	}

	.bb-card-desc {
		margin: 0;
		/* Noto Sans, not the display face. Registered as a 100..900 VARIABLE in +layout.svelte, so any
		 * weight on that axis is a real interpolated instance — which is why this line, unlike the
		 * button label below, can actually be asked for a lighter cut.
		 * 600 rather than the design's 700: one step down, which lifts the tagline off the free-ball
		 * count and the title without going thin on a textured panel at ~11px. 500 is available if it
		 * should go lighter still; much below that and the drop shadow starts eating the strokes. */
		font-family: 'Noto Sans', sans-serif;
		font-weight: 600;
		font-synthesis: none;
		/* The design's 16px is 0.049 of its card, i.e. 1.11vw of the 22.59vw landscape card; 1.06vw
		 * keeps a little back because this is the one line in the card that can wrap, and a third line
		 * would push the art out of shape. The binding case is 1024×576, where the modal is 96vw
		 * rather than its 1100ui-px cap and the card is at its narrowest for a given --ui-px.
		 * MEASURED there, against the flex column's content width (NOT this <p>'s own box — it is a
		 * centred flex item, so it shrink-wraps to its text and always looks 100% full): the design's
		 * longest forced line, "A MASSIVE STARTING BATCH AND", needs 190.4px of the 212.5px available,
		 * so every tagline clears its measure by 12-35% at the tightest landscape size.
		 *
		 * ⚠️ The 8.2 FLOOR is the PORTRAIT size, not a landscape guard — in landscape the vw term is
		 * always the larger of the two (1.06vw against a floor that works out to 0.80vw when --ui-px
		 * is width-bound, and less still when it is not), so the floor only ever takes effect once the
		 * portrait rule at the foot of this file re-points --ui-px at the CARD. There it is what sets
		 * the size outright, because 1.06vw on a phone is about 4px.
		 * Its value is set by the same forced line: uppercase at this weight and tracking runs 17.545×
		 * the font size, and a portrait card leaves 0.92 × 176ui-px = 161.9ui-px of measure, so
		 * anything above 9.23 wraps to a THIRD line and loses the design's two-line split. 8.2 keeps
		 * 12% in hand — and lands the tagline at 0.047 of the card, which is the 0.046 it is in
		 * landscape, so both orientations read at the same size relative to their card. */
		font-size: clamp(calc(8.2 * var(--ui-px)), 1.06vw, calc(12 * var(--ui-px)));
		line-height: 1.3;
		/* The `
` in each tagline (see BUY_BONUS_TIERS) is the design's own line break, so the two
		 * lines split where the comp splits them rather than wherever the measure runs out. `pre-line`
		 * and not `pre`: it honours the newline while still letting a line wrap further if a narrow
		 * card leaves it no room, so this can never push text off the panel. Other whitespace is
		 * collapsed as usual, so the source strings stay ordinary single-line literals. */
		white-space: pre-line;
		/* Tracked-out caps. Well inside the 0.16em the two-line wrap tolerates above — roughly a third
		 * of it — so there is room to open this further if it is ever wanted. */
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: #d4d0c4;
		text-shadow: 0 calc(4 * var(--ui-px)) calc(4 * var(--ui-px)) rgba(0, 0, 0, 0.7);
	}

	/* The art's stand-in in the flex column. It takes the card's whole slack, which pins the tagline
	 * (and title) to the top of the column and the free-ball count, price and button to the bottom —
	 * exactly where the comp puts them — while the chest itself hangs over the gap.
	 * `position: relative` is what makes this box, and not the card, the frame the chest is placed
	 * and centred against. */
	.bb-card-art-slot {
		position: relative;
		flex: 1 1 0;
		min-height: 0;
		width: 100%;
	}

	/* The chest and its sparkles as one block, so the cluster moves together. `left`/`width` arrive
	 * from `artStyle()`; the height is the image's own.
	 *
	 * `top: 50%` + the −50% translate is the CENTRING between the tagline and the count — the whole
	 * point of hanging the art here rather than at the comp's `top`; see the TIER_ART note. The
	 * translate (not `bottom: 50%` or a margin) because the box's height is intrinsic and unknown to
	 * the stylesheet.
	 *
	 * ⚠️ `z-index: -1` keeps the art BEHIND the card's text. `.bb-card-inner` is itself `z-index: 1`,
	 * so it opens a stacking context and a negative child cannot escape it — the chest lands above
	 * the panel art and below every row of type, which is what keeps the tagline crisp where the
	 * glow overlaps it. (The comp has the art on TOP of the text; it gets away with it because
	 * nothing there overlaps ink. Ours can, once the art is centred, so the order is flipped.) */
	.bb-card-art-wrap {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		z-index: -1;
		pointer-events: none;
		user-select: none;
	}

	/* No drop-shadow filter. The four renders bring their own cave backdrop and glow (that is most of
	 * what the canvas is), so a CSS shadow only greyed the halo's outer falloff — and, being a
	 * filter, it forced a separate compositing layer per card for nothing. */
	.bb-card-art {
		display: block;
		width: 100%;
		height: auto;
	}

	/* One sprite, sixteen placements — see TIER_SPARKLES. `left`/`top`/`width`/`opacity` all arrive
	 * from `sparkleStyle()`, relative to the chest's box; the art is square, so `height: auto`
	 * keeps it so. */
	.bb-card-sparkle {
		position: absolute;
		height: auto;
	}

	/* Count and label are ONE face in the comp — Noto Sans Black, differing only in fill — which is
	   what makes their cap heights line up. (The Figma layer names the count "Potato sans Black", but
	   a shape match of the comp's own "71" puts Noto Sans 900 at 0.93 IoU against PotatoSans's 0.52:
	   the display face is a good deal narrower and sits shorter per em, so taking the layer name here
	   left the number visibly small beside its label. The button's label IS PotatoSans — 0.76 there —
	   so this is a per-line fact, not a blanket one.) */
	.bb-card-total {
		display: flex;
		align-items: baseline;
		justify-content: center;
		gap: 0.33em;
		font-family: 'Noto Sans', sans-serif;
		font-weight: 900;
		font-synthesis: none;
		/* 30px on the design's 324px card = 0.0926 of it, i.e. 2.09vw of the 22.59vw landscape card;
		 * the cap is 0.0926 of the 260.6ui-px card the modal settles at. Both children inherit it. */
		/* Plinko's 24 cap and 2.09vw, cut to 21 and 1.85vw: "50,000x MAX WIN" is 9.18em against the
		 * free-ball count's much shorter line, and 21 keeps it inside the reference card's text column. */
		font-size: clamp(calc(16 * var(--ui-px)), 1.85vw, calc(21 * var(--ui-px)));
		/* Keep "<n> FREE BALLS" on one line even for the wide 3-digit tiers (matches the reference). */
		white-space: nowrap;
	}

	.bb-free-label {
		text-transform: uppercase;
		color: #ffffff;
		text-shadow: 0 calc(4 * var(--ui-px)) calc(5.8 * var(--ui-px)) #000000;
	}

	.bb-free {
		/* Face and weight come from .bb-card-total — see the note there. All this line adds is the fill. */
		/* Gold gradient fill clipped to the glyphs (reference design); the "FREE BALLS" label stays white. */
		background: linear-gradient(180deg, #f5b936 0%, #ebad26 56.7%, #d18a16 81.67%);
		-webkit-background-clip: text;
		background-clip: text;
		-webkit-text-fill-color: transparent;
		color: transparent;
		/* Belt and braces: .bb-card-total no longer sets one, but text-shadow IS inherited, and any
		 * shadow here would paint on top of the gradient (the same overlap bug the filter below fixes). */
		text-shadow: none;
		/* Use filter drop-shadow — NOT text-shadow. With background-clip:text the gradient paints in the
		 * element's background layer (behind), while text-shadow paints in the text layer (in front), so a
		 * text-shadow lands ON TOP of the gradient. drop-shadow composites the shadow behind the rendered
		 * glyphs, matching the reference (shadow behind the number). */
		/* All four in em, NOT --ui-px. The design's figures (4px, 1/2px, 28.5px) are for a 30px number
		 * on a 324px card; ours is 24px on a 260px one, so stating them raw made every pass ~19% too
		 * large — and on the glow that mattered: 28.5px against a 24px number is 1.19em, spread wide
		 * enough that it stopped reading as a glow at all and became a faint wash. em keeps each pass
		 * the same fraction of the glyphs it is lit from, at every card size.
		 *
		 * The glow is TWO passes because one cannot do both jobs. 0.5em is the tight, bright core that
		 * makes it read as a glow at a glance — the same 12px-on-24px this had before the restyle —
		 * and 0.95em is the design's own broad halo (its 28.5px, scaled), which alone is too diffuse
		 * to see against the textured panel. Chained, the second lights the first, so the falloff is
		 * continuous rather than two visible rings. */
		filter: drop-shadow(0 0.133em 0.133em #000000) drop-shadow(0.033em 0.067em 0 #000000)
			drop-shadow(0 0 0.5em rgba(237, 176, 42, 0.6))
			drop-shadow(0 0 0.95em rgba(237, 176, 42, 0.64));
	}

	.bb-activate {
		position: relative;
		/* 190.8px of the design's 324px card = 58.9% of it. `.bb-card-inner` leaves 92% of the card for
		   its text column (the tagline wants that width), so the button takes 64% of THAT to land on
		   the design's own width — and, through the aspect ratio below, its height. */
		width: 64%;
		/* The bottom of the card is now pinned by the PRICE line above (it carries the `margin-top: auto`
		   that used to live here); this button just follows it, with the card-inner bottom padding
		   leaving a small margin below. */
		/* Match the button image's native ratio (191×44) so the artwork isn't distorted. */
		aspect-ratio: 191 / 44;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: none;
		cursor: pointer;
		padding: 0;
		transition:
			transform 0.1s ease,
			filter 0.1s ease;
		/* Activate fires on `pointerdown` (see `onActivatePointerDown`), so a touch that starts here is
		   a press, never the start of a pan: `none` keeps the browser from claiming it for a scroll
		   (which would also mean a `pointercancel` racing the activation). No selection and no iOS
		   long-press callout for the same reason — the plate is a button, not text. */
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}

	.bb-activate-bg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: fill;
		pointer-events: none;
		user-select: none;
	}

	/* The blue plate rides on top of the gold one and is faded in on hover. Both are the same 191×44
	   art box, so they register exactly. */
	.bb-activate-bg--hover {
		opacity: 0;
		transition: opacity 0.12s ease;
	}
	/* :focus-visible too — a keyboard user gets the same read on which tier is armed.
	   The HOVER half is gated on a device that can actually hover. A touch screen has no hover, but a
	   tap still sets `:hover` on the target and LEAVES it there until the next tap lands elsewhere —
	   so on a phone the plate went blue on press and stayed blue after the prompt was dismissed, which
	   read as a stuck/selected button. `(hover: hover)` is false on touch-only devices, so they only
	   ever see the gold plate; the keyboard rule keeps working everywhere. */
	@media (hover: hover) {
		.bb-activate:hover:not(:disabled) .bb-activate-bg--hover {
			opacity: 1;
		}
	}
	.bb-activate:focus-visible:not(:disabled) .bb-activate-bg--hover {
		opacity: 1;
	}

	.bb-activate-text {
		position: relative;
		z-index: 1;
		/* The flex centring above centres this span's BOX; these two put the LETTERS in the middle of
		   the plate, which is not the same thing.
		   HORIZONTAL: letter-spacing is added after EVERY character, the last one included, so the box
		   carries one tracking's worth of empty air on its right and the word sits half that to the
		   left. The negative margin is exactly one tracking, so the box shrinks back to the word's own
		   advance and the centring lands on the letters. (A residual ~0.03em from the A and E having
		   different side bearings is left alone — it is sub-pixel here and would mean baking this one
		   string's metrics into the rule.)
		   VERTICAL: the line box reserves room under the baseline for descenders that an all-caps
		   label never uses, so its middle sits below the middle of the caps and the word rides high —
		   measured at 1.5px on the 18.5px label. 0.081em is that gap: half of the descent the caps
		   leave empty, derived from the face's own ascent/descent/cap metrics, so it holds at every
		   card size rather than only the one it was measured at. */
		margin-right: -0.07em;
		top: 0.081em;
		font-family: 'PotatoSans', sans-serif;
		/* 23px on the design's 324px card = 0.071 of it, which the existing 1.6vw already happened to
		 * be — only the caps moved (0.071 of the 260.6ui-px card the modal settles at). */
		font-size: clamp(calc(14 * var(--ui-px)), 1.6vw, calc(18.5 * var(--ui-px)));
		/* The design's own 1.61px on 23px. It only sets correctly alongside the inward stroke below —
		 * see the note there. */
		letter-spacing: 0.07em;
		text-transform: uppercase;
		/* White with a black outline. The design HAS this outline — it just doesn't survive Figma's
		 * code export, which reports the soft shadow alone; a 4× render of the button node measures a
		 * visible edge of 0.75–1ui-px on the 23px label.
		 *
		 * ⚠️ NO `paint-order: stroke fill` here, deliberately, and it is the only lever this label has
		 * on its weight: Potato sans ships as a single BLACK face (see +layout.svelte), so
		 * `font-weight` selects nothing and there is no lighter cut to ask for. Left at the CSS
		 * default the stroke paints OVER the fill, so the centred edge eats half its width back into
		 * every stem and thins the white letterforms towards the Bold the comp is set in.
		 * `paint-order: stroke fill` would put the fill back on top and restore the full Black weight.
		 * The design's 0.07em tracking depends on this: against the fatter un-eroded glyphs the word
		 * ran 4% wide and the letters drifted apart.
		 *
		 * That paint order is also why the width is 0.04em and not the 0.08em it would be if the edge
		 * sat outside the glyph. With the stroke centred, the WHOLE width reads as black — half
		 * outside the glyph and half in — so 0.04em is what draws the 0.92px band on a 23px label,
		 * inside the 0.75–1px the 4× render measures. Doubling it to get the same OUTER reach paints
		 * a band twice as heavy as the design's.
		 *
		 * Stated in em, NOT --ui-px, so the edge stays that fraction of the label at every card size.
		 * The four offset shadows carry the outer edge for anything without -webkit-text-stroke; the
		 * last one is the design's own soft drop shadow (1.467px on 23px). */
		color: #ffffff;
		-webkit-text-stroke: 0.04em #000000;
		text-shadow:
			0.02em 0.02em 0 #000000,
			-0.02em 0.02em 0 #000000,
			0.02em -0.02em 0 #000000,
			-0.02em -0.02em 0 #000000,
			0 0.064em 0.064em rgba(0, 0, 0, 0.25);
		white-space: nowrap;
	}

	/* Price line, sitting directly on top of the Activate button. It no longer inherits the button
	 * label's colour and outline (it used to live inside .bb-activate-text), so it restates the white
	 * fill + black edge that keeps small text legible over the textured panel.
	 * `margin-top: auto` moved down here with it: the price is now the first of the two bottom-pinned
	 * rows, so it — not the button — is what takes up the card's free space. */
	.bb-price {
		margin-top: auto;
		/* ⚠️ NOT the display face, even though the Figma layer is labelled "Potato sans Bold" — the
		 * shipped Potato_sans-Black.otf HAS NO `$` GLYPH (nor € or £), so this line would fall back
		 * mid-string and render the sign in a different face from the digits. The comp itself shows
		 * the substituted face rather than Potato sans for exactly that reason, and matching what the
		 * comp shows is also the only thing that can render every currency the game serves.
		 * Noto Sans Bold is that face: shape-matched against the comp's own "$80.00" at 0.85 IoU, ahead
		 * of Poppins Bold (0.80) and Instrument Sans Bold (0.67), and already the tagline's family. */
		font-family: 'Noto Sans', sans-serif;
		font-weight: 700;
		font-synthesis: none;
		/* 27px on the design's 324px card = 0.083 of it → 1.88vw of the 22.59vw landscape card, capped
		 * at 0.083 of the 260.6ui-px card the modal settles at. */
		font-size: clamp(calc(14 * var(--ui-px)), 1.88vw, calc(21.7 * var(--ui-px)));
		line-height: 1;
		/* Small gap to the button below; the pair reads as one price-and-buy block. */
		margin-bottom: calc(5 * var(--ui-px));
		/* The design drops the black outline this line used to carry, in favour of one soft drop
		 * shadow — the type is now big enough to hold its own against the textured panel. */
		color: #ffffff;
		text-shadow: 0 calc(3 * var(--ui-px)) calc(4.5 * var(--ui-px)) rgba(0, 0, 0, 0.79);
		white-space: nowrap;
	}

	/* Same hover gate as the blue plate above — a sticky touch `:hover` must not leave the button
	   sitting 1px high either. */
	@media (hover: hover) {
		.bb-activate:hover:not(:disabled) {
			/* No brightness lift any more — the gold-to-blue plate swap is the whole hover treatment, and
			   brightening on top of it only washed the blue out. */
			transform: translateY(-1px);
		}
	}
	.bb-activate:active:not(:disabled) {
		transform: translateY(1px);
	}
	.bb-activate:disabled {
		cursor: not-allowed;
		filter: grayscale(0.6) brightness(0.75);
	}

	/* Tablet / portrait — 2×2 grid.
	   ⚠️ Gated on the PORTRAIT aspect, not width alone. A 2×2 grid is twice as tall as 4×1, which is
	   fine on a tall phone but not in a short landscape frame: Stake's 400×225 popout is under 760px
	   wide, so the unqualified query used to flip it to 2×2 there and the second row fell off the
	   225px-tall viewport. `max-aspect-ratio: 1/1` is height ≥ width — the complement of the landscape
	   query --ui-px is defined under (routes/+layout.svelte), so the two can never both apply. */
	@media (max-width: 760px) and (max-aspect-ratio: 1/1) {
		.bb-cards {
			--bb-cols: 2;
			--bb-rows: 2;
			/* 7.2ui-px, not the 0.9rem this used to say: the app halves the root font-size on narrow
			   screens, so that rem resolved to 7.2px — the same number, but now it scales with the rest of
			   the column instead of standing still. */
			--bb-card-gap: calc(7.2 * var(--ui-px));
			grid-template-columns: repeat(2, 1fr);
			gap: var(--bb-card-gap);
		}
	}

	/* Landscape — 2×2 as well, in the column left of the captain (see CAPTAIN'S CABIN at the foot of
	   this stylesheet). The LANDSCAPE FIT below solves the card size against both rows; this `1fr` is
	   only what a browser without `svh` is left with. */
	@media (min-aspect-ratio: 1/1) {
		.bb-cards {
			--bb-cols: 2;
			--bb-rows: 2;
			--bb-card-gap: calc(12 * var(--ui-px));
			grid-template-columns: repeat(2, 1fr);
			gap: var(--bb-card-gap);
		}
	}

	/* ── PORTRAIT FIT ────────────────────────────────────────────────────────────────────────────────
	   The tier cards are the whole vertical budget: they carry a fixed `aspect-ratio`, so their HEIGHT
	   is decided by the modal's WIDTH, and in portrait that width is 96vw. Nothing in the column ever
	   consulted the viewport's HEIGHT, which is why a 375×667 phone overflowed by 54px and scrolled
	   while the same layout cleared 375×812 by 86px.

	   So the card is now sized from BOTH budgets and takes the smaller:
	     • WIDTH  — the modal's own width, split between the columns (what it always did), and
	     • HEIGHT — whatever `100svh` has left after the backdrop's padding and the other three blocks.
	   Everything else in the column is stated in --ui-px, which the portrait rule at the top of this
	   stylesheet now shrinks with `svh`, so the chrome gives ground on a short screen instead of
	   leaving the cards to absorb the whole shortfall. Together the two make the column fit by
	   construction at every portrait size — the backdrop keeps `overflow: auto` purely as a safety net
	   that should now never fire.

	   ⚠️ `188.9` + `--bb-any-space` is the rest of the column, in --ui-px, and has to be re-derived if
	   any of it changes
	   (the modal has no `gap`; every space is an item margin — see `.bb-modal`):
	       48.7  .bb-title       (42ui-px × the 1.16 line-height pinned below)
	       86.0  .bb-bet-row     (the 54.0ui-px chip pill — 64 x 260/308 — and two 16ui-px margins)
	      149.0  .bb-any         (133ui-px tall, 16ui-px margin below) — `--bb-any-space`, 0 while hidden
	       19.2  .bb-balance's margin-top
	       27.0  .bb-balance     (18ui-px × the 1.5 line-height pinned below)
	        8.0  slack, so a rounding or font-metric surprise costs a slightly smaller card rather than
	             a scrollbar
	   Both line-heights are pinned rather than left at `normal` so that sum is exact even before the
	   display faces have loaded.

	   @supports, because every one of these values is invalid on a browser without `svh` — and an
	   invalid `var()` in `grid-template-columns` computes to `none`, i.e. one card per row. Guarded, such
	   a browser simply keeps the pre-fit layout (which is all it could ever have had). */
	@supports (height: 100svh) {
		@media (max-aspect-ratio: 1/1) {
			.bb-title {
				/* Portrait drops the vw term — 5vw is only ~19px on a phone, so the clamp's --ui-px floor was
				   already winning; stating it plainly keeps the title a true multiple of the unit at every
				   height instead of catching on the vw preference once --ui-px shrinks. */
				font-size: calc(42 * var(--ui-px));
				line-height: 1.16;
			}

			.bb-balance {
				font-size: calc(18 * var(--ui-px));
				line-height: 1.5;
			}

			.bb-cards {
				--bb-cards-budget: calc(
					100svh - var(--bb-pad-y) - (188.9 + var(--bb-any-space)) * var(--ui-px)
				);
				/* The tighter of the two budgets. The height one is turned into a WIDTH by the same 0.74 the
				   card carries as its `aspect-ratio`, so one number can drive the tracks. The outer `max()` is
				   a floor for a viewport so short the budget goes negative — a negative track size would drop
				   the declaration outright and take the grid with it. */
				--bb-card-w: max(
					calc(48 * var(--ui-px)),
					min(
						calc(
							(var(--bb-modal-width) - (var(--bb-cols) - 1) * var(--bb-card-gap)) / var(--bb-cols)
						),
						calc(
							(var(--bb-cards-budget) - (var(--bb-rows) - 1) * var(--bb-card-gap)) /
								var(--bb-rows) * 0.74
						)
					)
				);
				/* Explicit tracks, not `1fr`: the cards have to be free to sit NARROWER than the modal once the
				   height budget is the binding one. `justify-content` then centres them under the title. */
				grid-template-columns: repeat(var(--bb-cols), var(--bb-card-w));
				/* The rows stated as plainly as the columns, by the same 0.74 the card carries as its
				   `aspect-ratio`. With `min-height: 0` above, the ratio alone would already hold the row —
				   but an auto row still SIZES to its items, so this makes the track a definite length that
				   the height budget solved for, rather than one that agrees with it. It also hands
				   `.bb-card-inner` a definite height, which every percentage inside the card — the chest's
				   `top`, the inner's own padding — resolves against. */
				grid-template-rows: repeat(var(--bb-rows), calc(var(--bb-card-w) / 0.74));
				justify-content: center;
			}

			/* The same trick as the backdrop, one level down: inside a card, "one pixel" means one pixel of a
			   REFERENCE CARD — 176ui-px across, which is what a card measures on the 375×812 phone this
			   layout was tuned at. Every size in the card (both headings, the tagline, the free-ball count,
			   the price, the button label, their strokes and shadows) is already stated in --ui-px, so this
			   one line keeps a card's contents a fixed fraction of the card at whatever size it lands on.
			   Without it the type held still while the card shrank, and the tagline overran the panel. */
			.bb-card {
				--ui-px: calc(var(--bb-card-w) / 176);
			}
		}
	}

	/* ── LANDSCAPE FIT ───────────────────────────────────────────────────────────────────────────────
	   The same solve as the PORTRAIT FIT above, for the other orientation, and it exists for the same
	   reason: the tier cards carry a fixed `aspect-ratio`, so their HEIGHT came entirely from the
	   modal's WIDTH and nothing in the column ever consulted the viewport's. That holds at the two
	   frames this layout was tuned against — 1024x576 clears by ~2px and Stake's 400x225 popout by
	   ~1px — but a PHONE IN LANDSCAPE is a far wider box than either (iPhone 15 measures 852x329 with
	   Safari's chrome on screen), so the width budget hands the cards more height than the viewport
	   has and the column scrolls.

	   So the card is sized from BOTH budgets and takes the smaller, exactly as portrait does:
	     • WIDTH  — the modal's width split between the columns (what it always did), and
	     • HEIGHT — whatever `100svh` has left once the rest of the column is paid for.

	   ⚠️ Unlike portrait's, this budget is not a MEASURED constant — every term below reads the same
	   knob as the declaration it accounts for (set on `.bb-backdrop` in CAPTAIN'S CABIN, so the
	   padding, the bet row and this grid all inherit one value), so the two cannot drift (the modal
	   has no `gap`; every space is an item margin — see `.bb-modal`):
	       --bb-pad-y                         the backdrop's padding, which includes the header at
	                                          the top of the screen (--bb-head-h: the title's line
	                                          and the balance's under it)
	       units + 2 x (16ui-px - units x 24/308), units = --bb-bet-units
	                                          .bb-bet-row: the same total as its chip pill
	                                          (units x 260/308) and two 16ui-px margins
	       --bb-any-space (133 + 16, or 0)    .bb-any, and its margin below
	   ⚠️ Re-derive it if the bet row's 16ui-px margin changes — that one is still a literal.
	   Both line-heights are pinned, as in portrait, so the sum is exact before the display faces load.
	   NO slack term here, deliberately: the reference frame clears its width budget by ~1.5px, and
	   slack would tip the min() over and shrink the cards on the very frame this was tuned at.

	   @supports for the same reason portrait needs it — every value here is invalid without `svh`, and
	   an invalid var() in `grid-template-columns` computes to `none`, i.e. one card per row. */
	@supports (height: 100svh) {
		@media (min-aspect-ratio: 1/1) {
			.bb-title {
				line-height: 1.2;
			}

			.bb-cards {
				--bb-cards-budget: calc(
					100svh - var(--bb-pad-y) -
						(
							var(--bb-bet-units) * var(--ui-px) + 2 *
								(16 * var(--ui-px) - var(--bb-bet-units) * var(--ui-px) * 24 / 308)
						) -
						var(--bb-any-space) * var(--ui-px)
				);
				/* The tighter of the two budgets, the height one turned into a WIDTH by the same 0.74 the
				   card carries as its `aspect-ratio`. The outer max() is the floor for a viewport so short
				   the budget goes negative — a negative track size drops the declaration and the grid with
				   it. */
				--bb-card-w: max(
					calc(48 * var(--ui-px)),
					min(
						calc(
							(var(--bb-modal-width) - (var(--bb-cols) - 1) * var(--bb-card-gap)) / var(--bb-cols)
						),
						calc(
							(var(--bb-cards-budget) - (var(--bb-rows) - 1) * var(--bb-card-gap)) /
								var(--bb-rows) * 0.74
						)
					)
				);
				grid-template-columns: repeat(var(--bb-cols), var(--bb-card-w));
				grid-template-rows: repeat(var(--bb-rows), calc(var(--bb-card-w) / 0.74));
				justify-content: center;
			}

			/* The portrait trick, one orientation over: inside a card "one pixel" is one pixel of a
			   REFERENCE CARD, so everything the card contains stays a fixed fraction of it once the height
			   budget starts shrinking it. 231.36 is what a card measured at 1024x576 in the old one-row
			   grid — (96vw - 3 x 19.2ui-px) / 4 — which is the size every type size in the card was tuned
			   at; the 2x2 grid's cards are smaller than that on most frames and scale down from it. The
			   `1px` cap keeps a card that is bigger still (a tall desktop) from scaling its contents UP. */
			.bb-card {
				--ui-px: min(1px, calc(var(--bb-card-w) / 231.36));
			}
		}
	}

	/* ── BET ROW ──────────────────────────────────────────────────────────────────────────────────
	   The buy is priced per chip, so the chip is chosen right here, off the table's own chips
	   (Chip.svelte) on the tray's dark pill. `--bb-bet-h` is the row's one size knob, and the row is
	   sized so it spends EXACTLY the height the old Plinko bet plate did: that plate was
	   `--bb-bet-h` tall with margins of 16ui-px less the 24/308 of it its art spent on a baked-in
	   shadow, so the pill is `--bb-bet-h` x 260/308 with plain 16ui-px margins. Both FIT budgets
	   below still count the row by the plate's formula — re-derive them if the height or the margin
	   changes. Sized in LAYOUT (no transform) for the same iOS reason as the cards. */
	.bb-bet-row {
		--bb-bet-h: calc(80 * var(--ui-px));
		--bb-pill-h: calc(var(--bb-bet-h) * 260 / 308);
		--chip-size: calc(var(--bb-pill-h) * 0.64);
		--chip-pitch: calc(var(--chip-size) * 1.25);
		position: relative;
		z-index: 3;
		display: flex;
		justify-content: center;
		margin: calc(16 * var(--ui-px)) auto;
	}
	@media (max-aspect-ratio: 1/1) {
		.bb-bet-row {
			--bb-bet-h: calc(64 * var(--ui-px));
		}
	}
	.bb-chips {
		box-sizing: border-box;
		height: var(--bb-pill-h);
		padding: 0 calc(var(--chip-size) * 0.3);
		display: flex;
		align-items: center;
		border-radius: calc(var(--bb-pill-h) / 2);
		/* The tray's dark pill, with a faint rim so it still reads against the screen's own dimming. */
		background: rgba(0, 0, 0, 0.45);
		outline: calc(1 * var(--ui-px)) solid rgba(255, 255, 255, 0.14);
		box-shadow: inset 0 calc(2 * var(--ui-px)) calc(1 * var(--ui-px)) rgba(0, 0, 0, 0.24);
		transition: opacity 0.2s ease;
	}
	/* A round is running: the chips stay on show but cannot be picked. */
	.bb-chips.locked {
		opacity: 0.55;
		pointer-events: none;
	}
	/* The window onto the rail. Its padding is room for the selected chip's ring and lift, which
	   the clip would otherwise shave off at the window's ends. */
	.bb-chips-viewport {
		box-sizing: content-box;
		width: calc(var(--slots, 7) * var(--chip-pitch));
		height: 100%;
		padding: 0 calc(var(--chip-size) * 0.15);
		margin: 0 calc(var(--chip-size) * -0.15);
		overflow: hidden;
	}
	.bb-chips-rail {
		display: flex;
		width: max-content;
		height: 100%;
		transform: translateX(calc(var(--offset, 0) * var(--chip-pitch) * -1));
		transition: transform 0.26s cubic-bezier(0.22, 0.61, 0.36, 1);
	}
	.bb-chip-slot {
		flex: 0 0 var(--chip-pitch);
		display: flex;
		align-items: center;
		justify-content: center;
		scale: calc(1 - var(--depth, 0) * 0.11);
		opacity: calc(1 - var(--depth, 0) * 0.22);
		z-index: calc(3 - var(--depth, 0));
		transition:
			scale 0.26s ease,
			opacity 0.26s ease;
	}
	.bb-chip-slot:not(.shown) {
		pointer-events: none;
	}
	/* The room badge on the card. Unlike Plinko's chest renders, the badge is solid art with no glow
	   to spare, so it does not hang over the text: it fills the slot between the tagline and the max
	   win and is contained there, however much room the two-line titles leave it. */
	.bb-card-art-wrap {
		inset: 0;
		transform: none;
	}
	.bb-card-art {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
	/* Its badge is away (see `lifted`): the one in the air is it. */
	.bb-card-art-wrap.lifted {
		visibility: hidden;
	}

	/* ── ANY BONUS BAR ────────────────────────────────────────────────────────────────────────────
	   Under the chip: the cards' panel turned landscape, with the name, price and Activate stacked
	   down its middle. 180 x 133 is the card's 0.74 turned on its side, so the stretched frame's rails
	   come out as thick as they are on the cards. The art is a pre-rotated copy
	   (buy_bonus_panel_landscape.webp) rather than a CSS rotate, which keeps the frame out of the iOS
	   transformed-art first-paint clip this game has already hit in the Stake Engine iframe.
	   Sized in --any-px, which is --ui-px until the modal is narrower than the panel, and then the
	   whole panel scales down with it. Counted in both FIT budgets above at its full 133 + 16ui-px. */
	.bb-modal.no-any {
		--bb-any-space: 0;
	}
	.bb-any {
		--any-px: min(var(--ui-px), calc(var(--bb-modal-width) / 180));
		position: relative;
		box-sizing: border-box;
		width: calc(180 * var(--any-px));
		height: calc(133 * var(--any-px));
		margin: 0 auto calc(16 * var(--any-px));
		padding: calc(12 * var(--any-px)) calc(14 * var(--any-px));
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: calc(7 * var(--any-px));
	}
	.bb-any-frame {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: fill;
		pointer-events: none;
		user-select: none;
	}
	.bb-any-title {
		position: relative;
		margin: 0;
		font-family: 'PiecesOfEight', serif;
		font-weight: 400;
		font-size: calc(18 * var(--any-px));
		line-height: 1;
		color: #ffffff;
		text-shadow: 0 calc(3 * var(--any-px)) calc(3 * var(--any-px)) rgba(0, 0, 0, 0.8);
		white-space: nowrap;
	}
	/* The cards' tagline face, sized off the panel rather than a card. */
	.bb-any-desc {
		position: relative;
		font-size: calc(8.5 * var(--any-px));
		line-height: 1.25;
		text-align: center;
	}
	.bb-any-price {
		position: relative;
		font-family: 'Noto Sans', sans-serif;
		font-weight: 700;
		font-synthesis: none;
		font-size: calc(18 * var(--any-px));
		line-height: 1;
		color: #ffffff;
		text-shadow: 0 calc(3 * var(--any-px)) calc(4.5 * var(--any-px)) rgba(0, 0, 0, 0.79);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.bb-any .bb-activate {
		flex: none;
		width: calc(116 * var(--any-px));
	}
	.bb-any .bb-activate-text {
		font-size: calc(14 * var(--any-px));
	}

	/* ── CAPTAIN'S CABIN (landscape) ───────────────────────────────────────────────────────────────
	   The captain stands on the right of the screen, feet off its bottom edge, and the column — chips
	   and the 2x2 cards — is centred in what is left to her left.
	   --bb-char-w is her width: 98% of the screen's height in her own 932x1070 shape, which at 16:9 is
	   the right ~49% of it, as the comp has her. Capped at half the width so a squarer landscape
	   (4:3) shrinks her, standing lower, rather than squeezing the column. The backdrop's right padding
	   is that width again, so the column can never run under her; `vh` first, `svh` where it exists,
	   for the same reason the backdrop's own height is written that way.
	   The chrome over and under the cards is lighter than the old one-row screen's, because the 2x2
	   grid is height-bound: every ui-px the chips and balance give back goes to the cards. The knobs
	   live on `.bb-backdrop` so its padding and the LANDSCAPE FIT can read the very values these
	   rules set.
	   The title, the balance and the close are not the column's: they head the SCREEN — the title at
	   the top centre with the balance on the line under it, the X in the top-right corner level with
	   the title, over the captain's shoulder. The header is those two line boxes (`--bb-head-h`), paid
	   for in the backdrop's top padding (and so in --bb-pad-y, which the FIT subtracts), so the column
	   starts under it and the chip rail can never run into it. All three are placed against the
	   backdrop, which is why the modal drops its `position` here; the captain goes to z -1 so the
	   column, now out of a positioned box, still paints over her. */
	.bb-character {
		display: none;
	}
	@media (min-aspect-ratio: 1/1) {
		.bb-backdrop {
			--bb-char-w: min(calc(98vh * 932 / 1070), 50vw);
			--bb-title-fs: clamp(calc(38 * var(--ui-px)), 5vw, calc(60 * var(--ui-px)));
			--bb-balance-fs: clamp(calc(16 * var(--ui-px)), 1.6vw, calc(22 * var(--ui-px)));
			/* The title's line (1.2) and the balance's (1.3) under it. */
			--bb-head-h: calc(1.2 * var(--bb-title-fs) + 1.3 * var(--bb-balance-fs));
			--bb-bet-units: 64;
			--bb-pad-y: calc(
				6vh + env(safe-area-inset-top, 0px) + env(safe-area-inset-bottom, 0px) +
					var(--bb-head-h)
			);
			padding-top: calc(3vh + env(safe-area-inset-top, 0px) + var(--bb-head-h));
			padding-right: calc(2vw + var(--bb-char-w) + env(safe-area-inset-right, 0px));
		}
		@supports (height: 100svh) {
			.bb-backdrop {
				--bb-char-w: min(calc(98svh * 932 / 1070), 50vw);
			}
		}
		.bb-character {
			display: block;
			position: absolute;
			right: 0;
			bottom: 0;
			z-index: -1;
			width: var(--bb-char-w);
			height: auto;
			pointer-events: none;
			user-select: none;
		}
		.bb-modal {
			position: static;
			--bb-modal-width: min(calc(1100 * var(--ui-px)), calc(96vw - var(--bb-char-w)));
		}
		.bb-title,
		.bb-balance {
			position: absolute;
			left: 50%;
			translate: -50% 0;
			margin: 0;
		}
		.bb-title {
			top: calc(3vh + env(safe-area-inset-top, 0px));
			font-size: var(--bb-title-fs);
			line-height: 1.2;
			white-space: nowrap;
		}
		/* Centred on the title's line. */
		.bb-close {
			top: calc(
				3vh + env(safe-area-inset-top, 0px) +
					(1.2 * var(--bb-title-fs) - 41.6 * var(--ui-px)) / 2
			);
			right: calc(2vw + env(safe-area-inset-right, 0px));
		}
		.bb-bet-row {
			--bb-bet-h: calc(var(--bb-bet-units) * var(--ui-px));
		}
		.bb-balance {
			top: calc(3vh + env(safe-area-inset-top, 0px) + 1.2 * var(--bb-title-fs));
			font-size: var(--bb-balance-fs);
			line-height: 1.3;
		}
	}
</style>
