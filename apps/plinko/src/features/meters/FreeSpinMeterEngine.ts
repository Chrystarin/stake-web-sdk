import { Application, Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';

export class FreeSpinMeterEngine {
	private hostElement!: HTMLElement;

	setProgress(value: number): void {
		this.setTargetProgress(value);
	}


  
  progress = 1;

  private app?: Application;
  private resizeObserver?: ResizeObserver;
  private resizeRafId: number | null = null;
  private progressAnimRafId: number | null = null;
  private lastProgressAnimTs: number | null = null;
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
  private displayedProgress = 0;
  private targetProgress = 0;
  private readonly fillAnimationSpeedPerSecond = 2.2;
  // Wheel tuning controls (relative to the base art size).
  private readonly wheelScaleByBaseHeight = 0.45;
  private readonly wheelOffsetXByBaseWidth = 0.9;
  private readonly wheelOffsetYByBaseHeight = 0.75;
  private readonly wheelSpinRadiansPerSecond = 2.4;
  private wheelSpinTicker?: (ticker: { deltaMS: number }) => void;

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
    if (this.app && this.wheelSpinTicker) {
      this.app.ticker.remove(this.wheelSpinTicker as any);
      this.wheelSpinTicker = undefined;
    }
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
      resolution: typeof window !== 'undefined' ? Math.min(1.5, window.devicePixelRatio || 1) : 1
    });
    this.hostElement.appendChild(app.canvas as HTMLCanvasElement);
    this.app = app;

    let baseTexture: Texture;
    let meterTexture: Texture;
    let wheelTexture: Texture;
    try {
      [baseTexture, meterTexture, wheelTexture] = await Promise.all([
        Assets.load('/img/free-spin-base.png'),
        Assets.load('/img/free-spin-meter.png'),
        Assets.load('/img/free-spin-meter-wheel.png')
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
    this.startWheelSpin();

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
    this.meterOffsetXPx = offsetX + scaledBaseWidth * 0.075;
    this.meterOffsetYPx = offsetY + scaledBaseHeight * 0.675;
    this.meterNativeWidth = scaledBaseWidth * 0.9;
    this.meterNativeHeight = scaledBaseHeight * 0.13;

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
  }

  private updateMeterFill(): void {
    if (!this.app || !this.meterSprite) return;
    const clampedProgress = Math.max(0, Math.min(1, this.displayedProgress));
    this.meterMask.clear();
    const radius = this.meterNativeHeight / 2;
    this.meterMask.roundRect(
      this.meterOffsetXPx,
      this.meterOffsetYPx,
      this.meterNativeWidth * clampedProgress,
      this.meterNativeHeight,
      radius
    );
    this.meterMask.fill(0xffffff);
  }

  private startWheelSpin(): void {
    if (!this.app || !this.wheelSprite) return;
    if (this.wheelSpinTicker) {
      this.app.ticker.remove(this.wheelSpinTicker as any);
    }
    this.wheelSpinTicker = (ticker: { deltaMS: number }) => {
      if (!this.wheelSprite) return;
      const deltaSec = Math.max(0, Number(ticker.deltaMS) || 0) / 1000;
      this.wheelSprite.rotation += this.wheelSpinRadiansPerSecond * deltaSec;
    };
    this.app.ticker.add(this.wheelSpinTicker as any);
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
