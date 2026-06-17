import { Application, Assets, Container, Graphics, Sprite, Text } from 'pixi.js';
import { slotColorForMultiplier } from '../game-logic/slotColors';
import { formatCoefficientLabel, isMobile } from '../lib/format';
import { staticUrl } from '../lib/staticUrl';

export type BallDroppedEvent = {
	multiplier: number;
	ballId: number;
	slotIndex: number;
	isSpinSlot: boolean;
};

export type CoinPegHitEvent = { row: number; col: number; ballId: number };

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
  /** Horizontal direction (-1 left, 0 center, 1 right) for the active peg bounce arc. */
  bounceTravelDir: -1 | 0 | 1;
  currentSegmentIndex: number;
  velocityX: number;
  velocityY: number;
  target: number;
  targetIndex: number;
  targetReached: boolean;
  slotAnimationStart: number;
  /** When true, a featured-peg contact may credit the bonus meter (server `hitBonusPeg`). */
  creditBonusPegHit: boolean;
  /**
   * When set, we will emit exactly one coin-peg hit once the ball reaches this
   * path index. This avoids relying on collision heuristics to drive meter fill.
   */
  bonusPegEmitPathIndex: number | null;
  bonusPegEmitRow: number;
  bonusPegEmitCol: number;
  bonusPegEmitted: boolean;
  /** Per-ball motion variation (small random spread at spawn). */
  speedMultiplier: number;
  bounceHeightMultiplier: number;
  driftMultiplier: number;
  bounceDurationMultiplier: number;
  laneOffsetX: number;
  /** Visual-only separation from other balls (no velocity impulse). */
  collisionOffsetX: number;
  collisionOffsetY: number;
}

interface PathPoint {
  x: number;
  y: number;
  row: number;
  closestPeg: Peg | null;
  bounceIntensity: number;
  /** Intended travel direction after bouncing this peg (-1 left, 1 right). */
  travelDir: -1 | 0 | 1;
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
			return;
		}
		/** Slots + multipliers come from coefficient rows; wait until they exist (config or RGS hydrate) before rebuilding. */
		if (this.rows && this.pixiReady && this.app) {
			this.updateContainerSize();
			this.ensureLayoutDimensionsFromRendererIfNeeded();
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
  private readonly labelLayer = new Container();
  private readonly bulletsLayer = new Container();
  private readonly ballsGraphics = new Graphics();
  private readonly slotAssetLayer = new Container();
  private readonly slotLabels: (Text | undefined)[] = [];
  private slotSprites: (Sprite | undefined)[] = [];
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
  private readonly boundWindowResize = (): void => {
    this.resizeCanvasToContainer();
  };

  private ballTexture?: Sprite['texture'];
  private coinPegTexture?: Sprite['texture'];
  private multiplierSlotSpinTexture?: Sprite['texture'];
  private readonly multiplierSlotTextures: Partial<Record<number, Sprite['texture']>> = {};
  private multiplierSlotAssetsReady = false;
  /** Pixel size for standard multiplier slots (from the 0.7× reference slot). */
  private uniformSlotDisplayW = 0;
  private uniformSlotDisplayH = 0;
  /** Spin slot keeps the wider center column width from layout. */
  private uniformSlotSpinDisplayW = 0;
  private static readonly MULTIPLIER_SLOT_REF_TEX_W = 41;
  private static readonly MULTIPLIER_SLOT_REF_TEX_H = 63;
  private pixiReady = false;
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
  /** Horizontal width scale at the top peg row (from CSS `--plinko-area-top-width-scale`). */
  private topWidthScale = 1;
  /** Horizontal width scale at the bottom peg row (from CSS `--plinko-area-bottom-width-scale`). */
  private bottomWidthScale = 1;
  /** Vertical layout scale (from CSS `--plinko-area-height-scale`). */
  private heightScale = 1;
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

  /** Measured host height (includes CSS `--plinko-area-height-scale` on the host element). */
  private get layoutHeight(): number {
    return this.containerHeight;
  }

  get pegRadius(): number {
    const raw = this.layoutHeight * 0.0135 * this.elementScale;
    if (!Number.isFinite(raw) || raw <= 0) return 2;
    return Math.max(2, raw);
  }

  get ballRadius(): number {
    // Use the same scaling strategy as pegs (container height + elementScale).
    const desiredRadius = this.layoutHeight * 0.0245 * this.elementScale;
    // Keep enough clearance so a falling ball fits between neighboring pegs.
    const laneSafeRadius = Math.max(1, (this.minPegSpacingX - this.pegRadius * 2) * 0.46);
    const raw = Math.min(desiredRadius, laneSafeRadius);
    if (!Number.isFinite(raw) || raw <= 0) return 2;
    return Math.max(2, raw) * 0.9;
  }

  get slotBounceHeight(): number {
    // Use the same scaling method as pegs/balls.
    return this.layoutHeight * 0.018 * this.elementScale;
  }

  get topMargin(): number {
    return isMobile()
      ? 0
      : Math.max(this.vw(1.56) * this.heightScale, this.layoutHeight * 0.01);
  }

  get bottomMargin(): number {
    return isMobile()
      ? 0
      : Math.max(this.vw(1.56) * this.heightScale, this.layoutHeight * 0.01);
  }

  get slotHeight(): number {
    return Math.max(this.vw(1.55) * this.heightScale, this.layoutHeight * 0.075);
  }

  private get basePegSpacingY(): number {
    if (this.rows <= 1) return this.vw(2.1) * this.heightScale;
    const availableHeight =
      this.layoutHeight -
      this.topMargin -
      this.bottomMargin -
      this.slotHeight -
      this.vw(1.05) * this.heightScale;
    /** Flex can transiently shrink height → negative spacing and invalid peg rows. */
    const raw = availableHeight / (this.rows + 0.5);
    if (!Number.isFinite(raw)) return this.vw(2.1) * this.heightScale;
    const safe = raw > 0 ? raw : this.vw(2.5) * this.heightScale;
    return Math.max(this.vw(1.05) * this.heightScale, safe);
  }

  /** Shrinks row spacing when the pyramid is taller than the host. */
  private get verticalPegSpacingScale(): number {
    if (this.layoutHeight <= 0 || this.rows <= 0) return 1;
    const natural =
      this.topMargin +
      (this.rows + 0.5) * this.basePegSpacingY +
      this.slotHeight +
      this.bottomMargin;
    const available = this.layoutHeight * 0.99;
    if (natural <= available || natural <= 0) return 1;
    return available / natural;
  }

  get pegSpacing(): number {
    return this.basePegSpacingY * this.verticalPegSpacingScale;
  }

  private get basePegSpacingX(): number {
    return this.pegSpacing * (isMobile() ? 1.35 : 1.5);
  }

  /** Interpolate top → bottom width scale across peg rows. */
  private rowWidthScale(row: number): number {
    if (this.rows <= 1) return this.bottomWidthScale;
    const t = Math.max(0, Math.min(1, row / (this.rows - 1)));
    return this.topWidthScale + (this.bottomWidthScale - this.topWidthScale) * t;
  }

  /** Shrinks horizontal lane spacing when the widest row exceeds the host width. */
  private get horizontalPegSpacingScale(): number {
    if (this.containerWidth <= 0 || this.rows <= 0) return 1;
    const base = this.basePegSpacingX;
    const availableWidth = this.containerWidth * 0.99;
    let maxNaturalSpan = 0;
    for (let row = 0; row < this.rows; row++) {
      const pegsInRow = row + 4;
      maxNaturalSpan = Math.max(maxNaturalSpan, (pegsInRow - 1) * base * this.rowWidthScale(row));
    }
    if (maxNaturalSpan <= availableWidth || maxNaturalSpan <= 0) return 1;
    return availableWidth / maxNaturalSpan;
  }

  pegSpacingXForRow(row: number): number {
    return this.basePegSpacingX * this.rowWidthScale(row) * this.horizontalPegSpacingScale;
  }

  /** Bottom-row spacing — used where a single lane width is needed. */
  get pegSpacingX(): number {
    return this.pegSpacingXForRow(Math.max(0, this.rows - 1));
  }

  private get minPegSpacingX(): number {
    if (this.rows <= 0) return this.basePegSpacingX;
    let min = Infinity;
    for (let row = 0; row < this.rows; row++) {
      min = Math.min(min, this.pegSpacingXForRow(row));
    }
    return Number.isFinite(min) ? min : this.basePegSpacingX;
  }

  private syncLayoutScalesFromHost(): void {
    if (typeof window === 'undefined') return;
    const style = getComputedStyle(this.hostElement);
    const readScale = (name: string, fallback: number): number => {
      const raw = style.getPropertyValue(name).trim();
      const parsed = parseFloat(raw);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    };
    this.topWidthScale = readScale('--plinko-area-top-width-scale', 1);
    this.bottomWidthScale = readScale('--plinko-area-bottom-width-scale', 1);
    this.heightScale = readScale('--plinko-area-height-scale', 1);
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
    belowBounceChance: 0.42,
    /** Minimum center-to-center gap between balls as a multiple of diameter. */
    ballSeparationFactor: 1.12,
    /** Gentle repulsion impulse when balls overlap. */
    ballRepulsionScale: 0.038,
  };

  destroy(): void {
    this.stopTicker();
    this.clearPendingDropTimeouts();
    this.clearPendingBallRemovalTimeouts();
    if (this.resizeRafId !== null) cancelAnimationFrame(this.resizeRafId);
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.boundWindowResize);
    }
    this.resizeObserver?.disconnect();
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
    const initialSize = this.getContainerSize();
    const { width, height } = initialSize;
    this.containerWidth = width;
    this.containerHeight = height;
    const renderHeight = this.getRendererHeight();

    const app = new Application();
    try {
      await app.init({
        width,
        height: renderHeight,
        resolution:
          typeof window !== 'undefined'
            ? Math.min(this.MAX_RENDER_RESOLUTION, window.devicePixelRatio || 1)
            : 1,
        autoDensity: true,
        antialias: true,
        backgroundAlpha: 0,
        preference: 'webgl',
      });
    } catch (err) {
      console.error('[PlinkoEngine] Pixi Application.init failed', err);
      throw err;
    }

    this.hostElement.appendChild(app.canvas as HTMLCanvasElement);

    this.world.sortableChildren = true;
    this.pegGraphics.zIndex = 1;
    this.featuredPegLayer.zIndex = 1.5;
    this.slotAssetLayer.zIndex = 2;
    this.bulletsLayer.zIndex = 2.5;
    this.ballsGraphics.zIndex = 2.6;
    this.labelLayer.zIndex = 4;

    this.world.addChild(this.pegGraphics);
    this.world.addChild(this.featuredPegLayer);
    this.world.addChild(this.slotAssetLayer);
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
      const [ballTex, coinPegTex, spinTex, ...tierTex] = await Promise.all([
        loadOptional(staticUrl('img/ball.svg')),
        loadOptional(staticUrl('img/coin_peg.png')),
        loadOptional(staticUrl('img/multiplier_slot_spin.png')),
        ...([1, 2, 3, 4, 5, 6, 7] as const).map((tier) =>
          loadOptional(staticUrl(`img/multiplier_slot_${tier}.png`))
        )
      ]);
      this.ballTexture = ballTex;
      this.coinPegTexture = coinPegTex;
      this.multiplierSlotSpinTexture = spinTex;
      for (let i = 0; i < 7; i++) {
        const tier = i + 1;
        if (tierTex[i]) this.multiplierSlotTextures[tier] = tierTex[i];
      }
    } catch {
      this.ballTexture = undefined;
      this.coinPegTexture = undefined;
      this.multiplierSlotSpinTexture = undefined;
    }
    this.multiplierSlotAssetsReady = !!this.multiplierSlotSpinTexture;
    if (!this.multiplierSlotAssetsReady) {
      console.warn('[PlinkoEngine] multiplier slot images failed to load');
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.boundWindowResize, { passive: true });
      this.lastWindowInnerW = window.innerWidth;
      this.lastWindowInnerH = window.innerHeight;
    }

    this.resizeObserver = new ResizeObserver(() => this.resizeCanvasToContainer());
    this.resizeObserver.observe(this.hostElement);

    this.pixiReady = true;
    this.ensureLayoutDimensionsFromRendererIfNeeded();
    if (this.coefficients.length && this.rows) {
      this.rebuildScene();
    }

    queueMicrotask(() => {
      this.bustResizeDedupe();
      this.resizeCanvasToContainer();
    });
  }

  private static readonly MIN_LAYOUT_PX = 48;

  /** True when the DOM host has a real flex box (not the transient 0×0 on cold load). */
  hostHasLayoutExtent(): boolean {
    const host = this.hostElement;
    const rect = host.getBoundingClientRect();
    const w = Math.round(rect.width) || Math.round(host.clientWidth);
    const h = Math.round(rect.height) || Math.round(host.clientHeight);
    return w >= PlinkoEngine.MIN_LAYOUT_PX && h >= PlinkoEngine.MIN_LAYOUT_PX;
  }

  private updateContainerSize(): void {
    const size = this.getContainerSize();
    if (!size) return;
    this.containerWidth = size.width;
    this.containerHeight = size.height;
  }

  /** When the CSS host still measures 0×0, pyramid math (`pegRadius`, etc.) tracks the Pixi buffer. */
  private ensureLayoutDimensionsFromRendererIfNeeded(): void {
    const r = this.app?.renderer;
    if (!r) return;
    if (this.containerWidth > 0 && this.containerHeight > 0) return;
    const rw = Math.max(1, Math.floor(Number(r.width) || 0));
    const rh = Math.max(1, Math.floor(Number(r.height) || 0));
    this.containerWidth = rw;
    this.containerHeight = rh;
  }

  /** VW-based fallback when the flex host has not reported a size yet. */
  private createViewportFallbackSize(): { width: number; height: number } {
    const maxW = Math.floor(this.vw(100));
    const maxH = Math.max(
      PlinkoEngine.MIN_LAYOUT_PX,
      Math.floor(window.innerHeight * 0.94),
      Math.floor(this.vw(22) * ((this.rows + 4) / 8)),
    );
    const aspectW = 96;
    const aspectH = 55;
    const width = Math.max(
      PlinkoEngine.MIN_LAYOUT_PX,
      Math.min(maxW, Math.floor((maxH * aspectW) / aspectH)),
    );
    const height = Math.max(
      PlinkoEngine.MIN_LAYOUT_PX,
      Math.min(maxH, Math.floor((width * aspectH) / aspectW)),
    );
    return { width, height };
  }

  private rebuildScene(): void {
    if (!this.app) return;
    if (!this.coefficients.length || !this.rows) return;
    const hostSize = this.getHostSize();
    if (hostSize) {
      this.containerWidth = hostSize.width;
      this.containerHeight = hostSize.height;
    } else {
      this.updateContainerSize();
      this.ensureLayoutDimensionsFromRendererIfNeeded();
      if (this.containerWidth <= 0 || this.containerHeight <= 0) {
        const fb = this.createViewportFallbackSize();
        this.containerWidth = fb.width;
        this.containerHeight = fb.height;
      }
    }

    this.syncLayoutScalesFromHost();

    const layoutW = this.containerWidth;
    const layoutH = this.getRendererHeight();
    const r = this.app.renderer;
    if (r.width !== layoutW || r.height !== layoutH) {
      r.resize(layoutW, layoutH);
      this.lastWidth = layoutW;
      this.lastHeight = layoutH;
    }

    this.updateWorldViewportOffset();
    this.generatePegs();
    this.syncFeaturedPegSprites();
    this.generateSlots();
    this.updateUniformSlotAssetScale();
    this.syncSlotAssetsAndLabels();
    this.refreshSlotLabelAppearance();
    this.fitWorldToSlotRow();
    this.drawStaticPyramid();
    this.renderFrame();
  }

  /** Host element size only — avoids vw fallback wider than the visible board. */
  private getHostSize(): { width: number; height: number } | null {
    const host = this.hostElement;
    const w = Math.round(host.getBoundingClientRect().width) || Math.round(host.clientWidth);
    const h = Math.round(host.getBoundingClientRect().height) || Math.round(host.clientHeight);
    if (w >= PlinkoEngine.MIN_LAYOUT_PX && h >= PlinkoEngine.MIN_LAYOUT_PX) {
      return { width: w, height: h };
    }
    return null;
  }

  /** Scale/center the Pixi world so every multiplier slot fits the visible host. */
  private fitWorldToSlotRow(): void {
    if (!this.slots.length || this.containerWidth <= 0) {
      this.world.scale.set(1);
      this.updateWorldViewportOffset();
      return;
    }

    let left = Infinity;
    let right = -Infinity;
    for (const slot of this.slots) {
      left = Math.min(left, slot.x);
      right = Math.max(right, slot.x + slot.width);
    }
    for (let row = 0; row < this.rows; row++) {
      const rowPegs = this.pegsByRow.get(row);
      if (!rowPegs?.length) continue;
      for (const peg of rowPegs) {
        left = Math.min(left, peg.x - this.pegRadius);
        right = Math.max(right, peg.x + this.pegRadius);
      }
    }
    const span = right - left;
    const margin = Math.max(this.pegRadius * 2, 8);
    const targetSpan = Math.max(1, this.containerWidth - margin * 2);

    if (span > targetSpan) {
      const scale = targetSpan / span;
      this.world.scale.set(scale);
      const offsetX = (this.containerWidth - span * scale) / 2 - left * scale;
      this.world.position.set(offsetX, this.getWorldViewportYOffset());
    } else {
      this.world.scale.set(1);
      this.updateWorldViewportOffset();
    }
  }

  private renderFrame(): void {
    if (this.app?.renderer) {
      this.app.renderer.render(this.app.stage);
    }
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

  /** Desktop render offset — board sits lower so spawn airspace stays visible. */
  private getWorldViewportYOffset(): number {
    return isMobile() ? 0 : this.layoutHeight * 0.085;
  }

  /** Pixi buffer height: host size plus viewport offset so bottom slots are not clipped. */
  private getRendererHeight(): number {
    return Math.ceil(this.containerHeight + this.getWorldViewportYOffset());
  }

  /**
   * Keep the board visually lower inside a taller canvas so high spawn remains visible.
   * This is a render offset only; physics/layout coordinates remain unchanged.
   */
  private updateWorldViewportOffset(): void {
    this.world.position.set(0, this.getWorldViewportYOffset());
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

  private getMiddleSlotIndex(): number {
    return Math.floor(this.slots.length / 2);
  }

  private isSpinSlotIndex(idx: number): boolean {
    return idx === this.getMiddleSlotIndex();
  }

  /** Spin uses spin asset; neighbors use tier 1..7 by distance from center. */
  private getMultiplierSlotTextureForIndex(idx: number): Sprite['texture'] | undefined {
    const middle = this.getMiddleSlotIndex();
    if (idx === middle) return this.multiplierSlotSpinTexture;
    const distance = Math.abs(idx - middle);
    const tier = Math.min(7, Math.max(1, distance));
    return this.multiplierSlotTextures[tier];
  }

  private syncSlotAssetsAndLabels(): void {
    for (const s of this.slotSprites) {
      s?.destroy();
    }
    this.slotSprites = [];
    for (const t of this.slotLabels) {
      t?.destroy();
    }
    this.slotLabels.length = 0;

    if (!this.multiplierSlotAssetsReady) return;

    for (let i = 0; i < this.slots.length; i++) {
      const texture = this.getMultiplierSlotTextureForIndex(i);
      if (texture) {
        const sp = new Sprite(texture);
        sp.anchor.set(0.5, 1);
        sp.visible = false;
        this.slotAssetLayer.addChild(sp);
        this.slotSprites.push(sp);
      } else {
        this.slotSprites.push(undefined);
      }

      if (this.isSpinSlotIndex(i)) {
        this.slotLabels.push(undefined);
        continue;
      }

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
    }
  }

  private resizeCanvasToContainer(): void {
    if (!this.app) return;
    if (this.resizeRafId !== null) return;
    this.resizeRafId = requestAnimationFrame(() => {
      this.resizeRafId = null;
      const prevWidth = this.containerWidth || this.lastWidth;
      const prevHeight = this.containerHeight || this.lastHeight;
      const { width, height } = this.getContainerSize();
      this.containerWidth = width;
      this.containerHeight = height;
      const renderHeight = this.getRendererHeight();
      const winW = typeof window !== 'undefined' ? window.innerWidth : 0;
      const winH = typeof window !== 'undefined' ? window.innerHeight : 0;
      if (
        width === this.lastWidth &&
        renderHeight === this.lastHeight &&
        winW === this.lastWindowInnerW &&
        winH === this.lastWindowInnerH
      ) {
        this.ensureLayoutDimensionsFromRendererIfNeeded();
        if (this.coefficients.length && this.rows) {
          this.drawStaticPyramid();
          this.renderFrame();
        }
        return;
      }
      this.app?.renderer.resize(width, renderHeight);
      this.lastWidth = width;
      this.lastHeight = renderHeight;
      this.lastWindowInnerW = winW;
      this.lastWindowInnerH = winH;
      this.updateContainerSize();
      this.updateWorldViewportOffset();
      this.remapActiveBallsForResize(prevWidth, prevHeight, width, height);
      if (this.coefficients.length && this.rows) {
        this.rebuildScene();
        this.rebindActiveBallPathPegs();
      } else {
        this.fitWorldToSlotRow();
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
      ball.laneOffsetX *= sx;
      ball.collisionOffsetX *= sx;
      ball.collisionOffsetY *= sy;

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

  private getContainerSize(): { width: number; height: number } {
    const host = this.hostElement;
    const rect = host.getBoundingClientRect();
    let w = Math.round(rect.width) || Math.round(host.clientWidth);
    let h = Math.round(rect.height) || Math.round(host.clientHeight);
    const min = PlinkoEngine.MIN_LAYOUT_PX;
    if (w >= min && h >= min) {
      return { width: w, height: h };
    }

    const r = this.app?.renderer;
    if (r) {
      const rw = Math.max(1, Math.floor(Number(r.width) || 0));
      const rh = Math.max(1, Math.floor(Number(r.height) || 0));
      if (rw >= min && rh >= min) {
        return { width: rw, height: rh };
      }
    }

    if (this.lastWidth >= min && this.lastHeight >= min) {
      return { width: this.lastWidth, height: this.lastHeight };
    }

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
    const { width, height } = this.getContainerSize();
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
    for (let i = 0; i < this.slots.length; i++) {
      if (this.isSpinSlotIndex(i)) continue;
      const slot = this.slots[i];
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
      const rowSpacingX = this.pegSpacingXForRow(row);
      for (let col = 0; col < pegsInRow; col++) {
        const pegX = centerX - ((pegsInRow - 1) * rowSpacingX) / 2 + col * rowSpacingX;
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
    const bottomSpacingX = this.pegSpacingXForRow(this.rows - 1);
    const totalWidth = (lastRowPegs - 1) * bottomSpacingX * this.slotWidthScale;
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
        labelText: i === middleIndex ? '' : String(formatCoefficientLabel(coefficient)),
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

  private createPathRng(seed: number): () => number {
    let state = (Math.abs(Math.floor(seed)) || 1) % 2147483647;
    return () => {
      state = (state * 16807) % 2147483647;
      return (state - 1) / 2147483646;
    };
  }

  private pickFeaturedPegForPath(pathSeed?: number): Peg | null {
    const keys = Array.from(this.featuredPegKeys);
    if (!keys.length) return null;
    const pick =
      pathSeed != null
        ? keys[Math.abs(pathSeed) % keys.length]
        : keys[Math.floor(Math.random() * keys.length)];
    const [rowStr, colStr] = pick.split(':');
    const row = Number(rowStr);
    const col = Number(colStr);
    return this.pegs.find((peg) => peg.row === row && peg.col === col) ?? null;
  }

  private isFeaturedPeg(peg: Peg): boolean {
    return this.featuredPegKeys.has(`${peg.row}:${peg.col}`);
  }

  private rowHasFeaturedPeg(row: number): boolean {
    if (row < 0) return false;
    const rowPegs = this.pegsByRow.get(row) ?? [];
    return rowPegs.some((peg) => this.isFeaturedPeg(peg));
  }

  private smoothstep(t: number): number {
    const clamped = Math.max(0, Math.min(1, t));
    return clamped * clamped * (3 - 2 * clamped);
  }

  /** Pure Galton lane positions (one per peg row) toward the target slot. */
  private buildGaltonLane(turns: number[], startX: number): number[] {
    const lane: number[] = [];
    let currentX = startX;
    for (let row = 0; row < this.rows; row++) {
      currentX += turns[row] * (this.pegSpacingXForRow(row) / 2);
      lane.push(currentX);
    }
    return lane;
  }

  private getFeaturedClusterSpan(row: number): { minX: number; maxX: number } | null {
    const featured = (this.pegsByRow.get(row) ?? []).filter((peg) => this.isFeaturedPeg(peg));
    if (!featured.length) return null;
    return {
      minX: Math.min(...featured.map((peg) => peg.x)),
      maxX: Math.max(...featured.map((peg) => peg.x)),
    };
  }

  private galtonLaneThreatensFeaturedCluster(row: number, laneX: number): boolean {
    const span = this.getFeaturedClusterSpan(row);
    if (!span) return false;
    const buffer = this.pegSpacingXForRow(row) * 0.36;
    return laneX >= span.minX - buffer && laneX <= span.maxX + buffer;
  }

  /** Regular peg immediately beside the bonus cluster on the given side (not in the gap). */
  private pickFlankBouncePeg(row: number, side: -1 | 1): Peg | null {
    const span = this.getFeaturedClusterSpan(row);
    if (!span) return null;
    const regular = (this.pegsByRow.get(row) ?? []).filter((peg) => !this.isFeaturedPeg(peg));
    if (side < 0) {
      const candidates = regular.filter((peg) => peg.x < span.minX);
      if (!candidates.length) return null;
      return candidates.reduce((best, peg) => (peg.x > best.x ? peg : best));
    }
    const candidates = regular.filter((peg) => peg.x > span.maxX);
    if (!candidates.length) return null;
    return candidates.reduce((best, peg) => (peg.x < best.x ? peg : best));
  }

  private isInsideFeaturedClusterGap(row: number, x: number): boolean {
    const span = this.getFeaturedClusterSpan(row);
    if (!span) return false;
    const margin = this.pegSpacingXForRow(row) * 0.14;
    return x > span.minX - margin && x < span.maxX + margin;
  }

  /**
   * Route around the full bonus cluster on one flank (never through the gap between bonus pegs).
   */
  private planSmoothFeaturedAvoidance(
    galtonLane: number[],
    targetSlotX: number,
  ): { offsets: number[]; flankPegByRow: Map<number, Peg> } {
    const offsets = new Array<number>(this.rows).fill(0);
    const flankPegByRow = new Map<number, Peg>();
    const featuredRows: number[] = [];
    for (let row = 0; row < this.rows; row++) {
      if (this.rowHasFeaturedPeg(row)) featuredRows.push(row);
    }
    if (!featuredRows.length) return { offsets, flankPegByRow };

    const needsAvoidance = featuredRows.some((row) =>
      this.galtonLaneThreatensFeaturedCluster(row, galtonLane[row] ?? targetSlotX),
    );
    if (!needsAvoidance) return { offsets, flankPegByRow };

    let chosenSide: -1 | 1 = 1;
    let bestScore = -Infinity;
    for (const side of [-1, 1] as const) {
      let score = 0;
      let valid = true;
      for (const row of featuredRows) {
        const flank = this.pickFlankBouncePeg(row, side);
        if (!flank) {
          valid = false;
          break;
        }
        const galtonX = galtonLane[row] ?? targetSlotX;
        score -= Math.abs(flank.x - targetSlotX) * 0.4;
        score -= Math.abs(flank.x - galtonX) * 0.15;
      }
      if (!valid) continue;
      if (score > bestScore) {
        bestScore = score;
        chosenSide = side;
      }
    }

    const targetLaneByRow = new Map<number, number>();
    for (const row of featuredRows) {
      const flank = this.pickFlankBouncePeg(row, chosenSide);
      if (!flank) continue;
      flankPegByRow.set(row, flank);
      targetLaneByRow.set(row, flank.x);
    }
    if (!targetLaneByRow.size) return { offsets, flankPegByRow };

    const firstFeatured = featuredRows[0];
    const lastFeatured = featuredRows[featuredRows.length - 1];
    const rampRows = Math.min(5, Math.max(3, firstFeatured));
    const easeInStart = Math.max(0, firstFeatured - rampRows);
    const easeOutEnd = Math.min(this.rows - 1, lastFeatured + rampRows);

    for (let row = 0; row < this.rows; row++) {
      let weight = 0;
      if (row < easeInStart) {
        weight = 0;
      } else if (row <= firstFeatured) {
        weight = this.smoothstep((row - easeInStart) / Math.max(1, firstFeatured - easeInStart));
      } else if (row <= lastFeatured) {
        weight = 1;
      } else if (row <= easeOutEnd) {
        weight = 1 - this.smoothstep((row - lastFeatured) / Math.max(1, easeOutEnd - lastFeatured));
      }

      if (weight <= 0) continue;

      const galtonX = galtonLane[row] ?? targetSlotX;
      let targetLane = galtonX;
      if (row >= firstFeatured && row <= lastFeatured && targetLaneByRow.has(row)) {
        targetLane = targetLaneByRow.get(row)!;
      } else {
        const anchorRow = row < firstFeatured ? firstFeatured : lastFeatured;
        const anchorLane = targetLaneByRow.get(anchorRow);
        if (anchorLane != null) {
          targetLane = galtonX + (anchorLane - galtonX) * weight;
        }
      }
      offsets[row] = targetLane - galtonX;
    }

    return { offsets, flankPegByRow };
  }

  /**
   * Smoothly steer the lane onto a single featured (bonus) peg and back off again.
   * Ramps from the Galton lane toward the peg over the rows leading up to it, holds
   * exactly on the peg at its row, then eases back to the Galton lane over the rows
   * below. This avoids the ball flinging sideways to "tag" the bonus peg and snapping
   * straight back; the approach and departure both look like a natural fall.
   */
  private planSmoothFeaturedApproach(galtonLane: number[], featuredTarget: Peg): number[] {
    const offsets = new Array<number>(this.rows).fill(0);
    const targetRow = featuredTarget.row;
    if (targetRow < 0 || targetRow >= this.rows) return offsets;

    const rampRows = Math.min(5, Math.max(3, targetRow));
    const easeInStart = Math.max(0, targetRow - rampRows);
    const easeOutEnd = Math.min(this.rows - 1, targetRow + rampRows);

    for (let row = 0; row < this.rows; row++) {
      let weight = 0;
      if (row < easeInStart) {
        weight = 0;
      } else if (row < targetRow) {
        weight = this.smoothstep((row - easeInStart) / Math.max(1, targetRow - easeInStart));
      } else if (row === targetRow) {
        weight = 1;
      } else if (row <= easeOutEnd) {
        weight = 1 - this.smoothstep((row - targetRow) / Math.max(1, easeOutEnd - targetRow));
      }
      if (weight <= 0) continue;
      const galtonX = galtonLane[row] ?? featuredTarget.x;
      offsets[row] = (featuredTarget.x - galtonX) * weight;
    }

    return offsets;
  }

  private pickNearestPeg(
    pegs: Peg[],
    x: number,
    penalizeFeatured = false,
  ): Peg | null {
    let closest: Peg | null = null;
    let minScore = Infinity;
    for (const peg of pegs) {
      let score = Math.abs(x - peg.x);
      if (penalizeFeatured && this.isFeaturedPeg(peg)) {
        score += this.pegSpacingXForRow(peg.row) * 0.35;
      }
      if (score < minScore) {
        minScore = score;
        closest = peg;
      }
    }
    return closest;
  }

  /**
   * Pick the peg this row should bounce off while keeping the Galton lane natural.
   */
  private resolveRowBounce(
    rowPegs: Peg[],
    laneX: number,
    options: {
      featuredTarget: Peg | null;
      row: number;
      targetSlotX: number;
      excludeFeaturedFromBounce: boolean;
      steerTowardFeatured: boolean;
      plannedFlankPeg?: Peg | null;
      nextRandom: () => number;
    },
  ): { pathX: number; closestPeg: Peg | null; bounceIntensity: number } {
    const {
      featuredTarget,
      row,
      excludeFeaturedFromBounce,
      steerTowardFeatured,
      plannedFlankPeg,
      nextRandom,
    } = options;

    if (featuredTarget && row === featuredTarget.row) {
      return {
        pathX: featuredTarget.x,
        closestPeg: featuredTarget,
        bounceIntensity: 0.92,
      };
    }

    let pathX = laneX;
    if (steerTowardFeatured && featuredTarget && row < featuredTarget.row) {
      const rowsUntil = Math.max(1, featuredTarget.row - row);
      const biasStrength = Math.min(0.42, 0.16 + 0.05 / rowsUntil);
      pathX = laneX + (featuredTarget.x - laneX) * biasStrength;
    }

    const bounceCandidates = excludeFeaturedFromBounce
      ? rowPegs.filter((peg) => !this.isFeaturedPeg(peg))
      : rowPegs;
    if (!bounceCandidates.length) {
      return { pathX, closestPeg: null, bounceIntensity: 0 };
    }

    let closestPeg: Peg | null = null;
    if (excludeFeaturedFromBounce && plannedFlankPeg) {
      closestPeg = plannedFlankPeg;
    } else {
      closestPeg = excludeFeaturedFromBounce
        ? this.pickNearestPeg(bounceCandidates, pathX, false)
        : this.pickNearestPeg(bounceCandidates, pathX, true);
    }

    if (!closestPeg) {
      return { pathX, closestPeg: null, bounceIntensity: 0 };
    }

    const maxDistance = this.pegSpacingXForRow(options.row) / 2;
    const finalDistance = Math.abs(pathX - closestPeg.x);
    let bounceIntensity = Math.max(0.45, Math.min(0.95, 1 - finalDistance / maxDistance));
    bounceIntensity *= 0.82 + nextRandom() * 0.18;

    return { pathX, closestPeg, bounceIntensity };
  }

  /** Resolve which peg the ball should bounce off at this row (never a bonus peg unless allowed). */
  private resolveLiveBouncePeg(pathPoint: PathPoint, ball: Ball): Peg | null {
    if (pathPoint.row < 0) return pathPoint.closestPeg;

    const rowPegs = this.pegsByRow.get(pathPoint.row) ?? [];
    const regularPegs = rowPegs.filter((peg) => !this.isFeaturedPeg(peg));
    if (ball.creditBonusPegHit) {
      return this.pickNearestPeg(rowPegs, ball.x, false) ?? pathPoint.closestPeg;
    }
    if (!regularPegs.length) return pathPoint.closestPeg;

    if (this.isInsideFeaturedClusterGap(pathPoint.row, ball.x)) {
      if (pathPoint.closestPeg && !this.isFeaturedPeg(pathPoint.closestPeg)) {
        return pathPoint.closestPeg;
      }
      const span = this.getFeaturedClusterSpan(pathPoint.row);
      if (span) {
        const side = ball.x <= (span.minX + span.maxX) / 2 ? -1 : 1;
        const flank = this.pickFlankBouncePeg(pathPoint.row, side);
        if (flank) return flank;
      }
    }

    if (pathPoint.closestPeg && !this.isFeaturedPeg(pathPoint.closestPeg)) {
      const alignedWithPlan =
        Math.abs(ball.x - pathPoint.closestPeg.x) <= this.pegSpacingXForRow(pathPoint.row) * 0.58 &&
        ball.y >= pathPoint.closestPeg.y - this.pegRadius * 0.65 &&
        ball.y <= pathPoint.closestPeg.y + this.pegRadius * 0.8;
      if (alignedWithPlan) return pathPoint.closestPeg;
    }

    return this.pickNearestPeg(regularPegs, ball.x, false) ?? pathPoint.closestPeg;
  }

  private calculatePath(
    targetIndex: number,
    pathOptions?: { hitBonusPeg?: boolean; deterministic?: boolean; pathSeed?: number },
  ): PathPoint[] {
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
    const pathRng = pathOptions?.deterministic
      ? this.createPathRng(pathOptions.pathSeed ?? targetIndex)
      : null;
    const nextRandom = () => (pathRng ? pathRng() : Math.random());

    for (let i = turns.length - 1; i > 0; i--) {
      const j = Math.floor(nextRandom() * (i + 1));
      [turns[i], turns[j]] = [turns[j], turns[i]];
    }
    // Randomize initial direction from origin:
    // far-left, left, middle, right, far-right.
    const spawnDirection = pathOptions?.deterministic
      ? (Math.floor(nextRandom() * 5) - 2)
      : this.randomSpawnDirection();
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
          const swapIndex = candidates[Math.floor(nextRandom() * candidates.length)];
          turns[swapIndex] = originalFirstTurn;
        } else {
          // Should be rare; fallback keeps path valid.
          turns[0] = originalFirstTurn;
        }
      }
    }
    // IMPORTANT: only bias the launch segment; do not alter Galton turns
    // so we preserve slot targeting and avoid flinging to far slots.
    const spawnLaneBias = spawnDirection * this.pegSpacingXForRow(0) * 0.42;

    const featuredTarget = pathOptions?.hitBonusPeg
      ? this.pickFeaturedPegForPath(pathOptions.pathSeed)
      : null;
    const avoidFeaturedPegs = pathOptions?.deterministic === true && pathOptions?.hitBonusPeg !== true;
    const steerToFeatured = pathOptions?.hitBonusPeg === true && featuredTarget != null;
    const galtonLane = this.buildGaltonLane(turns, centerX);
    let laneOffsets: number[];
    let flankPegByRow: Map<number, Peg>;
    if (avoidFeaturedPegs) {
      const avoidancePlan = this.planSmoothFeaturedAvoidance(galtonLane, targetX);
      laneOffsets = avoidancePlan.offsets;
      flankPegByRow = avoidancePlan.flankPegByRow;
    } else if (steerToFeatured && featuredTarget) {
      laneOffsets = this.planSmoothFeaturedApproach(galtonLane, featuredTarget);
      flankPegByRow = new Map<number, Peg>();
    } else {
      laneOffsets = new Array<number>(this.rows).fill(0);
      flankPegByRow = new Map<number, Peg>();
    }
    const earlyAvoidBias = laneOffsets[0] ?? 0;

    const path: PathPoint[] = [];
    path.push({ x: centerX, y: launchY, row: -1, closestPeg: null, bounceIntensity: 0, travelDir: 0 });
    path.push({
      x: centerX + spawnLaneBias + earlyAvoidBias * 0.12,
      y: this.topMargin - this.pegSpacing * 0.32,
      row: -1,
      closestPeg: null,
      bounceIntensity: 0,
      travelDir: 0,
    });

    for (let row = 0; row < this.rows; row++) {
      const rowY = this.topMargin + this.pegSpacing * 0.5 + row * this.pegSpacing;
      const galtonX = galtonLane[row] ?? centerX;
      const laneX = galtonX + (laneOffsets[row] ?? 0);

      const rowPegs = this.pegsByRow.get(row) ?? [];
      const { pathX, closestPeg, bounceIntensity } = this.resolveRowBounce(rowPegs, laneX, {
        featuredTarget,
        row,
        targetSlotX: targetX,
        excludeFeaturedFromBounce:
          avoidFeaturedPegs || steerToFeatured,
        // Lane is already smoothly steered onto the featured peg via laneOffsets, so
        // resolveRowBounce only needs to honor the lane (no extra per-row bias that
        // would otherwise yank the path sideways near the bonus peg).
        steerTowardFeatured: false,
        plannedFlankPeg: flankPegByRow.get(row),
        nextRandom,
      });

      const nextLookaheadX =
        featuredTarget && row + 1 === featuredTarget.row
          ? featuredTarget.x
          : row + 1 < this.rows
            ? (galtonLane[row + 1] ?? targetX) + (laneOffsets[row + 1] ?? 0)
            : targetX;
      const pegX = closestPeg?.x ?? pathX;
      const travelDir =
        bounceIntensity > 0 ? this.resolveTravelDir(pegX, nextLookaheadX, targetX) : 0;

      path.push({
        x: pathX,
        y: rowY,
        row,
        closestPeg,
        bounceIntensity,
        travelDir,
      });
    }

    path.push({
      x: targetX,
      y: targetSlot.y + this.slotHeight / 2,
      row: this.rows,
      closestPeg: null,
      bounceIntensity: 0,
      travelDir: 0,
    });

    return path;
  }

  dropBall(
    targetIndex: number,
    dropOptions?: { hitBonusPeg?: boolean; deterministic?: boolean; pathSeed?: number },
  ): { ballId: number; targetIndex: number } | null {
    if (!this.pixiReady || !this.app || !this.coefficients.length) return null;

    if (targetIndex === -1) {
      targetIndex = Math.floor(Math.random() * this.coefficients.length);
    }

    const path = this.calculatePath(targetIndex, dropOptions);
    if (!path.length) return null;

    // Authoritative drops: only server `hitBonusPeg` may credit the bonus meter.
    // Legacy / bonus-ball drops (non-deterministic): any featured-peg contact may credit.
    const creditBonusPegHit =
      dropOptions?.deterministic === true
        ? dropOptions?.hitBonusPeg === true
        : true;

    const bonusPegPathIndex = creditBonusPegHit
      ? path.findIndex(
          (p) =>
            !!p.closestPeg &&
            this.featuredPegKeys.has(`${p.closestPeg.row}:${p.closestPeg.col}`),
        )
      : -1;
    const bonusPeg = bonusPegPathIndex >= 0 ? path[bonusPegPathIndex]?.closestPeg : null;
    const traitSeed =
      dropOptions?.pathSeed != null ? dropOptions.pathSeed * 7919 + targetIndex : undefined;
    const traits = this.createBallVariationTraits(traitSeed);

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
      bounceTravelDir: 0,
      currentSegmentIndex: 0,
      velocityX: 0,
      velocityY: 0,
      target: this.coefficients[targetIndex],
      targetIndex,
      targetReached: false,
      slotAnimationStart: 0,
      creditBonusPegHit,
      bonusPegEmitPathIndex: bonusPegPathIndex >= 0 ? bonusPegPathIndex : null,
      bonusPegEmitRow: bonusPeg?.row ?? -1,
      bonusPegEmitCol: bonusPeg?.col ?? -1,
      bonusPegEmitted: false,
      collisionOffsetX: 0,
      collisionOffsetY: 0,
      ...traits,
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

        // Server-authoritative bonus-peg credit:
        // emit once when the ball reaches the featured-peg path segment.
        if (
          ball.creditBonusPegHit &&
          !ball.bonusPegEmitted &&
          ball.bonusPegEmitPathIndex != null &&
          segmentIndex >= ball.bonusPegEmitPathIndex
        ) {
          ball.bonusPegEmitted = true;
          if (ball.bonusPegEmitRow >= 0 && ball.bonusPegEmitCol >= 0) {
            this.onCoinPegHit?.({
              row: ball.bonusPegEmitRow,
              col: ball.bonusPegEmitCol,
              ballId: ball.id,
            });
          }
        }

        let baseX = 0;
        let baseY = 0;
        if (segmentIndex < pathLength - 1) {
          const pointA = ball.path[segmentIndex];
          const pointB = ball.path[segmentIndex + 1];
          const laneT = this.easeSmoothstep(segmentFraction);
          const fallT = this.easeInQuad(segmentFraction);
          baseX = pointA.x + (pointB.x - pointA.x) * laneT;
          baseY = pointA.y + (pointB.y - pointA.y) * fallT;
        } else {
          const lastPoint = ball.path[pathLength - 1];
          baseX = lastPoint.x;
          baseY = lastPoint.y;
        }

        if (ball.isInBounce) {
          const bounceElapsed = currentTime - ball.bounceStartTime;
          const bounceProgress = Math.min(1, bounceElapsed / ball.bounceDuration);
          if (bounceProgress >= 1) {
            ball.isInBounce = false;
            ball.bounceTravelDir = 0;
            ball.velocityX *= 0.78;
            ball.x =
              baseX +
              ball.velocityX * this.pyramidConfig.laneCentering +
              ball.laneOffsetX +
              ball.collisionOffsetX;
            ball.y = baseY + ball.velocityY + ball.collisionOffsetY;
          } else {
            const arcHeight =
              this.pyramidConfig.bounceAmplitude *
              ball.bounceHeightMultiplier *
              Math.sin(bounceProgress * Math.PI) *
              this.elementScale;
            const directedDrift =
              ball.bounceTravelDir *
              this.pyramidConfig.bounceAmplitude *
              ball.driftMultiplier *
              0.132 *
              this.elementScale *
              Math.sin(bounceProgress * Math.PI);
            const wobble =
              this.pyramidConfig.horizontalDrift *
              ball.driftMultiplier *
              0.18 *
              Math.sin(bounceProgress * Math.PI * 2) *
              this.elementScale;
            ball.x =
              baseX +
              ball.velocityX * this.pyramidConfig.laneCentering +
              directedDrift +
              wobble +
              ball.laneOffsetX +
              ball.collisionOffsetX;
            ball.y = baseY + ball.velocityY - arcHeight + ball.collisionOffsetY;
          }
        } else {
          ball.x =
            baseX +
            ball.velocityX * this.pyramidConfig.laneCentering +
            ball.laneOffsetX +
            ball.collisionOffsetX;
          ball.y = baseY + ball.velocityY + ball.collisionOffsetY;
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

    this.resolveBallCollisions();

    const heavyLoad = this.balls.length >= 8;
    const shouldRedrawEffectLayers = !heavyLoad || this.frameTick % 2 === 0;
    if (shouldRedrawEffectLayers) {
      const hasSlotVisuals = this.hasActiveSlotVisuals(currentTime);
      const hasPegVisuals = this.hasActivePegVisuals(currentTime);
      if (hasSlotVisuals) {
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

  private createBallVariationTraits(seed?: number): Pick<
    Ball,
    | 'speedMultiplier'
    | 'bounceHeightMultiplier'
    | 'driftMultiplier'
    | 'bounceDurationMultiplier'
    | 'laneOffsetX'
  > {
    const rng = seed != null ? this.createPathRng(seed) : Math.random;
    return {
      speedMultiplier: 1.3,
      bounceHeightMultiplier: 0.86 + rng() * 0.28,
      driftMultiplier: 0.72 + rng() * 0.56,
      bounceDurationMultiplier: 1,
      laneOffsetX: (rng() - 0.5) * this.pegSpacingXForRow(0) * 0.07,
    };
  }

  /** Separate overlapping balls and apply a slight repulsion away from each other. */
  private resolveBallCollisions(): void {
    const dropping = this.balls.filter((b) => b.isDropping && b.scale > 0);
    if (dropping.length < 2) return;

    const minSep = this.ballRadius * 2 * this.pyramidConfig.ballSeparationFactor;
    const minSepSq = minSep * minSep;
    const maxPush = this.ballRadius * 0.38;
    const repulsion = this.pyramidConfig.ballRepulsionScale * this.elementScale;
    const passes = dropping.length >= 4 ? 3 : 2;

    for (let pass = 0; pass < passes; pass++) {
      for (let i = 0; i < dropping.length; i++) {
        const a = dropping[i];
        for (let j = i + 1; j < dropping.length; j++) {
          const b = dropping[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distSq = dx * dx + dy * dy;
          if (distSq >= minSepSq) continue;

          let nx: number;
          let ny: number;
          let overlap: number;
          if (distSq < 0.0001) {
            nx = a.id < b.id ? -1 : 1;
            ny = -0.25;
            const len = Math.hypot(nx, ny) || 1;
            nx /= len;
            ny /= len;
            overlap = minSep;
          } else {
            const dist = Math.sqrt(distSq);
            nx = dx / dist;
            ny = dy / dist;
            overlap = minSep - dist;
          }

          const push = Math.min(overlap * 0.54, maxPush);
          a.collisionOffsetX -= nx * push;
          b.collisionOffsetX += nx * push;
          a.collisionOffsetY -= ny * push * 0.45;
          b.collisionOffsetY += ny * push * 0.45;
          a.x -= nx * push;
          a.y -= ny * push * 0.55;
          b.x += nx * push;
          b.y += ny * push * 0.55;

          const repulse = repulsion * overlap;
          a.velocityX -= nx * repulse;
          b.velocityX += nx * repulse;
          a.velocityY -= ny * repulse * 0.18;
          b.velocityY += ny * repulse * 0.18;
        }
      }
    }
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

    const maxLaneDrift = this.minPegSpacingX * 0.28;
    ball.velocityX = Math.max(-maxLaneDrift, Math.min(maxLaneDrift, ball.velocityX));
    if (!ball.isInBounce) {
      ball.velocityY += this.pyramidConfig.verticalGravity * this.elementScale;
      ball.velocityY *= this.pyramidConfig.verticalDamping;
      const maxVerticalOffset = this.pyramidConfig.bounceAmplitude * this.elementScale * 0.4;
      ball.velocityY = Math.max(-maxVerticalOffset, Math.min(maxVerticalOffset, ball.velocityY));
    } else {
      ball.velocityY *= 0.9;
    }

    if (Math.abs(ball.velocityX) > 0.1) {
      ball.velocityX *= this.pyramidConfig.lateralFriction;
    } else {
      ball.velocityX = 0;
    }

    ball.collisionOffsetX *= 0.91;
    ball.collisionOffsetY *= 0.91;
    const maxCollisionX = this.minPegSpacingX * 0.26;
    const maxCollisionY = this.pegSpacing * 0.1;
    ball.collisionOffsetX = Math.max(-maxCollisionX, Math.min(maxCollisionX, ball.collisionOffsetX));
    ball.collisionOffsetY = Math.max(-maxCollisionY, Math.min(maxCollisionY, ball.collisionOffsetY));
  }

  private easeSmoothstep(t: number): number {
    const c = Math.max(0, Math.min(1, t));
    return c * c * (3 - 2 * c);
  }

  private easeInQuad(t: number): number {
    const c = Math.max(0, Math.min(1, t));
    return c * c;
  }

  private resolveTravelDir(pegX: number, lookAheadX: number, targetX: number): -1 | 0 | 1 {
    const delta = lookAheadX - pegX;
    const centerThreshold = this.pegSpacingX * 0.09;
    if (Math.abs(delta) <= centerThreshold) return 0;
    return delta < 0 ? -1 : 1;
  }

  /** Contact on the peg crown only: top, top-left, or top-right (never side/bottom). */
  private getDirectionalPegContact(
    bouncePeg: Peg,
    travelDir: -1 | 0 | 1,
  ): { x: number; y: number } {
    const crownY = bouncePeg.y - this.pegRadius * 0.92;
    if (travelDir === 0) {
      return { x: bouncePeg.x, y: crownY };
    }
    const crownXOffset = this.pegRadius * 0.4;
    return {
      x: bouncePeg.x + travelDir * crownXOffset,
      y: crownY,
    };
  }

  private inferBounceTravelDir(
    ball: Ball,
    pathIndex: number,
    pathPoint: PathPoint,
    bouncePeg: Peg,
  ): -1 | 0 | 1 {
    if (pathPoint.travelDir === -1 || pathPoint.travelDir === 0 || pathPoint.travelDir === 1) {
      return pathPoint.travelDir;
    }
    const nextPoint = ball.path[pathIndex + 1];
    const targetX = ball.path[ball.path.length - 1]?.x ?? bouncePeg.x;
    const lookAheadX = nextPoint?.closestPeg?.x ?? nextPoint?.x ?? targetX;
    return this.resolveTravelDir(bouncePeg.x, lookAheadX, targetX);
  }

  private checkForBounce(ball: Ball, currentTime: number): void {
    if (ball.isInBounce) return;

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
        pathPoint.bounceIntensity <= 0 ||
        ball.bouncedRows.has(pathPoint.row) ||
        currentTime - ball.lastBounceTime <= this.pyramidConfig.bounceCooldown
      ) {
        continue;
      }

      const bouncePeg = this.resolveLiveBouncePeg(pathPoint, ball);
      if (!bouncePeg || (!ball.creditBonusPegHit && this.isFeaturedPeg(bouncePeg))) {
        continue;
      }

      // Contact on the peg crown only (top / top-left / top-right).
      const travelDir = this.inferBounceTravelDir(ball, i, pathPoint, bouncePeg);
      const contact = this.getDirectionalPegContact(bouncePeg, travelDir);
      const contactX = contact.x;
      const contactY = contact.y;
      const dx = ball.x - contactX;
      const dy = ball.y - contactY;
      const distanceSq = dx * dx + dy * dy;
      const interactionRadius = this.ballRadius * 0.95;
      const interactionRadiusSq = interactionRadius * interactionRadius;
      const rowWasCrossed = segmentProgress >= i - 0.02;
      const descendingOntoPeg = ball.y >= ball.prevY - 0.5;
      const approachingFromTop =
        ball.y <= bouncePeg.y - this.pegRadius * 0.08 && descendingOntoPeg;
      const columnTolerance =
        !ball.creditBonusPegHit && this.rowHasFeaturedPeg(pathPoint.row)
          ? this.pegSpacingXForRow(pathPoint.row) * 0.52
          : this.pegSpacingXForRow(pathPoint.row) * 0.32;
      const nearPegColumn = Math.abs(ball.x - bouncePeg.x) <= columnTolerance;
      const inCrownZone =
        ball.y <= bouncePeg.y &&
        ball.y >= bouncePeg.y - this.pegRadius * 1.25;
      const shouldUseFallback =
        rowWasCrossed && nearPegColumn && inCrownZone && approachingFromTop;

      if ((distanceSq < interactionRadiusSq && approachingFromTop && inCrownZone) || shouldUseFallback) {
        bouncePeg.bounceEffect = pathPoint.bounceIntensity;
        bouncePeg.bounceTime = currentTime;
        bouncePeg.isTouched = true;
        if (
          ball.creditBonusPegHit &&
          !ball.bonusPegEmitted &&
          this.isFeaturedPeg(bouncePeg)
        ) {
          ball.bonusPegEmitted = true;
          this.onCoinPegHit?.({
            row: bouncePeg.row,
            col: bouncePeg.col,
            ballId: ball.id,
          });
        }
        ball.isInBounce = true;
        ball.bounceStartTime = currentTime;
        ball.bounceDuration =
          this.pyramidConfig.bounceDuration *
          ball.bounceDurationMultiplier *
          (0.85 + Math.random() * 0.3);
        ball.bounceTravelDir = travelDir;
        ball.x = contactX + (ball.x - contactX) * 0.15;
        ball.y = Math.min(ball.y, contactY);

        const impulseScale =
          this.pyramidConfig.bounceImpulseMin +
          Math.random() * (this.pyramidConfig.bounceImpulseMax - this.pyramidConfig.bounceImpulseMin);
        const force = pathPoint.bounceIntensity * impulseScale * this.elementScale;
        ball.velocityX = travelDir * force * 2.82;
        ball.velocityY = Math.min(0, -force * this.pyramidConfig.bounceLift * 0.52);

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

  private resolveSlotAnimationOffset(slot: Slot, currentTime: number): number {
    if (!slot.animationActive) return 0;
    const elapsed = currentTime - slot.animationTime;
    if (elapsed < this.pyramidConfig.slotAnimationDuration) {
      const progress = elapsed / this.pyramidConfig.slotAnimationDuration;
      const bounce = progress * Math.PI * this.pyramidConfig.slotBounceCount;
      return this.slotBounceHeight * Math.sin(bounce) * (1 - progress);
    }
    slot.animationActive = false;
    slot.animationOffset = 0;
    return 0;
  }

  /** Match the 0.2× reference slot size for all multiplier assets. */
  private updateUniformSlotAssetScale(): void {
    const middle = this.getMiddleSlotIndex();
    let refIdx = this.slots.findIndex(
      (s) => formatCoefficientLabel(s.coefficient) === '0.2'
    );
    if (refIdx < 0) {
      refIdx = this.slots.findIndex((s) => Math.abs(s.coefficient - 0.2) < 0.01);
    }
    if (refIdx < 0) refIdx = middle > 0 ? middle - 1 : 0;

    const refSlot = this.slots[refIdx];
    const refW = refSlot.width - this.pegRadius;
    const middleIndex = (this.slots.length - 1) / 2;
    const distanceFromMiddle = Math.abs(refIdx - middleIndex);
    const normalizedDistance = middleIndex > 0 ? distanceFromMiddle / middleIndex : 0;
    const heightScale = 0.72 + normalizedDistance * 2.42;
    const scaleX = refW / PlinkoEngine.MULTIPLIER_SLOT_REF_TEX_W;
    const scaleY = scaleX * heightScale;

    this.uniformSlotDisplayW = scaleX * PlinkoEngine.MULTIPLIER_SLOT_REF_TEX_W;
    this.uniformSlotDisplayH = scaleY * PlinkoEngine.MULTIPLIER_SLOT_REF_TEX_H;

    const spinSlot = this.slots[middle];
    if (spinSlot) {
      this.uniformSlotSpinDisplayW = spinSlot.width - this.pegRadius;
    }
  }

  private layoutSlotAssetSprite(idx: number, x: number, y: number, w: number, h: number): void {
    const sp = this.slotSprites[idx];
    if (!sp || this.uniformSlotDisplayW <= 0 || this.uniformSlotDisplayH <= 0) return;

    const texW = sp.texture.width || PlinkoEngine.MULTIPLIER_SLOT_REF_TEX_W;
    const texH = sp.texture.height || PlinkoEngine.MULTIPLIER_SLOT_REF_TEX_H;
    const isSpin = idx === this.getMiddleSlotIndex();
    const displayW =
      isSpin && this.uniformSlotSpinDisplayW > 0
        ? this.uniformSlotSpinDisplayW
        : this.uniformSlotDisplayW;

    sp.visible = true;
    sp.scale.set(displayW / texW, this.uniformSlotDisplayH / texH);
    sp.position.set(x + w / 2, y + h);
    sp.tint = 0xffffff;
    sp.alpha = 1;
  }

  private drawAllSlotsPixi(currentTime: number): void {
    if (!this.slots.length) return;

    for (let idx = 0; idx < this.slots.length; idx++) {
      const slot = this.slots[idx];
      slot.animationOffset = this.resolveSlotAnimationOffset(slot, currentTime);

      const x = slot.x;
      const y = slot.y + slot.animationOffset;
      const w = slot.width - this.pegRadius;
      const h = this.slotHeight * 0.82;

      const sprite = this.slotSprites[idx];
      if (sprite) {
        this.layoutSlotAssetSprite(idx, x, y, w, h);
      }

      let textScale = 1.1;
      if (slot.animationActive) {
        const elapsed = currentTime - slot.animationTime;
        const progress = elapsed / this.pyramidConfig.slotAnimationDuration;
        textScale = 1 + 0.15 * Math.sin(progress * Math.PI * 4) * (1 - progress);
      }

      const label = this.slotLabels[idx];
      if (label) {
        label.scale.set(textScale, textScale);
        label.position.set(Math.round(x + w / 2), Math.round(y + h * 0.52));
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
    for (const sp of this.slotSprites) {
      if (sp) sp.visible = false;
    }

    this.drawAllSlotsPixi(now);
    this.drawAllPegsPixi(now);

    this.drawBallsPixi();
  }

  getSlotColor(coefficient: number): string {
    return slotColorForMultiplier(this.coefficients, coefficient);
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
    onBallSpawned?: (info: { dropped: { ballId: number; targetIndex: number } | null; index: number }) => void,
    hitBonusPegs?: boolean[],
    burstOptions?: { deterministic?: boolean },
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
          const dropped = this.dropBall(targetIndex, {
            hitBonusPeg: hitBonusPegs?.[i] === true,
            deterministic: burstOptions?.deterministic === true,
            pathSeed: targetIndex * 31 + i,
          });
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
