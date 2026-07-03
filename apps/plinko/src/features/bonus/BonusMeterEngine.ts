import { Application, Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { BONUS_METER_FILL_SPEED_PER_SECOND } from '../../game-logic/constants';
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
  private readonly meterMask = new Graphics();
  private baseSprite?: Sprite;
  private meterSprite?: Sprite;
  private fillTexture?: Texture;
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
    this.app?.destroy(true, { children: true, texture: false });
  }

  private async initPixi(): Promise<void> {
    const app = new Application();
    await app.init({
      width: 1,
      height: 1,
      antialias: true,
      autoDensity: true,
      backgroundAlpha: 0,
      resolution: typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1
    });
    this.hostElement.appendChild(app.canvas as HTMLCanvasElement);
    this.app = app;

    let baseTexture: Texture;
    let meterTexture: Texture;
    try {
      [baseTexture, meterTexture] = await Promise.all([
        Assets.load(staticUrl('img/bonus-bar-base.png')),
        Assets.load(staticUrl('img/bonus-bar-fill.png'))
      ]);
    } catch {
      return;
    }

    this.baseSprite = new Sprite(baseTexture);
    this.baseSprite.anchor.set(0, 0);

    this.meterSprite = new Sprite(meterTexture);
    this.meterSprite.anchor.set(0, 0);
    this.meterSprite.mask = this.meterMask;
    this.fillTexture = meterTexture;
    this.cacheFillAlphaData(meterTexture);

    this.meterScene.addChild(this.baseSprite);
    this.meterScene.addChild(this.meterMask);
    this.meterScene.addChild(this.meterSprite);
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
    if (!this.app || !this.baseSprite || !this.meterSprite) return;
    // Use layout dimensions (offsetWidth/offsetHeight), not getBoundingClientRect, so that
    // PixiJS world coordinates are in the same CSS-pixel space as the HTML marker overlay.
    // getBoundingClientRect returns post-transform visual pixels; when an ancestor has a CSS
    // scale() (e.g. .container scale(1.1)), the canvas buffer would be sized larger than the
    // element's own layout box, causing the marker's CSS left/top to diverge from the fill tip.
    const width = Math.max(1, Math.round(this.hostElement.offsetWidth));
    const height = Math.max(1, Math.round(this.hostElement.offsetHeight));
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
    this.meterSprite.position.set(offsetX, offsetY);
    this.meterSprite.width = scaledBaseWidth;
    this.meterSprite.height = scaledBaseHeight;
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
    if (!this.meterSprite) return;
    const clampedProgress = Math.max(0, Math.min(1, this.displayedProgress));
    this.meterMask.clear();
    const centerX = this.meterOffsetXPx + this.meterNativeWidth / 2;
    const centerY = this.meterOffsetYPx + this.meterNativeHeight;
    const radius = this.meterNativeWidth / 2;
    const startAngle = Math.PI;
    const endAngle = startAngle + Math.PI * clampedProgress;
    if (clampedProgress > 0) {
      this.meterMask.moveTo(centerX, centerY);
      this.meterMask.arc(centerX, centerY, radius, startAngle, endAngle);
      this.meterMask.lineTo(centerX, centerY);
      this.meterMask.fill(0xffffff);
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
      this.progressAnimRafId = requestAnimationFrame((ts) => this.animateProgress(ts));
      return;
    }
    this.displayedProgress = this.targetProgress;
    this.updateMeterFill();
    this.lastProgressAnimTs = null;
  }
}
