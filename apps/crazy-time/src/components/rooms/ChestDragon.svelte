<script lang="ts">
	/**
	 * The small dragon that lands on the chosen treasure chest, breathes fire over it before the lid
	 * comes off, and then stays perched on it, idling, for the rest of the room.
	 *
	 * The only Spine in the game, and so the only WebGL context: a transparent canvas laid over the
	 * chest board, click-through, with its ticker stopped until the dragon is wanted. It is mounted
	 * with the room and torn down with it — the room is rare, and the atlas is two large pages that
	 * have no business staying decoded for the rest of the session.
	 *
	 * The dragon is not placed by eye. It is placed by its own body: at load, the `Idle` pose is
	 * measured — the middle of its body off the hip and chest bones, its lowest point and its width
	 * off the drawn bounds — and every frame the body is centred over the chest, its feet stood on
	 * the lid, and the whole drawing sized to the chest. So it follows the chest wherever the board
	 * puts it, at whatever size the chest has grown to.
	 *
	 * The chest writes its multiplier on its front, below the lid, so the dragon never has to get out
	 * of the way of it.
	 */
	import '@esotericsoftware/spine-pixi-v8';
	import { Physics, Spine, type TrackEntry } from '@esotericsoftware/spine-pixi-v8';
	import { Application, Assets, type Ticker } from 'pixi.js';
	import { onMount } from 'svelte';

	import { playSound } from '../../game/sound';
	import { staticUrl } from '../../lib/staticUrl';

	type Props = {
		/** The chest to sit on. Nothing is drawn until there is one and `appear` has been called. */
		target?: HTMLElement;
	};
	let { target }: Props = $props();

	const SKELETON = {
		alias: 'chestDragon-skeleton',
		src: staticUrl('spine/dragon_fire/smallDragon.json'),
	};
	const ATLAS = { alias: 'chestDragon-atlas', src: staticUrl('spine/dragon_fire/smallDragon.atlas') };

	/**
	 * Marks in the `Fire` animation, in its own seconds, read off smallDragon.json: the ignition
	 * sequence starts at 2.0, the flame loop is at full from 3.2, starts fading at 6.3 and is gone by
	 * 7.07, and the dragon settles back by 8.27.
	 */
	const FIRE_IGNITE = 2;
	const FIRE_FADE = 6.3;
	/** As authored the animation is over eight seconds; most of the wind-up is skipped... */
	const FIRE_FROM = 1.5;
	/** ...and the rest is played quickly, so the lid is off about 2.7 s after the fire starts. */
	const FIRE_SPEED = 1.8;

	/** The dragon's idle width, as a share of the chest's width. */
	const DRAGON_WIDTH = 0.9;
	/** Where its body is centred across the chest, as a share of the chest's box. */
	const BODY_X = 0.5;
	/** Where its feet stand, as a share of the chest's box from the top: on the lid of the drawing,
	 *  which starts below the headroom the box carries over it. */
	const FEET_Y = 0.44;

	const FADE_IN_MS = 350;
	/** How long a reveal will wait for the dragon to finish loading before going on without it. */
	const READY_WAIT_MS = 1500;

	let host: HTMLDivElement;
	let app: Application | undefined;
	let spine: Spine | undefined;
	/** The idle body's middle, its feet and its width, in the skeleton's own units (see the note at
	 *  the top). */
	let pose = { x: 0, feet: 0, width: 1 };
	let shown = false;
	let destroyed = false;

	let markReady = () => {};
	const ready = new Promise<void>((resolve) => (markReady = resolve));

	type Breath = {
		entry: TrackEntry;
		ignited: boolean;
		onIgnite?: () => void;
		finish: () => void;
	};
	let breath: Breath | null = null;

	const ignite = (current: Breath) => {
		if (current.ignited) return;
		current.ignited = true;
		playSound('whoosh', 0.55, 1.6);
		current.onIgnite?.();
	};

	/** Pose the dragon idling and read its body off the bones and the drawing. */
	const measurePose = (dragon: Spine) => {
		dragon.state.setAnimation(0, 'Idle', true);
		dragon.update(0);
		dragon.skeleton.updateWorldTransform(Physics.update);
		// `Idle` never keys the ignition slot, so its first frame would stay lit at the dragon's mouth
		// for as long as it idles. `Fire` lights it and puts it out again on its own.
		const ember = dragon.skeleton.findSlot('startFire');
		if (ember) ember.pose.color.a = 0;
		const at = (name: string) => dragon.skeleton.findBone(name)?.appliedPose;
		const hip = at('hip');
		const chest = at('chest');
		const bounds = dragon.getLocalBounds();
		pose = {
			x: hip && chest ? (hip.worldX + chest.worldX) / 2 : (bounds.minX + bounds.maxX) / 2,
			feet: bounds.maxY,
			width: bounds.width || 1,
		};
	};

	/** Stand the dragon on the chest. Rects are page pixels (the game's CSS zoom applied); the
	 *  renderer draws in the host's own pixels, so everything measured is divided back out of the
	 *  zoom. */
	const place = () => {
		if (!spine || !target) return;
		const box = host.getBoundingClientRect();
		if (!box.width || !host.clientWidth) return;
		const zoom = box.width / host.clientWidth;
		const chest = target.getBoundingClientRect();
		const width = chest.width / zoom;
		const scale = (width * DRAGON_WIDTH) / pose.width;
		const bodyX = (chest.left - box.left) / zoom + width * BODY_X;
		const feetY = (chest.top - box.top) / zoom + (chest.height / zoom) * FEET_Y;
		spine.scale.set(scale);
		spine.position.set(bodyX - pose.x * scale, feetY - pose.feet * scale);
	};

	const tick = (ticker: Ticker) => {
		if (!spine) return;
		const dt = Math.min(48, Math.max(0, ticker.deltaMS));
		if (shown && spine.alpha < 1) spine.alpha = Math.min(1, spine.alpha + dt / FADE_IN_MS);
		spine.visible = spine.alpha > 0;
		place();
		spine.update(dt / 1000);
		const current = breath;
		if (!current) return;
		if (current.entry.trackTime >= FIRE_IGNITE) ignite(current);
		if (current.entry.trackTime >= FIRE_FADE) current.finish();
	};

	/** Bring the dragon in, idling, on the chest. It stays until the room is torn down. */
	export const appear = () => {
		shown = true;
		app?.ticker.start();
	};

	/**
	 * Breathe fire on the chest. Resolves as the flames start to die back, which is when the lid
	 * should come off; the dragon finishes the breath and goes back to idling on its own.
	 *
	 * Never holds the round up: if the dragon has not loaded in time it resolves straight away, and
	 * the wait is also on a wall-clock timer, because the ticker runs on animation frames and a
	 * hidden tab gets none.
	 */
	type BreatheOptions = { onIgnite?: () => void };
	export const breathe = async (options: BreatheOptions = {}): Promise<void> => {
		const { onIgnite } = options;
		const loaded = await Promise.race([
			ready.then(() => true),
			new Promise<boolean>((resolve) => setTimeout(() => resolve(false), READY_WAIT_MS)),
		]);
		if (!loaded || !spine || destroyed) return;
		appear();
		const entry = spine.state.setAnimation(0, 'Fire', false);
		entry.trackTime = FIRE_FROM;
		entry.timeScale = FIRE_SPEED;
		spine.state.addAnimation(0, 'Idle', true, 0);

		const toIgnite = ((FIRE_IGNITE - FIRE_FROM) / FIRE_SPEED) * 1000;
		const toFade = ((FIRE_FADE - FIRE_FROM) / FIRE_SPEED) * 1000;
		await new Promise<void>((resolve) => {
			const timers = [
				setTimeout(() => breath && ignite(breath), toIgnite + 250),
				setTimeout(() => breath?.finish(), toFade + 400),
			];
			const current: Breath = {
				entry,
				ignited: false,
				onIgnite,
				finish: () => {
					for (const timer of timers) clearTimeout(timer);
					ignite(current);
					if (breath === current) breath = null;
					resolve();
				},
			};
			breath = current;
		});
	};

	const init = async () => {
		const application = new Application();
		await application.init({
			resizeTo: host,
			backgroundAlpha: 0,
			// Off, as in the Plinko's overlays: a freshly cleared MSAA buffer can composite as an opaque
			// white box for a frame on some GPUs, and the dragon's edges are alpha anyway.
			antialias: false,
			autoDensity: true,
			resolution: Math.min(2, window.devicePixelRatio || 1),
			preference: 'webgl',
		});
		if (destroyed) {
			application.destroy(true);
			return;
		}
		host.appendChild(application.canvas);
		application.ticker.stop();
		application.ticker.add(tick);
		app = application;

		for (const { alias, src } of [SKELETON, ATLAS]) {
			if (!Assets.resolver.hasKey(alias)) Assets.add({ alias, src });
		}
		try {
			await Assets.load([SKELETON.alias, ATLAS.alias]);
		} catch (err) {
			console.error('[ChestDragon] failed to load the dragon', err);
			return;
		}
		if (destroyed) return;

		const dragon = Spine.from({ skeleton: SKELETON.alias, atlas: ATLAS.alias, autoUpdate: false });
		dragon.state.data.defaultMix = 0.25;
		measurePose(dragon);
		dragon.alpha = 0;
		application.stage.addChild(dragon);
		spine = dragon;
		markReady();
		if (shown) application.ticker.start();
	};

	onMount(() => {
		void init();
		return () => {
			destroyed = true;
			breath?.finish();
			const hadDragon = Boolean(spine);
			spine?.destroy();
			spine = undefined;
			if (app) {
				app.ticker.remove(tick);
				app.destroy(true, { children: true, texture: false });
				app = undefined;
			}
			if (hadDragon) void Assets.unload([SKELETON.alias, ATLAS.alias]).catch(() => {});
		};
	});
</script>

<div class="dragon" bind:this={host} aria-hidden="true"></div>

<style>
	/* Over the board with room to spare on every side: the dragon stands on the lid of the chest it
	   is breathing on, which by then has grown to three columns in the middle, and its wings and fire
	   reach well past the chest's own box. */
	.dragon {
		position: absolute;
		inset: calc(var(--cell) * -1.5);
		pointer-events: none;
		z-index: 6;
	}
	.dragon :global(canvas) {
		display: block;
		width: 100%;
		height: 100%;
	}
</style>
