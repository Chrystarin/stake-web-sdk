<script lang="ts">
	/**
	 * Ocean Voyage v2: the same voyage, steered with the ship's wheel. Played only when it is bought
	 * with the Buy Bonus screen's v2 button (see `voyageVersion`); the wheel's own landings and every
	 * replay play the original, RoomOceanVoyage.
	 *
	 * The skull cave stands in the sea at the top of the screen and grows as the voyage goes on, until
	 * it is wider than the viewport. Ten rows of three barrels lie out on the water between it and the
	 * player from the start, smaller the further off, and float in towards the player, growing as they
	 * come (`rowAt`). There is no boat: the player is looking out over
	 * the bow, and the wheel pans the whole scene — the sea, the cave and the barrels — left and right.
	 * The barrel at the centre of the screen when a row reaches the tip of the deck is the one the
	 * player has chosen. It is taken (it flashes and is gone) and the multiplier of that stop pops up
	 * and floats away as if collected — or the kraken, which rises up from behind the deck.
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
	import { playSound } from '../../game/sound';
	import { staticPath } from '../../lib/staticUrl';
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
	const INSIDE_ASPECT = 941 / 1671;
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
	/** The line of rows reaches back to the cave's waterline, but never further up than this share of
	    the way from the horizon down to the bow. */
	const CAVE_FOOT_MAX = 0.6;
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
	const FLOW_SECONDS = 18;
	const FLOW_FADE = 0.45;
	/** The sky picture, height over width. Its foot stands on the sea's horizon. */
	const SKY_ASPECT = 597 / 1526;
	const SKY_PAN = 0.15;
	/** The deck's picture, and where the ring its wheel sits in is centred in it. */
	const DECK_PX = { w: 1928, ring: 710, ringY: 690, tip: 250 };
	/** How far a landscape deck is let down below the foot of the screen, as a share of the height. */
	const DECK_SINK = 0.1;
	/** How far the sea fades in below the horizon, over the haze at the foot of the sky (layout pixels at 1024 wide). */
	const BLEND_PX = 40;

	/** Time on the water before the sea starts moving. */
	const START_MS = 900;
	/** How long a collected multiplier floats up before it fades. */
	const POP_MS = 1500;
	/** The kraken's beat before the screen moves on. */
	const SINK_MS = 1300;
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
	/** How long the scene takes to settle to the middle once the last gate is open. */
	const SETTLE_SECONDS = 1.8;
	/** How quickly the scene pans to where the wheel points it. */
	const PAN_TAU = 0.3;
	/** How much of the pan the sea and the cave follow — the far things move less. */
	const SEA_PAN = 0.7;
	const CAVE_PAN = 0.35;
	/** The wheel's lock, each way, and how far an arrow key turns it a press. */
	const WHEEL_LOCK = 110;
	const KEY_NOTCH_DEG = 12;
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
	 * its waterline at the foot of its mouth; the line of rows reaches back to it, but never further
	 * up than CAVE_FOOT_MAX of the way from the horizon to the bow, so there is always water for it.
	 */
	const caveAt = (p: number) => {
		const w = W * (layout.startW + (layout.endW - layout.startW) * p);
		const h = w / CAVE_ASPECT;
		const foot0 = horizonY + layout.startFoot * H;
		const foot = foot0 + (layout.endFoot * H - foot0) * p;
		const top = foot - h;
		const waterY = top + h * CAVE_MOUTH;
		const lowest = horizonY + CAVE_FOOT_MAX * (hitY - horizonY);
		return { w, h, top, waterY, mouthY: Math.min(waterY, lowest) };
	};
	/**
	 * How far the cave has grown (0-1) at `t` seconds: it comes in with the last row of barrels, growing
	 * as that row grows (`rowAt`) — hardly at all far off, then faster and faster — and is at its full
	 * size as that row reaches the bow. The row's growth is taken as the line of rows is laid out at the
	 * start (`chainFrom` the cave's first foot), since the line itself closes up as the cave comes in.
	 */
	const approach = (t: number) => {
		const { r } = chainFrom(caveAt(0).mouthY);
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
	 * The way into the treasure: with the last gate open — the voyage's top multiplier — the skull
	 * fades away and the inside of the cave grows from its mouth to fill the screen, the whole of it
	 * shown at last (0 to 1, over the scene's settling).
	 */
	const zoom = $derived.by(() => {
		if (ended === 'port') return 1;
		if (!settling) return 0;
		return dock * dock * (3 - 2 * dock);
	});
	/** The veil over the inside of the cave: pitch black far off, and lifting as the cave comes near —
	    but only so far (INSIDE_PEEK); the rest of it lifts only on the way in. */
	const veil = $derived.by(() => {
		const t = clamp((grow - 0.15) / 0.8, 0, 1);
		return (1 - INSIDE_PEEK * t * t * (3 - 2 * t)) * (1 - zoom);
	});
	/** The inside of the cave, where it stands in the mouth, and where it ends up: the whole picture, as
	    big as fits the screen (above the wheel, in portrait). */
	const insideRect = $derived.by(() => {
		const w = INSIDE_W * cave.w;
		const h = w * INSIDE_ASPECT;
		const from = { x: caveLeft + (INSIDE_CX - INSIDE_W / 2) * cave.w, y: cave.top + cave.h - h, w, h };
		const tw = Math.min(W, H / INSIDE_ASPECT);
		const th = tw * INSIDE_ASPECT;
		const to = { x: (W - tw) / 2, y: (portrait ? H * 0.4 : H / 2) - th / 2, w: tw, h: th };
		const mix = (a: number, b: number) => a + (b - a) * zoom;
		return { x: mix(from.x, to.x), y: mix(from.y, to.y), w: mix(from.w, to.w), h: mix(from.h, to.h) };
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

	/** The gates are barrels floating on the water, standing on the row's line by their foot. */
	/** Smaller in landscape, where the horizon is low and there is only a short stretch of sea between
	    the cave and the bow for the rows to lie out on with water between them. */
	const gateW = $derived(PW * (portrait ? 0.28 : 0.17));
	const gateH = $derived(gateW * BARREL_ASPECT);
	const pitch = $derived(PW * (portrait ? 0.4 : 0.3));
	const cx = $derived(W / 2);
	/** A row is opened as its barrels' feet come right up to the tip of the deck's bow. */
	const hitY = $derived(deckTop + DECK_PX.tip * deckScale - 4);
	/** The sky stands on the sea (its foot under the sea's fade), wide enough to fill the screen above
	    it however far it is panned. */
	const sky = $derived.by(() => {
		const foot = seaTop + blend;
		const w = Math.max(W + 2 * pitch * SKY_PAN + 8, foot / SKY_ASPECT + 8);
		return { w, top: foot - w * SKY_ASPECT };
	});
	/** The sea, from its top to the foot of the screen, wide enough to pan with the wheel. */
	const sea = $derived({ w: Math.max(W + 2 * pitch * SEA_PAN + 8, (H - seaTop) / SEA_ASPECT + 8) });
	/** The ripples over it: one tile's size, and how much they reach past the screen each side to pan. */
	const flow = $derived.by(() => {
		const w = FLOW_TILE * Math.max(W, H);
		return { w, h: w * FLOW_ASPECT, spare: pitch * SEA_PAN + 8 };
	});

	/** The kraken takes up the whole height in landscape and the whole width in portrait. */
	const krakenSize = $derived(portrait ? W : H);
	const krakenY = $derived(portrait ? H * 0.45 : H / 2);
	/** How far it rises: from wholly below the foot of the screen to where it stands. */
	const krakenRise = $derived(H - (krakenY - krakenSize / 2));

	/** Rows opened so far. */
	let reached = $state(0);
	let kraken = $state<{ depth: number; tile: number } | null>(null);
	let ended = $state<'kraken' | 'port' | null>(null);
	/** The gate of the row just opened, for its flash. */
	let opened = $state<{ depth: number; tile: number } | null>(null);
	/** Multipliers just collected, each floating up off the gate it came from. */
	type Pop = { id: number; value: number; x: number; y: number; last: boolean };
	let pops = $state<Pop[]>([]);
	let popId = 0;
	/** True while the voyage is under way. */
	let sailing = $state(false);
	/** The scene settling to the middle after the last gate, and how far along it is (0-1). */
	let settling = $state(false);

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
	 * The line reaches back no further than the cave's foot (the bottom middle of its mouth), so as the
	 * cave comes in the rows behind close up (`r` falls; at the very end, with the cave at the bow and
	 * no room left, the last rows may touch). Each row still comes to the bow exactly when it always
	 * has, ROW_SECONDS after the one before it.
	 */
	const chainFrom = (footY: number) => {
		const reach = Math.max(gateH * 0.5, hitY - footY - gateH * 0.05);
		return { reach, r: clamp(1 - ((1 + ROW_GAP) * gateH) / reach, ROW_SHRINK_MIN, 0.95) };
	};
	const rowChain = $derived(chainFrom(cave.mouthY));
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
		opened = { depth, tile };
		if (depth >= room.dived) {
			// The row the book ends the voyage at: whichever gate is at the middle, the kraken is behind it.
			kraken = { depth, tile };
			stop();
			playSound('doorClose');
			void waitForTimeout(SINK_MS).then(() => {
				ended = 'kraken';
				finish();
			});
			return;
		}
		const id = popId++;
		pops = [
			...pops,
			{ id, value: room.depths[depth], x: cx, y: hitY - gateH * 0.55, last: depth === depths - 1 },
		];
		// The last one stays up for the win line; the rest are gone once they have floated off.
		if (depth < depths - 1) void waitForTimeout(POP_MS + 100).then(() => (pops = pops.filter((q) => q.id !== id)));
		reached = depth + 1;
		playSound('pop', 1 + depth * 0.04);
		if (reached >= depths) {
			// The last gate: the voyage is made, and the scene comes to rest at the middle.
			settling = true;
			dock = 0;
			playSound('whoosh');
		}
	};

	let dock = $state(0);
	const step = (dt: number) => {
		if (!sailing) return;
		T += dt;

		if (settling) {
			dock = Math.min(1, dock + dt / SETTLE_SECONDS);
			offset += (0 - offset) * (1 - Math.exp(-dt / 0.25));
			wheelDeg += (0 - wheelDeg) * (1 - Math.exp(-dt / 0.2));
			if (dock >= 1) {
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
		wheelDeg = clamp(wheelDeg + d, -WHEEL_LOCK, WHEEL_LOCK);
	};
	const release = () => (dragging = false);

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
		wheelDeg = clamp(wheelDeg + d * KEY_NOTCH_DEG, -WHEEL_LOCK, WHEEL_LOCK);
		steered = true;
		event.preventDefault();
	};

	const place = (x: number, y: number) => `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;

</script>

<svelte:window onkeydown={keyDown} />

<div class="voyage" bind:this={rootEl} style="--voyage-w:{PW}px; --gw:{gateW}px; --gh:{gateH}px; --wheel-w:{wheelW}px">
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
		style="left:{caveLeft}px; top:{cave.top}px; width:{cave.w}px; height:{cave.h}px; opacity:{(1 - zoom).toFixed(3)}; --sink:{CAVE_SINK * 100}%; --hole-l:{HOLE.left * 100}%; --hole-w:{(HOLE.right - HOLE.left) * 100}%; --hole-t:{HOLE.top * 100}%; --hole-h:{(HOLE.bottom - HOLE.top) * 100}%"
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
		<img class="cave-front" src={CAVE} alt="" draggable="false" style="filter:brightness({litAt(grow).toFixed(3)})" />
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
					{@const chosen = opened?.depth === depth && opened.tile === tile}
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

	<!-- The way in, once the top multiplier is reached: the inside of the cave grows from the mouth to
	     fill the screen, coming out of the dark as it goes, over a black that hides the sea behind it. -->
	{#if zoom > 0}
		<div class="zoom-dark" style="opacity:{zoom.toFixed(3)}"></div>
		<div
			class="inside-zoom"
			style="left:{insideRect.x.toFixed(1)}px; top:{insideRect.y.toFixed(1)}px; width:{insideRect.w.toFixed(1)}px; height:{insideRect.h.toFixed(1)}px; opacity:{Math.min(1, zoom * 3).toFixed(3)}"
		>
			<img src={INSIDE} alt="" draggable="false" style="filter:brightness({(1 - (1 - INSIDE_PEEK) * (1 - zoom)).toFixed(3)})" />
		</div>
	{/if}

	<!-- The kraken, when it comes: up from behind the deck. -->
	{#if kraken}
		<img
			class="kraken"
			src={KRAKEN}
			alt=""
			draggable="false"
			style="width:{krakenSize}px; height:{krakenSize}px; left:{cx}px; top:{krakenY}px; --rise:{krakenRise.toFixed(1)}px"
		/>
	{/if}

	<!-- The ship's deck, in front of the sea, the gates and the kraken, with the wheel set into its ring. -->
	<img class="deck" src={DECK} alt="" draggable="false" style="left:{cx - deckW / 2}px; top:{deckTop}px; width:{deckW}px" />

	{#each pops as pop (pop.id)}
		<div class="pop mult-badge" class:last={pop.last} style="left:{pop.x}px; top:{pop.y}px; --rise:{H * 0.22}px; --pop-ms:{POP_MS}ms">
			<span class="mult-stroke" aria-hidden="true">{pop.value}x</span>
			<span class="mult-fill">{pop.value}x</span>
		</div>
	{/each}

	<!-- What the voyage is doing, in the voice the other rooms speak in (`RoomHint`), just under the
	     title frame. -->
	<div class="caption" style="top:{plateFoot.toFixed(1)}px">
		{#if ended === 'kraken'}
			<RoomHint size="2.6vw" portraitSize="7.4vw">Kraken at stop {(kraken?.depth ?? 0) + 1}</RoomHint>
		{:else if ended === 'port'}
			<RoomHint size="2.6vw" portraitSize="7.4vw">Made port</RoomHint>
		{:else if interactive}
			<RoomHint lines={HINT} shown={!steered} size="2.6vw" portraitSize="7.4vw" />
		{:else}
			<RoomHint lines={['Sailing on']} size="2.6vw" portraitSize="7.4vw" />
		{/if}
	</div>

	<!-- The helm. Dragged round by hand, or by the arrow keys; turned by itself when the voyage is
	     being sailed for the player. -->
	<div
		class="helm"
		class:hands
		class:dragging
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
	/* Over the gates, under the deck and the multiplier. */
	.zoom-dark {
		position: absolute;
		inset: 0;
		z-index: 3;
		background: #000;
		pointer-events: none;
	}
	.inside-zoom {
		position: absolute;
		z-index: 3;
		pointer-events: none;
	}
	.inside-zoom img {
		display: block;
		width: 100%;
		height: 100%;
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
	 * (`.pop` collects its multiplier); the rest of the row sinks away.
	 */
	.gates {
		position: absolute;
		inset: 0;
		z-index: 2;
		pointer-events: none;
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
	.barrel {
		display: block;
		width: 100%;
		height: 100%;
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
	.gate.gone {
		opacity: 0 !important;
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
	 * The kraken, when it comes: it slides up from below the foot of the screen, behind the deck, and
	 * rears over the rail to fill the screen — its whole height in landscape, its whole width in
	 * portrait — over the sea and the barrels, but with the deck and the wheel still in front of it.
	 * It is a square picture, so the size is the one number.
	 */
	.kraken {
		position: absolute;
		z-index: 3;
		pointer-events: none;
		transform: translate(-50%, -50%);
		filter: drop-shadow(0 calc(var(--voyage-w) * 0.01) calc(var(--voyage-w) * 0.03) rgba(0, 0, 0, 0.6));
		animation: kraken-rise 900ms cubic-bezier(0.2, 0.9, 0.3, 1.08) both;
	}
	@keyframes kraken-rise {
		from {
			transform: translate(-50%, -50%) translateY(var(--rise));
		}
		to {
			transform: translate(-50%, -50%);
		}
	}

	/* A multiplier collected: it pops up glowing where the gate opened and floats up and away, as if
	   gathered. It carries the game's own multiplier lettering (`.mult-badge`). The last one of a
	   voyage stays up, glowing, for the win line. */
	.pop {
		position: absolute;
		z-index: 6;
		font-size: calc(var(--voyage-w) * 0.1);
		white-space: nowrap;
		pointer-events: none;
		transform: translate(-50%, -50%);
		filter: drop-shadow(0 0 calc(var(--voyage-w) * 0.016) rgba(255, 220, 90, 1))
			drop-shadow(0 0 calc(var(--voyage-w) * 0.04) rgba(255, 180, 40, 0.85));
		animation: collect var(--pop-ms) cubic-bezier(0.2, 0.7, 0.3, 1) both;
	}
	.pop.last {
		animation: collect-last 700ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
	}
	@keyframes collect {
		0% {
			transform: translate(-50%, -50%) scale(0.3);
			opacity: 0;
		}
		14% {
			transform: translate(-50%, -70%) scale(1.25);
			opacity: 1;
		}
		30% {
			transform: translate(-50%, calc(-50% - var(--rise) * 0.3)) scale(1);
			opacity: 1;
		}
		100% {
			transform: translate(-50%, calc(-50% - var(--rise))) scale(0.9);
			opacity: 0;
		}
	}
	@keyframes collect-last {
		0% {
			transform: translate(-50%, -50%) scale(0.3);
			opacity: 0;
		}
		100% {
			transform: translate(-50%, calc(-50% - var(--rise) * 0.4)) scale(1.3);
			opacity: 1;
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
	/* Asked to be turned: a faint swell of light round it while it waits for a hand. */
	.helm.hands:not(.dragging) .wheel {
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
