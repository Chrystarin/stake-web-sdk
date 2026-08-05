import { Application, Assets, BlurFilter, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { BONUS_METER_FILL_SPEED_PER_SECOND } from '../../game-logic/constants';
import { reportBonusMeterRenderedProgress } from './bonusMeterVisual';
import { staticUrl } from '../../lib/staticUrl';

export class BonusMeterEngine {
	private hostElement!: HTMLElement;

	setProgress(value: number): void {
		this.setTargetProgress(value);
	}


  
  progress = 0;

  private app?: Application;
  private resizeObserver?: ResizeObserver;
  private resizeRafId: number | null = null;
  private progressAnimRafId: number | null = null;
  private lastProgressAnimTs: number | null = null;
  private readonly meterScene = new Container();
  // Vector fill: a solid #04AEF6 stroke ridden along the arch centerline, with a blurred #00E6FF
  // glow layer behind it (mirrors the design's `border: 14px solid #04AEF6` +
  // `box-shadow: 0 0 7.5px #00E6FF`). Replaces the old masked fill-PNG sprite.
  private readonly fillGlow = new Graphics();
  private readonly fillStroke = new Graphics();
  private glowFilter?: BlurFilter;
  private baseSprite?: Sprite;
  private fillTexture?: Texture;
  // --- Vector-fill tuning knobs (measured in fill-texture pixels; scaled to the rendered size) ---
  // Stroke thickness of the solid blue line and the blur radius of the cyan glow behind it.
  private readonly fillStrokeWidthTexPx = 11;
  private readonly fillGlowBlurTexPx = 7.5;
  private fillAlphaData?: Uint8ClampedArray;
  private fillAlphaWidth = 0;
  private fillAlphaHeight = 0;
  /** Left tip of fill art — used when meter is empty (ray at π hits the bottom edge instead). */
  private fillStartTipLocal?: { x: number; y: number };
  /** Right tip of fill art — used near full (ray at 2π runs off the texture's bottom edge). */
  private fillEndTipLocal?: { x: number; y: number };
  /** Solid-core centerline of the fill arch in texture space, one point per opaque column
   *  (ascending x). The marker rides this polyline so it stays glued to the visible bright tip. */
  private fillCenterlineLocal?: Array<{ x: number; y: number }>;
  markerLeftPx: number = 0;
  markerTopPx: number = 0;
  markerSizePx: number = 10;
  private meterOffsetXPx = 0;
  private meterOffsetYPx = 0;
  private meterNativeWidth = 1;
  private meterNativeHeight = 1;
  // Last size the renderer was resized to, so we can skip no-op resizes (see resizeToHost).
  private lastRenderWidth = 0;
  private lastRenderHeight = 0;
  private displayedProgress = 0;
  private targetProgress = 0;
  private readonly fillAnimationSpeedPerSecond = BONUS_METER_FILL_SPEED_PER_SECOND;
  // Fallback marker alignment if texture sampling is unavailable.
  private readonly markerRadiusOffsetByHeight = -0.2;
  private readonly markerAngleOffsetRad = 0.0;
  // Nudge marker downward by this fraction of markerSizePx (positive = lower). The marker now
  // lands on the fill centerline directly, so no vertical correction is needed.
  private readonly markerVerticalNudgeFraction = 0;

	async init(host: HTMLElement): Promise<void> {
		this.hostElement = host;
		await this.initPixi();
	}

  destroy(): void {
    if (this.resizeRafId !== null) {
      cancelAnimationFrame(this.resizeRafId);
      this.resizeRafId = null;
    }
    if (this.progressAnimRafId !== null) {
      cancelAnimationFrame(this.progressAnimRafId);
      this.progressAnimRafId = null;
    }
    this.resizeObserver?.disconnect();
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
      // imperceptible transparent blip instead of a white flash. The meter art is alpha-defined PNGs,
      // so MSAA does nothing for their visible edges — no visual cost.
      antialias: false,
      autoDensity: true,
      backgroundAlpha: 0,
      resolution: typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1
    });
    this.hostElement.appendChild(app.canvas as HTMLCanvasElement);
    this.app = app;

    // RENDER ON DEMAND. Pixi's Application starts a ticker that re-renders the stage every frame; this
    // scene only changes when the fill animates (`animateProgress` → `updateMeterFill`) or the host
    // resizes, so those 60 repaints/second were redrawing an identical picture — including a full
    // render-to-texture pass for `glowFilter`. Measured on an emulated phone (414x896, DPR 3): this
    // meter alone was 539 of the game's 898 draw calls/second, and it is `visibility: hidden` for the
    // whole 1-ball tier, so most of that was for pixels nobody could see. Every mutation path now ends
    // in `renderNow()` instead.
    //
    // ⚠️ This does NOT touch the level-up gate. `reportBonusMeterRenderedProgress` is called from
    // `updateMeterFill`, which is driven by this engine's own rAF loop, not by the Pixi ticker — so the
    // "wait for a visibly full bar" handshake still reports on exactly the same schedule as before.
    app.ticker.stop();

    let baseTexture: Texture;
    let meterTexture: Texture;
    try {
      [baseTexture, meterTexture] = await Promise.all([
        Assets.load(staticUrl('img/bonus-bar-base.webp')),
        Assets.load(staticUrl('img/bonus-bar-fill.webp'))
      ]);
    } catch {
      return;
    }

    this.baseSprite = new Sprite(baseTexture);
    this.baseSprite.anchor.set(0, 0);

    // The fill PNG is no longer drawn — it is kept only as the geometry source. Its alpha gives us
    // the arch centerline that the vector stroke and the marker both ride.
    this.fillTexture = meterTexture;
    this.cacheFillAlphaData(meterTexture);

    // Glow sits behind the solid stroke and is softened by a blur, standing in for the CSS
    // box-shadow. Blur radius is set per-resize once we know the render scale.
    this.glowFilter = new BlurFilter({ strength: 4 });
    this.fillGlow.filters = [this.glowFilter];

    this.meterScene.addChild(this.baseSprite);
    this.meterScene.addChild(this.fillGlow);
    this.meterScene.addChild(this.fillStroke);
    app.stage.addChild(this.meterScene);

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
    if (!this.app || !this.baseSprite) return;
    // Use layout dimensions (offsetWidth/offsetHeight), not getBoundingClientRect, so that
    // PixiJS world coordinates are in the same CSS-pixel space as the HTML marker overlay.
    // getBoundingClientRect returns post-transform visual pixels; when an ancestor has a CSS
    // scale() (e.g. .container scale(1.1)), the canvas buffer would be sized larger than the
    // element's own layout box, causing the marker's CSS left/top to diverge from the fill tip.
    const width = Math.max(1, Math.round(this.hostElement.offsetWidth));
    const height = Math.max(1, Math.round(this.hostElement.offsetHeight));
    // Skip when the host box hasn't actually changed size. ResizeObserver fires on unrelated layout
    // reflows around the meter (e.g. toggling Ball Per Drop restructures the panel), and every
    // renderer.resize() reallocates + clears the canvas backing store — the visible flash. Only
    // resize when the size truly changed. (Same no-op guard PlinkoEngine uses.)
    if (width === this.lastRenderWidth && height === this.lastRenderHeight) return;
    this.lastRenderWidth = width;
    this.lastRenderHeight = height;
    this.app.renderer.resize(width, height);

    const baseWidth = this.baseSprite.texture.width || 1;
    const baseHeight = this.baseSprite.texture.height || 1;
    const scale = Math.min(width / baseWidth, height / baseHeight);
    const scaledBaseWidth = baseWidth * scale;
    const scaledBaseHeight = baseHeight * scale;
    const offsetX = (width - scaledBaseWidth) / 2;
    const offsetY = (height - scaledBaseHeight) / 2;

    this.baseSprite.scale.set(scale);
    this.baseSprite.position.set(offsetX, offsetY);

    this.meterOffsetXPx = offsetX;
    this.meterOffsetYPx = offsetY;
    this.meterNativeWidth = scaledBaseWidth;
    this.meterNativeHeight = scaledBaseHeight;
    // Scale the glow blur from fill-texture space into rendered pixels so the halo keeps the same
    // visual weight at every meter size.
    if (this.glowFilter) {
      this.glowFilter.strength = Math.max(1, this.fillGlowBlurTexPx * this.texToWorldScale());
    }
    // Sized to cover the fill's glow halo at the tip (the bright core plus its soft bloom),
    // so the leading edge sits under the dot rather than peeking out around it.
    this.markerSizePx = Math.max(8, scaledBaseHeight * 0.72);
    this.updateMeterFill();
    // Render synchronously right after the resize. `renderer.resize` clears the canvas buffer, and
    // with antialias on the un-resolved MSAA buffer composites as an opaque white box for the one
    // frame before the ticker's next rAF redraw — a visible white flash whenever the layout reflows
    // (e.g. toggling Ball Per Drop). Drawing now closes that gap (same pattern as PlinkoEngine).
    this.app.renderer.render(this.app.stage);
  }

  private updateMeterFill(): void {
    if (!this.baseSprite) return;
    const clampedProgress = Math.max(0, Math.min(1, this.displayedProgress));
    // Publish what is actually being DRAWN. The in-bonus level-up waits on this so its reward only ever
    // lands on a bar the player has seen complete (the logical value runs ahead of this animation).
    reportBonusMeterRenderedProgress(clampedProgress);
    const centerX = this.meterOffsetXPx + this.meterNativeWidth / 2;
    const centerY = this.meterOffsetYPx + this.meterNativeHeight;
    const radius = this.meterNativeWidth / 2;
    const startAngle = Math.PI;
    const endAngle = startAngle + Math.PI * clampedProgress;

    // Draw the filled portion as a solid vector stroke that rides the arch centerline up to the
    // current progress angle, with a blurred cyan copy behind it for the glow. This replaces the
    // masked fill-PNG: `border: 14px solid #04AEF6` + `box-shadow: 0 0 7.5px #00E6FF`.
    this.fillStroke.clear();
    this.fillGlow.clear();
    const path = this.getFillPolylineWorld(endAngle);
    if (clampedProgress > 0 && path.length >= 2) {
      const strokeWidth = Math.max(1, this.fillStrokeWidthTexPx * this.texToWorldScale());
      const trace = (g: Graphics) => {
        g.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i++) g.lineTo(path[i].x, path[i].y);
      };
      // Glow first (behind), then the solid core on top.
      trace(this.fillGlow);
      this.fillGlow.stroke({ width: strokeWidth, color: 0x00e6ff, cap: 'round', join: 'round' });
      trace(this.fillStroke);
      this.fillStroke.stroke({ width: strokeWidth, color: 0x04aef6, cap: 'round', join: 'round' });
    }

    // Marker follows the current fill endpoint along the top arc.
    const markerAngle = endAngle + this.markerAngleOffsetRad;
    const epsilon = 0.0001;
    // At rest (fully empty / fully full) snap straight onto the art tip, so the dot settles
    // exactly on the end of the bar.
    if (clampedProgress <= epsilon && this.fillStartTipLocal) {
      this.setMarkerPosition(this.toWorldX(this.fillStartTipLocal.x), this.toWorldY(this.fillStartTipLocal.y));
      return;
    }
    if (clampedProgress >= 1 - epsilon && this.fillEndTipLocal) {
      this.setMarkerPosition(this.toWorldX(this.fillEndTipLocal.x), this.toWorldY(this.fillEndTipLocal.y));
      return;
    }

    // Ride the fill's own centerline at the leading angle. The bright core ends where this line
    // meets the mask cut, so the dot lands exactly on the visible tip — and because we read the
    // centerline directly (rather than ray-casting the band, which skims a long, off-tip stretch
    // wherever the ray grazes the shallow arch) it stays glued across the whole sweep, with no
    // progress-dependent drift to correct for.
    const tip = this.getCenterlineTipWorld(markerAngle);
    if (tip) {
      this.setMarkerPosition(tip.x, tip.y);
      return;
    }
    // Past either end of the arch the lookup has no segment to interpolate; snap to the matching
    // art tip so the marker rests on the fill edge instead of dropping to the baseline below.
    const nullFallbackTip = clampedProgress >= 0.5 ? this.fillEndTipLocal : this.fillStartTipLocal;
    if (nullFallbackTip) {
      this.setMarkerPosition(this.toWorldX(nullFallbackTip.x), this.toWorldY(nullFallbackTip.y));
      return;
    }
    const fallbackRadius = Math.max(0, radius + this.meterNativeHeight * this.markerRadiusOffsetByHeight);
    this.setMarkerPosition(
      centerX + fallbackRadius * Math.cos(markerAngle),
      centerY + fallbackRadius * Math.sin(markerAngle),
    );
  }

  private cacheFillAlphaData(texture: Texture): void {
    try {
      const source = texture.source.resource as CanvasImageSource | undefined;
      if (!source) return;
      const width = texture.width || 0;
      const height = texture.height || 0;
      if (width <= 0 || height <= 0) return;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(source, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);
      this.fillAlphaData = imageData.data;
      this.fillAlphaWidth = width;
      this.fillAlphaHeight = height;
      this.cacheFillTips();
      this.cacheFillCenterline();
    } catch {
      this.fillAlphaData = undefined;
      this.fillAlphaWidth = 0;
      this.fillAlphaHeight = 0;
      this.fillStartTipLocal = undefined;
      this.fillEndTipLocal = undefined;
      this.fillCenterlineLocal = undefined;
    }
  }

  /**
   * Endpoints of the fill arch in texture space, each taken at the vertical center
   * of its extreme opaque column so they match the band-center the ray sampler uses.
   * Used when the leading ray runs ~horizontal near the ends and samples nothing:
   * - start = leftmost opaque column (arc start, meter empty),
   * - end   = rightmost opaque column (arc end, meter full).
   */
  private cacheFillTips(): void {
    if (!this.fillAlphaData || !this.fillAlphaWidth || !this.fillAlphaHeight) {
      this.fillStartTipLocal = undefined;
      this.fillEndTipLocal = undefined;
      return;
    }
    // Use the same solid threshold as the ray sampler so tips land on the solid fill
    // core, not the faint outer glow, keeping the marker aligned at progress ≈ 0 / 1.
    const threshold = 80;
    const w = this.fillAlphaWidth;
    const h = this.fillAlphaHeight;
    let minX = w;
    let minXTop = h;
    let minXBot = -1;
    let maxX = -1;
    let maxXTop = h;
    let maxXBot = -1;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const alpha = this.fillAlphaData[(y * w + x) * 4 + 3];
        if (alpha <= threshold) continue;
        if (x < minX) {
          minX = x;
          minXTop = y;
          minXBot = y;
        } else if (x === minX) {
          if (y < minXTop) minXTop = y;
          if (y > minXBot) minXBot = y;
        }
        if (x > maxX) {
          maxX = x;
          maxXTop = y;
          maxXBot = y;
        } else if (x === maxX) {
          if (y < maxXTop) maxXTop = y;
          if (y > maxXBot) maxXBot = y;
        }
      }
    }

    this.fillStartTipLocal = minX < w ? { x: minX, y: (minXTop + minXBot) / 2 } : undefined;
    this.fillEndTipLocal = maxX >= 0 ? { x: maxX, y: (maxXTop + maxXBot) / 2 } : undefined;
  }

  /** Per-column center of the solid fill core (alpha > threshold), ascending x. The marker rides
   *  this polyline so it tracks the bright tip exactly, with none of the grazing-ray drift a
   *  single radial sample suffers near the ends of the shallow arch. */
  private cacheFillCenterline(): void {
    if (!this.fillAlphaData || !this.fillAlphaWidth || !this.fillAlphaHeight) {
      this.fillCenterlineLocal = undefined;
      return;
    }
    // Match the tip threshold so the centerline tracks the solid core, not the faint outer glow.
    const threshold = 80;
    const w = this.fillAlphaWidth;
    const h = this.fillAlphaHeight;
    const line: Array<{ x: number; y: number }> = [];
    for (let x = 0; x < w; x++) {
      let top = -1;
      let bot = -1;
      for (let y = 0; y < h; y++) {
        if (this.fillAlphaData[(y * w + x) * 4 + 3] <= threshold) continue;
        if (top < 0) top = y;
        bot = y;
      }
      if (top >= 0) line.push({ x, y: (top + bot) / 2 });
    }
    this.fillCenterlineLocal = line.length >= 2 ? line : undefined;
  }

  /**
   * World position of the arch centerline at the given leading-ray angle. Angles from the mask
   * center increase monotonically left→right along the arch, so we walk the centerline polyline
   * and interpolate within the segment that straddles the target angle. Returns null when the
   * angle falls past either end of the arch (handled by the art-tip fallbacks).
   */
  private getCenterlineTipWorld(angle: number): { x: number; y: number } | null {
    const line = this.fillCenterlineLocal;
    if (!line || line.length < 2) return null;
    const worldCx = this.meterOffsetXPx + this.meterNativeWidth / 2;
    const worldCy = this.meterOffsetYPx + this.meterNativeHeight;
    let prevAngle: number | null = null;
    let prevX = 0;
    let prevY = 0;
    for (const point of line) {
      const wx = this.toWorldX(point.x);
      const wy = this.toWorldY(point.y);
      // Arch points sit above the center (wy < worldCy), so the raw atan2 is negative; shift it
      // into [π, 2π] — the same range the mask sweep uses — where it rises monotonically.
      let a = Math.atan2(wy - worldCy, wx - worldCx);
      if (a < 0) a += Math.PI * 2;
      if (prevAngle !== null && angle >= Math.min(prevAngle, a) && angle <= Math.max(prevAngle, a)) {
        const span = a - prevAngle;
        const t = Math.abs(span) < 1e-6 ? 0 : (angle - prevAngle) / span;
        return { x: prevX + (wx - prevX) * t, y: prevY + (wy - prevY) * t };
      }
      prevAngle = a;
      prevX = wx;
      prevY = wy;
    }
    return null;
  }

  /**
   * The arch centerline in world space, from the start tip up to the point at `angle`, with the
   * leading end interpolated so it lands exactly where the marker sits. The vector fill stroke is
   * drawn along this polyline, so filled length and marker stay locked together across the sweep.
   */
  private getFillPolylineWorld(angle: number): Array<{ x: number; y: number }> {
    const line = this.fillCenterlineLocal;
    if (!line || line.length < 2) return [];
    const worldCx = this.meterOffsetXPx + this.meterNativeWidth / 2;
    const worldCy = this.meterOffsetYPx + this.meterNativeHeight;
    const points: Array<{ x: number; y: number }> = [];
    let prevAngle: number | null = null;
    let prevX = 0;
    let prevY = 0;
    for (const point of line) {
      const wx = this.toWorldX(point.x);
      const wy = this.toWorldY(point.y);
      // Same [π, 2π] remap as getCenterlineTipWorld so angles rise monotonically along the arch.
      let a = Math.atan2(wy - worldCy, wx - worldCx);
      if (a < 0) a += Math.PI * 2;
      if (a <= angle) {
        points.push({ x: wx, y: wy });
      } else {
        if (prevAngle !== null) {
          const span = a - prevAngle;
          const t = Math.abs(span) < 1e-6 ? 0 : (angle - prevAngle) / span;
          points.push({ x: prevX + (wx - prevX) * t, y: prevY + (wy - prevY) * t });
        }
        break;
      }
      prevAngle = a;
      prevX = wx;
      prevY = wy;
    }
    return points;
  }

  /** Fill-texture pixels → rendered world pixels. The fill art is stretched to the base's scaled
   *  box, so this is the width ratio between them. Used to size the stroke and glow responsively. */
  private texToWorldScale(): number {
    const texW = this.fillTexture?.width || 1;
    return this.meterNativeWidth / texW;
  }

  private toWorldX(localX: number): number {
    const texW = this.fillTexture?.width || 1;
    return this.meterOffsetXPx + localX * (this.meterNativeWidth / texW);
  }

  private toWorldY(localY: number): number {
    const texH = this.fillTexture?.height || 1;
    return this.meterOffsetYPx + localY * (this.meterNativeHeight / texH);
  }

  get markerStyle(): Record<string, string> {
    return {
      left: `${this.markerLeftPx}px`,
      top: `${this.markerTopPx}px`,
      width: `${this.markerSizePx}px`,
      height: `${this.markerSizePx}px`
    };
  }

  /**
   * Paint one frame. Replaces the per-frame ticker render stopped in {@link initPixi} — call it after
   * anything that changes what the meter should look like.
   *
   * Synchronous rather than rAF-coalesced on purpose: every caller is already inside a frame (the
   * progress rAF, or the resize rAF), and rendering right after the mutation keeps the scene-graph
   * write and the draw in the same frame in that order. Deferring the draw to a later callback is what
   * made the free-spin meter's fill visibly stutter — see `FreeSpinMeterEngine.startFrameTicker`.
   */
  private renderNow(): void {
    if (!this.app) return;
    this.app.renderer.render(this.app.stage);
  }

  private setMarkerPosition(x: number, y: number): void {
    this.markerLeftPx = x;
    this.markerTopPx = y + this.markerSizePx * this.markerVerticalNudgeFraction;
  }

  private setTargetProgress(value: number): void {
    this.targetProgress = Math.max(0, Math.min(1, Number(value) || 0));
    this.startProgressAnimation();
  }

  private startProgressAnimation(): void {
    if (this.progressAnimRafId !== null) return;
    this.lastProgressAnimTs = null;
    this.progressAnimRafId = requestAnimationFrame((ts) => this.animateProgress(ts));
  }

  private animateProgress(timestamp: number): void {
    this.progressAnimRafId = null;
    if (this.lastProgressAnimTs === null) {
      this.lastProgressAnimTs = timestamp;
    }
    const deltaSec = Math.max(0, (timestamp - this.lastProgressAnimTs) / 1000);
    this.lastProgressAnimTs = timestamp;
    const step = this.fillAnimationSpeedPerSecond * deltaSec;

    if (this.displayedProgress < this.targetProgress) {
      this.displayedProgress = Math.min(this.targetProgress, this.displayedProgress + step);
    } else if (this.displayedProgress > this.targetProgress) {
      this.displayedProgress = Math.max(this.targetProgress, this.displayedProgress - step);
    }

    this.updateMeterFill();
    const diff = Math.abs(this.displayedProgress - this.targetProgress);
    if (diff > 0.0005) {
      // Exactly one draw per animating frame (the ticker no longer draws — see `renderNow`).
      this.renderNow();
      this.progressAnimRafId = requestAnimationFrame((ts) => this.animateProgress(ts));
      return;
    }
    this.displayedProgress = this.targetProgress;
    this.updateMeterFill();
    // Final frame of the animation: draw the settled bar, then go quiet until something changes.
    this.renderNow();
    this.lastProgressAnimTs = null;
  }
}
