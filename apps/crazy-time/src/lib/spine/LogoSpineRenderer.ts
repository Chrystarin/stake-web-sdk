import '@esotericsoftware/spine-pixi-v8';
import { Physics, Spine } from '@esotericsoftware/spine-pixi-v8';
import { Application, Assets, Ticker, UPDATE_PRIORITY } from 'pixi.js';

/** Everything the splash needs to know about the one spine it plays. */
export type LogoSpineAsset = {
	id: string;
	skeleton: string;
	atlas: string;
	/** Atlas page name (as written in the `.atlas`) -> the file to load for it. */
	images: Record<string, string>;
	animation: string;
	/** The artwork sits ABOVE the skeleton root (y-up), so the vertical fit term is flipped. */
	yUp?: boolean;
	/** Contain rather than cover on a portrait viewport, so a wide logo is not clipped at the sides. */
	containInPortrait?: boolean;
	portraitContainScale?: number;
	/** Clamp Pixi's shared-ticker catch-up to one frame at this rate while the splash is up. */
	catchUpMinFps?: number;
};

/**
 * A window of the animation's OWN timeline to ping-pong across while something is awaited — see
 * {@link LogoSpineRenderer.setAnimationHold}.
 */
export type AnimationHold = {
	fromSeconds: number;
	toSeconds: number;
	periodSeconds: number;
};

/**
 * The splash's spine renderer: one skeleton, one animation, fitted to its host, with the two things
 * the loader needs that a bare `Spine` does not give it — a hold that keeps the logo alive on the
 * artist's own curve while the preload runs, and a way to keep painting when the tab is hidden.
 *
 * A cut-down of the Plinko's `SpineBackgroundRenderer` (1,400 lines, most of it the bonus-scene
 * overlays this game has no use for). What is kept is kept faithfully: the same fit maths, the same
 * shared-ticker clamp, the same hold, the same teardown — including the `Assets.unload`, because the
 * logo's four 1806²-and-up pages are tens of MB of texture memory that must not outlive the splash.
 */
export class LogoSpineRenderer {
	private readonly host: HTMLElement;
	private app?: Application;
	private spine?: Spine;
	private asset?: LogoSpineAsset;
	private resizeObserver?: ResizeObserver;
	private fitFrameId = 0;
	/** Authored bounds of the skeleton (`skeleton.data`), in skeleton units. */
	private bounds = { x: 0, y: 0, width: 0, height: 0 };
	private hold?: AnimationHold;
	private holdElapsed = 0;
	private holdTick?: () => void;
	/** Saved `Ticker.shared._maxElapsedMS` when this renderer clamped it, restored on destroy. */
	private sharedTickerRestore?: number;
	/** Set by `destroy()`; every `await` in `init` re-checks it before creating GPU state. */
	private destroyed = false;

	constructor(host: HTMLElement) {
		this.host = host;
	}

	async init(asset: LogoSpineAsset): Promise<void> {
		await this.waitForHostSize();
		if (this.destroyed) return;

		const app = new Application();
		await app.init({
			resizeTo: this.host,
			backgroundAlpha: 0,
			// Off: everything drawn is alpha-textured quads, which MSAA does nothing for, and a 4x
			// backbuffer on a full-viewport canvas is exactly the GPU pressure that makes iOS reap
			// WebGL contexts (see the Plinko's Background notes).
			antialias: false,
			autoDensity: true,
			resolution: Math.min(2, window.devicePixelRatio || 1),
			preference: 'webgl',
		});
		if (this.destroyed) {
			app.destroy(true);
			return;
		}
		this.host.appendChild(app.canvas);
		// Pixi leaves the canvas `display: inline`, which adds a baseline gap.
		app.canvas.style.display = 'block';
		this.app = app;

		// Clamp per-frame catch-up so a stall (atlas GPU upload, the preload starting) pauses-and-
		// resumes the animation instead of skipping ahead. Spine's `autoUpdate` advances off the GLOBAL
		// `Ticker.shared`, reading its clamped `deltaMS`, so the clamp lives there. The field is poked
		// directly: `Ticker.minFPS`'s setter collapses to Infinity under the default maxFPS of 0, and the
		// default (100 ms) is a raw field init that the API cannot restore.
		if (asset.catchUpMinFps != null) {
			const shared = Ticker.shared as unknown as { _maxElapsedMS: number };
			this.sharedTickerRestore = shared._maxElapsedMS;
			shared._maxElapsedMS = 1000 / asset.catchUpMinFps;
		}

		const atlasAlias = `${asset.id}-atlas`;
		const skeletonAlias = `${asset.id}-skeleton`;
		if (!Assets.resolver.hasKey(atlasAlias)) {
			Assets.add({ alias: atlasAlias, src: asset.atlas, data: { images: asset.images } });
		}
		if (!Assets.resolver.hasKey(skeletonAlias)) {
			Assets.add({ alias: skeletonAlias, src: asset.skeleton });
		}
		await Assets.load([atlasAlias, skeletonAlias]);
		if (this.destroyed || !this.app) return;

		const spine = Spine.from({ skeleton: skeletonAlias, atlas: atlasAlias, autoUpdate: true });
		spine.state.setAnimation(0, asset.animation, false);
		app.stage.addChild(spine);
		this.spine = spine;
		this.asset = asset;

		// Authored bounds, off the setup pose — the fit is against the scene as drawn, not the frame.
		spine.skeleton.setupPose();
		spine.state.apply(spine.skeleton);
		spine.skeleton.updateWorldTransform(Physics.update);
		const { x, y, width, height } = spine.skeleton.data;
		this.bounds = { x, y, width, height };
		this.fit();

		this.resizeObserver = new ResizeObserver(() => this.scheduleFit());
		this.resizeObserver.observe(this.host);
	}

	private waitForHostSize(): Promise<void> {
		if (this.host.clientWidth > 0 && this.host.clientHeight > 0) return Promise.resolve();
		return new Promise((resolve) => {
			const observer = new ResizeObserver(([entry]) => {
				const { width, height } = entry.contentRect;
				if (width <= 0 || height <= 0) return;
				observer.disconnect();
				resolve();
			});
			observer.observe(this.host);
		});
	}

	private scheduleFit(): void {
		cancelAnimationFrame(this.fitFrameId);
		this.fitFrameId = requestAnimationFrame(() => this.fit());
	}

	/**
	 * Cover-fit the authored bounds to the host (contain, on a portrait host, when the asset asks for
	 * it), centred. The same maths as the Plinko's `computeFitTransform` for a centre-anchored asset.
	 */
	private fit(): void {
		const { spine, asset } = this;
		if (!spine || !asset) return;
		const width = this.host.clientWidth;
		const height = this.host.clientHeight;
		const { bounds } = this;
		if (!width || !height || !bounds.width || !bounds.height) return;

		const contain = asset.containInPortrait === true && height > width;
		const scale = contain
			? Math.min(width / bounds.width, height / bounds.height) * (asset.portraitContainScale ?? 1)
			: Math.max(width / bounds.width, height / bounds.height);
		const centerX = bounds.x + bounds.width / 2;
		const centerY = bounds.y + bounds.height / 2;
		// Spine is authored y-up; a y-up asset (content above the root) needs the vertical term
		// flipped or it parks entirely above the viewport.
		const centerYTerm = asset.yUp ? centerY * scale : -centerY * scale;
		spine.scale.set(scale);
		spine.position.set(width / 2 - centerX * scale, height / 2 + centerYTerm);
	}

	/**
	 * Milliseconds since Pixi's shared ticker last ran — i.e. since the last animation frame. The
	 * splash reads this to tell a stalled `requestAnimationFrame` (a throttled or embedded tab that is
	 * not `document.hidden`) from a healthy one, and hand-drives the frames itself in the meantime.
	 */
	sharedTickerIdleMs(): number {
		return performance.now() - Ticker.shared.lastTime;
	}

	/**
	 * Manually advance the animation and paint one frame. Used by the splash to keep rendering when
	 * `requestAnimationFrame` is throttled (a backgrounded tab), where Pixi's shared ticker — and so
	 * `autoUpdate` — stalls. Safe no-op before init.
	 */
	advanceFrame(deltaSeconds: number): void {
		if (!this.app || !this.spine) return;
		// A hold owns `trackTime` outright (the state's own clock is stopped), so it is stepped here
		// too — `spine.update` alone would re-apply the same frame forever.
		this.advanceHold(deltaSeconds);
		this.spine.update(deltaSeconds);
		this.app.render();
	}

	/**
	 * Hold the animation inside a window of its OWN timeline, ping-ponging between the two ends,
	 * instead of letting it play on. `undefined` releases it to continue from wherever the hold left
	 * it. Because the motion is seeked out of the authored animation rather than synthesised on the
	 * display object, it uses the artist's own curve and cannot fight the fit transform.
	 *
	 * While held, the state's clock is stopped (`timeScale = 0`) and `trackTime` is driven by hand.
	 */
	setAnimationHold(hold: AnimationHold | undefined): void {
		const spine = this.spine;
		if (!this.app || !spine) return;

		if (this.holdTick) {
			Ticker.shared.remove(this.holdTick);
			this.holdTick = undefined;
		}
		this.hold = hold;
		if (!hold) {
			spine.state.timeScale = 1;
			return;
		}

		spine.state.timeScale = 0;
		// Start the phase where the animation ALREADY is (inverting the raised cosine over its rising
		// half), so engaging the hold at the top of the window does not snap trackTime back to
		// `fromSeconds` on the first frame — a visible pop into the pulse.
		const span = hold.toSeconds - hold.fromSeconds;
		const current = spine.state.getTrack(0)?.trackTime ?? hold.fromSeconds;
		const progress = span > 0 ? Math.min(1, Math.max(0, (current - hold.fromSeconds) / span)) : 0;
		this.holdElapsed = (Math.acos(1 - 2 * progress) / (Math.PI * 2)) * hold.periodSeconds;

		const tick = () => {
			try {
				this.advanceHold(Ticker.shared.deltaMS / 1000);
			} catch (error) {
				// An exception escaping a ticker listener aborts Pixi's rAF loop and freezes the canvas.
				// Detach and leave the logo on its last frame instead.
				console.error('[LogoSpineRenderer] animation hold failed; freezing instead', error);
				Ticker.shared.remove(tick);
				this.holdTick = undefined;
			}
		};
		this.holdTick = tick;
		// `Ticker.shared`, NOT `app.ticker`, and ahead of spine's own update: spine drives `autoUpdate`
		// off the shared ticker, and the two tickers do not share a clock or an ordering.
		Ticker.shared.add(tick, undefined, UPDATE_PRIORITY.HIGH);
	}

	private advanceHold(deltaSeconds: number): void {
		const hold = this.hold;
		const entry = this.spine?.state.getTrack(0);
		if (!hold || !entry) return;
		this.holdElapsed += deltaSeconds;
		const span = hold.toSeconds - hold.fromSeconds;
		if (span <= 0 || hold.periodSeconds <= 0) {
			entry.trackTime = hold.fromSeconds;
			return;
		}
		// Raised cosine: zero velocity at both turns, so the swell eases in and out.
		const phase = (this.holdElapsed % hold.periodSeconds) / hold.periodSeconds;
		entry.trackTime = hold.fromSeconds + span * ((1 - Math.cos(phase * Math.PI * 2)) / 2);
	}

	/**
	 * Seconds into the animation, read off the spine's own track rather than a wall clock — the two
	 * diverge whenever `catchUpMinFps` clamps a stalled frame. Keeps counting past the animation's own
	 * length (spine leaves a finished entry on the track), so it can be compared against the authored
	 * duration. `Infinity` if the track has been cleared, `0` before init.
	 */
	getAnimationTime(): number {
		if (!this.spine) return 0;
		return this.spine.state.getTrack(0)?.trackTime ?? Number.POSITIVE_INFINITY;
	}

	/** Tear everything down and release the atlas from Pixi's cache. Idempotent. */
	destroy(): void {
		this.destroyed = true;
		if (this.sharedTickerRestore != null) {
			(Ticker.shared as unknown as { _maxElapsedMS: number })._maxElapsedMS =
				this.sharedTickerRestore;
			this.sharedTickerRestore = undefined;
		}
		cancelAnimationFrame(this.fitFrameId);
		this.resizeObserver?.disconnect();
		this.resizeObserver = undefined;
		if (this.holdTick) {
			// Registered on the SHARED ticker, which outlives this app — leaving it attached would keep a
			// destroyed renderer's callback running for the rest of the session.
			Ticker.shared.remove(this.holdTick);
			this.holdTick = undefined;
		}
		this.hold = undefined;
		this.spine?.destroy({ children: true });
		this.spine = undefined;
		this.app?.destroy(true, { children: true });
		this.app = undefined;
		const asset = this.asset;
		this.asset = undefined;
		if (asset) {
			void Assets.unload([`${asset.id}-atlas`, `${asset.id}-skeleton`]).catch(() => {});
		}
	}
}
