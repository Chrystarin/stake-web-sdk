import '@esotericsoftware/spine-pixi-v8';
import { Physics, Spine, Vector2 } from '@esotericsoftware/spine-pixi-v8';
import { Application, Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';
import {
	getFreeSpinMeterFullAssets,
	type FreeSpinMeterFullAssetDef,
} from '../../lib/spine/freeSpinMeterFullAssets';
import { loadSpineAsset } from '../../lib/spine/spineAssetCache';
import { readSkeletonData } from '../../lib/spine/spineSkeletonData';
import { staticUrl } from '../../lib/staticUrl';

/**
 * One half of the meter-full effect: its skeleton plus the SETUP-POSE box it is placed by.
 *
 * The box is in spine WORLD space, where y has already been flipped for the screen (spine-pixi sets
 * `Skeleton.yDown`, which negates the skeleton's scaleY). So a world point lands at
 * `position + world * scale` with NO second flip — see `layoutFullEffect`.
 */
type FullEffectLayer = {
	spine: Spine;
	animation: string;
	offset: Vector2;
	size: Vector2;
};

export class FreeSpinMeterEngine {
	private hostElement!: HTMLElement;

	setProgress(value: number): void {
		this.setTargetProgress(value);
	}

	/**
	 * Start/stop drawing to match whether this meter is on screen.
	 *
	 * The meter is PERMANENTLY MOUNTED and shown/hidden with `visibility` so its WebGL canvas is never
	 * churned (recreating it flashes white for a frame on slower GPUs — the whole reason for the
	 * keep-mounted design). But a mounted Pixi Application keeps its ticker running, so while hidden it
	 * went on spinning the wheel and re-rasterising the bar 60 times a second for pixels nobody can
	 * see: 180 draw calls/second measured on an emulated phone, for the entire 1-ball tier.
	 *
	 * Stopping the TICKER (not destroying anything) leaves the canvas, its GL context and its last
	 * rendered frame completely intact, so showing it again is instant and flash-free.
	 *
	 * ⚠️ Deliberately not a `maxFPS` cap: unlike the background renderer this scene has nothing to
	 * settle while hidden, and the wheel's rotation is delta-time driven, so it picks up correctly
	 * wherever it resumes.
	 */
	setVisible(visible: boolean): void {
		const ticker = this.app?.ticker;
		if (!ticker) return;
		if (visible === ticker.started) return;
		if (visible) ticker.start();
		else ticker.stop();
	}


  /**
   * Fill the meter is seeded with before anything drives it — EMPTY.
   *
   * ⚠️ This was 1, and `init` copies it into both `targetProgress` and `displayedProgress`, so a
   * freshly-initialised meter drew itself FULL and only eased down once `setProgress` arrived and the
   * ticker ran a few frames. On the 1-ball tier the meter is hidden from mount, which STOPS the ticker
   * (see `setVisible`) — so those frames never ran, the canvas stayed frozen on that full first frame,
   * and buying a bonus from that tier (the one place a 1-ball player ever sees this bar) revealed a
   * meter that was already full before a single ball had dropped.
   */
  progress = 0;

  private app?: Application;
  private resizeObserver?: ResizeObserver;
  private resizeRafId: number | null = null;
  private readonly meterScene = new Container();
  private readonly meterMask = new Graphics();
  private baseSprite?: Sprite;
  private meterSprite?: Sprite;
  private wheelSprite?: Sprite;
  private viewportWidth = 1;
  private viewportHeight = 1;
  private meterNativeWidth = 1;
  private meterNativeHeight = 1;
  private meterOffsetXPx = 0;
  private meterOffsetYPx = 0;
  // Last size the renderer was resized to, so we can skip no-op resizes (see resizeToHost).
  private lastRenderWidth = 0;
  private lastRenderHeight = 0;
  private displayedProgress = 0;
  private targetProgress = 0;
  // ── Fill smoothing ────────────────────────────────────────────────────────────────────────────
  // THE knob for the feel: lower = snappier, higher = lazier. NOT the total duration — a critically
  // damped spring approaches asymptotically. Measured mapping: it covers 99% of the distance in
  // ~3.3x this value, so 0.144 → ~0.47s to visually land, whatever the distance.
  // Note a spring settles in the same time regardless of how far it travels, so a one-ball step is
  // slower here than the old linear ramp's ~76ms. That is the point — the old code hit a single
  // notch in ~4 frames, which is what read as a twitch rather than a movement. 0.35 was tried first
  // and took ~1.4s, which trailed play badly once balls landed a few hundred ms apart; 0.18 then
  // 0.144 (= 0.18 x 0.8, "20% snappier") dialled that back in.
  private readonly fillSmoothTimeSeconds = 0.144;
  // Carried between frames by the spring. Retargeting mid-flight inherits it, so a burst of balls
  // landing in quick succession reads as one continuous sweep rather than a stack of restarts.
  private fillVelocity = 0;
  // Once this close to the target AND nearly stopped, snap and park. Without it the bar never quite
  // arrives and the mask is re-tessellated every frame forever.
  private readonly fillSnapEpsilon = 0.0008;
  // Frame deltas are clamped to this. A backgrounded/stalled tab reports one enormous deltaMS on
  // resume, which would teleport the fill (and spin the wheel wildly) in a single frame.
  private readonly maxFrameDeltaSec = 0.1;
  // Wheel tuning controls (relative to the base art size).
  private readonly wheelScaleByBaseHeight = 0.8;
  private readonly wheelOffsetXByBaseWidth = 0.9;
  private readonly wheelOffsetYByBaseHeight = 0.65;
  private readonly wheelSpinRadiansPerSecond = 1.2;
  // Fill-bar tuning controls (relative to the base art size).
  private readonly meterOffsetXByBaseWidth = 0.055;
  private readonly meterOffsetYByBaseHeight = 0.5;
  private readonly meterWidthByBaseWidth = 0.8;
  private readonly meterHeightByBaseHeight = 0.25;
  /**
   * Fraction of the canvas WIDTH held back as empty bleed on EACH side when fitting the base art.
   *
   * At 0 the art fills the canvas exactly, which leaves NO room to the right of the helm — it sits at
   * 0.9 of the base width and is ~0.11 wide, so its own last few pixels were already being cut flat
   * by the canvas edge, and the meter-full effect's ring (1.44x the helm) was cut from roughly
   * halfway through its expansion, at full alpha.
   *
   * The ring needs ≥ 0.0527 to clear (solve `b + (1 - 2b)(0.9 + 0.1588) ≤ 1`, where 0.1588 is its
   * half-width as a fraction of the base art). 0.06 takes that with ~0.8% to spare.
   *
   * ⚠️ PAIRED WITH CSS — this is not a knob to turn on its own. It shrinks the art in the canvas by
   * `1 - 2x`, so `.bp-free-spin-meter-wrap` and `.mobile-free-spin-meter` are grown by `1/(1 - 2x)`
   * = 1.13636 and re-anchored right by `x` of their new width, which keeps the meter at exactly the
   * size and position on screen it had at 0. Change one, change all four.
   */
  private readonly artBleedByViewportWidth = 0.06;
  /**
   * Where the shine's PAINTED pill sits inside the mesh quad `getBounds` reports, as fractions of
   * that quad.
   *
   * The rig draws the flipbook onto one full-bleed quad (852.371 x 123.731 authored units) but the
   * frames themselves are 248 x 36 sprites whose gold pill only occupies x 3..244 and y 7..29 —
   * hard-edged, identical across all 45 frames, and confirmed against the union of every frame's
   * alpha in `free_spin_meter_bar_highlight/skeleton.webp`. So the quad overstates the art by 1.2%
   * on the left, 1.6% on the right and 19.4% top and bottom, and anything fitted to the quad lands
   * short. Spine cannot tell us this — mesh bounds are geometry, and the padding is alpha — hence
   * measured constants.
   *
   * ⚠️ Re-measure if the bar highlight is re-exported: a re-crop that changes the frame padding
   * changes these four numbers, and nothing at runtime will notice.
   */
  private readonly barHighlightArtInset = {
    left: 3 / 248,
    top: 7 / 36,
    width: (244 - 3) / 248,
    height: (29 - 7) / 36
  };
  private frameTicker?: (ticker: { deltaMS: number }) => void;
  /** Both halves of the meter-full effect (see `loadFullEffect`) — iterated per frame, so built once. */
  private fullEffect: FullEffectLayer[] = [];
  private barHighlight?: FullEffectLayer;
  private wheelGlow?: FullEffectLayer;
  /** Whether the effect is currently lit — see `syncFullEffect`. */
  private fullEffectLit = false;
  /** Set by `destroy`, so an in-flight async init never adds children to a torn-down stage. */
  private destroyed = false;

	async init(host: HTMLElement): Promise<void> {
		this.hostElement = host;
		await this.initPixi();
	}

  destroy(): void {
    this.destroyed = true;
    if (this.resizeRafId !== null) {
      cancelAnimationFrame(this.resizeRafId);
      this.resizeRafId = null;
    }
    this.resizeObserver?.disconnect();
    if (this.app && this.frameTicker) {
      this.app.ticker.remove(this.frameTicker as any);
      this.frameTicker = undefined;
    }
    // Hide the canvas synchronously BEFORE tearing down the WebGL context. `app.destroy()` drops the
    // GL context but the <canvas> can linger in the DOM for a frame or two and composite as an opaque
    // WHITE box before it's removed — a teardown flash on slower GPUs. Hiding it first closes that gap.
    // Defense-in-depth: with the meter kept mounted this path no longer runs on a Ball-Per-Drop toggle,
    // only on a full teardown (page unload / orientation swap).
    const canvas = this.app?.canvas as HTMLCanvasElement | undefined;
    if (canvas) canvas.style.visibility = 'hidden';
    for (const layer of this.fullEffect) layer.spine.destroy();
    this.fullEffect = [];
    this.barHighlight = undefined;
    this.wheelGlow = undefined;
    this.app?.destroy(true, { children: true, texture: false });
  }

  private async initPixi(): Promise<void> {
    const app = new Application();
    await app.init({
      width: 1,
      height: 1,
      // Antialias OFF is deliberate: with it on, a freshly-resized WebGL canvas can composite its
      // un-resolved multisample buffer as an OPAQUE WHITE box for a frame (a GPU/driver-timing quirk
      // — it reproduces on some machines but not others, which is exactly the "QA sees it, I don't"
      // report). With antialias off a cleared buffer is transparent, so the worst case is an
      // imperceptible transparent blip instead of a white flash. The meter art + spinning wheel are
      // alpha-defined PNGs, so MSAA does nothing for their visible edges — no visual cost.
      antialias: false,
      autoDensity: true,
      backgroundAlpha: 0,
      resolution: typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1
    });
    this.hostElement.appendChild(app.canvas as HTMLCanvasElement);
    this.app = app;

    let baseTexture: Texture;
    let meterTexture: Texture;
    let wheelTexture: Texture;
    try {
      [baseTexture, meterTexture, wheelTexture] = await Promise.all([
        Assets.load(staticUrl('img/free-spin-base.webp')),
        Assets.load(staticUrl('img/free-spin-meter.webp')),
        Assets.load(staticUrl('img/free-spin-meter-wheel.webp'))
      ]);
    } catch {
      return;
    }

    this.baseSprite = new Sprite(baseTexture);
    this.baseSprite.anchor.set(0, 0);

    this.meterSprite = new Sprite(meterTexture);
    this.meterSprite.anchor.set(0, 0);
    this.meterSprite.mask = this.meterMask;

    this.wheelSprite = new Sprite(wheelTexture);
    this.wheelSprite.anchor.set(0.5, 0.5);

    // Base first, then masked meter so fill is visible on top of the base strip.
    this.meterScene.addChild(this.baseSprite);
    this.meterScene.addChild(this.meterMask);
    this.meterScene.addChild(this.meterSprite);

    await this.loadFullEffect();
    if (this.destroyed) return;
    // The meter-full effect STRADDLES the wheel, exactly as its slots do in the rig it was exported
    // from (`highlightbar`, then `helm2`, then `glowWheel` and `ring`): the shine sweeps over the
    // gold fill but UNDER the helm, while the cyan glow and its ring paint OVER it — so the helm
    // reads as lighting up rather than sitting in front of its own halo.
    if (this.barHighlight) this.meterScene.addChild(this.barHighlight.spine);
    this.meterScene.addChild(this.wheelSprite);
    if (this.wheelGlow) this.meterScene.addChild(this.wheelGlow.spine);
    app.stage.addChild(this.meterScene);
    this.startFrameTicker();

    this.resizeObserver = new ResizeObserver(() => this.scheduleResize());
    this.resizeObserver.observe(this.hostElement);

    this.targetProgress = Math.max(0, Math.min(1, Number(this.progress) || 0));
    this.displayedProgress = this.targetProgress;
    this.resizeToHost();
  }

  /**
   * Load the two skeletons the FULL meter celebrates with (see `syncFullEffect`).
   *
   * A missing bar highlight takes the wheel glow down with it: the bar's authored box is the scale
   * basis BOTH layers are placed from (see `layoutFullEffect`), so the survivor would have nothing
   * to be sized against. Half an effect is worse than none anyway — the two were drawn as one beat.
   *
   * Sequential, not `Promise.all`: both bundles name their atlas page `skeleton.png`, and loading
   * them concurrently can race in Pixi's asset cache — the same reason `BalanceCoinGlowRenderer`
   * loads its pair one at a time.
   */
  private async loadFullEffect(): Promise<void> {
    for (const def of getFreeSpinMeterFullAssets()) {
      if (this.destroyed) return;
      const layer = await this.loadFullEffectLayer(def);
      if (!layer) continue;
      if (def.layer === 'barHighlight') this.barHighlight = layer;
      else this.wheelGlow = layer;
    }
    if (!this.barHighlight || this.destroyed) {
      this.barHighlight?.spine.destroy();
      this.wheelGlow?.spine.destroy();
      this.barHighlight = undefined;
      this.wheelGlow = undefined;
    }
    this.fullEffect = [this.barHighlight, this.wheelGlow].filter(
      (layer): layer is FullEffectLayer => layer !== undefined
    );
  }

  private async loadFullEffectLayer(
    def: FreeSpinMeterFullAssetDef
  ): Promise<FullEffectLayer | undefined> {
    try {
      // Shared cache — preloaded by the intro loader, and registered with Pixi's resolver once.
      const { atlasAlias, skeletonAlias } = await loadSpineAsset(def);
      const atlas = Assets.get(atlasAlias);
      const skeletonSource = Assets.get(skeletonAlias);
      if (!atlas || !skeletonSource) throw new Error('atlas/skeleton missing from the cache');

      const spine = new Spine({
        skeletonData: readSkeletonData(def, atlas, skeletonSource),
        autoUpdate: false
      });
      // Measure the SETUP pose, BEFORE any animation is set. Both layers open COLLAPSED — the wheel
      // glow's first deform key shrinks its meshes to ~27% and the bar's flipbook opens on a
      // near-empty frame — so measuring after `state.apply` would read a fraction of the real box,
      // and a DIFFERENT fraction for each, destroying the authored size relationship the shared
      // scale in `layoutFullEffect` depends on.
      spine.skeleton.setupPose();
      spine.state.apply(spine.skeleton);
      spine.skeleton.updateWorldTransform(Physics.update);
      const offset = new Vector2();
      const size = new Vector2();
      spine.skeleton.getBounds(offset, size, []);
      const measured =
        size.x > 0 && size.y > 0 && Number.isFinite(offset.x) && Number.isFinite(offset.y);
      if (!measured) {
        // No usable box means no way to place it, and a layer parked off-centre over the meter is
        // worse than a meter that simply doesn't celebrate.
        spine.destroy();
        throw new Error('skeleton has no measurable content bounds');
      }
      spine.visible = false;
      return { spine, animation: def.animation, offset, size };
    } catch (err) {
      console.error('[FreeSpinMeterEngine] meter-full effect failed to load', def.id, err);
      return undefined;
    }
  }

  /**
   * Place both halves of the meter-full effect. Called from `resizeToHost`, which owns every other
   * placement in this scene.
   *
   * THE SHINE IS FITTED BY ITS PAINTED PILL, NOT BY ITS BOX. `getBounds` measures the mesh QUAD,
   * and the quad is padded — see `barHighlightArtInset`. Fitting the quad to the fill rect
   * therefore parked the pill INSIDE the bar, and because the bar's own left cap is the first thing
   * the eye lands on, the ~1.2% of unlit fill it left there read as a gap down the left end every
   * time the meter completed. Anchoring the pill instead makes the shine cover the fill rect
   * exactly, which is what it was drawn to do.
   *
   * The wheel glow keeps the QUAD-derived scale it always had. Its layers' proportions are
   * internal (the ring is ~1.4x the helm because that is how it was authored) and its clearance
   * from the canvas edge is what `artBleedByViewportWidth` was solved against, so the bar's
   * correction deliberately does not travel to it.
   *
   * TWO ANCHORS, rather than one scene transform. The authored scene and the engine's hand-tuned
   * wheel placement (`wheelOffsetXByBaseWidth`) agree to within ~1% of the bar's width, which is
   * nothing on the soft cyan halo but shows on the crisp ring expanding out of it — that has to be
   * exactly concentric with the helm, so it is pinned to the sprite instead of inheriting the drift.
   */
  private layoutFullEffect(wheelCenterXPx: number, wheelCenterYPx: number): void {
    const bar = this.barHighlight;
    if (!bar) return;
    // Quad-derived, and used ONLY by the wheel glow below — see the note above.
    const scale = this.meterNativeWidth / bar.size.x;

    // Map the pill's box onto the fill rect: same left edge, same top edge, same width, same
    // height. x and y are scaled independently because the pill is ~9% squatter than the fill rect
    // in relative terms; splitting them is what removes the bleed at BOTH ends and above/below,
    // and 9% of a cap radius is invisible on art this soft.
    const inset = this.barHighlightArtInset;
    const barScaleX = this.meterNativeWidth / (bar.size.x * inset.width);
    const barScaleY = this.meterNativeHeight / (bar.size.y * inset.height);
    bar.spine.scale.set(barScaleX, barScaleY);
    // World space is already y-down here (see `FullEffectLayer`), so `offset.y` is the art's TOP
    // and the inset is added, not subtracted.
    bar.spine.position.set(
      this.meterOffsetXPx - (bar.offset.x + bar.size.x * inset.left) * barScaleX,
      this.meterOffsetYPx - (bar.offset.y + bar.size.y * inset.top) * barScaleY
    );

    const wheel = this.wheelGlow;
    if (!wheel) return;
    wheel.spine.scale.set(scale);
    wheel.spine.position.set(
      wheelCenterXPx - (wheel.offset.x + wheel.size.x / 2) * scale,
      wheelCenterYPx - (wheel.offset.y + wheel.size.y / 2) * scale
    );
  }

  /**
   * Light the meter-full effect while the bar reads FULL, and advance it.
   *
   * Keyed off `displayedProgress`, NOT the target: the fill takes ~0.5s to ease home (see
   * `fillSmoothTimeSeconds`), and a shine lit on the target would be sweeping a bar the player can
   * still see climbing under it. This way the celebration lands on the frame the bar completes.
   *
   * Stepped from THIS ticker rather than spine's own `autoUpdate` so it inherits `setVisible` for
   * free: a hidden meter stops this ticker, whereas an effect running off Pixi's SHARED ticker would
   * go on animating (and re-uploading its atlas frames) behind `visibility: hidden` — exactly the
   * waste `setVisible` exists to kill.
   */
  private stepFullEffect(deltaSec: number): void {
    if (!this.syncFullEffect()) return;
    for (const layer of this.fullEffect) layer.spine.update(deltaSec);
  }

  /** Start/stop the effect to match whether the bar is DRAWN full. Returns whether it is now lit. */
  private syncFullEffect(): boolean {
    // Nothing loaded (yet, or at all). Answering `false` rather than latching `fullEffectLit` keeps
    // the flag honest, so a fill that completes while the skeletons are still in flight still lights
    // them on the first frame after they land instead of being swallowed as "already lit".
    if (this.fullEffect.length === 0) return false;
    const lit = this.targetProgress >= 1 && this.displayedProgress >= 1 - this.fillSnapEpsilon;
    if (lit === this.fullEffectLit) return lit;
    this.fullEffectLit = lit;
    for (const layer of this.fullEffect) layer.spine.visible = lit;
    if (!lit) {
      for (const layer of this.fullEffect) layer.spine.state.clearTracks();
      return false;
    }

    // Replay from the top on every fill rather than resuming. The meter empties the moment its wheel
    // pays out, so "full" is an EVENT, not a state the effect drifts in and out of — its shine has
    // to start at the head of the sweep every time.
    const barEntry = this.barHighlight
      ? this.barHighlight.spine.state.setAnimation(0, this.barHighlight.animation, true)
      : undefined;
    const cycleSeconds = barEntry?.animation?.duration ?? 0;
    if (this.wheelGlow) {
      const entry = this.wheelGlow.spine.state.setAnimation(0, this.wheelGlow.animation, true);
      // Keep the two in phase FOREVER. They are one authored cycle split across two exports, and the
      // wheel's half is the shorter (its burst is spent well before the bar's flipbook finishes and
      // holds), so on its own duration it would gain a whole beat on the bar within seconds. Wrapping
      // its track on the bar's duration replays it on the bar's beat instead — and the time that adds
      // is dead anyway, since both its slots key back to alpha 0 before its own animation ends.
      if (cycleSeconds > entry.animationEnd) entry.animationEnd = cycleSeconds;
    }
    // Pose frame 0 NOW. `setAnimation` only queues the track: until something calls `update` the
    // skeleton is still in its SETUP pose, which for these two is every layer at full size and full
    // alpha. A stopped ticker (hidden meter) or the synchronous render at the end of `resizeToHost`
    // would otherwise present that as the opening frame — a full-blown glow with no build-up.
    for (const layer of this.fullEffect) layer.spine.update(0);
    return true;
  }

  private scheduleResize(): void {
    if (!this.app) return;
    if (this.resizeRafId !== null) return;
    this.resizeRafId = requestAnimationFrame(() => {
      this.resizeRafId = null;
      this.resizeToHost();
    });
  }

  private resizeToHost(): void {
    if (!this.app || !this.baseSprite || !this.meterSprite || !this.wheelSprite) return;
    const hostRect = this.hostElement.getBoundingClientRect();
    const width = Math.max(1, Math.round(hostRect.width));
    const height = Math.max(1, Math.round(hostRect.height));
    // Skip when the host box hasn't actually changed size. ResizeObserver fires on unrelated layout
    // reflows around the meter (e.g. toggling Ball Per Drop restructures the panel), and every
    // renderer.resize() reallocates + clears the canvas backing store — the visible flash. Only
    // resize when the size truly changed. (Same no-op guard PlinkoEngine uses.)
    if (width === this.lastRenderWidth && height === this.lastRenderHeight) return;
    this.lastRenderWidth = width;
    this.lastRenderHeight = height;
    this.app.renderer.resize(width, height);

    const baseTexture = this.baseSprite.texture;
    const meterTexture = this.meterSprite.texture;
    const baseWidth = baseTexture.width || 1;
    const baseHeight = baseTexture.height || 1;
    const wheelBaseWidth = this.wheelSprite.texture.width || 1;
    const wheelBaseHeight = this.wheelSprite.texture.height || 1;

    // `artBleedByViewportWidth` reserves empty margin for the meter-full effect to expand into; at
    // its shipped 0 this is exactly the old `width / baseWidth`.
    const fitWidth = width * (1 - this.artBleedByViewportWidth * 2);
    const scale = Math.min(fitWidth / baseWidth, height / baseHeight);
    const scaledBaseWidth = baseWidth * scale;
    const scaledBaseHeight = baseHeight * scale;
    const offsetX = (width - scaledBaseWidth) / 2;
    const offsetY = (height - scaledBaseHeight) / 2;

    this.baseSprite.scale.set(scale);
    this.baseSprite.position.set(offsetX, offsetY);

    // Align the fill to the long horizontal strip shown in the FREE SPIN art.
    this.meterOffsetXPx = offsetX + scaledBaseWidth * this.meterOffsetXByBaseWidth;
    this.meterOffsetYPx = offsetY + scaledBaseHeight * this.meterOffsetYByBaseHeight;
    this.meterNativeWidth = scaledBaseWidth * this.meterWidthByBaseWidth;
    this.meterNativeHeight = scaledBaseHeight * this.meterHeightByBaseHeight;

    this.meterSprite.position.set(this.meterOffsetXPx, this.meterOffsetYPx);
    this.meterSprite.width = this.meterNativeWidth;
    this.meterSprite.height = this.meterNativeHeight;

    const wheelHeight = scaledBaseHeight * this.wheelScaleByBaseHeight;
    const wheelWidth = wheelHeight * (wheelBaseWidth / wheelBaseHeight);
    const wheelCenterXPx = offsetX + scaledBaseWidth * this.wheelOffsetXByBaseWidth;
    const wheelCenterYPx = offsetY + scaledBaseHeight * this.wheelOffsetYByBaseHeight;
    this.wheelSprite.width = wheelWidth;
    this.wheelSprite.height = wheelHeight;
    this.wheelSprite.position.set(wheelCenterXPx, wheelCenterYPx);

    this.layoutFullEffect(wheelCenterXPx, wheelCenterYPx);

    this.viewportWidth = width;
    this.viewportHeight = height;
    this.updateMeterFill();
    // Render synchronously right after the resize. `renderer.resize` clears the canvas buffer, and
    // with antialias on the un-resolved MSAA buffer composites as an opaque white box for the one
    // frame before the ticker's next rAF redraw — a visible white flash whenever the layout reflows
    // (e.g. toggling Ball Per Drop). Drawing now closes that gap (same pattern as PlinkoEngine).
    this.app.renderer.render(this.app.stage);
  }

  private updateMeterFill(): void {
    if (!this.app || !this.meterSprite) return;
    const clampedProgress = Math.max(0, Math.min(1, this.displayedProgress));
    const fillWidth = this.meterNativeWidth * clampedProgress;
    this.meterMask.clear();
    if (fillWidth <= 0) return;
    // The radius must never exceed HALF THE CURRENT FILL WIDTH. The bar's corner radius is
    // height/2, so while the fill is still narrower than its own height — under ~14% progress at
    // the current bar proportions — an unclamped roundRect has overlapping end caps and Pixi
    // tessellates a pinched, wrong-looking sliver. The fill sweeps through that range on every
    // climb up from empty, which read as a glitch right at the start of the animation.
    const radius = Math.min(this.meterNativeHeight / 2, fillWidth / 2);
    this.meterMask.roundRect(
      this.meterOffsetXPx,
      this.meterOffsetYPx,
      fillWidth,
      this.meterNativeHeight,
      radius
    );
    this.meterMask.fill(0xffffff);
  }

  /**
   * ONE ticker drives both the wheel and the fill.
   *
   * The fill used to run its own `requestAnimationFrame` loop while Pixi rendered from `app.ticker`
   * (also rAF-driven). Whether the mask update landed before or after Pixi's render within a given
   * frame depended on callback registration order, so some frames presented the new mask and some
   * re-presented the previous one — the fill appeared to stutter even though its numbers were
   * advancing perfectly smoothly. Stepping it from the ticker puts the mask update and the render in
   * the same frame, in that order, every time.
   */
  private startFrameTicker(): void {
    if (!this.app) return;
    if (this.frameTicker) {
      this.app.ticker.remove(this.frameTicker as any);
    }
    this.frameTicker = (ticker: { deltaMS: number }) => {
      const deltaSec = Math.min(
        this.maxFrameDeltaSec,
        Math.max(0, Number(ticker.deltaMS) || 0) / 1000
      );
      if (this.wheelSprite) {
        this.wheelSprite.rotation += this.wheelSpinRadiansPerSecond * deltaSec;
      }
      this.stepFill(deltaSec);
      this.stepFullEffect(deltaSec);
    };
    this.app.ticker.add(this.frameTicker as any);
  }

  /**
   * Ease the drawn fill toward the target with a CRITICALLY DAMPED SPRING. No-ops (and skips the
   * redraw) once settled.
   *
   * Why a spring rather than the obvious exponential `displayed += diff * k·dt`: an exponential
   * approach is at its FASTEST on the very first frame and only ever decelerates. Measured on the
   * 0→full sweep that put 12.9% of the whole bar into a single 16.7ms frame — the bar visibly
   * *popped* off the mark before easing in to land. A critically damped spring starts from the
   * current velocity instead, so from rest it eases IN, peaks mid-travel, and eases OUT — and being
   * critically damped it never overshoots or oscillates.
   *
   * This is the standard stable formulation (Unity's SmoothDamp / Game Programming Gems 4 §1.10).
   * The rational `expo` term is a cheap Padé-style approximation of e^(-x) that keeps the
   * integration stable at large dt, which is what makes it frame-rate independent rather than
   * merely frame-rate tolerant.
   */
  private stepFill(deltaSec: number): void {
    const target = this.targetProgress;
    if (this.displayedProgress === target && this.fillVelocity === 0) return;
    if (deltaSec <= 0) return;

    const omega = 2 / this.fillSmoothTimeSeconds;
    const x = omega * deltaSec;
    const expo = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = this.displayedProgress - target;
    const temp = (this.fillVelocity + omega * change) * deltaSec;

    this.fillVelocity = (this.fillVelocity - omega * temp) * expo;
    this.displayedProgress = target + (change + temp) * expo;

    // Park exactly on target once it's both close enough AND slow enough. Testing distance alone
    // would snap the bar mid-flight whenever it happened to pass near the target at speed.
    if (
      Math.abs(target - this.displayedProgress) <= this.fillSnapEpsilon &&
      Math.abs(this.fillVelocity) <= this.fillSnapEpsilon * omega
    ) {
      this.displayedProgress = target;
      this.fillVelocity = 0;
    }
    this.updateMeterFill();
  }

  private setTargetProgress(value: number): void {
    // Retarget — a RUNNING ticker picks the new value up next frame and eases to it. (The old code
    // kicked off a fresh rAF chain here, which is what created the second, competing loop.)
    this.targetProgress = Math.max(0, Math.min(1, Number(value) || 0));
    // A STOPPED ticker (this meter is hidden — see `setVisible`) will never run that easing, so the
    // canvas would keep showing whatever fill it was frozen on and hand that stale frame straight back
    // to the player the moment it is shown again. Jump to the value and draw it once instead: there is
    // no one watching, so there is no animation to lose — only a wrong frame to avoid.
    if (this.app && !this.app.ticker.started) {
      this.displayedProgress = this.targetProgress;
      this.fillVelocity = 0;
      this.updateMeterFill();
      // Settle the meter-full effect for the same reason the fill jumps: nobody is watching, so
      // there is no animation to lose — only a wrong frame to hand back. A shine left frozen over a
      // bar that has since emptied is exactly that, and `resizeToHost` renders synchronously.
      this.syncFullEffect();
    }
  }
}
