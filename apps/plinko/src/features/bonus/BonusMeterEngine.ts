import { Application, Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';
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
  markerLeftPx: number = 0;
  markerTopPx: number = 0;
  markerSizePx: number = 10;
  private meterOffsetXPx = 0;
  private meterOffsetYPx = 0;
  private meterNativeWidth = 1;
  private meterNativeHeight = 1;
  private displayedProgress = 0;
  private targetProgress = 0;
  private readonly fillAnimationSpeedPerSecond = 1.8;
  // Fallback marker alignment if texture sampling is unavailable.
  private readonly markerRadiusOffsetByHeight = -0.2;
  private readonly markerAngleOffsetRad = 0.0;
  // Nudge marker downward by this fraction of markerSizePx (positive = lower).
  private readonly markerVerticalNudgeFraction = 0.25;

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
    this.markerSizePx = Math.max(8, scaledBaseHeight * 0.5);
    this.updateMeterFill();
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
    if (clampedProgress <= epsilon && this.fillStartTipLocal) {
      this.setMarkerPosition(this.toWorldX(this.fillStartTipLocal.x), this.toWorldY(this.fillStartTipLocal.y));
      return;
    }
    if (clampedProgress >= 1 - epsilon && this.fillEndTipLocal) {
      this.setMarkerPosition(this.toWorldX(this.fillEndTipLocal.x), this.toWorldY(this.fillEndTipLocal.y));
      return;
    }
    const sampledPos = this.getMarkerPositionFromFillTexture(markerAngle);
    if (sampledPos) {
      this.setMarkerPosition(sampledPos.x, sampledPos.y);
      return;
    }
    // Near either end of the flattened arch the leading ray runs almost horizontal
    // and can miss every texel; snap to the actual art tip on the matching side so
    // the marker stays on the fill edge instead of dropping to the baseline below.
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
    } catch {
      this.fillAlphaData = undefined;
      this.fillAlphaWidth = 0;
      this.fillAlphaHeight = 0;
      this.fillStartTipLocal = undefined;
      this.fillEndTipLocal = undefined;
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

  private getMarkerPositionFromFillTexture(angle: number): { x: number; y: number } | null {
    if (!this.fillTexture || !this.fillAlphaData || !this.fillAlphaWidth || !this.fillAlphaHeight) return null;
    const texW = this.fillAlphaWidth;
    const texH = this.fillAlphaHeight;
    const scaleX = this.meterNativeWidth / texW;
    const scaleY = this.meterNativeHeight / texH;

    // Cast the ray in WORLD space so non-uniform texture scaling doesn't skew the angle.
    // The mask arc uses world-space geometry; sampling in texture space at the same numeric
    // angle introduces drift whenever scaleX ≠ scaleY (different at higher progress values).
    const worldCx = this.meterOffsetXPx + this.meterNativeWidth / 2;
    const worldCy = this.meterOffsetYPx + this.meterNativeHeight;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const maxRadius = Math.max(this.meterNativeWidth, this.meterNativeHeight);

    let firstHit = -1;
    let lastHit = -1;
    let lastSolidHit = -1;
    for (let r = 0; r <= maxRadius; r += 0.5) {
      const worldX = worldCx + dx * r;
      const worldY = worldCy + dy * r;
      const texX = Math.round((worldX - this.meterOffsetXPx) / scaleX);
      const texY = Math.round((worldY - this.meterOffsetYPx) / scaleY);
      if (texX < 0 || texX >= texW || texY < 0 || texY >= texH) continue;
      const alpha = this.fillAlphaData[(texY * texW + texX) * 4 + 3];
      if (alpha > 20) {
        if (firstHit < 0) firstHit = r;
        lastHit = r;
      }
      // Track the outer edge of the solid fill core (excluding the faint outer glow).
      if (alpha > 80) lastSolidHit = r;
    }
    if (firstHit < 0 || lastHit < 0) return null;
    // Place marker at the outer solid-fill edge so it sits right on the visible tip.
    // midpoint was still offset at higher progress; lastHit overshoots into the glow.
    const tipR = lastSolidHit >= 0 ? lastSolidHit : (firstHit + lastHit) / 2;
    return {
      x: worldCx + dx * tipR,
      y: worldCy + dy * tipR,
    };
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
