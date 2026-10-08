<script lang="ts">
	/**
	 * Ocean Voyage, steered with the ship's wheel — the room for every Ocean Voyage: the wheel landing
	 * on it, a buy, and a replay (which sails itself). It replaced the original board voyage
	 * (RoomOceanVoyage), and plays the same books.
	 *
	 * The skull cave stands in the sea at the top of the screen and grows as the voyage goes on, until
	 * it is wider than the viewport. Ten rows of three barrels lie out on the water between it and the
	 * player from the start, smaller the further off, and float in towards the player, growing as they
	 * come (`rowAt`). There is no boat: the player is looking out over
	 * the bow, and the wheel pans the whole scene — the sea, the cave and the barrels — left and right.
	 * The barrel at the centre of the screen when a row reaches the tip of the deck is the one the
	 * player has chosen. It is taken (it flashes and is gone) and the total on the barrel of gold behind
	 * the wheel goes up to that stop's multiplier, with a pop — or the kraken rises up from behind the
	 * deck.
	 *
	 * Each barrel taken throws up a splash at the bow (`SPLASH`, One-Eyed Willy Plinko's waterfall
	 * burst) and a fountain of coins (`CoinFountain`, that game's win coin shower), which scatter and
	 * come down into the barrel of gold, raising its heap as they land. The kraken throws up a mirrored
	 * pair of splashes as it surges up. A voyage made to the last row eases round to the middle and then
	 * zooms into the skull cave's mouth on the treasure (`zoomIn`). The total on the barrel of gold IS
	 * the round's result, and BonusRound takes it off the barrel to show it (`handTotal`).
	 *
	 * The voyage is AUTHORED, exactly as the original's is: the book says how many rows are cleared
	 * (`dived`), and that is what pays. Every barrel in a row before that one is safe, and every barrel
	 * in that row has the kraken behind it, so nowhere the scene is panned to changes what the round
	 * pays — v2 changes how the round plays out, not what it pays, and shares the original's books and
	 * rules page. The wheel only chooses WHICH barrel is taken. A player who is not at the helm (a
	 * bonus they were not in) has the scene panned to the book's own `path` / `krakenTile`, the wheel
	 * turning by itself.
	 *
	 * BonusRound gives this room the whole screen rather than the stage, under its title frame. The ship's
	 * deck stands in front of the sea with the wheel set into its ring: all of it across a landscape
	 * screen, just its bottom middle (the rest cropped off) in portrait. There is no `.voyage .ship`
	 * for the wheel's own ship to dock on when it sails the player in, so Game.svelte docks it at a
	 * default spot and it fades away.
	 *
	 * The simulation is stepped from a clock as well as from animation frames: a background tab is
	 * given no frames, and a voyage that waited on them would never finish and so never pay.
	 */
	import { onDestroy } from 'svelte';
	import { TILES_PER_DEPTH } from '../../game/constants';
	import type { BookEventOceanVoyage } from '../../game/typesBookEvent';
	import { fadeOutSound, playSound } from '../../game/sound';
	import { staticPath } from '../../lib/staticUrl';
	import { CoinFountain } from '../../lib/coinFountain';
	import RoomHint from './RoomHint.svelte';
	import { waitForTimeout } from 'utils-shared/wait';

	type Props = { room: BookEventOceanVoyage; interactive?: boolean; portrait?: boolean };
	let { room, interactive = false, portrait = false }: Props = $props();

	const KRAKEN = staticPath('img/ocean-voyage/kraken.png');
	const BARREL = staticPath('img/ocean-voyage/barrel.webp');
	const CAVE = staticPath('img/ocean-voyage/skull_cave_v2.webp');
	const INSIDE = staticPath('img/ocean-voyage/inside_cave.webp');
	const SEA = staticPath('img/ocean-voyage/sea_night.webp');
	const SKY = staticPath('img/ocean-voyage/sky_night.webp');
	const SEA_FLOW = staticPath('img/ocean-voyage/sea_overlay.webp');
	const DECK = staticPath('img/ocean-voyage/ship_deck.webp');
	const WHEEL = staticPath('img/ocean-voyage/wheel.webp');
	/**
	 * The water splash thrown up as a barrel is taken: One Eyed Willy Plinko's free-game waterfall burst
	 * (apps/plinko static/spine/FG_SPLASH), baked out of its Spine atlas into one vertical strip of
	 * frames — the sequence's 50 drawn frames (6-55; the rest are blank), straight alpha, at 0.6 of
	 * the authored 521×404 — so it plays as a CSS sprite here rather than standing up a Spine/WebGL
	 * canvas of its own (`.splash`).
	 */
	const SPLASH = staticPath('img/ocean-voyage/splash_strip.webp');
	const SPLASH_FRAMES = 50;
	/** The Spine sequence's own rate (a frame every 1/30 s), so it runs as long as it does in plinko. */
	const SPLASH_MS = (SPLASH_FRAMES * 1000) / 30;
	/** A frame's width to its height, and where across it the burst rises from (its foot is the frame's
	    bottom edge). */
	const SPLASH_ASPECT = 521 / 404;
	const SPLASH_FOOT_X = 0.52;
	/** The burst's width against a barrel's at the bow. */
	const SPLASH_W = 4;
	/** How far below the taken barrel's foot the burst's own foot is set, in barrel heights at the bow:
	    lower down behind the deck, so it bursts up from under the bow rather than off the barrel. */
	const SPLASH_DROP = 0.8;

	/**
	 * The barrel of gold standing on the deck behind the wheel: what the voyage has won so far, piling
	 * up. Three layers — the far rim and inside of the barrel (`back`), the heap of coins, and the
	 * barrel's body with the near rim (`front`) — so the coins sit IN the barrel: the front hides
	 * whatever of the heap is still below its rim, and the heap rises out of it a little with every
	 * barrel collected (`goldTip`).
	 *
	 * Everything is in the front picture's own pixels (916×1070), which the barrel is drawn at
	 * `barrelU` of. `back` is cropped to its art (`barrel_back.webp`, 764×191) and set so its rim meets
	 * the front's at the front's top edge; the heap (`gold_pile.webp`, cropped to 1006×965) is drawn
	 * at 0.8 of its size, centred on the mouth, `tip` being where its peak is down it.
	 */
	const GOLD_BACK = staticPath('img/ocean-voyage/barrel_golds/barrel_back.webp');
	const GOLD_FRONT = staticPath('img/ocean-voyage/barrel_golds/barrel_front.webp');
	const GOLD_PILE = staticPath('img/ocean-voyage/barrel_golds/gold_pile.webp');
	const GOLD_PX = {
		front: { w: 916, h: 1070 },
		back: { x: 74, y: -107, w: 764 },
		pile: { x: 43.4, w: 804.8, tip: 92.8 },
	};
	/**
	 * Where the heap's peak is, down the front picture: under the near rim (out of sight) before
	 * anything is collected; just showing in the mouth on the first barrel; and with the whole heap
	 * standing up out of the barrel, its foot at the rim, on the last.
	 */
	const GOLD_TIP = { empty: 140, first: -40, full: -603 };
	/** Where the total is written on the barrel: on its top hoop, down the front picture. */
	const GOLD_LABEL_Y = 225;
	/** The barrel's width against the wheel's, and how far up the wheel (in wheel widths from the
	    foot of the screen) it stands — low enough that the wheel hides its foot. */
	const GOLD_BARREL_W = 0.35;
	const GOLD_BARREL_FOOT = 0.12;

	/**
	 * The fountain of coins a barrel throws as it is collected (`CoinFountain`, One-Eyed Willy Plinko's
	 * win coin shower): up off the bow where the barrel was taken, scattering, then down into the
	 * barrel of gold — and the heap there rises, and the total goes up, as they land (`banked`), not
	 * as the barrel is taken. Plinko's own coin (`img/win_popup/coin.webp`).
	 */
	const COIN = staticPath('img/ocean-voyage/coin.webp');
	/** Coins a barrel throws: a few more the further the voyage has got. */
	const FOUNTAIN_COINS = (depth: number) => Math.min(30, 10 + depth * 2);
	/** The throw, first coin to last; how long one hangs in the air before it turns for the barrel (give
	    or take the stagger); and its speed and size against plinko's full-screen shower. */
	const FOUNTAIN_THROW_MS = 350;
	const FOUNTAIN_HANG_MS = 550;
	const FOUNTAIN_STAGGER_MS = 300;
	const FOUNTAIN_SPEED = 0.6;
	const FOUNTAIN_SIZE = 0.45;
	/** Portrait's coins against landscape's: a little bigger, on the narrow screen their size is taken
	    from (the short side — its width there). */
	const FOUNTAIN_SIZE_PORTRAIT = 1.2;
	/** If no coin has landed by now (a tab given no animation frames), the gold goes in anyway. */
	const FOUNTAIN_BACKSTOP_MS = 2200;
	/** Where in the barrel the coins go: just inside its mouth, down the front picture. */
	const GOLD_MOUTH_Y = -30;
	/**
	 * The coins' sounds are plinko's win shower's: its shuffle as they are thrown (`coinShuffle`), and a
	 * coin flip as each lands (`coinFlip`), each at a pitch of its own and no closer together than its
	 * 55 ms — so a stream of them reads as a cascade, not a buzz.
	 */
	const COIN_SOUND_GAP_MS = 55;

	/** The art's own shapes. */
	const CAVE_ASPECT = 2122 / 729;
	/** The foot of the cave's mouth, as a share of its height: the waterline. The art has no water of
	    its own, so from CAVE_SINK down the rocks fade into the sea. */
	const CAVE_MOUTH = 0.97;
	const CAVE_SINK = 0.92;
	/**
	 * The cave's mouth is a hole in the picture, and the treasure cave inside (`inside_cave`) shows
	 * through it: this much of the cave's width, centred this far across it, standing on its foot.
	 * Behind it, and over it as a veil, is black in the box the hole takes up (shares of the cave) —
	 * the veil pitch black far off, and lifting as the cave comes near, so the treasure is revealed.
	 */
	/** How far the skull around the mouth is dimmed when the treasure is revealed. */
	const SKULL_DIM = 0.45;
	/** How much of the inside the lifting veil shows on the way to the cave. */
	const INSIDE_PEEK = 0.3;
	const INSIDE_W = 0.49;
	const INSIDE_CX = 0.509;
	const HOLE = { left: 0.378, right: 0.642, top: 0.36, bottom: CAVE_MOUTH };
	/**
	 * The scene's layout, as shares of the screen, from the reference pictures: where the horizon is
	 * (down the screen), and the cave as it first comes into view and on the last row — its width (of
	 * the screen's), and its foot (the bottom of the rocks): at the start that far below the horizon
	 * (of the height), at the end that far down the screen. Portrait's horizon sits a little lower
	 * than its picture's, since the game's own title frame is taller there and would hide the cave.
	 */
	const LAYOUT = {
		landscape: { horizon: 0.49, startW: 0.33, startFoot: 0.015, endW: 1.02, endFoot: 0.66 },
		portrait: { horizon: 0.24, startW: 0.63, startFoot: 0.047, endW: 3.05, endFoot: 0.68 },
	};
	/** The barrel's picture, height over width. */
	const BARREL_ASPECT = 352 / 512;
	/** The sea picture (its own perspective painted in: its top edge is the far horizon), height over width. */
	const SEA_ASPECT = 2074 / 1526;
	/**
	 * The water's ripples, laid over the sea picture and running down towards the player: a seamless
	 * tile (made from sea_texture.png), height over width, its width as a share of the screen's longer
	 * side, the seconds it takes to run one tile's height, and how far down the sea it has faded in
	 * from nothing at the top (it is flat, so it is kept off the far water the picture paints small).
	 */
	const FLOW_ASPECT = 1536 / 1024;
	const FLOW_TILE = 0.3;
	const FLOW_SECONDS = 36;
	const FLOW_FADE = 0.45;
	/** How far the view beyond the rail rises at the top of its swell, as a share of the height (the
	    sea reaches this much further down so none of the foot of the screen is ever left bare). */
	const VIEW_SWELL = 0.02;
	/** The sky picture, height over width. Its foot stands on the sea's horizon. */
	const SKY_ASPECT = 597 / 1526;
	const SKY_PAN = 0.15;
	/** The deck's picture, and where the ring its wheel sits in is centred in it. `pick` is the row a
	    barrel's foot comes down to as it is taken: below the tip of the bow's spike (250) and above
	    the rail (419), so the spike stands over the barrel as it is picked. */
	const DECK_PX = { w: 1928, ring: 710, ringY: 690, tip: 250, pick: 330 };
	/** How far a landscape deck is let down below the foot of the screen, as a share of the height. */
	const DECK_SINK = 0.1;
	/** How far the sea fades in below the horizon, over the haze at the foot of the sky (layout pixels at 1024 wide). */
	const BLEND_PX = 40;

	/** Time on the water before the sea starts moving. */
	const START_MS = 900;
	/** The kraken's coming (`.kraken`'s animation: a peek, a sink, a surge), and its beat before the
	    screen moves on, which waits for all of it. */
	const KRAKEN_MS = 2150;
	const SINK_MS = KRAKEN_MS + 500;
	/**
	 * The water the kraken throws up, either side of it — the barrels' splash (`SPLASH`), the left one
	 * as drawn and the right one mirrored, so both burst outward. One pair, as it surges up out of the
	 * water for its full reveal (`kraken-rise`'s 84%) — not on the peek before it. `at` is a share of
	 * KRAKEN_MS, `w` each splash's width against the kraken's size; they stand `apart` of its size
	 * either side of the middle, sunk behind the deck's rail where they stand.
	 */
	const KRAKEN_SPLASHES = [{ at: 0.84, w: 0.7 }];
	const KRAKEN_SPLASH_APART = 0.3;
	/** How much of a kraken splash's height is sunk behind the deck: only the top of it shows over the
	    rail. */
	const KRAKEN_SPLASH_SUNK = 0.3;
	/**
	 * The top edge of the deck's rail across the deck picture, in its pixels: 33 samples, left edge to
	 * right, measured off `ship_deck.webp`'s alpha. It falls away from the bow to the sides, so a splash
	 * off to one side has to be set by the rail where it stands, not at the middle. The lanterns (2-3,
	 * 29-30) and the bow's spike (16) stand up out of it and are smoothed over: the rail behind them.
	 */
	const DECK_EDGE_PX = [
		523, 511, 510, 510, 509, 499, 489, 480, 470, 461, 451, 442, 431, 418, 399, 373, 365, 372, 398, 417,
		431, 441, 451, 461, 470, 479, 489, 499, 509, 510, 510, 512, 523,
	];
	/** Where its eyes end, as a share of its picture's height: the peek shows it down to here. */
	const KRAKEN_EYES = 0.44;
	/** The top of the deck's rail at its middle, in the deck picture's pixels. */
	const DECK_RAIL = 419;
	const END_HOLD_MS = 900;

	/** Seconds between one row reaching the bow and the next, and before the first one does (after LEAD_SECONDS). */
	const ROW_SECONDS = 3.2;
	const TRAVEL_SECONDS = 6.2;
	/** The clear water behind a barrel, as a share of its own height: room for both barrels to bob without touching. */
	const ROW_GAP = 0.25;
	/** Each row is at least this share of the size of the one in front of it. Where the water is too
	    short for that and ROW_GAP both (only at the very end, with the cave at the bow), the rows close
	    up and the nearer stand over the farther. */
	const ROW_SHRINK_MIN = 0.3;
	/** How bright things are far off, in the dark: the cave and the barrels come into their colours
	    from this as they come near (`litAt`). */
	const FAR_LIT = 0.15;
	/** The first row comes out this long after the sea starts moving. */
	const LEAD_SECONDS = 0.2;
	/**
	 * Once the last gate is open the voyage is made, and comes to rest in two beats: the view (and the
	 * wheel) eases round to the middle over SETTLE_SECONDS — gliding, not snapped there — and then the
	 * skull cave opens up, zooming in on its mouth until the treasure inside fills the screen, over
	 * CAVE_ZOOM_SECONDS (`zoomIn`). It zooms CAVE_ZOOM_COVER past the size that just covers the screen
	 * with the hole, so no edge of it is left showing.
	 */
	const SETTLE_SECONDS = 1.2;
	const CAVE_ZOOM_SECONDS = 1.8;
	const CAVE_ZOOM_COVER = 1.04;
	/** The middle of the mouth's hole, as shares of the cave: what the zoom is centred on. */
	const HOLE_CX = 0.51;
	const HOLE_CY = 0.665;
	/** How quickly the scene pans to where the wheel points it. */
	const PAN_TAU = 0.3;
	/** How much of the pan the sea and the cave follow — the far things move less. */
	const SEA_PAN = 0.7;
	const CAVE_PAN = 0.35;
	/** The wheel's lock, each way, and how far an arrow key turns it a press. */
	const WHEEL_LOCK = 110;
	const KEY_NOTCH_DEG = 12;
	/** How long one creak of the wheel runs (sound.ts's `shipWheel` window, short of its fade); how
	    long the wheel can sit still before it is taken to have stopped; and the fade it stops on. */
	const CREAK_MS = 1500;
	const CREAK_IDLE_MS = 180;
	const CREAK_FADE_MS = 250;
	/** What to tell the player at the helm. One line per drain — see `RoomHint`. */
	const HINT = ['Steer the wheel', 'to pick barrels'];
	/** The visible foot of BonusRound's title frame, as a share of its box (the rest is glow). */
	const PLATE_FOOT = 0.857;

	const depths = $derived(room.depths.length);
	const cols = TILES_PER_DEPTH;
	/** Lane of tile `t`: -1 left, 0 centre, 1 right on a three-wide row. */
	const laneOf = (t: number) => t - (cols - 1) / 2;

	/** The screen this room is given, in layout pixels (the game's CSS zoom cancels out of both). */
	let rootEl = $state<HTMLDivElement>();
	let W = $state(1280);
	let H = $state(720);
	/** Where the title frame's sign ends, down the room. */
	let plateFoot = $state(0);
	$effect(() => {
		const el = rootEl;
		if (!el) return;
		const measure = () => {
			W = el.clientWidth || W;
			H = el.clientHeight || H;
			// The caption hangs just under BonusRound's title frame, wherever that falls on this screen.
			// Both move with the screen as it slides in, so the gap between them is what is kept.
			const plate = el.closest('.screen')?.querySelector('.plate');
			if (plate) {
				const box = el.getBoundingClientRect();
				const sign = plate.getBoundingClientRect();
				const zoom = box.width / W || 1;
				plateFoot = (sign.top + sign.height * PLATE_FOOT - box.top) / zoom;
			}
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	});

	/** The lanes' width: how much of the screen the playing field takes up. */
	const PW = $derived(portrait ? W * 0.92 : Math.min(W * 0.56, H * 0.85));
	/** Seconds on the water. */
	let T = $state(0);
	const rowStart = (i: number) => LEAD_SECONDS + i * ROW_SECONDS;
	const layout = $derived(portrait ? LAYOUT.portrait : LAYOUT.landscape);
	/**
	 * The cave at `p` of its way from far off to near (`LAYOUT`): small, standing on the horizon in
	 * the middle of the screen, and growing — its foot coming down the screen towards the player — to
	 * its size on the last row, when it is as wide as the screen in landscape and three times that in
	 * portrait (the sides off the screen, the top behind the title frame). It stands in the sea with
	 * its waterline at the foot of its mouth; the line of rows reaches back to its bottom edge.
	 */
	const caveAt = (p: number) => {
		const w = W * (layout.startW + (layout.endW - layout.startW) * p);
		const h = w / CAVE_ASPECT;
		const foot0 = horizonY + layout.startFoot * H;
		const foot = foot0 + (layout.endFoot * H - foot0) * p;
		const top = foot - h;
		return { w, h, top, bottom: foot };
	};
	/**
	 * How far the cave has grown (0-1) at `t` seconds: it comes in with the last row of barrels, growing
	 * as that row grows (`rowAt`) — hardly at all far off, then faster and faster — and is at its full
	 * size as that row reaches the bow. The row's growth is taken as the line of rows is laid out at the
	 * start (`chainFrom` the cave's first foot), since the line itself closes up as the cave comes in.
	 */
	const approach = (t: number) => {
		const { r } = chainFrom(caveAt(0).bottom);
		const last = depths - 1;
		const at = (time: number) => r ** ((rowStart(last) + TRAVEL_SECONDS - time) / ROW_SECONDS);
		const from = at(0);
		return clamp((at(clamp(t, 0, voyageSeconds)) - from) / (1 - from), 0, 1);
	};
	/** From the start to the last row reaching the bow. */
	const voyageSeconds = $derived(rowStart(depths - 1) + TRAVEL_SECONDS);
	const grow = $derived(approach(T));
	/**
	 * How lit something is (FAR_LIT far off, 1 near) at `near` of the way to the player (0-1). The
	 * square root brings the light up early in the coming, so neither the cave nor a barrel — both of
	 * which grow most at the very end — sits black for most of the voyage.
	 */
	const litAt = (near: number) => FAR_LIT + (1 - FAR_LIT) * Math.sqrt(clamp(near, 0, 1));
	const cave = $derived(caveAt(grow));

	/**
	 * The treasure revealed: with the last gate open — the voyage's top multiplier — the inside of the
	 * cave comes all the way out of the dark, and the skull around it is dimmed so the eye goes to
	 * what is in its mouth (0 to 1, as the cave zooms in).
	 */
	const reveal = $derived.by(() => {
		if (ended === 'port') return 1;
		return zoomIn * zoomIn * (3 - 2 * zoomIn);
	});
	/**
	 * The cave zooming in on its mouth (`zoomIn`, eased): scaled up about the middle of the hole, which
	 * is carried to the middle of the screen as it goes, to the size at which the hole covers the whole
	 * screen. And the rocks' fade into the sea is firmed up as it comes, or the bottom of the treasure
	 * would fade into the water too.
	 */
	const caveZoom = $derived.by(() => {
		const e = zoomIn < 0.5 ? 4 * zoomIn ** 3 : 1 - (-2 * zoomIn + 2) ** 3 / 2;
		const holeW = cave.w * (HOLE.right - HOLE.left);
		const holeH = cave.h * (HOLE.bottom - HOLE.top);
		const hx = caveLeft + cave.w * HOLE_CX;
		const hy = cave.top + cave.h * HOLE_CY;
		const full = CAVE_ZOOM_COVER * Math.max(W / holeW, H / holeH);
		return {
			transform: e > 0 ? `translate(${((cx - hx) * e).toFixed(1)}px, ${((H / 2 - hy) * e).toFixed(1)}px) scale(${(1 + (full - 1) * e).toFixed(4)})` : 'none',
			sink: CAVE_SINK + (1 - CAVE_SINK) * e,
		};
	});
	/** The veil over the inside of the cave: pitch black far off, and lifting as the cave comes near —
	    but only so far (INSIDE_PEEK); the rest of it lifts only with the treasure revealed. */
	const veil = $derived.by(() => {
		const t = clamp((grow - 0.15) / 0.8, 0, 1);
		return (1 - INSIDE_PEEK * t * t * (3 - 2 * t)) * (1 - reveal);
	});
	/** The horizon, down the screen: the sky stands on it, the sea runs from it, the cave starts on it. */
	const horizonY = $derived(H * layout.horizon);
	/** How far the sea takes to fade in at its top edge, over the haze at the foot of the sky. */
	const blend = $derived(BLEND_PX * (W / 1024));
	/**
	 * Where the sea starts. In portrait it fades in below the horizon. In landscape it is solid right
	 * up to the bottom of the cave as it first comes into view — the cave's foot stands on the line
	 * where the water begins — and fades in above that.
	 */
	const seaTop = $derived(portrait ? horizonY : horizonY + layout.startFoot * H - blend);

	/**
	 * The deck. Landscape draws it the whole width of the screen, sunk a little so the sea has room;
	 * portrait takes just its bottom middle — the ring the wheel sits in and the rail round the bow —
	 * at a size that suits the wheel, and the screen crops the sides off. Either way the ring's
	 * middle is (about) the wheel's middle, which is the foot of the screen.
	 */
	/** The wheel's width: larger in portrait, where the screen is narrow and it is the thing to reach for. */
	const wheelW = $derived(PW * (portrait ? 0.95 : 0.6));
	const deckScale = $derived(portrait ? (wheelW * 1.25) / DECK_PX.ring : W / DECK_PX.w);
	const deckW = $derived(DECK_PX.w * deckScale);
	const deckTop = $derived(H - DECK_PX.ringY * deckScale + (portrait ? 0 : H * DECK_SINK));

	/** The barrel of gold (`GOLD_PX`): its size in pixels per front-picture pixel, and where it stands —
	    centred behind the wheel, its foot hidden behind it. */
	const barrelU = $derived((wheelW * GOLD_BARREL_W) / GOLD_PX.front.w);
	const barrelTop = $derived(H - wheelW * GOLD_BARREL_FOOT - GOLD_PX.front.h * barrelU);

	/** The gates are barrels floating on the water, standing on the row's line by their foot. */
	/** Smaller in landscape, where the horizon is low and there is only a short stretch of sea between
	    the cave and the bow for the rows to lie out on with water between them. */
	const gateW = $derived(PW * (portrait ? 0.28 : 0.17));
	const gateH = $derived(gateW * BARREL_ASPECT);
	const pitch = $derived(PW * (portrait ? 0.4 : 0.3));
	const cx = $derived(W / 2);
	/** A row is opened as its barrels' feet come in under the deck's bow, the spike over them. */
	const hitY = $derived(deckTop + DECK_PX.pick * deckScale);
	/** The sky stands on the sea (its foot under the sea's fade), wide enough to fill the screen above
	    it however far it is panned. */
	const sky = $derived.by(() => {
		const foot = seaTop + blend;
		const w = Math.max(W + 2 * pitch * SKY_PAN + 8, foot / SKY_ASPECT + 8);
		return { w, top: foot - w * SKY_ASPECT };
	});
	/** The sea, from its top to the foot of the screen, wide enough to pan with the wheel. */
	const sea = $derived({ w: Math.max(W + 2 * pitch * SEA_PAN + 8, (H * (1 + VIEW_SWELL) - seaTop) / SEA_ASPECT + 8) });
	/** The ripples over it: one tile's size, and how much they reach past the screen each side to pan. */
	const flow = $derived.by(() => {
		const w = FLOW_TILE * Math.max(W, H);
		return { w, h: w * FLOW_ASPECT, spare: pitch * SEA_PAN + 8 };
	});

	/** The kraken takes up the whole height in landscape and the whole width in portrait, standing low
	    enough that the title frame does not cover its head. */
	const krakenSize = $derived(portrait ? W : H);
	const krakenY = $derived(portrait ? H * 0.52 : H * 0.6);
	/**
	 * How far below where it stands it starts (wholly under the foot of the screen), and how far
	 * below it it peeks from: just its eyes showing over whatever stands highest in front of it — the
	 * rail, or the wheel set into it.
	 */
	const krakenHide = $derived(H - (krakenY - krakenSize / 2));
	/** The line the kraken peeks over: the rail, or the wheel set into it, whichever stands higher. */
	const krakenLine = $derived(Math.min(deckTop + DECK_RAIL * deckScale, H - wheelW / 2) - 4);
	const krakenPeek = $derived(krakenLine - KRAKEN_EYES * krakenSize - (krakenY - krakenSize / 2));
	/** The top of the deck's rail at `x` across the screen (`DECK_EDGE_PX`), down the screen. */
	const deckEdgeAt = (x: number) => {
		const n = DECK_EDGE_PX.length - 1;
		const u = clamp(((x - (cx - deckW / 2)) / deckW) * n, 0, n);
		const i = Math.min(n - 1, Math.floor(u));
		const px = DECK_EDGE_PX[i] + (DECK_EDGE_PX[i + 1] - DECK_EDGE_PX[i]) * (u - i);
		return deckTop + px * deckScale;
	};

	/** Rows opened so far. */
	let reached = $state(0);
	let kraken = $state<{ depth: number; tile: number } | null>(null);
	let ended = $state<'kraken' | 'port' | null>(null);
	/** Barrels whose coins have reached the barrel of gold: it trails `reached` by a fountain's flight. */
	let banked = $state(0);
	/** The heap's peak in the barrel of gold (`GOLD_TIP`): out of sight, then up an even step for each
	    barrel's coins landing in it, from the first to the last. */
	const goldTip = $derived.by(() => {
		if (banked < 1) return GOLD_TIP.empty;
		const p = depths > 1 ? (banked - 1) / (depths - 1) : 1;
		return GOLD_TIP.first + (GOLD_TIP.full - GOLD_TIP.first) * p;
	});
	/** The total so far: the multiplier of the last barrel collected — what the voyage pays if it ends
	    here — written on the barrel of gold. It goes up the moment a barrel is taken (with a pop and a
	    bounce, `.gold-total`), ahead of that barrel's coins, which only raise the heap as they land. */
	const goldTotal = $derived(reached >= 1 ? room.depths[reached - 1] : null);
	/** The total has been taken off the barrel to be the round's result (`handTotal`). */
	let totalHanded = $state(false);
	let goldTotalEl = $state<HTMLDivElement>();
	/**
	 * The round's result is the barrel's total — the book's `total`, the last stop's multiplier with
	 * the Top Slot already in it — so BonusRound takes it off the barrel rather than putting up a
	 * second one beside it: where it is on the screen, and it is gone from the hoop.
	 */
	export const handTotal = (): DOMRect | null => {
		const rect = goldTotalEl?.getBoundingClientRect() ?? null;
		totalHanded = true;
		return rect;
	};
	/** The gate taken in each row opened so far (row -> lane): it flashes and is gone, and stays gone —
	    the rest of its row sink away (`.gone`), and it must never be taken for one of them. */
	let taken = $state<Record<number, number>>({});
	/** Splashes thrown up by barrels just taken, each playing out once where its barrel stood. */
	type Splash = { id: number; x: number; y: number };
	let splashes = $state<Splash[]>([]);
	/** The kraken's splashes (`KRAKEN_SPLASHES`): over it rather than under, and some mirrored. */
	type KrakenSplash = Splash & { w: number; mirror: boolean };
	let krakenSplashes = $state<KrakenSplash[]>([]);
	let splashId = 0;
	/** True while the voyage is under way. */
	let sailing = $state(false);
	/** The scene settling after the last gate (`SETTLE_SECONDS`, then `CAVE_ZOOM_SECONDS`): how long it
	    has been at it, where the view and the wheel were when it started, and how far the cave has
	    zoomed in (0-1). */
	let settling = $state(false);
	let settleT = 0;
	let settleFrom = { offset: 0, wheel: 0 };
	let zoomIn = $state(0);

	/** How far the player is looking to one side of the middle, in pixels: the scene pans the other way. */
	let offset = $state(0);
	/** The middle of the cave's mouth across the screen: the cave pans a little with the wheel, and the
	    lanes narrow off towards it. */
	const mouthX = $derived(cx - offset * CAVE_PAN);
	const caveLeft = $derived(mouthX - cave.w / 2);
	let wheelDeg = $state(0);

	/**
	 * The rows lie out on the water from the start, all of them, one behind another from the bow back
	 * to the cave's foot, and come in towards the player. A row `n` rows' time from the bow is `r^n`
	 * of its full size, and the row behind it stands back from it by ROW_GAP more than its height — so
	 * the top of a barrel never reaches the foot of the one behind: each is smaller than the one in
	 * front, the gaps close up with distance the way they do far off, and none overlaps another.
	 *
	 * The line reaches back no further than the bottom edge of the cave, so no barrel is ever laid over
	 * it (and the cave stands in front of the barrels besides): as the cave comes in the rows behind
	 * close up (`r` falls; at the very end, with the cave at the bow and no room left, the last rows
	 * may touch). Each row still comes to the bow exactly when it always
	 * has, ROW_SECONDS after the one before it.
	 */
	const chainFrom = (footY: number) => {
		const reach = Math.max(gateH * 0.5, hitY - footY - gateH * 0.05);
		return { reach, r: clamp(1 - ((1 + ROW_GAP) * gateH) / reach, ROW_SHRINK_MIN, 0.95) };
	};
	const rowChain = $derived(chainFrom(cave.bottom));
	/** Where row `i` is and how big, as a share of its size at the bow. */
	const rowAt = (i: number) => {
		const n = (rowStart(i) + TRAVEL_SECONDS - T) / ROW_SECONDS;
		const { reach, r } = rowChain;
		if (n >= 0) {
			const size = r ** n;
			return { y: hitY - reach * (1 - size), size, live: true };
		}
		// Past the bow it carries on down off the screen at the speed it reached the bow at, growing
		// only a little — not on along the line's curve, which would blow it up out of all size.
		const past = -n;
		const y = hitY + reach * -Math.log(r) * past;
		const size = 1 + 0.15 * past;
		return { y, size, live: y < H + gateH * size };
	};
	/** Where the gate of lane `tile` stands across the screen at `size`: in its lane at the bow, the lanes
	    narrowing off towards the cave's mouth. */
	const laneX = (tile: number, size: number) => mouthX + (cx - offset + laneOf(tile) * pitch - mouthX) * size;

	let alive = true;
	let raf = 0;
	let clock: ReturnType<typeof setInterval> | undefined;
	onDestroy(() => {
		alive = false;
		stop();
	});

	const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

	/** The tile of a row whose lane is at the middle of the screen. */
	const nearest = () => {
		let best = 0;
		for (let t = 1; t < cols; t++)
			if (Math.abs(laneOf(t) * pitch - offset) < Math.abs(laneOf(best) * pitch - offset)) best = t;
		return best;
	};
	/** The gate at the middle right now: the one that is lit, and the one the next row will open. */
	const centred = $derived(nearest());

	let finish: () => void = () => undefined;
	const finished = new Promise<void>((resolve) => (finish = resolve));

	const open = (depth: number, tile: number) => {
		taken = { ...taken, [depth]: tile };
		if (depth >= room.dived) {
			// The row the book ends the voyage at: whichever gate is at the middle, the kraken is behind it.
			kraken = { depth, tile };
			stop();
			playSound('kraken');
			// Water thrown up either side of it as it surges up for its full reveal.
			for (const { at, w } of KRAKEN_SPLASHES) {
				void waitForTimeout(KRAKEN_MS * at).then(() => {
					if (!alive) return;
					const width = krakenSize * w;
					const pair = [-1, 1].map((side) => {
						const x = cx + side * krakenSize * KRAKEN_SPLASH_APART;
						// Its foot sunk below the rail where it stands, so the deck hides the bottom of it.
						return {
							id: splashId++,
							x,
							y: deckEdgeAt(x) + (width / SPLASH_ASPECT) * KRAKEN_SPLASH_SUNK,
							w: width,
							mirror: side > 0,
						};
					});
					krakenSplashes = [...krakenSplashes, ...pair];
					const ids = new Set(pair.map((s) => s.id));
					void waitForTimeout(SPLASH_MS + 100).then(() => (krakenSplashes = krakenSplashes.filter((s) => !ids.has(s.id))));
				});
			}
			void waitForTimeout(SINK_MS).then(() => {
				ended = 'kraken';
				finish();
			});
			return;
		}
		// Every barrel collected — the last one too — throws up a splash at the bow, behind the deck.
		const sid = splashId++;
		splashes = [...splashes, { id: sid, x: cx, y: hitY + gateH * SPLASH_DROP }];
		void waitForTimeout(SPLASH_MS + 100).then(() => (splashes = splashes.filter((s) => s.id !== sid)));
		// The row's multiplier goes up on the barrel of gold (`goldTotal`), which pops to say so.
		reached = depth + 1;
		playSound('pop', 1 + depth * 0.04);
		throwCoins(depth);
		if (reached >= depths) {
			// The last gate: the voyage is made. The view eases to the middle, then the cave zooms in.
			settling = true;
			settleT = 0;
			settleFrom = { offset, wheel: wheelDeg };
			zoomIn = 0;
			playSound('whoosh');
		}
	};

	// ---- The fountain of coins -----------------------------------------------------------------
	let coinCanvas = $state<HTMLCanvasElement>();
	let fountain = $state.raw<CoinFountain>();
	$effect(() => {
		const canvas = coinCanvas;
		if (!canvas) return;
		const f = new CoinFountain(canvas);
		fountain = f;
		const coin = new Image();
		coin.onload = () => f.setCoinImage(coin);
		coin.src = COIN;
		return () => {
			f.destroy();
			if (fountain === f) fountain = undefined;
		};
	});
	// Drawn in the room's layout pixels, with the backing store at device resolution: the game's CSS
	// zoom times the device's pixel ratio (held to 2 — a full-screen canvas at 3x is a lot of memory
	// for some coins).
	$effect(() => {
		const f = fountain;
		const canvas = coinCanvas;
		if (!f || !canvas || !rootEl) return;
		const zoom = rootEl.getBoundingClientRect().width / W || 1;
		f.resize(W, H, Math.min(2, (window.devicePixelRatio || 1) * zoom));
	});

	/** Bank barrel `n`'s gold: the heap rises and the total goes up. Never back down. */
	const bank = (n: number) => {
		if (alive && n > banked) banked = n;
	};
	let coinSoundAt = -Infinity;
	/** Barrel `depth`'s coins: thrown up off the bow where it was taken, and down into the barrel of gold. */
	const throwCoins = (depth: number) => {
		const n = depth + 1;
		void waitForTimeout(FOUNTAIN_BACKSTOP_MS).then(() => bank(n));
		if (!fountain) return bank(n);
		playSound('coinShuffle');
		fountain.burst({
			from: { x: cx, y: hitY - gateH * 0.5 },
			to: () => ({ x: cx, y: barrelTop + GOLD_MOUTH_Y * barrelU }),
			count: FOUNTAIN_COINS(depth),
			throwWindowMs: FOUNTAIN_THROW_MS,
			hangMs: FOUNTAIN_HANG_MS,
			mergeStaggerMs: FOUNTAIN_STAGGER_MS,
			speedScale: FOUNTAIN_SPEED,
			sizeScale: FOUNTAIN_SIZE * (portrait ? FOUNTAIN_SIZE_PORTRAIT : 1),
			onFirstArrive: () => bank(n),
			onArrive: () => {
				const now = performance.now();
				if (now - coinSoundAt < COIN_SOUND_GAP_MS) return;
				coinSoundAt = now;
				playSound('coinFlip', 0.94 + Math.random() * 0.12);
			},
		});
	};

	const step = (dt: number) => {
		if (!sailing) return;
		T += dt;

		if (settling) {
			settleT += dt;
			// The glide to the middle: eased in and out from wherever the view and the wheel were.
			const p = clamp(settleT / SETTLE_SECONDS, 0, 1);
			const e = p * p * (3 - 2 * p);
			offset = settleFrom.offset * (1 - e);
			wheelDeg = settleFrom.wheel * (1 - e);
			// Then the cave zooms in on its treasure.
			zoomIn = clamp((settleT - SETTLE_SECONDS) / CAVE_ZOOM_SECONDS, 0, 1);
			if (zoomIn >= 1) {
				stop();
				playSound('win');
				ended = 'port';
				finish();
			}
			return;
		}

		// Where the scene is being panned to: by the wheel, or by the book when no hands are on it.
		let target: number;
		if (!interactive) {
			const tile = (reached < room.dived ? room.path[reached] : (room.krakenTile ?? 0)) % cols;
			target = laneOf(tile) * pitch;
			const want = (laneOf(tile) / Math.max(1, (cols - 1) / 2)) * WHEEL_LOCK;
			wheelDeg += (want - wheelDeg) * (1 - Math.exp(-dt / 0.15));
		} else {
			target = (wheelDeg / WHEEL_LOCK) * ((cols - 1) / 2) * pitch;
		}
		offset += (target - offset) * (1 - Math.exp(-dt / PAN_TAU));

		while (sailing && reached < depths && rowAt(reached).y >= hitY) {
			open(reached, nearest());
		}
	};

	let last = 0;
	const advance = (now: number) => {
		if (!sailing) {
			last = now;
			return;
		}
		// Fixed steps, however long it has been since the last look (a hidden tab looks once a second).
		let owed = Math.min((now - last) / 1000, 2);
		last = now;
		while (owed > 0 && sailing) {
			const dt = Math.min(owed, 1 / 60);
			owed -= dt;
			step(dt);
		}
	};
	const frame = (now: number) => {
		if (!alive || !sailing) return;
		advance(now);
		raf = requestAnimationFrame(frame);
	};
	const stop = () => {
		sailing = false;
		cancelAnimationFrame(raf);
		clearInterval(clock);
	};

	export const play = async (): Promise<number> => {
		await waitForTimeout(START_MS);
		if (!alive) return room.total;
		sailing = true;
		last = performance.now();
		playSound('whoosh');
		raf = requestAnimationFrame(frame);
		clock = setInterval(() => advance(performance.now()), 250);
		await finished;
		await waitForTimeout(END_HOLD_MS);
		return room.total;
	};

	// ---- The wheel ---------------------------------------------------------------------------
	let helmEl = $state<HTMLDivElement>();
	let dragging = $state(false);
	let lastAngle = 0;
	const angleOf = (event: PointerEvent) => {
		const r = helmEl!.getBoundingClientRect();
		return (Math.atan2(event.clientY - (r.top + r.height / 2), event.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
	};
	const hands = $derived(interactive && ended === null && !kraken && reached < depths);
	/** Set the first time the player takes the wheel: the instruction has done its job and goes. */
	let steered = $state(false);
	const grab = (event: PointerEvent) => {
		if (!hands || !helmEl || !event.isPrimary) return;
		dragging = true;
		steered = true;
		helmEl.setPointerCapture(event.pointerId);
		lastAngle = angleOf(event);
	};
	const turn = (event: PointerEvent) => {
		if (!dragging || !hands) return;
		const a = angleOf(event);
		let d = a - lastAngle;
		if (d > 180) d -= 360;
		if (d < -180) d += 360;
		lastAngle = a;
		const before = wheelDeg;
		wheelDeg = clamp(wheelDeg + d, -WHEEL_LOCK, WHEEL_LOCK);
		if (Math.abs(wheelDeg - before) > 0.5) creak();
	};
	const release = () => {
		dragging = false;
		creakStop();
	};

	/**
	 * The wheel creaks while the player turns it: one creak at a time, played again as each runs out
	 * (`CREAK_MS`) rather than restarted on every movement of the hand — and faded out early the
	 * moment the wheel stops (let go, or no movement for CREAK_IDLE_MS), so it never creaks on after
	 * the hand has stopped. Not for the wheel turning by itself — only a player's turn.
	 */
	let creakAt = -Infinity;
	let creakIdle: ReturnType<typeof setTimeout> | undefined;
	const creak = () => {
		const now = performance.now();
		if (now - creakAt >= CREAK_MS) {
			creakAt = now;
			playSound('shipWheel');
		}
		clearTimeout(creakIdle);
		creakIdle = setTimeout(creakStop, CREAK_IDLE_MS);
	};
	const creakStop = () => {
		clearTimeout(creakIdle);
		if (creakAt === -Infinity) return;
		creakAt = -Infinity;
		fadeOutSound('shipWheel', CREAK_FADE_MS);
	};
	onDestroy(creakStop);

	const keyOf = (event: KeyboardEvent) =>
		event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A'
			? -1
			: event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D'
				? 1
				: 0;
	const keyDown = (event: KeyboardEvent) => {
		const d = keyOf(event);
		if (!d || !hands) return;
		// A press (and each repeat of a held key) turns the wheel a notch.
		const before = wheelDeg;
		wheelDeg = clamp(wheelDeg + d * KEY_NOTCH_DEG, -WHEEL_LOCK, WHEEL_LOCK);
		if (wheelDeg !== before) creak();
		steered = true;
		event.preventDefault();
	};

	const place = (x: number, y: number) => `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;

</script>

<svelte:window onkeydown={keyDown} />

<div class="voyage" class:portrait bind:this={rootEl} style="--view-swell:{VIEW_SWELL}; --voyage-w:{PW}px; --gw:{gateW}px; --gh:{gateH}px; --wheel-w:{wheelW}px">
	<!-- Everything out beyond the rail, swelling up and settling under the ship as the table's own
	     view does (Background's `sea-swell`), while the deck and the wheel hold still in front. -->
	<div class="view">
		<!-- The sky, standing on the horizon. Farthest of all, so it pans least. -->
		<img
			class="sky"
			src={SKY}
			alt=""
			draggable="false"
			style="left:{cx - sky.w / 2 - offset * SKY_PAN}px; top:{sky.top}px; width:{sky.w}px"
		/>

		<!-- The sea, from the horizon down, as painted: wide enough to pan as the wheel turns, fading in
		     just below the horizon over the haze at the foot of the sky. -->
		<img
			class="sea"
			src={SEA}
			alt=""
			draggable="false"
			style="left:{cx - sea.w / 2 - offset * SEA_PAN}px; top:{seaTop}px; width:{sea.w}px; --blend:{blend}px"
		/>
		<!-- Its ripples, running down towards the player without a seam and panning with the wheel. Only
		     their light shows: the tile's dark drops out, laid over the sea as a screen. -->
		<div class="sea-flow" style="top:{seaTop}px; --fade:{((H - seaTop) * FLOW_FADE).toFixed(1)}px">
			<div
				class="sea-flow-run"
				style="left:{(-flow.spare - offset * SEA_PAN).toFixed(1)}px; width:{(W + 2 * flow.spare).toFixed(1)}px; height:{(H - seaTop + flow.h).toFixed(1)}px; background-image:url('{SEA_FLOW}'); background-size:{flow.w.toFixed(1)}px {flow.h.toFixed(1)}px; --tile-h:{flow.h.toFixed(1)}px; animation-duration:{FLOW_SECONDS}s"
			></div>
		</div>

		<!-- The cave, standing in the sea, its rocks fading into the water at the foot. Through the hole of
		     its mouth, the treasure cave inside — black far off, and only ever partly seen on the way. -->
		<div
			class="cave"
			style="left:{caveLeft}px; top:{cave.top}px; width:{cave.w}px; height:{cave.h}px; transform:{caveZoom.transform}; transform-origin:{HOLE_CX * 100}% {HOLE_CY * 100}%; --sink:{(caveZoom.sink * 100).toFixed(2)}%; --hole-l:{HOLE.left * 100}%; --hole-w:{(HOLE.right - HOLE.left) * 100}%; --hole-t:{HOLE.top * 100}%; --hole-h:{(HOLE.bottom - HOLE.top) * 100}%"
		>
			<div class="cave-dark"></div>
			<img
				class="cave-inside"
				src={INSIDE}
				alt=""
				draggable="false"
				style="width:{INSIDE_W * 100}%; left:{(INSIDE_CX - INSIDE_W / 2) * 100}%"
			/>
			<div class="cave-dark" style="opacity:{veil.toFixed(3)}"></div>
			<img
				class="cave-front"
				src={CAVE}
				alt=""
				draggable="false"
				style="filter:brightness({(litAt(grow) * (1 - SKULL_DIM * reveal)).toFixed(3)})"
			/>
		</div>

		<!-- The gates, on a layer of their own: a row that came out of the cave earlier is nearer, so it
		     stands in front of every row after it. -->
		<div class="gates">
			{#each Array.from({ length: depths }, (_, d) => d) as depth (depth)}
				{@const row = rowAt(depth)}
				{#if row.live}
					{@const done = depth < reached || kraken?.depth === depth}
					{#each Array.from({ length: cols }, (_, t) => t) as tile (tile)}
						{@const wreck = kraken?.depth === depth && kraken.tile === tile}
						{@const chosen = taken[depth] === tile}
						<div
							class="gate"
							class:wreck
							class:chosen
							class:near={!done && depth === reached && tile === centred && row.size > 0.6}
							class:gone={done && !wreck && !chosen}
							style="z-index:{depths - depth}; transform:{place(laneX(tile, row.size), row.y)} translate(-50%, -100%) scale({row.size.toFixed(4)})"
						>
							<div class="float" style="--bob:{(depth * 3 + tile * 5) % 7}; --lit:{litAt(row.size).toFixed(3)}">
								<img class="barrel" src={BARREL} alt="" draggable="false" />
							</div>
						</div>
					{/each}
				{/if}
			{/each}
		</div>

		<!-- A splash for each barrel taken, rising off the water where it stood: in front of the barrels,
		     and — being out here on the water, under `.view` — behind the deck, which hides its foot. -->
		{#each splashes as splash (splash.id)}
			<div
				class="splash"
				style="left:{splash.x}px; top:{splash.y}px; width:{(gateW * SPLASH_W).toFixed(1)}px; aspect-ratio:{SPLASH_ASPECT}; background-image:url('{SPLASH}'); --foot-x:{SPLASH_FOOT_X * 100}%; --frames:{SPLASH_FRAMES}; --splash-ms:{SPLASH_MS.toFixed(0)}ms"
			></div>
		{/each}

		<!-- The kraken, when it comes: up from behind the deck, the night closing in behind it. -->
		{#if kraken}
			<div class="kraken-dark"></div>
			<img
				class="kraken"
				src={KRAKEN}
				alt=""
				draggable="false"
				style="width:{krakenSize}px; height:{krakenSize}px; left:{cx}px; top:{krakenY}px; --hide:{krakenHide.toFixed(1)}px; --peek:{krakenPeek.toFixed(1)}px; --kraken-ms:{KRAKEN_MS}ms"
			/>
		{/if}
		<!-- The water it throws up either side, over it — and, out on the water, behind the deck, which
		     hides the bottom of each (`KRAKEN_SPLASH_SUNK`). -->
		{#each krakenSplashes as splash (splash.id)}
			<div
				class="splash kraken-splash"
				class:mirror={splash.mirror}
				style="left:{splash.x.toFixed(1)}px; top:{splash.y.toFixed(1)}px; width:{splash.w.toFixed(1)}px; aspect-ratio:{SPLASH_ASPECT}; background-image:url('{SPLASH}'); --foot-x:{SPLASH_FOOT_X * 100}%; --frames:{SPLASH_FRAMES}; --splash-ms:{SPLASH_MS.toFixed(0)}ms"
			></div>
		{/each}

	</div>

	<!-- The ship's deck, in front of the sea, the gates and the kraken, with the wheel set into its ring. -->
	<img class="deck" src={DECK} alt="" draggable="false" style="left:{cx - deckW / 2}px; top:{deckTop}px; width:{deckW}px" />

	<!-- The barrel of gold, on the deck behind the wheel: the barrel's inside, the heap of coins rising
	     out of it as barrels are collected, the barrel's body in front, and the total on its hoop. -->
	<div
		class="gold-barrel"
		style="left:{cx - (GOLD_PX.front.w * barrelU) / 2}px; top:{barrelTop}px; width:{GOLD_PX.front.w * barrelU}px; height:{GOLD_PX.front.h * barrelU}px"
	>
		<img
			class="gold-layer"
			src={GOLD_BACK}
			alt=""
			draggable="false"
			style="left:{GOLD_PX.back.x * barrelU}px; top:{GOLD_PX.back.y * barrelU}px; width:{GOLD_PX.back.w * barrelU}px"
		/>
		<img
			class="gold-layer gold-pile"
			src={GOLD_PILE}
			alt=""
			draggable="false"
			style="left:{GOLD_PX.pile.x * barrelU}px; top:0; width:{GOLD_PX.pile.w * barrelU}px; transform:translateY({((goldTip - GOLD_PX.pile.tip) * barrelU).toFixed(1)}px)"
		/>
		<img class="gold-layer" src={GOLD_FRONT} alt="" draggable="false" style="left:0; top:0; width:100%" />
	</div>
	<!-- The fountains of coins, thrown up off the bow and down into the barrel of gold: over the barrel
	     they land in, under the wheel. -->
	<canvas class="coins" bind:this={coinCanvas} aria-hidden="true"></canvas>

	<!-- Its total, across the top hoop — but outside the barrel's box, so it stands in front of the
	     wheel: the wheel's top handle crosses the hoop, and would cut the number in two. Gone once
	     BonusRound has taken it off to be the round's result (`handTotal`). -->
	{#if goldTotal !== null && !totalHanded}
		<!-- Keyed on the barrels collected, not the number, so it pops for every one — even a stop that
		     pays what the one before it did. -->
		{#key reached}
			<div
				class="gold-total mult-badge"
				bind:this={goldTotalEl}
				style="left:{cx}px; top:{barrelTop + GOLD_LABEL_Y * barrelU}px; font-size:{GOLD_PX.front.w * barrelU * 0.26}px"
			>
				<span class="mult-stroke" aria-hidden="true">{goldTotal}x</span>
				<span class="mult-fill">{goldTotal}x</span>
			</div>
		{/key}
	{/if}

	<!-- What the voyage is doing, in the voice the other rooms speak in (`RoomHint`), just under the
	     title frame. -->
	<div class="caption" style="top:{plateFoot.toFixed(1)}px">
		{#if ended === 'kraken'}
			<RoomHint size="2.6vw" portraitSize="7.4vw">Kraken encountered!</RoomHint>
		{:else if !kraken && reached < depths}
			{#if interactive}
				<RoomHint lines={HINT} shown={!steered} size="2.6vw" portraitSize="7.4vw" />
			{:else}
				<RoomHint lines={['Sailing on']} size="2.6vw" portraitSize="7.4vw" />
			{/if}
		{/if}
	</div>

	<!-- The helm. Dragged round by hand, or by the arrow keys; turned by itself when the voyage is
	     being sailed for the player. -->
	<div
		class="helm"
		class:hands
		class:dragging
		class:steered
		bind:this={helmEl}
		role="slider"
		tabindex={hands ? 0 : -1}
		aria-label="Ship's wheel"
		aria-valuemin={-WHEEL_LOCK}
		aria-valuemax={WHEEL_LOCK}
		aria-valuenow={Math.round(wheelDeg)}
		onpointerdown={grab}
		onpointermove={turn}
		onpointerup={release}
		onpointercancel={release}
	>
		<img class="wheel" src={WHEEL} alt="" draggable="false" style="transform: rotate({wheelDeg.toFixed(1)}deg)" />
	</div>

</div>

<style>
	.voyage {
		position: absolute;
		inset: 0;
		overflow: hidden;
	}
	/* The table's own swell: up and back over ten seconds, eased at both ends so it reads as the sea
	   lifting the ship rather than a bounce. Only ever up: down would open bare sky at the top, while
	   up opens the foot of the screen, which the deck covers and the sea reaches past anyway. Under
	   the deck (4), with everything in it layered among itself. */
	.view {
		position: absolute;
		inset: 0;
		z-index: 3;
		will-change: transform;
		animation: view-swell 10s ease-in-out infinite;
	}
	@keyframes view-swell {
		0%,
		100% {
			transform: translate3d(0, 0, 0);
		}
		50% {
			transform: translate3d(0, calc(var(--view-swell) * -100%), 0);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.view {
			animation: none;
		}
	}
	.sky {
		position: absolute;
		height: auto;
		pointer-events: none;
	}
	.sea-flow {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		overflow: hidden;
		pointer-events: none;
		mix-blend-mode: screen;
		mask-image: linear-gradient(180deg, transparent 0, #000 var(--fade));
		-webkit-mask-image: linear-gradient(180deg, transparent 0, #000 var(--fade));
	}
	/* One tile taller than the water, run down by exactly one tile and round again: the same picture
	   every lap, so the loop never shows. */
	.sea-flow-run {
		position: absolute;
		top: 0;
		background-repeat: repeat;
		will-change: transform;
		animation: sea-flow linear infinite;
	}
	@keyframes sea-flow {
		from {
			transform: translateY(calc(-1 * var(--tile-h)));
		}
		to {
			transform: translateY(0);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sea-flow-run {
			animation: none;
		}
	}
	/* The whole cave — the front and what is seen through its mouth — fades into the sea at its foot. */
	.cave {
		position: absolute;
		/* In front of the barrels (`.gates`, 2) in landscape, where none of them is ever laid over the
		   cave — but behind them in portrait (`.portrait .gates`). Under the kraken and its darkness,
		   which come after it at this level. */
		z-index: 3;
		pointer-events: none;
		mask-image: linear-gradient(180deg, #000 var(--sink), transparent 100%);
		-webkit-mask-image: linear-gradient(180deg, #000 var(--sink), transparent 100%);
		filter: drop-shadow(0 calc(var(--voyage-w) * 0.01) calc(var(--voyage-w) * 0.02) rgba(0, 0, 0, 0.55));
	}
	.cave img {
		position: absolute;
		display: block;
	}
	.cave-front {
		inset: 0;
		width: 100%;
		height: 100%;
	}
	.cave-inside {
		bottom: 0;
		height: auto;
	}
	/* The box the mouth's hole takes up: black behind the inside (its own see-through corners show
	   none of the sea), and black over it as the veil. The front covers all of it but the hole. */
	.cave-dark {
		position: absolute;
		left: var(--hole-l);
		width: var(--hole-w);
		top: var(--hole-t);
		height: var(--hole-h);
		background: #000;
	}
	.sea {
		position: absolute;
		height: auto;
		pointer-events: none;
		mask-image: linear-gradient(180deg, transparent 0, #000 var(--blend));
		-webkit-mask-image: linear-gradient(180deg, transparent 0, #000 var(--blend));
	}

	/*
	 * A gate: a barrel floating on the water, bobbing up and down and rolling a little on the swell as
	 * it comes. Its foot is the point it is placed by, and its size is written on the element each
	 * frame as it comes out of the cave and grows. The one at the middle of the screen is the one the
	 * next row will open, and is lit; the others sit back. Opened, the barrel flashes and is gone
	 * (its multiplier goes up on the barrel of gold, `.gold-total`); the rest of the row sinks away.
	 */
	.gates {
		position: absolute;
		inset: 0;
		z-index: 2;
		pointer-events: none;
	}
	/* On a phone the cave comes right down to the bow by the last rows (it is three screens wide and
	   the screen is short), and stood in front of the barrels it hid the last row outright. The barrels
	   are nearer than the cave, so in portrait they stand over it: at its level, and after it. The
	   kraken and its darkness, after both, still come over them. */
	.voyage.portrait .gates {
		z-index: 3;
	}
	.gate {
		position: absolute;
		left: 0;
		top: 0;
		width: var(--gw);
		height: var(--gh);
		transform-origin: 50% 100%;
		pointer-events: none;
		transition: opacity 220ms ease-out;
	}
	/* Riding the swell: up over each wave and down into the trough behind it, rolling with the slope
	   of the water — leaning back on the way up, forward on the way down. Each barrel has its own
	   place in the swell, so a row never bobs in step. */
	.float {
		position: absolute;
		inset: 0;
		transform-origin: 50% 85%;
		animation: bob 2400ms linear calc(var(--bob) * -340ms) infinite;
	}
	/* Stood on the gate's foot at the gate's width. */
	.barrel {
		position: absolute;
		left: 0;
		bottom: 0;
		display: block;
		width: 100%;
		height: auto;
		transition: filter 200ms ease-out;
		/* Dark far off, coming into its colours as it comes near (`--lit`). */
		filter: brightness(calc(0.85 * var(--lit, 1))) drop-shadow(0 calc(var(--gw) * 0.03) calc(var(--gw) * 0.04) rgba(0, 20, 40, 0.5));
	}
	@keyframes bob {
		0% {
			transform: translateY(0) rotate(-4deg);
			animation-timing-function: ease-out;
		}
		25% {
			transform: translateY(-11%) rotate(0deg);
			animation-timing-function: ease-in;
		}
		50% {
			transform: translateY(0) rotate(4deg);
			animation-timing-function: ease-out;
		}
		75% {
			transform: translateY(9%) rotate(0deg);
			animation-timing-function: ease-in;
		}
		100% {
			transform: translateY(0) rotate(-4deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.float {
			animation: none;
		}
	}
	.gate.near {
		filter: drop-shadow(0 0 calc(var(--gw) * 0.07) rgba(255, 214, 90, 0.95));
	}
	.gate.near .barrel {
		filter: brightness(calc(1.15 * var(--lit, 1)));
	}
	/* The rest of a row once its barrel is taken: they sink and fade as they float on in under the
	   deck. */
	.gate.gone .barrel {
		animation: drift-away 900ms ease-in forwards;
	}
	@keyframes drift-away {
		from {
			transform: translateY(0);
			opacity: 1;
		}
		to {
			transform: translateY(45%);
			opacity: 0;
		}
	}
	/* The chosen barrel flashes and is gone, so the multiplier — or the kraken, which stays — is all
	   that is left where it stood. */
	.gate.chosen .float {
		animation: flash-out 420ms ease-out both;
	}
	@keyframes flash-out {
		0% {
			filter: brightness(1.2);
			opacity: 1;
			transform: scale(1);
		}
		35% {
			filter: brightness(2.6);
			opacity: 1;
			transform: scale(1.1);
		}
		100% {
			filter: brightness(2.6);
			opacity: 0;
			transform: scale(1.4);
		}
	}
	.gate.wreck {
		z-index: 100 !important;
	}
	/*
	 * A barrel's splash: the strip of frames (`SPLASH`) stepped through once, a frame at a time, its foot
	 * on the barrel's foot. `background-position-y` 0% shows the first frame and 100% the last, so
	 * `steps(n, jump-none)` lands on each of the n frames in turn. Over the barrels (`.gates`, 2) — under
	 * the cave and the kraken, which it never reaches — and behind the deck, which is above `.view`.
	 */
	.splash {
		position: absolute;
		z-index: 2;
		pointer-events: none;
		transform: translate(calc(-1 * var(--foot-x)), -100%);
		background-repeat: no-repeat;
		background-size: 100% calc(var(--frames) * 100%);
		animation: splash-frames var(--splash-ms) steps(var(--frames), jump-none) both;
	}
	/* Still over the barrels where they have been raised over the cave (`.voyage.portrait .gates`). */
	.voyage.portrait .splash {
		z-index: 3;
	}
	/* The kraken's: over it and its darkness (3, after them). The mirrored one is flipped about its own
	   foot, so it still rises from the same point. */
	.splash.kraken-splash {
		z-index: 3;
	}
	.splash.mirror {
		transform-origin: var(--foot-x) 100%;
		transform: translate(calc(-1 * var(--foot-x)), -100%) scaleX(-1);
	}
	@keyframes splash-frames {
		from {
			background-position: 0 0%;
		}
		to {
			background-position: 0 100%;
		}
	}
	/*
	 * The kraken, when it comes: it creeps up from below the foot of the screen, behind the deck, until
	 * its eyes are over the rail, sinks back out of sight, and then rears up all at once to fill the
	 * screen — its whole height in landscape, its whole width in portrait — over the sea and the
	 * barrels, but with the deck and the wheel still in front of it. It is a square picture, so the
	 * size is the one number.
	 */
	.kraken {
		position: absolute;
		z-index: 3;
		pointer-events: none;
		transform: translate(-50%, -50%);
		filter: drop-shadow(0 calc(var(--voyage-w) * 0.01) calc(var(--voyage-w) * 0.03) rgba(0, 0, 0, 0.6));
		animation: kraken-rise var(--kraken-ms) both;
	}
	/* Up slowly behind the deck until its eyes are over the rail, a look, back down slowly out of
	   sight, a beat — then up all at once. */
	/* Over the sea, the sky, the cave and the barrels, under the kraken (which comes after it at the
	   same level) and the deck. */
	.kraken-dark {
		position: absolute;
		inset: 0;
		z-index: 3;
		pointer-events: none;
		background: radial-gradient(ellipse at 50% 60%, rgba(0, 0, 0, 0.55), rgba(0, 0, 0, 0.8));
		animation: kraken-dark 600ms ease-out both;
	}
	@keyframes kraken-dark {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	@keyframes kraken-rise {
		0% {
			transform: translate(-50%, -50%) translateY(var(--hide));
			animation-timing-function: cubic-bezier(0.25, 0.6, 0.35, 1);
		}
		46% {
			transform: translate(-50%, -50%) translateY(var(--peek));
		}
		56% {
			transform: translate(-50%, -50%) translateY(var(--peek));
			animation-timing-function: cubic-bezier(0.5, 0, 0.75, 0.6);
		}
		79% {
			transform: translate(-50%, -50%) translateY(var(--hide));
		}
		84% {
			transform: translate(-50%, -50%) translateY(var(--hide));
			animation-timing-function: cubic-bezier(0.2, 0.9, 0.3, 1.1);
		}
		100% {
			transform: translate(-50%, -50%);
		}
	}

	/* Over the scene and the deck; under the win line, which BonusRound draws over the whole room. */
	.caption {
		position: absolute;
		left: 0;
		right: 0;
		z-index: 7;
		padding-top: 0.6vw;
		pointer-events: none;
	}
	:global(.game.portrait) .caption {
		padding-top: 1.6vw;
	}

	/* The deck, over the sea and the gates and under the wheel. */
	.deck {
		position: absolute;
		height: auto;
		pointer-events: none;
		z-index: 4;
	}

	/* The barrel of gold: in front of the deck it stands on (4, and after it), behind the wheel (5) and
	   its own total (`.gold-total`, 6). Its layers spill out of its box — the inside above the rim, the
	   heap above that — so nothing clips it. */
	.gold-barrel {
		position: absolute;
		z-index: 4;
		pointer-events: none;
		filter: drop-shadow(0 calc(var(--voyage-w) * 0.008) calc(var(--voyage-w) * 0.015) rgba(0, 0, 0, 0.6));
	}
	.gold-layer {
		position: absolute;
		display: block;
		height: auto;
		pointer-events: none;
	}
	/* The coins' canvas, the whole room's size: at the barrel's level and after it, so the coins come
	   down over it into its mouth, and under the wheel (5). */
	.coins {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		z-index: 4;
		pointer-events: none;
	}
	/* The heap rises a step at a time, easing up out of the barrel as each barrel's coins land in it. */
	.gold-pile {
		transition: transform 700ms cubic-bezier(0.2, 0.8, 0.3, 1);
	}
	/* The total, in the game's multiplier lettering (`.mult-badge`), across the barrel's top hoop, over
	   the wheel (5). Each barrel collected it goes up and says so: it pops out big and bright, drops
	   back past its size, and bounces to rest (`gold-total-bump`). */
	.gold-total {
		position: absolute;
		z-index: 6;
		pointer-events: none;
		white-space: nowrap;
		transform: translate(-50%, -50%);
		filter: drop-shadow(0 0 calc(var(--voyage-w) * 0.012) rgba(255, 220, 90, 0.9));
		animation: gold-total-bump 900ms both;
	}
	@keyframes gold-total-bump {
		0% {
			transform: translate(-50%, -50%) scale(0.6);
			filter: drop-shadow(0 0 calc(var(--voyage-w) * 0.012) rgba(255, 220, 90, 0.9));
			animation-timing-function: cubic-bezier(0.2, 0.8, 0.4, 1);
		}
		/* Up big, with a hop off the hoop. */
		26% {
			transform: translate(-50%, -75%) scale(2.1);
			filter: drop-shadow(0 0 calc(var(--voyage-w) * 0.045) rgba(255, 230, 120, 1)) brightness(1.4);
			animation-timing-function: ease-in-out;
		}
		46% {
			transform: translate(-50%, -50%) scale(0.78);
			animation-timing-function: ease-in-out;
		}
		63% {
			transform: translate(-50%, -58%) scale(1.3);
			animation-timing-function: ease-in-out;
		}
		78% {
			transform: translate(-50%, -50%) scale(0.9);
			animation-timing-function: ease-in-out;
		}
		90% {
			transform: translate(-50%, -50%) scale(1.06);
			animation-timing-function: ease-in-out;
		}
		100% {
			transform: translate(-50%, -50%) scale(1);
			filter: drop-shadow(0 0 calc(var(--voyage-w) * 0.012) rgba(255, 220, 90, 0.9));
		}
	}

	/* The ship's wheel, bottom middle with its lower half off the screen: only the top of the wheel
	   shows. It is the control, so it is the one thing here that takes pointer events. */
	.helm {
		position: absolute;
		left: 50%;
		translate: -50% 0;
		bottom: calc(var(--wheel-w) * -0.5);
		width: var(--wheel-w);
		aspect-ratio: 1;
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		-webkit-tap-highlight-color: transparent;
		outline: none;
		z-index: 5;
	}
	.helm.hands {
		cursor: grab;
	}
	.helm.hands.dragging {
		cursor: grabbing;
	}
	.wheel {
		display: block;
		width: 100%;
		height: 100%;
		pointer-events: none;
		filter: drop-shadow(0 calc(var(--voyage-w) * 0.012) calc(var(--voyage-w) * 0.02) rgba(0, 0, 0, 0.65));
		transition: transform 90ms linear;
	}
	.helm.dragging .wheel {
		transition: none;
	}
	/* Asked to be turned: a faint swell of light round it while it waits for a hand — only until the
	   player has first taken it. */
	.helm.hands:not(.dragging):not(.steered) .wheel {
		animation: invite 1400ms ease-in-out infinite alternate;
	}
	@keyframes invite {
		from {
			filter: drop-shadow(0 calc(var(--voyage-w) * 0.012) calc(var(--voyage-w) * 0.02) rgba(0, 0, 0, 0.65));
		}
		to {
			filter: drop-shadow(0 0 calc(var(--voyage-w) * 0.03) rgba(255, 214, 90, 0.9));
		}
	}

</style>
