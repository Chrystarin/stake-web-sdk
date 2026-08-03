import { Application, Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { staticUrl } from '../../lib/staticUrl';

export class FreeSpinMeterEngine {
	private hostElement!: HTMLElement;

	setProgress(value: number): void {
		this.setTargetProgress(value);
	}


  
  progress = 1;

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
  private frameTicker?: (ticker: { deltaMS: number }) => void;

	async init(host: HTMLElement): Promise<void> {
		this.hostElement = host;
		await this.initPixi();
	}

  destroy(): void {
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
    this.meterScene.addChild(this.wheelSprite);
    app.stage.addChild(this.meterScene);
    this.startFrameTicker();

    this.resizeObserver = new ResizeObserver(() => this.scheduleResize());
    this.resizeObserver.observe(this.hostElement);

    this.targetProgress = Math.max(0, Math.min(1, Number(this.progress) || 0));
    this.displayedProgress = this.targetProgress;
    this.resizeToHost();
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

    const scale = Math.min(width / baseWidth, height / baseHeight);
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
    this.wheelSprite.width = wheelWidth;
    this.wheelSprite.height = wheelHeight;
    this.wheelSprite.position.set(
      offsetX + scaledBaseWidth * this.wheelOffsetXByBaseWidth,
      offsetY + scaledBaseHeight * this.wheelOffsetYByBaseHeight
    );

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
    // Just retarget — the ticker is always running and picks the new value up next frame. (The old
    // code kicked off a fresh rAF chain here, which is what created the second, competing loop.)
    this.targetProgress = Math.max(0, Math.min(1, Number(value) || 0));
  }
}
