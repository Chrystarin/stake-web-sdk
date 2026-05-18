import { Application, Assets, Container, FillGradient, Graphics, Sprite, Text } from 'pixi.js';
import { formatCoefficientLabel, isMobile } from '../lib/format';
import { staticUrl } from '../lib/staticUrl';

export type BallDroppedEvent = {
	multiplier: number;
	ballId: number;
	slotIndex: number;
	isSpinSlot: boolean;
};

export type CoinPegHitEvent = { row: number; col: number };

export type PlinkoEngineOptions = {
	hostElement: HTMLElement;
	onBallDropped?: (event: BallDroppedEvent) => void;
	onCoinPegHit?: (event: CoinPegHitEvent) => void;
};

interface Ball {
  id: number;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  scale: number;
  isDropping: boolean;
  currentPoint: number;
  path: PathPoint[];
  bouncedRows: Set<number>;
  lastBounceTime: number;
  visitedPoints: Set<number>;
  currentSpeed: number;
  isInBounce: boolean;
  bounceStartTime: number;
  bounceDuration: number;
  currentSegmentIndex: number;
  velocityX: number;
  velocityY: number;
  target: number;
  targetIndex: number;
  targetReached: boolean;
  slotAnimationStart: number;
}

interface PathPoint {
  x: number;
  y: number;
  row: number;
  closestPeg: Peg | null;
  bounceIntensity: number;
}

interface Peg {
  x: number;
  y: number;
  row: number;
  col: number;
  bounceEffect: number;
  bounceTime: number;
  isTouched: boolean;
}

interface Slot {
  x: number;
  y: number;
  width: number;
  coefficient: number;
  labelText: string;
  centerX: number;
  color: string;
  colorNumber: number;
  isSpecial: boolean;
  originalY: number;
  animationOffset: number;
  animationTime: number;
  animationActive: boolean;
}

type SpawnDirection = -2 | -1 | 0 | 1 | 2;

export class PlinkoEngine {
	constructor(options: PlinkoEngineOptions) {
		this.hostElement = options.hostElement;
		this.onBallDropped = options.onBallDropped;
		this.onCoinPegHit = options.onCoinPegHit;
		if (isMobile()) {
			this.pyramidConfig.bounceAmplitude = 12;
		}
	}

	async init(): Promise<void> {
		await this.initPixi();
	}

	updateScene(coefficients: number[], rows: number, animationEnabled?: boolean): void {
		if (coefficients?.length) this.coefficients = coefficients;
		if (rows) this.rows = rows;
		if (animationEnabled !== undefined) this.animationEnabled = animationEnabled;
		if (!this.coefficients.length) {
			this.layoutWidthFloor = 0;
			return;
		}
		/** Slots + multipliers come from coefficient rows; wait until they exist (config or RGS hydrate) before rebuilding. */
		if (this.rows && this.pixiReady && this.app) {
			this.updateContainerSize();
			this.rebuildScene();
		}
	}

  coefficients: number[] = [];
  rows = 12;
  /** When false, peg hit visuals (glow / scale pulse) and slot landing pulse are off; ball physics and bounces still run. */
  animationEnabled = true;
  /** Emitted when a ball settles; includes slot metadata for spin-gate handling. */
  onBallDropped?: (event: BallDroppedEvent) => void;
  /** Emitted when a featured (coin) peg is hit. */
  onCoinPegHit?: (event: CoinPegHitEvent) => void;
  private hostElement: HTMLElement;

  private app?: Application;
  private readonly world = new Container();
  private readonly pegGraphics = new Graphics();
  private readonly featuredPegLayer = new Container();
  private readonly slotGlowGraphics = new Graphics();
  private readonly slotBodiesGraphics = new Graphics();
  private readonly labelLayer = new Container();
  private readonly bulletsLayer = new Container();
  private readonly ballsGraphics = new Graphics();
  private readonly pipeLayer = new Container();
  private readonly slotLabels: Text[] = [];
  private pipeSprites: Sprite[] = [];
  private slotPipeGradients: FillGradient[] = [];
  private readonly pendingDropTimeouts = new Set<ReturnType<typeof setTimeout>>();
  private readonly pendingBallRemovalTimeouts = new Set<ReturnType<typeof setTimeout>>();
  /** Balls queued by `dropBallBurst` that have not yet been spawned. */
  private pendingBurstDrops = 0;

  private resizeObserver?: ResizeObserver;
  private resizeRafId: number | null = null;
  private lastWidth = 0;
  private lastHeight = 0;
  /** Last window size — layout uses vw() so we must rebuild when inner size changes even if the canvas host size is unchanged. */
  private lastWindowInnerW = 0;
  private lastWindowInnerH = 0;
  /** Minimum layout width so the full peg grid is not clipped when the flex host is narrower than the pyramid span. */
  private layoutWidthFloor = 0;

  private readonly boundWindowResize = (): void => {
    this.resizeCanvasToContainer();
  };

  private ballTexture?: Sprite['texture'];
  private slotPipeTexture?: Sprite['texture'];
  private coinPegTexture?: Sprite['texture'];
  private texturesLoaded = false;
  private pixiReady = false;
  private slotGlowStripGradient?: FillGradient;
  private readonly featuredPegSprites = new Map<string, Sprite>();
  private readonly pegsByRow = new Map<number, Peg[]>();
  private featuredPegKeys = new Set<string>();

  
  

  balls: Ball[] = [];
  pegs: Peg[] = [];
  slots: Slot[] = [];
  nextBallId = 1;
  isAnimating = false;
  animationSpeed = 0.7;
  private containerWidth = 0;
  private containerHeight = 0;
  private readonly BASE_ROWS = 8;
  private animTickerBound = (): void => this.animateFrame();
  private tickerRegistered = false;
  private readonly BASE_VIEWPORT_WIDTH = 1920;
  private readonly MAX_RENDER_RESOLUTION = 1.5;
  private frameTick = 0;
  private slotLabelFontSize = 14;
  private slotLabelLetterSpacingPx = 0;
  private slotLabelStrokeWidth = 1;

  private vw(vwValue: number): number {
    if (typeof window === 'undefined') {
      return (this.BASE_VIEWPORT_WIDTH * vwValue) / 100;
    }
    return (window.innerWidth * vwValue) / 100;
  }

  get elementScale(): number {
    return this.BASE_ROWS / this.rows;
  }

  get pegRadius(): number {
    return this.containerHeight * 0.0135 * this.elementScale;
  }

  get ballRadius(): number {
    // Use the same scaling strategy as pegs (container height + elementScale).
    const desiredRadius = this.containerHeight * 0.0245 * this.elementScale;
    // Keep enough clearance so a falling ball fits between neighboring pegs.
    const laneSafeRadius = Math.max(1, (this.pegSpacingX - this.pegRadius * 2) * 0.46);
    return Math.min(desiredRadius, laneSafeRadius);
  }

  get slotBounceHeight(): number {
    // Use the same scaling method as pegs/balls.
    return this.containerHeight * 0.018 * this.elementScale;
  }

  get topMargin(): number {
    return isMobile() ? 0 : Math.max(this.vw(1.56), this.containerHeight * 0.01);
  }

  get bottomMargin(): number {
    return isMobile() ? 0 : Math.max(this.vw(1.56), this.containerHeight * 0.01);
  }

  get slotHeight(): number {
    return Math.max(this.vw(1.55), this.containerHeight * 0.075);
  }

  get pegSpacing(): number {
    if (this.rows <= 1) return this.vw(2.1);
    const availableHeight =
      this.containerHeight - this.topMargin - this.bottomMargin - this.slotHeight - this.vw(1.05);
    /** Flex can transiently shrink height → negative spacing and invalid peg rows. */
    const raw = availableHeight / (this.rows + 0.5);
    if (!Number.isFinite(raw)) return this.vw(2.1);
    const safe = raw > 0 ? raw : this.vw(2.5);
    return Math.max(this.vw(1.05), safe);
  }

  get pegSpacingX(): number {
    // Horizontal lane multiplier: increasing this widens the pyramid footprint,
    // especially visible at the bottom rows.
    return this.pegSpacing * (isMobile() ? 1.35 : 1.5);
  }

  get slotWidthScale(): number {
    return 1.025;
  }

  get actualPyramidHeight(): number {
    return this.topMargin + (this.rows + 0.5) * this.pegSpacing + this.slotHeight + this.bottomMargin;
  }

  pyramidConfig = {
    animationSteps: 100,
    dropSpeed: 0.01,
    bounceEffectDuration: 200,
    maxBounceScale: 2.0,
    bounceCooldown: 100,
    bounceDistance: 60,
    normalSpeed: 0.0066,
    bounceSlowdown: 0.0039,
    bounceDuration: 240,
    acceleration: 0.00036,
    gravityEffect: 0.00102,
    maxSpeed: 0.047,
    minSpeed: 0.0012,
    bounceAmplitude: 26,
    bounceFrequency: 0.05,
    horizontalDrift: 0.4,
    slotAnimationDuration: 600,
    slotBounceHeight: 18,
    slotBounceCount: 3,
    laneCentering: 0.6,
    lateralFriction: 0.985,
    bounceImpulseMin: 0.9,
    bounceImpulseMax: 1.45,
    bounceLift: 0.58,
    verticalGravity: 0.13,
    verticalDamping: 0.988,
    belowBounceChance: 0.42
  };

  destroy(): void {
    this.layoutWidthFloor = 0;
    this.stopTicker();
    this.clearPendingDropTimeouts();
    this.clearPendingBallRemovalTimeouts();
    if (this.resizeRafId !== null) cancelAnimationFrame(this.resizeRafId);
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.boundWindowResize);
    }
    this.resizeObserver?.disconnect();
    this.slotGlowStripGradient?.destroy();
    this.slotGlowStripGradient = undefined;
    this.featuredPegSprites.forEach((sprite) => sprite.destroy());
    this.featuredPegSprites.clear();
    this.app?.destroy(true, { children: true, texture: false });
  }

  private clearPendingDropTimeouts(): void {
    this.pendingDropTimeouts.forEach((id) => clearTimeout(id));
    this.pendingDropTimeouts.clear();
    this.pendingBurstDrops = 0;
  }

  private clearPendingBallRemovalTimeouts(): void {
    this.pendingBallRemovalTimeouts.forEach((id) => clearTimeout(id));
    this.pendingBallRemovalTimeouts.clear();
  }

  private async initPixi(): Promise<void> {
    const initialSize = this.getContainerSize() ?? { width: Math.floor(this.vw(16.7)), height: Math.floor(this.vw(9.4)) };
    const { width, height } = initialSize;

    const app = new Application();
    await app.init({
      width,
      height,
      resolution:
        typeof window !== 'undefined'
          ? Math.min(this.MAX_RENDER_RESOLUTION, window.devicePixelRatio || 1)
          : 1,
      autoDensity: true,
      antialias: true,
      backgroundAlpha: 0
    });

    this.hostElement.appendChild(app.canvas as HTMLCanvasElement);

    this.world.sortableChildren = true;
    this.slotGlowGraphics.zIndex = 0;
    this.pegGraphics.zIndex = 1;
    this.featuredPegLayer.zIndex = 1.5;
    this.pipeLayer.zIndex = 2;
    this.bulletsLayer.zIndex = 2.5;
    this.ballsGraphics.zIndex = 2.6;
    this.slotBodiesGraphics.zIndex = 3;
    this.labelLayer.zIndex = 4;

    this.world.addChild(this.slotGlowGraphics);
    this.world.addChild(this.pegGraphics);
    this.world.addChild(this.featuredPegLayer);
    this.world.addChild(this.pipeLayer);
    this.world.addChild(this.slotBodiesGraphics);
    this.world.addChild(this.labelLayer);
    this.world.addChild(this.bulletsLayer);
    this.world.addChild(this.ballsGraphics);
    app.stage.addChild(this.world);

    this.app = app;
    this.lastWidth = width;
    this.lastHeight = height;
    this.updateContainerSize();
    if (this.containerWidth <= 0 || this.containerHeight <= 0) {
      this.containerWidth = width;
      this.containerHeight = height;
    }

    try {
      const loadOptional = async (url: string) => {
        try {
          return await Assets.load(url);
        } catch {
          return undefined;
        }
      };
      const [ballTex, pipeTex, coinPegTex] = await Promise.all([
        loadOptional(staticUrl('img/ball.svg')),
        loadOptional(staticUrl('img/slot_pipe_bg.svg')),
        loadOptional(staticUrl('img/coin_peg.png'))
      ]);
      this.ballTexture = ballTex;
      this.slotPipeTexture = pipeTex;
      this.coinPegTexture = coinPegTex;
    } catch {
      this.ballTexture = undefined;
      this.slotPipeTexture = undefined;
      this.coinPegTexture = undefined;
    }
    this.texturesLoaded = !!this.slotPipeTexture;

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.boundWindowResize, { passive: true });
      this.lastWindowInnerW = window.innerWidth;
      this.lastWindowInnerH = window.innerHeight;
    }

    this.resizeObserver = new ResizeObserver(() => this.resizeCanvasToContainer());
    this.resizeObserver.observe(this.hostElement);

    this.pixiReady = true;
    if (this.coefficients.length && this.rows) {
      this.rebuildScene();
    }

    queueMicrotask(() => {
      this.bustResizeDedupe();
      this.resizeCanvasToContainer();
    });
  }

  private updateContainerSize(): void {
    const size = this.getContainerSize();
    if (!size) return;
    this.containerWidth = size.width;
    this.containerHeight = size.height;
  }

  /** Smallest usable board box (CSS px). Rejects flex “almost zero” widths that bunch every peg left. */
  private layoutMinExtentPx(): number {
    return Math.max(96, Math.floor(this.vw(24)));
  }

  /** When the CSS host still measures 0×0, pyramid math (`pegRadius`, etc.) tracks the Pixi buffer. */
  private ensureLayoutDimensionsFromRendererIfNeeded(): void {
    const r = this.app?.renderer;
    if (!r) return;
    const rw = Math.max(1, Math.floor(Number(r.width) || 0));
    const rh = Math.max(1, Math.floor(Number(r.height) || 0));
    const minE = this.layoutMinExtentPx();
    const unusable =
      this.containerWidth < minE ||
      this.containerHeight < minE ||
      this.containerWidth <= 0 ||
      this.containerHeight <= 0;
    if (!unusable) return;
    this.containerWidth = Math.max(minE, rw);
    this.containerHeight = Math.max(minE, rh);
  }

  /** True if flex/layout gave bogus narrow/tiny rectangles (fixes “single peg top-left”). */
  private measurementsLookUsable(width: number, height: number): boolean {
    const minE = this.layoutMinExtentPx();
    if (width < minE || height < minE) return false;
    const area = width * height;
    return Number.isFinite(area) && area >= minE * minE;
  }

  /** VW-based fallback canvas size when DOM has not yielded a real flex box yet. */
  private createViewportFallbackSize(): { width: number; height: number } {
    const minE = this.layoutMinExtentPx();
    return {
      width: Math.max(minE, Math.floor(this.vw(92))),
      height: Math.max(
        minE,
        Math.floor(this.vw(55)),
        Math.floor(this.vw(22) * ((this.rows + 4) / 8)),
      ),
    };
  }

  private rebuildScene(): void {
    if (!this.app) return;
    if (!this.coefficients.length || !this.rows) return;
    this.ensureLayoutDimensionsFromRendererIfNeeded();
    /** If DOM gave a bogus strip after init, widen/tall-enough before peg math. */
    if (!this.measurementsLookUsable(this.containerWidth, this.containerHeight)) {
      const fb = this.createViewportFallbackSize();
      const r = this.app.renderer;
      this.containerWidth = fb.width;
      this.containerHeight = fb.height;
      r.resize(this.containerWidth, this.containerHeight);
      this.lastWidth = this.containerWidth;
      this.lastHeight = this.containerHeight;
    }
    /** Host can be a narrow flex column; buffer must be at least the bottom-row peg span or only the left column is visible. */
    const pegsInBottomRow = this.rows + 3;
    const footprintX = Math.max(1, pegsInBottomRow - 1) * this.pegSpacingX * 1.02;
    this.layoutWidthFloor = Math.ceil(footprintX);
    if (this.containerWidth < this.layoutWidthFloor) {
      this.containerWidth = this.layoutWidthFloor;
      const r = this.app.renderer;
      r.resize(this.containerWidth, this.containerHeight);
      this.lastWidth = this.containerWidth;
      this.lastHeight = this.containerHeight;
    }
    this.updateWorldViewportOffset();
    this.generatePegs();
    this.syncFeaturedPegSprites();
    this.generateSlots();
    this.syncSlotPipesAndLabels();
    this.refreshSlotLabelAppearance();
    this.drawStaticPyramid();
    this.renderFrame();
  }

  private renderFrame(): void {
    this.app?.render();
  }

  private refreshSlotLabelAppearance(): void {
    this.slotLabelFontSize = this.computeUniformSlotLabelFontSize();
    this.slotLabelLetterSpacingPx = Math.round(this.slotLabelFontSize * 0.035);
    this.slotLabelStrokeWidth = Math.max(1, Math.round(this.slotLabelFontSize * 0.08));
    const textRes = this.getSlotLabelTextResolution();
    for (let i = 0; i < this.slotLabels.length; i++) {
      const label = this.slotLabels[i];
      const slot = this.slots[i];
      if (!label || !slot) continue;
      if (label.resolution !== textRes) {
        label.resolution = textRes;
      }
      label.style.fontSize = this.slotLabelFontSize;
      label.style.fontWeight = '700';
      label.style.letterSpacing = this.slotLabelLetterSpacingPx;
      label.style.fill = 0xffffff;
      label.style.stroke = {
        color: 0x152028,
        width: this.slotLabelStrokeWidth,
        join: 'round',
        cap: 'round'
      };
      label.text = slot.labelText;
    }
  }

  /**
   * Keep the board visually lower inside a taller canvas so high spawn remains visible.
   * This is a render offset only; physics/layout coordinates remain unchanged.
   */
  private updateWorldViewportOffset(): void {
    const yOffset = isMobile() ? 0 : this.containerHeight * 0.085;
    this.world.position.set(0, yOffset);
  }

  private syncFeaturedPegSprites(): void {
    for (const [key, sprite] of this.featuredPegSprites.entries()) {
      if (!this.featuredPegKeys.has(key) || !this.coinPegTexture) {
        sprite.destroy();
        this.featuredPegSprites.delete(key);
      }
    }
    if (!this.coinPegTexture) return;
    for (const key of this.featuredPegKeys) {
      if (this.featuredPegSprites.has(key)) continue;
      const sprite = new Sprite(this.coinPegTexture);
      sprite.anchor.set(0.5);
      this.featuredPegLayer.addChild(sprite);
      this.featuredPegSprites.set(key, sprite);
    }
  }

  private syncSlotPipesAndLabels(): void {
    for (const s of this.pipeSprites) {
      s.destroy();
    }
    this.pipeSprites = [];
    for (const t of this.slotLabels) {
      t.destroy();
    }
    this.slotLabels.length = 0;
    for (const gradient of this.slotPipeGradients) {
      gradient.destroy();
    }
    this.slotPipeGradients = [];

    if (!this.texturesLoaded || !this.slotPipeTexture) return;

    for (let i = 0; i < this.slots.length; i++) {
      const sp = new Sprite(this.slotPipeTexture);
      sp.anchor.set(0.5, 0);
      this.pipeLayer.addChild(sp);
      this.pipeSprites.push(sp);

      const slot = this.slots[i];
      const slotBodyH = this.slotHeight * 0.82;
      const txt = new Text({
        text: '',
        resolution: this.getSlotLabelTextResolution(),
        roundPixels: true,
        style: {
          fontFamily: 'Arial',
          fontSize: Math.max(14, slotBodyH * 0.42),
          fontWeight: '700',
          fill: 0xffffff,
          align: 'center'
        }
      });
      txt.anchor.set(0.5, 0.5);
      this.labelLayer.addChild(txt);
      this.slotLabels.push(txt);

      const slotRgb = this.cssColorToNumber(slot.color);
      const { r: sr, g: sg, b: sb } = this.numberToRgb(slotRgb);
      this.slotPipeGradients.push(
        new FillGradient({
          type: 'linear',
          start: { x: 0, y: 0 },
          end: { x: 0, y: 1 },
          textureSpace: 'local',
          colorStops: [
            { offset: 0, color: `rgba(${sr}, ${sg}, ${sb}, 0.0)` },
            { offset: 0.22, color: `rgba(${sr}, ${sg}, ${sb}, 0.03)` },
            { offset: 0.5, color: `rgba(${sr}, ${sg}, ${sb}, 0.2)` },
            { offset: 0.78, color: `rgba(${sr}, ${sg}, ${sb}, 0.48)` },
            { offset: 1, color: `rgba(${sr}, ${sg}, ${sb}, 0.72)` }
          ]
        })
      );
    }
  }

  private resizeCanvasToContainer(): void {
    if (!this.app) return;
    if (this.resizeRafId !== null) return;
    this.resizeRafId = requestAnimationFrame(() => {
      this.resizeRafId = null;
      const size = this.getContainerSize();
      if (!size) return;
      const { width, height } = size;
      const winW = typeof window !== 'undefined' ? window.innerWidth : 0;
      const winH = typeof window !== 'undefined' ? window.innerHeight : 0;
      if (
        width === this.lastWidth &&
        height === this.lastHeight &&
        winW === this.lastWindowInnerW &&
        winH === this.lastWindowInnerH
      ) {
        this.updateContainerSize();
        return;
      }
      const prevWidth = this.containerWidth || this.lastWidth;
      const prevHeight = this.containerHeight || this.lastHeight;
      this.app?.renderer.resize(width, height);
      this.lastWidth = width;
      this.lastHeight = height;
      this.lastWindowInnerW = winW;
      this.lastWindowInnerH = winH;
      this.updateContainerSize();
      this.updateWorldViewportOffset();
      this.remapActiveBallsForResize(prevWidth, prevHeight, width, height);
      if (this.coefficients.length && this.rows) {
        this.rebuildScene();
        this.rebindActiveBallPathPegs();
      }
    });
  }

  private remapActiveBallsForResize(
    prevWidth: number,
    prevHeight: number,
    nextWidth: number,
    nextHeight: number
  ): void {
    if (!this.balls.length) return;
    if (prevWidth <= 0 || prevHeight <= 0) return;
    const sx = nextWidth / prevWidth;
    const sy = nextHeight / prevHeight;

    for (const ball of this.balls) {
      ball.x *= sx;
      ball.prevX *= sx;
      ball.y *= sy;
      ball.prevY *= sy;
      ball.velocityX *= sx;
      ball.velocityY *= sy;

      for (const point of ball.path) {
        point.x *= sx;
        point.y *= sy;
      }
    }
  }

  private rebindActiveBallPathPegs(): void {
    if (!this.balls.length || !this.pegs.length) return;
    const pegByKey = new Map<string, Peg>();
    for (const peg of this.pegs) {
      pegByKey.set(`${peg.row}:${peg.col}`, peg);
    }

    for (const ball of this.balls) {
      for (const point of ball.path) {
        const oldPeg = point.closestPeg;
        if (!oldPeg) continue;
        point.closestPeg = pegByKey.get(`${oldPeg.row}:${oldPeg.col}`) ?? null;
      }
    }
  }

  private getContainerSize(): { width: number; height: number } | null {
    const host = this.hostElement;
    const rect = host.getBoundingClientRect();
    let w = Math.round(rect.width);
    let h = Math.round(rect.height);
    if (!w || !h) {
      w = Math.round(host.clientWidth);
      h = Math.round(host.clientHeight);
    }
    if (this.layoutWidthFloor > 0) {
      w = Math.max(w, this.layoutWidthFloor);
    }
    if (this.measurementsLookUsable(w, h)) return { width: w, height: h };

    const r = this.app?.renderer;
    const bufW = r ? Math.max(1, Math.floor(Number(r.width) || 0)) : 0;
    const bufH = r ? Math.max(1, Math.floor(Number(r.height) || 0)) : 0;
    if (this.measurementsLookUsable(bufW, bufH)) return { width: bufW, height: bufH };

    const lw = this.lastWidth;
    const lh = this.lastHeight;
    if (this.measurementsLookUsable(lw, lh)) return { width: lw, height: lh };

    return this.createViewportFallbackSize();
  }

  /** Re-measure host and redraw after layout (e.g. flex parent finished sizing). */
  refreshLayout(): void {
    this.resizeCanvasToContainer();
  }

  /**
   * Clears resize dedupe keyed on window dims so the next pass picks up flex layout once it settles.
   * Call shortly after mount / refresh.
   */
  bustResizeDedupe(): void {
    this.lastWindowInnerW = -1;
    this.lastWidth = 0;
    this.lastHeight = 0;
  }

  /** Synchronous layout + redraw before spawning balls (avoids rAF race with drop burst). */
  refreshLayoutSync(): void {
    if (!this.app) return;
    const size = this.getContainerSize();
    if (!size) return;
    const { width, height } = size;
    const winW = typeof window !== 'undefined' ? window.innerWidth : 0;
    const winH = typeof window !== 'undefined' ? window.innerHeight : 0;
    if (
      width === this.lastWidth &&
      height === this.lastHeight &&
      winW === this.lastWindowInnerW &&
      winH === this.lastWindowInnerH &&
      this.rows &&
      this.coefficients.length
    ) {
      this.updateContainerSize();
      this.ensureLayoutDimensionsFromRendererIfNeeded();
      this.drawStaticPyramid();
      this.renderFrame();
      return;
    }
    const prevWidth = this.containerWidth || this.lastWidth;
    const prevHeight = this.containerHeight || this.lastHeight;
    this.app.renderer.resize(width, height);
    this.lastWidth = width;
    this.lastHeight = height;
    this.lastWindowInnerW = winW;
    this.lastWindowInnerH = winH;
    this.updateContainerSize();
    this.updateWorldViewportOffset();
    this.remapActiveBallsForResize(prevWidth, prevHeight, width, height);
    if (this.coefficients.length && this.rows) {
      this.rebuildScene();
      this.rebindActiveBallPathPegs();
    }
  }

  /** Match renderer DPR so slot text stays sharp on high-DPI displays. */
  private getSlotLabelTextResolution(): number {
    const r = this.app?.renderer?.resolution;
    if (typeof r === 'number' && r > 0) {
      return Math.min(2, Math.max(1.25, r));
    }
    return typeof window !== 'undefined'
      ? Math.min(2, Math.max(1.25, Math.min(this.MAX_RENDER_RESOLUTION, window.devicePixelRatio || 1)))
      : 1.25;
  }

  /**
   * One font size for every slot: fits the narrowest slot and longest coefficient label,
   * with extra inner padding so labels do not touch slot edges.
   */
  private computeUniformSlotLabelFontSize(): number {
    if (!this.slots.length) return 14;
    const slotBodyH = this.slotHeight * 0.82;
    const paddingRatio = 0.16;
    let minInnerW = Infinity;
    let minInnerH = Infinity;
    let maxLabelLen = 1;
    for (const slot of this.slots) {
      const w = slot.width - this.pegRadius;
      const innerW = w * (1 - 2 * paddingRatio);
      const innerH = slotBodyH * (1 - 2 * paddingRatio);
      minInnerW = Math.min(minInnerW, innerW);
      minInnerH = Math.min(minInnerH, innerH);
      maxLabelLen = Math.max(maxLabelLen, slot.labelText.length);
    }
    if (!Number.isFinite(minInnerW) || !Number.isFinite(minInnerH)) return 14;
    const sizeFromHeight = minInnerH * 0.9;
    const sizeFromWidth = minInnerW / (maxLabelLen * 0.58);
    let fontSize = Math.min(sizeFromHeight, sizeFromWidth);
    fontSize = Math.max(11, Math.min(fontSize, minInnerH * 0.72));
    return Math.round(fontSize);
  }

  private generatePegs(): void {
    this.pegs = [];
    this.pegsByRow.clear();
    if (!this.app) return;

    const centerX = this.containerWidth / 2;
    const startY = this.topMargin + this.pegSpacing * 0.5;
    for (let row = 0; row < this.rows; row++) {
      const rowY = startY + row * this.pegSpacing;
      const pegsInRow = row + 4;
      for (let col = 0; col < pegsInRow; col++) {
        const pegX = centerX - ((pegsInRow - 1) * this.pegSpacingX) / 2 + col * this.pegSpacingX;
        this.pegs.push({
          x: pegX,
          y: rowY,
          row,
          col,
          bounceEffect: 0,
          bounceTime: 0,
          isTouched: false
        });
        let rowPegs = this.pegsByRow.get(row);
        if (!rowPegs) {
          rowPegs = [];
          this.pegsByRow.set(row, rowPegs);
        }
        rowPegs.push(this.pegs[this.pegs.length - 1]);
      }
    }
    this.featuredPegKeys = this.getFeaturedPegKeys();
  }

  private generateSlots(): void {
    this.slots = [];
    if (!this.app || !this.coefficients.length) return;

    const centerX = this.containerWidth / 2;
    const bottomY = this.topMargin + (this.rows + 0.5) * this.pegSpacing - this.vw(0.52);
    const slotsCount = this.coefficients.length;
    const lastRowPegs = this.rows + 3;
    const totalWidth = (lastRowPegs - 1) * this.pegSpacingX * this.slotWidthScale;
    const availableWidth = this.containerWidth * 0.99;
    let finalTotalWidth = totalWidth;
    if (totalWidth > availableWidth) {
      finalTotalWidth = availableWidth;
    }
    const middleIndex = Math.floor(slotsCount / 2);
    const centerWeight = 1.55;
    const totalWeight = (slotsCount - 1) + centerWeight;
    const unitWidth = finalTotalWidth / totalWeight;
    const centerSlotWidth = unitWidth * centerWeight;
    let currentX = centerX - finalTotalWidth / 2;

    for (let i = 0; i < slotsCount; i++) {
      const slotWidth = i === middleIndex ? centerSlotWidth : unitWidth;
      const slotX = currentX;
      const coefficient = this.coefficients[i];
      const isSpecial = coefficient >= 3;
      this.slots.push({
        x: slotX + 3,
        y: bottomY,
        originalY: bottomY,
        width: slotWidth,
        coefficient,
        labelText: i === middleIndex ? 'Spin' : String(formatCoefficientLabel(coefficient)),
        centerX: slotX + slotWidth / 2,
        color: this.getSlotColor(coefficient),
        colorNumber: 0,
        isSpecial,
        animationOffset: 0,
        animationTime: 0,
        animationActive: false
      });
      const currentSlot = this.slots[this.slots.length - 1];
      currentSlot.colorNumber = this.cssColorToNumber(currentSlot.color);
      currentX += slotWidth;
    }
  }

  /**
   * Gold featured pegs at fixed grid positions (1-based numbering as in design):
   * row 7 peg 5, row 7 peg 8, row 8 peg 6 → zero-based keys 6:4, 6:7, 7:5.
   * Matches 14-row layout (4 pegs top row … 17 bottom).
   */
  private getFeaturedPegKeys(): Set<string> {
    const fixed: Array<[number, number]> = [
      [6, 4],
      [6, 5],
      [7, 5]
    ];
    const keys = new Set<string>();
    for (const [row, col] of fixed) {
      if (row >= 0 && row < this.rows && col >= 0 && col < row + 4) {
        keys.add(`${row}:${col}`);
      }
    }
    return keys;
  }

  private randomSpawnDirection(): SpawnDirection {
    const bucket = Math.floor(Math.random() * 5);
    if (bucket === 0) return -2; // far left
    if (bucket === 1) return -1; // left
    if (bucket === 2) return 0; // middle
    if (bucket === 3) return 1; // right
    return 2; // far right
  }

  private calculatePath(targetIndex: number): PathPoint[] {
    if (!this.app || !this.slots.length) return [];

    const centerX = this.containerWidth / 2;
    // Spawn from higher above the board while keeping peg/slot layout unchanged.
    const launchY = this.topMargin - this.pegSpacing * 1.35;
    const targetSlot = this.slots[targetIndex];
    const targetX = targetSlot.centerX;

    const denom = Math.max(1, this.slots.length - 1);
    const galtonPosition = Math.round((targetIndex / denom) * this.rows);
    const rightTurns = galtonPosition;
    const leftTurns = this.rows - rightTurns;

    const turns: number[] = [];
    for (let i = 0; i < this.rows; i++) {
      turns.push(i < leftTurns ? -1 : 1);
    }
    for (let i = turns.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [turns[i], turns[j]] = [turns[j], turns[i]];
    }
    // Randomize initial direction from origin:
    // far-left, left, middle, right, far-right.
    const spawnDirection = this.randomSpawnDirection();
    // Keep launch direction consistent with first peg impact so the ball
    // doesn't visually launch to one side and immediately snap to the other.
    if (spawnDirection !== 0 && turns.length > 1) {
      const desiredFirstTurn = spawnDirection < 0 ? -1 : 1;
      const originalFirstTurn = turns[0];
      if (originalFirstTurn !== desiredFirstTurn) {
        turns[0] = desiredFirstTurn;
        // Preserve overall left/right turn count (thus target distribution)
        // by swapping one later matching turn back to the original value.
        const candidates: number[] = [];
        for (let i = 1; i < turns.length; i++) {
          if (turns[i] === desiredFirstTurn) candidates.push(i);
        }
        if (candidates.length) {
          const swapIndex = candidates[Math.floor(Math.random() * candidates.length)];
          turns[swapIndex] = originalFirstTurn;
        } else {
          // Should be rare; fallback keeps path valid.
          turns[0] = originalFirstTurn;
        }
      }
    }
    // IMPORTANT: only bias the launch segment; do not alter Galton turns
    // so we preserve slot targeting and avoid flinging to far slots.
    const spawnLaneBias = spawnDirection * this.pegSpacingX * 0.42;

    const path: PathPoint[] = [];
    path.push({ x: centerX, y: launchY, row: -1, closestPeg: null, bounceIntensity: 0 });
    path.push({
      x: centerX + spawnLaneBias,
      y: this.topMargin - this.pegSpacing * 0.32,
      row: -1,
      closestPeg: null,
      bounceIntensity: 0
    });

    let currentX = centerX;

    for (let row = 0; row < this.rows; row++) {
      const rowY = this.topMargin + this.pegSpacing * 0.5 + row * this.pegSpacing;
      const turn = turns[row];
      const shift = this.pegSpacingX / 2;
      // Keep the default path centered in the lane between pegs.
      currentX += turn * shift;

      const rowPegs = this.pegsByRow.get(row) ?? [];
      let closestPeg: Peg | null = null;
      let minDistance = Infinity;
      let bounceIntensity = 0;

      rowPegs.forEach((peg) => {
        const distance = Math.abs(currentX - peg.x);
        if (distance < minDistance) {
          minDistance = distance;
          closestPeg = peg;
        }
      });

      if (closestPeg) {
        const maxDistance = this.pegSpacingX / 2;
        bounceIntensity = Math.max(0.45, Math.min(0.95, 1 - minDistance / maxDistance));
        bounceIntensity *= 0.82 + Math.random() * 0.18;
      }

      path.push({
        x: currentX,
        y: rowY,
        row,
        closestPeg,
        bounceIntensity
      });
    }

    path.push({
      x: targetX,
      y: targetSlot.y + this.slotHeight / 2,
      row: this.rows,
      closestPeg: null,
      bounceIntensity: 0
    });

    return path;
  }

  dropBall(targetIndex: number): { ballId: number; targetIndex: number } | null {
    if (!this.pixiReady || !this.app || !this.coefficients.length) return null;

    if (targetIndex === -1) {
      targetIndex = Math.floor(Math.random() * this.coefficients.length);
    }

    const path = this.calculatePath(targetIndex);
    if (!path.length) return null;

    const ball: Ball = {
      id: this.nextBallId++,
      x: path[0].x,
      y: path[0].y,
      prevX: path[0].x,
      prevY: path[0].y,
      scale: 1,
      isDropping: true,
      currentPoint: 0,
      path,
      bouncedRows: new Set<number>(),
      lastBounceTime: 0,
      visitedPoints: new Set<number>(),
      currentSpeed: this.pyramidConfig.normalSpeed,
      isInBounce: false,
      bounceStartTime: 0,
      bounceDuration: this.pyramidConfig.bounceDuration,
      currentSegmentIndex: 0,
      velocityX: 0,
      velocityY: 0,
      target: this.coefficients[targetIndex],
      targetIndex,
      targetReached: false,
      slotAnimationStart: 0
    };

    this.balls.push(ball);

    if (!this.isAnimating) {
      this.isAnimating = true;
      this.startTicker();
    }

    return { ballId: ball.id, targetIndex };
  }

  private startTicker(): void {
    if (!this.app || this.tickerRegistered) return;
    this.app.ticker.add(this.animTickerBound);
    this.tickerRegistered = true;
  }

  private stopTicker(): void {
    if (!this.app || !this.tickerRegistered) return;
    this.app.ticker.remove(this.animTickerBound);
    this.tickerRegistered = false;
  }

  private animateFrame(): void {
    if (!this.app) return;

    if (!this.isAnimating) return;

    const currentTime = Date.now();
    this.frameTick++;

    let activeBalls = 0;

    for (let i = 0; i < this.balls.length; i++) {
      const ball = this.balls[i];
      if (ball.isDropping) {
        activeBalls++;
        const previousX = ball.x;
        const previousY = ball.y;
        this.updateBallPhysics(ball, currentTime);
        const pathLength = ball.path.length;
        const totalProgress = ball.currentPoint;
        const segmentProgress = totalProgress * (pathLength - 1);
        const segmentIndex = Math.floor(segmentProgress);
        ball.currentSegmentIndex = segmentIndex;
        const segmentFraction = segmentProgress - segmentIndex;

        let baseX = 0;
        let baseY = 0;
        if (segmentIndex < pathLength - 1) {
          const pointA = ball.path[segmentIndex];
          const pointB = ball.path[segmentIndex + 1];
          baseX = pointA.x + (pointB.x - pointA.x) * segmentFraction;
          baseY = pointA.y + (pointB.y - pointA.y) * segmentFraction;
        } else {
          const lastPoint = ball.path[pathLength - 1];
          baseX = lastPoint.x;
          baseY = lastPoint.y;
        }

        if (ball.isInBounce) {
          const bounceElapsed = currentTime - ball.bounceStartTime;
          const bounceProgress = bounceElapsed / ball.bounceDuration;
          if (bounceProgress >= 1) {
            ball.isInBounce = false;
            // Keep some side momentum after impact for less scripted-looking pathing.
            ball.velocityX *= 0.78;
          } else {
            // Peg-to-peg parabolic arc: visible bounce while still continuous with gravity offset.
            const parabolicT = 4 * bounceProgress * (1 - bounceProgress);
            const arcHeight = this.pyramidConfig.bounceAmplitude * this.elementScale * 0.95 * parabolicT;
            ball.x = baseX + ball.velocityX * this.pyramidConfig.laneCentering;
            ball.y = baseY + ball.velocityY - arcHeight;
          }
        }
        if (!ball.isInBounce) {
          // Continuous gravity-driven vertical motion around the path baseline.
          ball.x = baseX + ball.velocityX * this.pyramidConfig.laneCentering;
          ball.y = baseY + ball.velocityY;
        }

        ball.prevX = previousX;
        ball.prevY = previousY;
        // Always run peg collisions so the ball still bounces; peg glow/scale is gated in drawAllPegsPixi.
        this.checkForBounce(ball, currentTime);

        if (!ball.targetReached && ball.currentPoint >= 0.99) {
          ball.targetReached = true;
          ball.isDropping = false;
          if (this.animationEnabled) {
            this.triggerSlotAnimation(ball, currentTime);
          }
          const spinSlotIndex = Math.floor(this.slots.length / 2);
          this.onBallDropped?.({
            multiplier: ball.target,
            ballId: ball.id,
            slotIndex: ball.targetIndex,
            isSpinSlot: ball.targetIndex === spinSlotIndex
          });
        }
      } else if (ball.scale > 0) {
        activeBalls++;
        ball.scale *= 0.93;
        if (ball.scale < 0.05) ball.scale = 0;
      }
    }

    const heavyLoad = this.balls.length >= 8;
    const shouldRedrawEffectLayers = !heavyLoad || this.frameTick % 2 === 0;
    if (shouldRedrawEffectLayers) {
      const hasSlotVisuals = this.hasActiveSlotVisuals(currentTime);
      const hasPegVisuals = this.hasActivePegVisuals(currentTime);
      if (hasSlotVisuals) {
        this.slotGlowGraphics.clear();
        this.slotBodiesGraphics.clear();
        this.drawAllSlotsPixi(currentTime);
      }
      if (hasPegVisuals) {
        this.pegGraphics.clear();
        this.drawAllPegsPixi(currentTime);
      }
    }
    // Keep balls rendered every frame so motion stays visually smooth.
    this.drawBallsPixi();

    let nextLiveBallIndex = 0;
    for (let i = 0; i < this.balls.length; i++) {
      const ball = this.balls[i];
      if (ball.scale > 0 || ball.isDropping) {
        this.balls[nextLiveBallIndex++] = ball;
      }
    }
    this.balls.length = nextLiveBallIndex;

    if (activeBalls === 0) {
      this.isAnimating = false;
      this.stopTicker();
      this.drawStaticPyramid();
    }
  }

  private hasActivePegVisuals(currentTime: number): boolean {
    for (let i = 0; i < this.pegs.length; i++) {
      const peg = this.pegs[i];
      if (peg.bounceEffect > 0) return true;
      if (peg.isTouched && currentTime - peg.bounceTime <= 1000) return true;
    }
    return false;
  }

  private hasActiveSlotVisuals(currentTime: number): boolean {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot.animationActive && currentTime - slot.animationTime < this.pyramidConfig.slotAnimationDuration) return true;
    }
    return false;
  }

  private updateBallPhysics(ball: Ball, currentTime: number): void {
    let baseSpeed = this.pyramidConfig.normalSpeed * this.animationSpeed;
    baseSpeed += this.pyramidConfig.gravityEffect * (ball.currentPoint + 0.5);

    if (ball.isInBounce) {
      const bounceElapsed = currentTime - ball.bounceStartTime;
      if (bounceElapsed < ball.bounceDuration) {
        const bounceProgress = bounceElapsed / ball.bounceDuration;
        if (bounceProgress < 0.3) {
          ball.currentSpeed = this.pyramidConfig.bounceSlowdown * (0.5 + 0.5 * this.elementScale);
        } else {
          const recovery = (bounceProgress - 0.3) / 0.7;
          ball.currentSpeed =
            this.pyramidConfig.bounceSlowdown * (0.5 + 0.5 * this.elementScale) +
            (baseSpeed - this.pyramidConfig.bounceSlowdown * (0.5 + 0.5 * this.elementScale)) *
              Math.max(0, Math.min(1, recovery));
        }
      } else {
        ball.currentSpeed = baseSpeed;
      }
    } else if (ball.currentSpeed < baseSpeed) {
      ball.currentSpeed += this.pyramidConfig.acceleration * this.elementScale;
    }

    ball.currentSpeed = Math.max(
      this.pyramidConfig.minSpeed,
      Math.min(ball.currentSpeed, this.pyramidConfig.maxSpeed)
    );
    ball.currentPoint += ball.currentSpeed;

    const maxLaneDrift = this.pegSpacingX * 0.28;
    ball.velocityX = Math.max(-maxLaneDrift, Math.min(maxLaneDrift, ball.velocityX));
    // Integrate vertical offset with gravity so rise/fall is smooth and physically continuous.
    ball.velocityY += this.pyramidConfig.verticalGravity * this.elementScale;
    ball.velocityY *= this.pyramidConfig.verticalDamping;
    const maxVerticalOffset = this.pyramidConfig.bounceAmplitude * this.elementScale;
    ball.velocityY = Math.max(-maxVerticalOffset, Math.min(maxVerticalOffset, ball.velocityY));

    if (Math.abs(ball.velocityX) > 0.1) {
      ball.velocityX *= this.pyramidConfig.lateralFriction;
    } else {
      ball.velocityX = 0;
    }
  }

  private checkForBounce(ball: Ball, currentTime: number): void {
    const pathLength = ball.path.length;
    const segmentProgress = ball.currentPoint * (pathLength - 1);
    const segmentIndex = Math.floor(segmentProgress);

    for (
      let i = Math.max(0, segmentIndex - 1);
      i <= Math.min(pathLength - 1, segmentIndex + 1);
      i++
    ) {
      const pathPoint = ball.path[i];
      if (
        !pathPoint.closestPeg ||
        pathPoint.bounceIntensity <= 0 ||
        ball.bouncedRows.has(pathPoint.row) ||
        currentTime - ball.lastBounceTime <= this.pyramidConfig.bounceCooldown
      ) {
        continue;
      }

      // Use top-middle peg contact to avoid "through-center" collisions.
      const contactX = pathPoint.closestPeg.x;
      const contactY = pathPoint.closestPeg.y - this.pegRadius * 0.85;
      const dx = ball.x - contactX;
      const dy = ball.y - contactY;
      const distanceSq = dx * dx + dy * dy;
      // Use inner peg body for collision so glow/outer visual doesn't trigger bounce.
      const innerPegRadius = this.pegRadius * 0.72;
      const interactionRadius = innerPegRadius + this.ballRadius * 0.78;
      const interactionRadiusSq = interactionRadius * interactionRadius;
      // Fallback only when ball has genuinely reached this peg row/column neighborhood.
      const rowWasCrossed = segmentProgress >= i - 0.02;
      const approachingFromTop = ball.y <= pathPoint.closestPeg.y + this.ballRadius * 0.2;
      const nearPegColumn = Math.abs(ball.x - pathPoint.closestPeg.x) <= this.pegSpacingX * 0.34;
      const atPegRow =
        ball.y >= pathPoint.closestPeg.y - this.pegRadius * 0.35 &&
        ball.y <= pathPoint.closestPeg.y + this.pegRadius * 0.6;
      const shouldUseFallback = rowWasCrossed && nearPegColumn && atPegRow;

      if ((distanceSq < interactionRadiusSq && approachingFromTop) || shouldUseFallback) {
        pathPoint.closestPeg.bounceEffect = pathPoint.bounceIntensity;
        pathPoint.closestPeg.bounceTime = currentTime;
        pathPoint.closestPeg.isTouched = true;
        if (this.featuredPegKeys.has(`${pathPoint.closestPeg.row}:${pathPoint.closestPeg.col}`)) {
          this.onCoinPegHit?.({ row: pathPoint.closestPeg.row, col: pathPoint.closestPeg.col });
        }
        ball.isInBounce = true;
        ball.bounceStartTime = currentTime;
        ball.bounceDuration = this.pyramidConfig.bounceDuration * (0.85 + Math.random() * 0.3);

        const distance = Math.max(0.0001, Math.sqrt(distanceSq));
        const nxRaw = dx / distance;
        const nyRaw = dy / distance;
        // If fallback is used, keep the normal pointing upward to ensure visible peg impact.
        const nx = shouldUseFallback && distanceSq >= interactionRadiusSq ? Math.sign(nxRaw || (Math.random() < 0.5 ? -1 : 1)) : nxRaw;
        const ny = shouldUseFallback && distanceSq >= interactionRadiusSq ? -1 : nyRaw;
        const impulseScale =
          this.pyramidConfig.bounceImpulseMin +
          Math.random() * (this.pyramidConfig.bounceImpulseMax - this.pyramidConfig.bounceImpulseMin);
        const force = pathPoint.bounceIntensity * impulseScale * this.elementScale;
        const belowBounce = Math.random() < this.pyramidConfig.belowBounceChance;
        const lateralMultiplier = belowBounce ? 1.1 : 2.9;
        ball.velocityX = ball.velocityX * 0.35 + nx * force * lateralMultiplier;
        ball.velocityY = Math.min(0, ball.velocityY * 0.2 + ny * force * this.pyramidConfig.bounceLift);

        ball.bouncedRows.add(pathPoint.row);
        ball.lastBounceTime = currentTime;
        ball.currentSpeed = this.pyramidConfig.bounceSlowdown * (0.3 + Math.random() * 0.4);
        break;
      }
    }
  }

  private triggerSlotAnimation(ball: Ball, currentTime: number): void {
    let closestSlot: Slot | null = null;
    let minDistance = Infinity;
    this.slots.forEach((slot) => {
      const distance = Math.abs(ball.x - slot.centerX);
      if (distance < minDistance && distance < slot.width / 2) {
        minDistance = distance;
        closestSlot = slot;
      }
    });
    if (closestSlot) {
      closestSlot.animationActive = true;
      closestSlot.animationTime = currentTime;
      ball.slotAnimationStart = currentTime;
    }
  }

  private drawAllPegsPixi(currentTime: number): void {
    const g = this.pegGraphics;
    this.pegs.forEach((peg) => {
      if (peg.isTouched && currentTime - peg.bounceTime > 1000) {
        peg.isTouched = false;
      }
      let glowIntensity = 0;
      let hitProgress = 0;
      if (peg.bounceEffect > 0) {
        const elapsed = currentTime - peg.bounceTime;
        if (elapsed < this.pyramidConfig.bounceEffectDuration) {
          const progress = elapsed / this.pyramidConfig.bounceEffectDuration;
          const bounceValue = Math.sin(progress * Math.PI);
          if (this.animationEnabled) {
            hitProgress = progress;
            glowIntensity = peg.bounceEffect * bounceValue;
          }
          peg.bounceEffect *= 0.95;
        } else {
          peg.bounceEffect = 0;
        }
      }

      const pr = this.pegRadius;
      const isFeaturedPeg = this.featuredPegKeys.has(`${peg.row}:${peg.col}`);

      if (isFeaturedPeg) {
        const sprite = this.featuredPegSprites.get(`${peg.row}:${peg.col}`);
        const hasCoinSprite = !!(
          sprite &&
          this.coinPegTexture &&
          (sprite.texture.width ?? 0) > 0
        );
        if (hasCoinSprite && sprite) {
          const coinGrow = glowIntensity > 0 ? 1 + glowIntensity * 0.5 : 1;
          const size = pr * 6.2 * coinGrow;
          const tw = sprite.texture.width || 1;
          sprite.scale.set(size / tw);
          sprite.position.set(peg.x, peg.y);
          sprite.visible = true;
        }
        if (glowIntensity > 0) {
          const expansion = Math.min(1, hitProgress * 1.35);
          const radialRadius = pr * (1 + expansion * 3.2);
          g.circle(peg.x, peg.y, radialRadius).fill({
            color: 0xffea00,
            alpha: Math.min(0.5, glowIntensity * 0.42)
          });
          g.circle(peg.x, peg.y, radialRadius * 0.72).fill({
            color: 0xfff24a,
            alpha: Math.min(0.44, glowIntensity * 0.36)
          });
          g.circle(peg.x, peg.y, radialRadius + pr * 0.38).stroke({
            width: Math.max(1.6, pr * 0.34),
            color: 0xffd100,
            alpha: Math.min(0.56, glowIntensity * 0.46)
          });
        }
        if (!hasCoinSprite) {
          if (glowIntensity > 0) {
            this.drawClassicPegHitGlow(g, peg, pr, glowIntensity);
          } else {
            this.drawClassicPegIdleBody(g, peg, pr);
          }
        }
      } else {
        if (glowIntensity > 0) {
          this.drawClassicPegHitGlow(g, peg, pr, glowIntensity);
        } else {
          this.drawClassicPegIdleBody(g, peg, pr);
        }
      }
    });
  }

  private drawClassicPegIdleBody(g: Graphics, peg: Peg, pr: number): void {
    g.circle(peg.x, peg.y, pr).fill({ color: 0xafafaf, alpha: 0.98 });
    g.circle(peg.x - pr * 0.2, peg.y - pr * 0.22, pr * 0.68).fill({ color: 0xc8c8c8, alpha: 0.55 });
    g.circle(peg.x - pr * 0.28, peg.y - pr * 0.3, pr * 0.36).fill({ color: 0xe2e2e2, alpha: 0.42 });
    g.circle(peg.x, peg.y, pr).stroke({ width: Math.max(0.5, pr * 0.07), color: 0x22181b, alpha: 0.95 });
  }

  private drawClassicPegHitGlow(g: Graphics, peg: Peg, pr: number, glowIntensity: number): void {
    const glowStrokeWidth = Math.max(1.2, pr * 0.62);
    g.circle(peg.x, peg.y, pr * 1.34 + glowStrokeWidth / 2).stroke({
      width: glowStrokeWidth,
      color: 0xffffff,
      alpha: Math.min(0.28, 0.08 + glowIntensity * 0.2)
    });
    g.circle(peg.x, peg.y, pr * 1.82).fill({ color: 0xffffff, alpha: Math.min(0.15, glowIntensity * 0.1) });
    g.circle(peg.x, peg.y, pr).fill({ color: 0xffffff, alpha: Math.min(1, 0.95 + glowIntensity * 0.3) });
    g.circle(peg.x - pr * 0.2, peg.y - pr * 0.22, pr * 0.68).fill({
      color: 0xffffff,
      alpha: Math.min(1, 0.75 + glowIntensity * 0.35)
    });
    g.circle(peg.x - pr * 0.28, peg.y - pr * 0.3, pr * 0.36).fill({
      color: 0xffffff,
      alpha: Math.min(1, 0.62 + glowIntensity * 0.35)
    });
    g.circle(peg.x, peg.y, pr).stroke({
      width: Math.max(0.5, pr * 0.07),
      color: 0xffffff,
      alpha: Math.min(1, 0.68 + glowIntensity * 0.28)
    });
  }

  private drawAllSlotsPixi(currentTime: number): void {
    if (!this.slots.length) return;
    const g = this.slotBodiesGraphics;

    for (let idx = 0; idx < this.slots.length; idx++) {
      const slot = this.slots[idx];
      if (slot.animationActive) {
        const elapsed = currentTime - slot.animationTime;
        if (elapsed < this.pyramidConfig.slotAnimationDuration) {
          const progress = elapsed / this.pyramidConfig.slotAnimationDuration;
          const bounce = progress * Math.PI * this.pyramidConfig.slotBounceCount;
          slot.animationOffset = this.slotBounceHeight * Math.sin(bounce) * (1 - progress);
        } else {
          slot.animationActive = false;
          slot.animationOffset = 0;
        }
      }

      const x = slot.x;
      const y = slot.y + slot.animationOffset;
      const w = slot.width - this.pegRadius;
      const h = this.slotHeight * 0.82;
      const r = Math.max(4, Math.min(6, h * 0.28));
      const shadowOffset = Math.max(2, h * 0.13);
      const slotRgb = slot.colorNumber;

      g.roundRect(x, y + shadowOffset, w, h, r).fill({ color: 0x000000, alpha: 0.22 });
      g.roundRect(x, y + shadowOffset * 1.9, w, h * 0.9, r * 1.2).fill({ color: 0x000000, alpha: 0.14 });

      if (this.pipeSprites[idx] && this.texturesLoaded) {
        const bgW0 = 37;
        const bgH0 = 40;
        const scale = w / bgW0;
        const baseBgH = bgH0 * scale;
        const middleIndex = (this.slots.length - 1) / 2;
        const distanceFromMiddle = Math.abs(idx - middleIndex);
        const normalizedDistance = middleIndex > 0 ? distanceFromMiddle / middleIndex : 0;
        const heightScale = 0.72 + normalizedDistance * 2.42;
        const bgH = baseBgH * heightScale;
        const sp = this.pipeSprites[idx];
        sp.visible = false;

        const pipeTopY = y - bgH * 0.78;
        const pipeGradient = this.slotPipeGradients[idx];
        if (pipeGradient) {
          g.rect(x, pipeTopY, w, bgH).fill(pipeGradient);
        }
      }

      g.roundRect(x, y, w, h, r)
        .fill({ color: slotRgb });

      let textScale = 1.1;
      if (slot.animationActive) {
        const elapsed = currentTime - slot.animationTime;
        const progress = elapsed / this.pyramidConfig.slotAnimationDuration;
        textScale = 1 + 0.15 * Math.sin(progress * Math.PI * 4) * (1 - progress);
      }

      const label = this.slotLabels[idx];
      if (label) {
        label.scale.set(textScale, textScale);
        label.position.set(Math.round(x + w / 2), Math.round(y + h / 2));
      }
    }
  }

  private cssColorToNumber(css: string): number {
    if (css.startsWith('#')) {
      const hex = css.slice(1);
      const n = parseInt(hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex, 16);
      return Number.isFinite(n) ? n : 0x64748b;
    }
    const m = css.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (m) {
      return (parseInt(m[1], 10) << 16) | (parseInt(m[2], 10) << 8) | parseInt(m[3], 10);
    }
    return 0x64748b;
  }

  private numberToRgb(color: number): { r: number; g: number; b: number } {
    return {
      r: (color >> 16) & 255,
      g: (color >> 8) & 255,
      b: color & 255
    };
  }

  private drawBallsPixi(): void {
    const g = this.ballsGraphics;
    g.clear();
    const useSimpleBallRender = this.balls.length >= 12;
    for (let i = 0; i < this.balls.length; i++) {
      const ball = this.balls[i];
      if (ball.scale <= 0) continue;
      const r = this.ballRadius * ball.scale;
      const x = ball.x;
      const y = ball.y;
      g.circle(x, y, r).fill({ color: 0xd9e7ff, alpha: 0.95 });
      if (!useSimpleBallRender) {
        g.circle(x - r * 0.22, y - r * 0.22, r * 0.72).fill({ color: 0xf3f8ff, alpha: 0.92 });
        g.circle(x - r * 0.32, y - r * 0.32, r * 0.38).fill({ color: 0xffffff, alpha: 0.98 });
      }
    }
  }

  private drawStaticPyramid(): void {
    const now = Date.now();
    this.pegGraphics.clear();
    this.slotGlowGraphics.clear();
    this.slotBodiesGraphics.clear();

    this.drawAllSlotsPixi(now);
    this.drawAllPegsPixi(now);

    this.drawBallsPixi();
  }

  getSlotColor(coefficient: number): string {
    const outerToCenterColors = [
      '#da3dbe',
      '#fb6287',
      '#f96f65',
      '#f58f61',
      '#feae62',
      '#fbcb67',
      '#fee663',
      '#21a7d9'
    ];
    const index = this.coefficients.indexOf(coefficient);
    if (index === -1) return '#64748b';
    const mid = (this.coefficients.length - 1) / 2;
    const maxDist = Math.max(1, mid);
    const distFromCenter = Math.abs(index - mid);
    const outerToCenterT = 1 - Math.min(1, distFromCenter / maxDist);

    const scaled = outerToCenterT * (outerToCenterColors.length - 1);
    const low = Math.floor(scaled);
    const high = Math.min(outerToCenterColors.length - 1, low + 1);
    const localT = scaled - low;

    return this.interpolateHexColor(outerToCenterColors[low], outerToCenterColors[high], localT);
  }

  private interpolateHexColor(startHex: string, endHex: string, t: number): string {
    const clampT = Math.max(0, Math.min(1, t));
    const start = this.hexToRgb(startHex);
    const end = this.hexToRgb(endHex);
    const r = Math.round(start.r + (end.r - start.r) * clampT);
    const g = Math.round(start.g + (end.g - start.g) * clampT);
    const b = Math.round(start.b + (end.b - start.b) * clampT);
    return `rgb(${r}, ${g}, ${b})`;
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } {
    const normalized = hex.replace('#', '');
    const full = normalized.length === 3 ? normalized.split('').map((c) => c + c).join('') : normalized;
    const value = parseInt(full, 16);
    return {
      r: (value >> 16) & 255,
      g: (value >> 8) & 255,
      b: value & 255
    };
  }

  dropRandomBall(): { coefficient: number; index: number } {
    const randomIndex = Math.floor(Math.random() * this.coefficients.length);
    const coefficient = this.coefficients[randomIndex];
    const dropped = this.dropBall(randomIndex);
    return { coefficient, index: dropped?.targetIndex ?? randomIndex };
  }

  /**
   * Schedules multiple drops: ball `i` spawns at `spawnDelaysMs[i]` ms after burst start (parallel timers).
   * Use `targetIndex === -1` for a random pocket; otherwise pass server slot indices.
   */
  dropBallBurst(
    targetIndices: number[],
    spawnDelaysMs: number[],
    onBallSpawned?: (info: { dropped: { ballId: number; targetIndex: number } | null; index: number }) => void
  ): void {
    const n = targetIndices?.length ?? 0;
    if (!n || !this.coefficients.length) return;
    if (!Array.isArray(spawnDelaysMs) || spawnDelaysMs.length !== n) return;
    this.pendingBurstDrops += n;
    for (let i = 0; i < n; i++) {
      const targetIndex = targetIndices[i];
      const delayMs = Math.max(0, Number(spawnDelaysMs[i]) || 0);
      const timeoutId = window.setTimeout(() => {
        this.pendingDropTimeouts.delete(timeoutId);
        try {
          const dropped = this.dropBall(targetIndex);
          onBallSpawned?.({ dropped, index: i });
        } finally {
          this.pendingBurstDrops = Math.max(0, this.pendingBurstDrops - 1);
        }
      }, delayMs);
      this.pendingDropTimeouts.add(timeoutId);
    }
  }

  reset(): void {
    this.clearPendingDropTimeouts();
    this.clearPendingBallRemovalTimeouts();
    this.balls = [];
    this.nextBallId = 1;
    this.pegs.forEach((peg) => {
      peg.bounceEffect = 0;
      peg.isTouched = false;
    });
    this.slots.forEach((slot) => {
      slot.animationActive = false;
      slot.animationOffset = 0;
    });
    this.isAnimating = false;
    this.stopTicker();
    this.drawStaticPyramid();
  }

  get activeBallsCount(): number {
    return this.balls.filter((b) => b.isDropping).length;
  }

  get isDropBatchActive(): boolean {
    return this.pendingBurstDrops > 0 || this.isAnimating || this.activeBallsCount > 0;
  }
}
