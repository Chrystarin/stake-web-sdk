import '@esotericsoftware/spine-pixi-v8';
import { type Bone, Spine, Vector2 } from '@esotericsoftware/spine-pixi-v8';
import { Application, Assets, UPDATE_PRIORITY, type Ticker } from 'pixi.js';

import { isLite } from '../deviceTier.svelte';
import { staticNetworkUrl } from '../staticUrl';

/**
 * The captain on the Buy Bonus screen (components/BuyBonusModal.svelte), drawn from the artist's
 * Spine skeleton (static/spine/buy_bonus_captain) on a small transparent canvas where her still
 * (img/buy-bonus/character.webp, 932x1070) stands: the right of a WIDE landscape screen, her
 * lower half off its bottom edge. Her one animation is a 6.67 s idle (breathing, a blink, the hat,
 * hair and earrings swaying) that loops seamlessly, so it simply loops from its start.
 *
 * The skeleton was authored over the cabin's landscape picture, with the picture's foot on its
 * origin and the captain standing on it — the still is that same pose cut at the picture's foot.
 * She is laid on the still's own box (STILL_*, measured by overlaying the two), so the still under
 * the canvas and the canvas over it agree to the pixel and the hand-over between them never shows.
 *
 * The canvas is the still's box let out at the top and the left (PAD_*): her hat and hair sway a
 * little past the still's edges, and the still's box would clip them.
 *
 * Aliases and files are kept here so the intro preload warms exactly what this mounts.
 */
export const CAPTAIN_SPINE = {
	skeleton: { alias: 'buyBonusCaptain-skeleton', path: 'spine/buy_bonus_captain/skeleton.json' },
	atlas: { alias: 'buyBonusCaptain-atlas', path: 'spine/buy_bonus_captain/skeleton.atlas' },
	pages: ['spine/buy_bonus_captain/skeleton.webp'],
} as const;
/** Every file the skeleton loads — for the preload's drift alarm. */
export const CAPTAIN_FILES: readonly string[] = [
	CAPTAIN_SPINE.skeleton.path,
	CAPTAIN_SPINE.atlas.path,
	...CAPTAIN_SPINE.pages,
];

/** Register and load the skeleton into Pixi's cache. Idempotent; rejects if anything fails. */
export const loadCaptainSpine = async (): Promise<void> => {
	const { skeleton, atlas } = CAPTAIN_SPINE;
	for (const { alias, path } of [skeleton, atlas]) {
		if (!Assets.resolver.hasKey(alias)) Assets.add({ alias, src: staticNetworkUrl(path) });
	}
	await Assets.load([skeleton.alias, atlas.alias]);
};

const ANIMATION = 'animation';

/** The still's size, in its pixels. */
const STILL_W = 932;
const STILL_H = 1070;
/**
 * The skeleton in the still's frame: where its origin falls (still pixels, from the top-left) and
 * still pixels per skeleton unit.
 */
const STILL_ORIGIN_X = 463;
const STILL_ORIGIN_Y = 1070;
const STILL_PER_UNIT = 1;

/**
 * How far the canvas runs past the still's box, as shares of the still's width (left) and height
 * (top). The same two numbers are in BuyBonusModal.svelte's `.bb-captain` — keep them in step.
 */
export const PAD_LEFT = 0.04;
export const PAD_TOP = 0.06;

/** Frame-time cap: a stall pauses her rather than skipping ahead. */
const MAX_STEP_SECONDS = 0.1;

/**
 * HER GAZE. In the rig each pupil swings on an IK bone (`wink8`, `wink6`) aimed at a target bone in
 * front of her face (`target3`, `target`), and her idle animation moves those targets to glance
 * left and up. The two swings are not matched: the far eye's pupil sits 5.4 units out from its
 * pivot, the near eye's 15.5, so one target offset moves the near pupil two to three times as far
 * as the far one, and the far one tops out at ~5 units. Led by the targets, her eyes part company.
 *
 * So while the player's pointer is moving she looks at it by moving the PUPILS themselves, both by
 * one gaze, the way eyes move together: the targets are held at rest (the IK leaves the pupils
 * where they look straight ahead), then each pupil is moved off that place by the same gaze,
 * the far one by FAR_EYE of it — its eye is smaller and turned away, so the same look covers less
 * of the screen. The pupils are plain meshes on their own bones, under the head's art, which is
 * what masks them to the eye openings.
 *
 * The gaze is the pointer's direction from her face, at most GAZE_LEFT / GAZE_RIGHT / GAZE_UP /
 * GAZE_DOWN units for the near eye — sized off the openings, so the iris never slides out of sight
 * into a corner. A pointer within GAZE_FULL_AT units of her face gets less than the full reach, so
 * the eyes settle as it nears them rather than flicking across.
 *
 * She watches the SELECTION only — the chip row and the mode cards, and the gap between them (the
 * box around both, from the screen's `selection` getter) — so her eyes go to the chips, then follow
 * the pointer across to the modes. Off the selection she looks at the nearest point of it, less
 * and less as the pointer goes further, and none from GAZE_FADE (a share of the selection's height)
 * out: her eyes ease back to her own animated glances. Her look comes in over GAZE_IN_S and goes
 * back over the slower GAZE_OUT_S, so the return is gradual. A pointer leaving the page sends her
 * back too, and so does a finger GAZE_TOUCH_MS after it lifted (a tap leaves no pointer to watch).
 * GAZE_FOLLOW_S is how quickly the eyes catch the pointer.
 */
const GAZE_TARGETS = ['target3', 'target'] as const;
/** The near eye's pupil, then the far eye's, and how much of the gaze each one takes. */
const FAR_EYE = 0.75;
const GAZE_PUPILS = [
	{ bone: 'pupil1', share: 1 },
	{ bone: 'pupil2', share: FAR_EYE },
] as const;
/**
 * Skeleton units, for the near eye. Right is shorter than left: her irises rest left of the middle
 * of the openings. Up and down are short: the lids sit close over the iris.
 */
const GAZE_LEFT = 10;
const GAZE_RIGHT = 7;
const GAZE_UP = 6;
const GAZE_DOWN = 4;
const GAZE_FULL_AT = 300;
const GAZE_FADE = 0.35;
const GAZE_TOUCH_MS = 2500;
const GAZE_IN_S = 0.4;
const GAZE_OUT_S = 1.2;
const GAZE_FOLLOW_S = 0.08;

type GazeTarget = { pose: { x: number; y: number }; restX: number; restY: number };
type GazePupil = { bone: Bone; share: number };
/** The elements she watches the pointer over; missing ones are skipped. */
export type GazeSelection = () => readonly (Element | null | undefined)[];

/**
 * The captain on a transparent WebGL canvas filling `host`. Backing store at the device's pixel
 * ratio times any CSS `zoom` above it, capped at 2 (1 on the reduced budget, which shows the still
 * instead and never makes one). `onLost` is called if the browser takes the canvas's context back,
 * so the screen can fall back to the still. `selection` is what her eyes follow the pointer over.
 */
export class CaptainScene {
	private readonly host: HTMLElement;
	private readonly onLost: () => void;
	private readonly selection: GazeSelection;
	private app?: Application;
	private captain?: Spine;
	private observer?: ResizeObserver;
	private destroyed = false;
	/** The look-at targets, their poses and where her setup pose has them. */
	private gaze: GazeTarget[] = [];
	private pupils: GazePupil[] = [];
	private readonly scratch = new Vector2();
	/** Her face, between the two rest targets (skeleton units, y up). */
	private faceX = 0;
	private faceY = 0;
	/** The pointer, in client pixels; whether it is on the page; a finger's, when it last moved. */
	private pointerX = 0;
	private pointerY = 0;
	private pointerIn = false;
	private touchAt = -Infinity;
	/** The offset the eyes are at, and how much of their aim is the pointer's (0: the animation's). */
	private gazeX = 0;
	private gazeY = 0;
	private gazeWeight = 0;

	constructor(host: HTMLElement, onLost: () => void, selection: GazeSelection = () => []) {
		this.host = host;
		this.onLost = onLost;
		this.selection = selection;
	}

	/**
	 * Resolves true once her first frame is on the canvas — the caller hides the still then, not
	 * before — and false if the scene could not be put up (the still stays).
	 */
	async init(): Promise<boolean> {
		try {
			await loadCaptainSpine();
		} catch (error) {
			console.error('[CaptainScene] assets failed to load', error);
			return false;
		}
		if (this.destroyed || !this.host.clientWidth || !this.host.clientHeight) return false;

		const app = new Application();
		try {
			await app.init({
				width: this.host.clientWidth,
				height: this.host.clientHeight,
				backgroundAlpha: 0,
				antialias: false,
				autoDensity: true,
				resolution: this.resolution(),
				preference: 'webgl',
			});
		} catch (error) {
			console.error('[CaptainScene] no canvas', error);
			return false;
		}
		if (this.destroyed) {
			app.destroy(true);
			return false;
		}
		app.canvas.style.display = 'block';
		app.canvas.addEventListener('webglcontextlost', this.lost);
		this.host.appendChild(app.canvas);
		this.app = app;

		const captain = Spine.from({
			skeleton: CAPTAIN_SPINE.skeleton.alias,
			atlas: CAPTAIN_SPINE.atlas.alias,
			autoUpdate: false,
		});
		captain.state.setAnimation(0, ANIMATION, true);
		this.gaze = GAZE_TARGETS.flatMap((name) => {
			const bone = captain.skeleton.findBone(name);
			if (!bone) return [];
			const pose = bone.getPose();
			return [{ pose, restX: pose.x, restY: pose.y }];
		});
		if (this.gaze.length) {
			this.faceX = this.gaze.reduce((sum, t) => sum + t.restX, 0) / this.gaze.length;
			this.faceY = this.gaze.reduce((sum, t) => sum + t.restY, 0) / this.gaze.length;
		}
		this.pupils = GAZE_PUPILS.flatMap(({ bone, share }) => {
			const found = captain.skeleton.findBone(bone);
			return found ? [{ bone: found, share }] : [];
		});
		// After her animation has placed the targets, before the IK aims the pupils at them; and the
		// pupils moved by the gaze once the IK has put them.
		captain.beforeUpdateWorldTransforms = this.aim;
		captain.afterUpdateWorldTransforms = this.look;
		captain.update(0);
		app.stage.addChild(captain);
		this.captain = captain;
		window.addEventListener('pointermove', this.pointerMoved, { passive: true });
		window.addEventListener('pointerdown', this.pointerMoved, { passive: true });
		document.documentElement.addEventListener('pointerleave', this.pointerLeft);

		this.place();
		this.observer = new ResizeObserver(() => this.place());
		this.observer.observe(this.host);
		app.ticker.add(this.tick);

		// Her first frame: a utility-priority callback runs after the ticker's own render.
		await new Promise<void>((resolve) => app.ticker.addOnce(() => resolve(), undefined, UPDATE_PRIORITY.UTILITY));
		return !this.destroyed;
	}

	destroy(): void {
		this.destroyed = true;
		this.observer?.disconnect();
		this.observer = undefined;
		window.removeEventListener('pointermove', this.pointerMoved);
		window.removeEventListener('pointerdown', this.pointerMoved);
		document.documentElement.removeEventListener('pointerleave', this.pointerLeft);
		this.gaze = [];
		this.pupils = [];
		const app = this.app;
		this.app = undefined;
		this.captain = undefined;
		if (!app) return;
		app.ticker.remove(this.tick);
		app.canvas.removeEventListener('webglcontextlost', this.lost);
		// `texture: false`: the atlas page stays in Pixi's cache for the next time the screen opens.
		app.destroy(true, { children: true, texture: false });
	}

	private readonly lost = (): void => {
		console.warn('[CaptainScene] WebGL context lost — showing the still');
		this.onLost();
	};

	private readonly pointerMoved = (event: PointerEvent): void => {
		this.pointerX = event.clientX;
		this.pointerY = event.clientY;
		this.pointerIn = true;
		this.touchAt = event.pointerType === 'touch' ? performance.now() : Infinity;
	};

	private readonly pointerLeft = (): void => {
		this.pointerIn = false;
	};

	/**
	 * Where on the selection she looks (client pixels) and how much (0..1): the pointer clamped into
	 * the box around the selection, all of it inside, fading to none GAZE_FADE out.
	 */
	private focus(): { x: number; y: number; weight: number } | undefined {
		if (!this.pointerIn || performance.now() - this.touchAt > GAZE_TOUCH_MS) return;
		let left = Infinity;
		let top = Infinity;
		let right = -Infinity;
		let bottom = -Infinity;
		for (const element of this.selection()) {
			const rect = element?.getBoundingClientRect();
			if (!rect?.width || !rect.height) continue;
			left = Math.min(left, rect.left);
			top = Math.min(top, rect.top);
			right = Math.max(right, rect.right);
			bottom = Math.max(bottom, rect.bottom);
		}
		if (!(right > left && bottom > top)) return;
		const x = Math.min(right, Math.max(left, this.pointerX));
		const y = Math.min(bottom, Math.max(top, this.pointerY));
		const off = Math.hypot(this.pointerX - x, this.pointerY - y);
		const weight = 1 - Math.min(1, off / (GAZE_FADE * (bottom - top)));
		return weight > 0 ? { x, y, weight } : undefined;
	}

	private readonly tick = (ticker: Ticker): void => {
		const seconds = Math.min(ticker.deltaMS / 1000, MAX_STEP_SECONDS);
		this.follow(seconds);
		this.captain?.update(seconds);
	};

	/** Ease the eyes' offset toward the selection, and their aim between it and the animation. */
	private follow(seconds: number): void {
		const captain = this.captain;
		const canvas = this.app?.canvas;
		if (!captain || !canvas || !this.gaze.length) return;
		const focus = this.focus();
		const want = focus?.weight ?? 0;
		this.gazeWeight =
			want > this.gazeWeight
				? Math.min(want, this.gazeWeight + seconds / GAZE_IN_S)
				: Math.max(want, this.gazeWeight - seconds / GAZE_OUT_S);
		// Off the selection the eyes hold their last look while it fades.
		if (!focus) return;

		// The spot she looks at, client pixels → the canvas's own pixels (a CSS `zoom` above makes them differ)
		// → the skeleton's units, y up (the targets' parent is the root).
		const rect = canvas.getBoundingClientRect();
		const width = this.host.clientWidth;
		const height = this.host.clientHeight;
		if (!rect.width || !rect.height || !width || !height) return;
		const point = {
			x: ((focus.x - rect.left) * width) / rect.width,
			y: ((focus.y - rect.top) * height) / rect.height,
		};
		const root = captain.skeleton.getRootBone();
		if (!root) return;
		captain.pixiWorldCoordinatesToBone(point, root);

		const dx = point.x - this.faceX;
		const dy = point.y - this.faceY;
		const distance = Math.hypot(dx, dy);
		const reach = distance > 0 ? Math.min(1, distance / GAZE_FULL_AT) / distance : 0;
		const wantX = dx * reach * (dx < 0 ? GAZE_LEFT : GAZE_RIGHT);
		const wantY = dy * reach * (dy > 0 ? GAZE_UP : GAZE_DOWN);
		const k = 1 - Math.exp(-seconds / GAZE_FOLLOW_S);
		this.gazeX += (wantX - this.gazeX) * k;
		this.gazeY += (wantY - this.gazeY) * k;
	}

	/** Hold the look-at targets at rest, as much as `gazeWeight` says: the animation's glances fade. */
	private readonly aim = (): void => {
		const w = this.gazeWeight;
		if (w <= 0) return;
		for (const { pose, restX, restY } of this.gaze) {
			pose.x += (restX - pose.x) * w;
			pose.y += (restY - pose.y) * w;
		}
	};

	/** Move both pupils off where the IK put them by the one gaze (skeleton units, y up), together. */
	private readonly look = (): void => {
		const w = this.gazeWeight;
		const root = this.captain?.skeleton.getRootBone();
		if (w <= 0 || !root) return;
		const rootPose = root.appliedPose;
		const point = this.scratch;
		for (const { bone, share } of this.pupils) {
			const pose = bone.appliedPose;
			// World → the root's own space (y up, whatever the runtime's world y does) and back.
			point.set(pose.worldX, pose.worldY);
			rootPose.worldToLocal(point);
			point.x += this.gazeX * share * w;
			point.y += this.gazeY * share * w;
			rootPose.localToWorld(point);
			pose.worldX = point.x;
			pose.worldY = point.y;
		}
	};

	/** Size the canvas to the host and lay her on the still's box inside it. */
	private place(): void {
		const app = this.app;
		const captain = this.captain;
		const width = this.host.clientWidth;
		const height = this.host.clientHeight;
		if (!app || !captain || !width || !height) return;
		app.renderer.resize(width, height, this.resolution());
		// Host pixels per still pixel: the host is the still's width let out by PAD_LEFT.
		const perStill = width / (STILL_W * (1 + PAD_LEFT));
		const left = STILL_W * PAD_LEFT * perStill;
		const top = STILL_H * PAD_TOP * perStill;
		captain.scale.set(perStill * STILL_PER_UNIT);
		captain.position.set(left + STILL_ORIGIN_X * perStill, top + STILL_ORIGIN_Y * perStill);
	}

	private resolution(): number {
		const width = this.host.clientWidth;
		const zoom = width ? this.host.getBoundingClientRect().width / width : 1;
		const cap = isLite() ? 1 : 2;
		return Math.min(cap, Math.max(1, (window.devicePixelRatio || 1) * (zoom || 1)));
	}
}
