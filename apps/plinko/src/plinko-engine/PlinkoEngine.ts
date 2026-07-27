import { Application, Assets, Container, Graphics, Sprite, Text } from 'pixi.js';
import {
  Spine,
  Physics,
  type Bone,
  type Slot as SpineSlot,
  type Attachment as SpineAttachment
} from '@esotericsoftware/spine-pixi-v8';
import { slotColorForMultiplier } from '../game-logic/slotColors';
import { formatCoefficientLabel, isMobile } from '../lib/format';
import { getGlowNumbersAsset } from '../lib/spine/glowNumbersAsset';
import { readSkeletonData } from '../lib/spine/spineSkeletonData';
import { staticUrl } from '../lib/staticUrl';

export type BallDroppedEvent = {
	multiplier: number;
	ballId: number;
	slotIndex: number;
	isSpinSlot: boolean;
};

export type CoinPegHitEvent = { row: number; col: number; ballId: number };

/** Per-bounce sound event. `featured` is true when the contacted peg is a coin (featured) peg. */
export type PegBounceEvent = CoinPegHitEvent & { featured: boolean };

export type PlinkoEngineOptions = {
	hostElement: HTMLElement;
	onBallDropped?: (event: BallDroppedEvent) => void;
	onCoinPegHit?: (event: CoinPegHitEvent) => void;
	/** Emitted on every peg contact (once per peg/row) so the UI can play a per-bounce sound. */
	onPegBounce?: (event: PegBounceEvent) => void;
	/**
	 * Where balls are thrown from, in client (screen) px — the black cavity in the skull's mouth,
	 * which lives in the frame art outside this engine's host. Injected so the engine stays free of
	 * the app's markup; when it is absent or returns null (e.g. the board rendered bare in
	 * Storybook) the spawn falls back to the board's own centre.
	 */
	resolveSpawnAnchor?: () => { x: number; y: number; halfWidth?: number } | null | undefined;
};

interface Ball {
  id: number;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  scale: number;
  /**
   * Emergence from the skull's mouth: 0 the instant it appears in the cavity, 1 once it is fully
   * out. Drives size and brightness only (see `drawBallsPixi`) — never physics.
   */
  emerge: number;
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
  /** Precomputed `${row}:${col}` key — avoids per-frame string allocation in hot loops. */
  key: string;
  /** Precomputed featured (bonus/coin) flag — avoids per-frame Set lookups with string keys. */
  isFeatured: boolean;
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

/**
 * Which way, and how hard, a ball is thrown out of the mouth. Never straight down: the reference
 * game (inout Aztec) spits every ball to one side or the other, and a centre launch reads as the
 * ball being dropped rather than thrown.
 */
type SpawnDirection = -2 | -1 | 1 | 2;

export class PlinkoEngine {
	constructor(options: PlinkoEngineOptions) {
		this.hostElement = options.hostElement;
		this.onBallDropped = options.onBallDropped;
		this.onCoinPegHit = options.onCoinPegHit;
		this.onPegBounce = options.onPegBounce;
		this.resolveSpawnAnchor = options.resolveSpawnAnchor;
		if (isMobile()) {
			this.pyramidConfig.bounceAmplitude = 12;
		}
	}

	async init(): Promise<void> {
		await this.initPixi();
	}

	updateScene(coefficients: number[], rows: number, animationEnabled?: boolean): void {
		if (coefficients?.length) this.coefficients = coefficients;
		// Visual pyramid is a fixed 12-row board; ignore the passed (math) rowCount so the 6→17
		// layout stays stable. `rows` is kept in the signature for API compatibility.
		void rows;
		this.rows = PlinkoEngine.VISUAL_ROW_COUNT;
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
  /** Emitted on every peg contact (once per peg/row) for the per-bounce "thunk" sound. */
  onPegBounce?: (event: PegBounceEvent) => void;
  /** Resolves the skull-mouth spawn in client px; see `PlinkoEngineOptions`. */
  private resolveSpawnAnchor?: () => { x: number; y: number; halfWidth?: number } | null | undefined;
  private hostElement: HTMLElement;

  private app?: Application;
  private readonly world = new Container();
  private readonly pegGraphics = new Graphics();
  private readonly featuredPegLayer = new Container();
  private readonly labelLayer = new Container();
  private readonly bulletsLayer = new Container();
  private readonly ballsGraphics = new Graphics();
  private readonly slotAssetLayer = new Container();
  /** Glow-number spine layer (sits between slot backgrounds and the real-number labels). */
  private readonly slotSpineLayer = new Container();
  private readonly slotLabels: (Text | undefined)[] = [];
  private slotSprites: (Sprite | undefined)[] = [];

  /** Single glow-number spine instance (the whole slot row); bones repositioned per slot. */
  private glowSpine?: Spine;
  private glowSpineReady = false;
  /** Skeleton bone for each slot index (spatial left→right order), or undefined if unmapped. */
  private glowBoneBySlotIndex: (Bone | undefined)[] = [];
  /** Uniform display scale of the glow spine (used to convert the slot bounce offset to bone units). */
  private glowScale = 1;
  /** Runtime slot + default attachment of the center "SPIN" glyph, captured on spine load so the glyph
   *  can be hidden in the 1-ball rapid tier (where the center pocket is a plain 0×, not a spin). */
  private glowSpinSlot?: SpineSlot;
  private glowSpinDefaultAttachment: SpineAttachment | null = null;
  /** 1-ball rapid tier: the center pocket carries no bonus, so it shows "0" instead of the "SPIN" glyph. */
  private rapidSingleBall = false;
  /** Slot count the spine was authored for — only render glow when the board matches it. */
  private static readonly GLOW_SPINE_SLOT_COUNT = 15;
  /** Spine bones in spatial left→right order (15 numbers, center = Spin). */
  private static readonly GLOW_BONE_ORDER = [
    'number 100a', 'number 50a', 'number 20a', 'number 10a', 'number 2a', 'number 0.5a',
    'number 0.2a', 'Spin', 'number 0.2b', 'number 0.5b', 'number 3b', 'number 10b',
    'number 20b', 'number 50b', 'number 100b',
  ] as const;
  /** Hide the spine's baked glyphs (keep the animated glow cards) so the real number reads cleanly. */
  private static readonly HIDE_GLOW_BAKED_NUMBERS = true;
  /** Guards the global `Assets` alias registration so remounts don't re-add (and warn). */
  private static glowAssetsRegistered = false;
  /** Authored card width (px) used to derive a UNIFORM display scale (keeps the authored aspect). */
  private static readonly GLOW_REF_CARD_WIDTH = 82;
  /** Card width as a fraction of slot width — ~1 packs the glow cards edge-to-edge (tiny gaps). */
  private static readonly GLOW_WIDTH_FILL = 1.02;
  private static readonly GLOW_Y_OFFSET_RATIO = 0.52;

  /** Multiplier-label IMAGES (`img/multiplier_slot_text_<label>.png`) keyed by the slot's label. */
  private readonly multiplierTextTextures: Partial<Record<string, Sprite['texture']>> = {};
  /** Image-based slot labels (parallel to `slotLabels`); a slot uses the sprite OR the text, not both. */
  private slotLabelSprites: (Sprite | undefined)[] = [];
  /** Label image files (loaded once, matched to slots by `slot.labelText`). A label without an asset
   * falls back to a Pixi Text. `0.1` / `0.3` are the feature-free 1-ball board's own pockets (centre +
   * the two either side — see `ONE_BALL_BOARD_SLOT_MULTIPLIERS`); they share the same uniform scale and
   * placement as every other label, and being no wider than `100` they don't shrink the others. */
  private static readonly MULTIPLIER_TEXT_LABELS = [
    '0.1',
    '0.2',
    '0.3',
    '0.4',
    '1.5',
    '5',
    '20',
    '50',
    '100'
  ] as const;
  /** Label image height as a fraction of the slot body height (drives the shared scale). */
  private static readonly SLOT_TEXT_HEIGHT_RATIO = 0.72;
  /** Cap the (widest) label to this fraction of the slot width — applied uniformly to all labels. */
  private static readonly SLOT_TEXT_MAX_WIDTH_RATIO = 0.95;
  /** Horizontal center of the label within the slot (0.5 = dead center of `x..x+w`). */
  private static readonly SLOT_TEXT_X_RATIO = 0.4625;
  /** Vertical center of the label within the slot body (0.5 = dead center of `y..y+h`). */
  private static readonly SLOT_TEXT_Y_RATIO = 0.7;
  /** 1-BALL TIER ONLY — the centre pocket is a paying slot there (`0.1`) rather than the SPIN card, and
   * it sits on the wider centre tile: print it 25% larger than the shared label scale and dead-centre it
   * vertically in the slot body (the 0.7 ratio above is tuned for the narrow tiles). */
  private static readonly ONE_BALL_CENTER_LABEL_SCALE = 1.25;
  /** 0.61, not 0.5: the PAINTED centre tile (the glow spine's wide card) does not sit centred inside the
   * slot body — measured at 1920×1080 it spans 0.61 of `y..y+h` at its middle, so this ratio puts the
   * label's ink on the card's optical centre. Resolution-independent (both are fractions of the body). */
  private static readonly ONE_BALL_CENTER_LABEL_Y_RATIO = 0.61;
  /** Single scale applied to EVERY label image so they all match (computed per layout). */
  private uniformLabelScale = 1;
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
  /** Centroid of the featured (coin) pegs — coin sprites are pulled toward it (visual only). */
  private featuredCentroidX = 0;
  private featuredCentroidY = 0;
  /** How far each coin SPRITE is pulled toward the cluster centroid (0 = on its peg, 1 = at center). */
  private static readonly COIN_CLUSTER_PULL = 0.25;
  /** Coin diameter as a fraction of the lane spacing — scales the coins with the board at any viewport. */
  private static readonly COIN_SIZE_FACTOR = 0.9;
  private readonly pegsByRow = new Map<number, Peg[]>();
  private featuredPegKeys = new Set<string>();
  /** Per-row regular (non-featured) pegs — precomputed so the bounce hot path avoids `.filter` allocations. */
  private readonly regularPegsByRow = new Map<number, Peg[]>();
  /** Rows that contain at least one featured peg — O(1) replacement for `rowHasFeaturedPeg` scans. */
  private readonly featuredRowsSet = new Set<number>();
  /** Featured-peg horizontal span per row — precomputed so cluster queries avoid `.filter`/`.map`/spread. */
  private readonly clusterSpanByRow = new Map<number, { minX: number; maxX: number }>();
  /** Reused scratch buffer for ball-collision resolution (avoids a per-frame `filter` allocation). */
  private readonly collisionScratch: Ball[] = [];

  
  

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
  /** Pegs in the top row; each row below adds one (top 6 → bottom `rows-1+6` = 17 at 12 rows). */
  private static readonly TOP_ROW_PEGS = 6;
  /**
   * Fixed VISUAL peg-row count. Decoupled from the math `rowCount` (kept for the server contract) —
   * the ball is choreographed to its server slot index (`calculatePath` snaps to the slot center),
   * so peg rows are purely cosmetic. Holds the 6→17 pyramid stable regardless of the rowCount passed.
   */
  private static readonly VISUAL_ROW_COUNT = 12;
  /**
   * Regular pegs to OMIT entirely (zero-based `row:col`) — clears the interior of the coin-peg
   * triangle so the enlarged coins read as one tight cluster. No peg is added back in their place.
   */
  private static readonly REMOVED_PEG_KEYS = new Set(['3:4', '4:4', '4:5']);
  private animTickerBound = (): void => this.animateFrame();
  private tickerRegistered = false;
  /** Fixed physics step used when manually advancing a backgrounded tab (matches ~60fps rAF). */
  private static readonly HIDDEN_FRAME_MS = 1000 / 60;
  /** Cap on physics steps per background tick, so a long hidden stretch can't fast-forward minutes. */
  private static readonly HIDDEN_MAX_STEPS_PER_TICK = 120;
  /** Sub-frame leftover carried between background ticks so paced advancement stays accurate. */
  private hiddenStepCarryMs = 0;
  private readonly BASE_VIEWPORT_WIDTH = 1920;
  private readonly MAX_RENDER_RESOLUTION = 2;

  /**
   * Spawn airspace above the host box, as a fraction of host height. Enough to clear the skull's
   * mouth on the tightest layout (portrait phone, where the mouth sits ~9px above the host and the
   * ball is ~5px across); desktop has room to spare. Costs one extra strip of buffer, nothing else.
   */
  private static readonly TOP_AIRSPACE_RATIO = 0.075;

  /**
   * How far to one side of the cavity centre a ball is born, per unit of `SpawnDirection`, as a
   * fraction of top-row peg spacing. Measured off the reference game (inout Aztec), whose balls
   * first appear 0.34–1.08 peg-spacings out from centre (mean 0.75) and never in between: the two
   * strengths here span that range, and `spawnLaneBias` then carries the ball further the same way.
   */
  private static readonly SPAWN_MOUTH_OFFSET_RATIO = 0.38;

  /**
   * The sideways kick given to a ball as it leaves the mouth, per unit of `SpawnDirection`, as a
   * fraction of top-row peg spacing.
   *
   * The reference game front-loads the throw: its balls cover ~20px sideways in the first few frames
   * while dropping only ~3px, then arc over and fall. Aiming straight from the mouth at the peg-field
   * entry instead spreads that sideways motion evenly down the whole airspace, which reads as a drop
   * from an off-centre point rather than a throw — so the launch gets its own apex (below), and the
   * entry point is left exactly where it was.
   */
  private static readonly SPAWN_LAUNCH_BURST_RATIO = 0.22;

  /** How far down the airspace the launch apex sits, as a fraction of mouth → peg-field entry. */
  private static readonly SPAWN_LAUNCH_APEX_FALL = 0.28;

  /** Ball size the instant it appears in the mouth, as a fraction of its real radius. */
  private static readonly EMERGE_MIN_SCALE = 0.12;

  /** Ball brightness the instant it appears — near-black, so it reads as deep inside the skull. */
  private static readonly EMERGE_MIN_BRIGHTNESS = 0.14;

  /** Emergence finishes once the ball has fallen this many of its own radii clear of the mouth. */
  private static readonly EMERGE_FALL_RADII = 2.4;
  private frameTick = 0;
  private slotLabelFontSize = 14;
  private slotLabelLetterSpacingPx = 0;
  private slotLabelStrokeWidth = 1;

  /**
   * Memoized board geometry. The pyramid layout is constant for the whole duration of a
   * drop, but the derived getters (peg/ball radius, lane spacing) are O(rows²) and were
   * recomputed for every ball on every frame. We cache the results keyed on the raw layout
   * inputs; the values are recomputed only when one of those inputs actually changes
   * (rebuild / resize / window change), which never happens mid-drop. This is a pure
   * memoization — the numbers produced are identical to the live computation, so ball
   * physics and trajectories are unchanged.
   */
  private geomValid = false;
  private geomCW = -1;
  private geomCH = -1;
  private geomRows = -1;
  private geomTWS = -1;
  private geomBWS = -1;
  private geomHS = -1;
  private geomWinW = -1;
  private geomWinH = -1;
  private geomPegSpacing = 0;
  private geomBasePegSpacingX = 0;
  private geomHScale = 1;
  private geomMinPegSpacingX = 0;
  private geomPegRadius = 2;
  private geomBallRadius = 2;
  private geomPegSpacingXByRow: number[] = [];

  private vw(vwValue: number): number {
    if (typeof window === 'undefined') {
      return (this.BASE_VIEWPORT_WIDTH * vwValue) / 100;
    }
    return (window.innerWidth * vwValue) / 100;
  }

  /**
   * Host-height (@1920×1080) equal to 1vw of viewport width. The board's vertical metrics were
   * authored in `vw()`, which is fine only while the host tracks viewport width. It doesn't: the host
   * is a 96:55 fit of the game area, so on a wide viewport it's height-constrained and its size stops
   * following the width. `vwHost()` re-bases a design-`vw` amount onto the host's OWN height so the
   * board keeps a constant proportion — same scale/position inside the game-area frame at every size.
   * Derivation: at the 1920×1080 reference the measured host is ~633px tall (fit-height × 0.54 ×
   * height-scale 1.2 × the container's 1.1 scale) while `vw(1)` = 19.2px; dividing out the height-scale
   * (callers re-apply it, as they did with `vw()`) gives 19.2 / (633 / 1.2) ≈ 0.0364 host-heights/vw.
   */
  private static readonly BOARD_VW_TO_HOST_H = 0.0364;

  /** Host-relative stand-in for `this.vw(vwValue)` used by the board's vertical geometry. */
  private vwHost(vwValue: number): number {
    const heightScale = this.heightScale > 0 ? this.heightScale : 1;
    const baseHostHeight = this.containerHeight / heightScale;
    // Before the host has reported a real size, fall back to the viewport-based value.
    if (!Number.isFinite(baseHostHeight) || baseHostHeight <= 0) return this.vw(vwValue);
    return baseHostHeight * vwValue * PlinkoEngine.BOARD_VW_TO_HOST_H;
  }

  get elementScale(): number {
    return this.BASE_ROWS / this.rows;
  }

  /**
   * `pegSpacing` (px) reference that sets the peg-bounce height. The bounce arc peak is
   * `bounceAmplitude / BOUNCE_REFERENCE_SPACING` of a row gap (~0.33 of a gap on desktop),
   * constant across viewports. LOWER this to bounce higher, raise it to bounce lower.
   */
  private static readonly BOUNCE_REFERENCE_SPACING = 30;

  /**
   * Viewport scale for peg-bounce MOTION (arc height, lateral drift, vertical settle/impulse).
   * The bounce must track the board's vertical row spacing so the ball rises the same fraction
   * of a row gap at EVERY viewport. These terms previously used `elementScale`, which is a
   * constant (the visual row count is fixed at VISUAL_ROW_COUNT), so the bounce was a fixed
   * pixel height — too tall on short boards, too short on tall ones. Tying it to `pegSpacing`
   * (which already scales with the viewport) makes the bounce scale with the viewport too.
   */
  private get bounceScale(): number {
    const s = this.pegSpacing / PlinkoEngine.BOUNCE_REFERENCE_SPACING;
    return Number.isFinite(s) && s > 0 ? s : this.elementScale;
  }

  /** Normal-mode `animationSpeed` baseline (mirrors SIM_SPEED.normal in game-logic/constants). */
  private static readonly NORMAL_ANIMATION_SPEED = 0.7;
  /** Floor on the speed-compressed bounce duration so a fast-mode hop stays long enough to read. */
  private static readonly MIN_FAST_BOUNCE_MS = 90;

  /**
   * How many times faster than NORMAL play the sim is running (1 in normal, ~3.4 in Fast Game mode
   * where animationSpeed = 2.4). Used ONLY to compress the bounce TIMING (duration + cooldown) so a
   * hop still spans ~one row and the ball bounces on (nearly) every peg at speed — like normal mode —
   * instead of holding one long arc across several rows. The bounce shape/depth is untouched, so
   * bounces stay crisp, and normal mode (factor 1) is unchanged. Clamped to ≥ 1 so it never stretches.
   */
  private get simSpeedFactor(): number {
    const f = this.animationSpeed / PlinkoEngine.NORMAL_ANIMATION_SPEED;
    return Number.isFinite(f) && f >= 1 ? f : 1;
  }

  /** Measured host height (includes CSS `--plinko-area-height-scale` on the host element). */
  private get layoutHeight(): number {
    return this.containerHeight;
  }

  get pegRadius(): number {
    this.ensureGeom();
    return this.geomPegRadius;
  }

  get ballRadius(): number {
    this.ensureGeom();
    return this.geomBallRadius;
  }

  /**
   * Recompute and cache the O(rows²) board geometry when (and only when) a raw layout
   * input changed since the last call. During an active drop none of these inputs move,
   * so every getter access after the first is an 8-field comparison and a field read.
   */
  private ensureGeom(): void {
    const winW = typeof window !== 'undefined' ? window.innerWidth : 0;
    const winH = typeof window !== 'undefined' ? window.innerHeight : 0;
    if (
      this.geomValid &&
      this.geomCW === this.containerWidth &&
      this.geomCH === this.containerHeight &&
      this.geomRows === this.rows &&
      this.geomTWS === this.topWidthScale &&
      this.geomBWS === this.bottomWidthScale &&
      this.geomHS === this.heightScale &&
      this.geomWinW === winW &&
      this.geomWinH === winH
    ) {
      return;
    }

    const pegSpacing = this.basePegSpacingY * this.verticalPegSpacingScale;
    // Horizontal lane spacing. The portrait CSS layout (.game-root--mobile) is shared by a real
    // phone AND a narrow desktop window, so the board geometry must NOT depend on UA — otherwise
    // a phone (isMobile) renders a narrower board than the tuned desktop-portrait. Use one value
    // everywhere; hScale below still shrinks lanes if a row exceeds the host width.
    const basePegSpacingX = pegSpacing * 1.5;

    // horizontalPegSpacingScale (shrink lanes when the widest row exceeds host width).
    let hScale = 1;
    if (this.containerWidth > 0 && this.rows > 0) {
      const availableWidth = this.containerWidth * 0.99;
      let maxNaturalSpan = 0;
      for (let row = 0; row < this.rows; row++) {
        const pegsInRow = row + PlinkoEngine.TOP_ROW_PEGS;
        maxNaturalSpan = Math.max(
          maxNaturalSpan,
          (pegsInRow - 1) * basePegSpacingX * this.rowWidthScale(row)
        );
      }
      if (maxNaturalSpan > availableWidth && maxNaturalSpan > 0) {
        hScale = availableWidth / maxNaturalSpan;
      }
    }

    const byRow = new Array<number>(Math.max(0, this.rows));
    let minX = Infinity;
    for (let row = 0; row < this.rows; row++) {
      const v = basePegSpacingX * this.rowWidthScale(row) * hScale;
      byRow[row] = v;
      if (v < minX) minX = v;
    }
    if (!Number.isFinite(minX)) minX = basePegSpacingX;

    const prRaw = this.layoutHeight * 0.0135 * this.elementScale;
    const pegRadius = !Number.isFinite(prRaw) || prRaw <= 0 ? 2 : Math.max(2, prRaw);

    const desiredRadius = this.layoutHeight * 0.0245 * this.elementScale;
    const laneSafeRadius = Math.max(1, (minX - pegRadius * 2) * 0.46);
    const brRaw = Math.min(desiredRadius, laneSafeRadius);
    const ballRadius = !Number.isFinite(brRaw) || brRaw <= 0 ? 2 : Math.max(2, brRaw) * 0.9;

    this.geomPegSpacing = pegSpacing;
    this.geomBasePegSpacingX = basePegSpacingX;
    this.geomHScale = hScale;
    this.geomPegSpacingXByRow = byRow;
    this.geomMinPegSpacingX = minX;
    this.geomPegRadius = pegRadius;
    this.geomBallRadius = ballRadius;

    this.geomCW = this.containerWidth;
    this.geomCH = this.containerHeight;
    this.geomRows = this.rows;
    this.geomTWS = this.topWidthScale;
    this.geomBWS = this.bottomWidthScale;
    this.geomHS = this.heightScale;
    this.geomWinW = winW;
    this.geomWinH = winH;
    this.geomValid = true;
  }

  get slotBounceHeight(): number {
    // Use the same scaling method as pegs/balls.
    return this.layoutHeight * 0.018 * this.elementScale;
  }

  // Vertical margins frame the pyramid inside the host. Kept UA-independent so the shared portrait
  // layout (real phone + narrow desktop window) lands the board at the same height; a phone-only
  // 0 margin previously made the board sit higher than the tuned desktop-portrait.
  get topMargin(): number {
    return Math.max(this.vwHost(1.56) * this.heightScale, this.layoutHeight * 0.01);
  }

  get bottomMargin(): number {
    return Math.max(this.vwHost(1.56) * this.heightScale, this.layoutHeight * 0.01);
  }

  get slotHeight(): number {
    return Math.max(this.vwHost(1.55) * this.heightScale, this.layoutHeight * 0.075);
  }

  private get basePegSpacingY(): number {
    if (this.rows <= 1) return this.vwHost(2.1) * this.heightScale;
    const availableHeight =
      this.layoutHeight -
      this.topMargin -
      this.bottomMargin -
      this.slotHeight -
      this.vwHost(1.05) * this.heightScale;
    /** Flex can transiently shrink height → negative spacing and invalid peg rows. */
    const raw = availableHeight / (this.rows + 0.5);
    if (!Number.isFinite(raw)) return this.vwHost(2.1) * this.heightScale;
    const safe = raw > 0 ? raw : this.vwHost(2.5) * this.heightScale;
    return Math.max(this.vwHost(1.05) * this.heightScale, safe);
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
    this.ensureGeom();
    return this.geomPegSpacing;
  }

  private get basePegSpacingX(): number {
    this.ensureGeom();
    return this.geomBasePegSpacingX;
  }

  /** Interpolate top → bottom width scale across peg rows. */
  private rowWidthScale(row: number): number {
    if (this.rows <= 1) return this.bottomWidthScale;
    const t = Math.max(0, Math.min(1, row / (this.rows - 1)));
    return this.topWidthScale + (this.bottomWidthScale - this.topWidthScale) * t;
  }

  /** Shrinks horizontal lane spacing when the widest row exceeds the host width. */
  private get horizontalPegSpacingScale(): number {
    this.ensureGeom();
    return this.geomHScale;
  }

  pegSpacingXForRow(row: number): number {
    this.ensureGeom();
    const v = this.geomPegSpacingXByRow[row];
    if (v !== undefined) return v;
    return this.geomBasePegSpacingX * this.rowWidthScale(row) * this.geomHScale;
  }

  /** Bottom-row spacing — used where a single lane width is needed. */
  get pegSpacingX(): number {
    return this.pegSpacingXForRow(Math.max(0, this.rows - 1));
  }

  private get minPegSpacingX(): number {
    this.ensureGeom();
    return this.geomMinPegSpacingX;
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
    this.glowSpine?.destroy({ children: true });
    this.glowSpine = undefined;
    this.glowSpineReady = false;
    this.glowBoneBySlotIndex = [];
    this.glowSpinSlot = undefined;
    this.glowSpinDefaultAttachment = null;
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
    this.slotSpineLayer.zIndex = 2.05;
    this.bulletsLayer.zIndex = 2.5;
    this.ballsGraphics.zIndex = 2.6;
    this.labelLayer.zIndex = 4;

    this.world.addChild(this.pegGraphics);
    this.world.addChild(this.featuredPegLayer);
    this.world.addChild(this.slotAssetLayer);
    this.world.addChild(this.slotSpineLayer);
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

      const textLabels = PlinkoEngine.MULTIPLIER_TEXT_LABELS;
      const textTex = await Promise.all(
        textLabels.map((label) => loadOptional(staticUrl(`img/multiplier_slot_text_${label}.png`)))
      );
      textLabels.forEach((label, i) => {
        if (textTex[i]) this.multiplierTextTextures[label] = textTex[i];
      });
    } catch {
      this.ballTexture = undefined;
      this.coinPegTexture = undefined;
      this.multiplierSlotSpinTexture = undefined;
    }
    this.multiplierSlotAssetsReady = !!this.multiplierSlotSpinTexture;
    if (!this.multiplierSlotAssetsReady) {
      console.warn('[PlinkoEngine] multiplier slot images failed to load');
    }

    await this.loadGlowSpine();

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
      Math.floor(this.vw(22) * ((this.rows + PlinkoEngine.TOP_ROW_PEGS) / 8)),
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
    this.computeUniformLabelScale();
    this.refreshSlotLabelAppearance();
    this.fitWorldToSlotRow();
    this.layoutGlowSpine();
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
    // Side breathing room = one peg diameter, derived from the UNFLOORED peg size so it stays a
    // constant fraction of the board at every host size. The old `Math.max(this.pegRadius * 2, 8)`
    // leaned on the pegRadius floor (min 2px) plus a fixed 8px floor; on a small popout host (e.g.
    // 400×225) both balloon relative to the ~144px-wide board, over-margining the world into an extra
    // uniform shrink. Because that shrink is anchored at the top, the slack fell to the bottom and
    // dropped the board away from the game area. This matches the old value at desktop sizes (where
    // pegRadius wasn't floored and `pegRadius * 2` already won) and scales down proportionally below.
    const margin = this.containerHeight * 0.0135 * this.elementScale * 2;
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

  /**
   * Render offset — the board sits lower inside a taller canvas so the spawn airspace above the
   * top peg stays visible. Applied UA-independently: the portrait CSS layout is shared by a real
   * phone and a narrow desktop window, so gating this on isMobile() made the phone drop the offset
   * and float the board higher than the tuned desktop-portrait. One value keeps them identical.
   */
  private getBoardViewportYOffset(): number {
    return this.layoutHeight * 0.085;
  }

  /** Buffer height before any spawn airspace — the baseline the canvas squash is defined against. */
  private get baseRendererHeight(): number {
    return Math.ceil(this.containerHeight + this.getBoardViewportYOffset());
  }

  /**
   * Extra world rows kept ABOVE the host box, purely so the skull-mouth spawn is on-canvas: the
   * mouth is painted above the board (~9px above the host's top edge on a phone), so a ball thrown
   * from it would otherwise be clipped at the buffer edge instead of rising into view.
   *
   * Whole buffer pixels only — `syncCanvasViewportStyle` cancels this exactly, and the cancellation
   * is only exact while the buffer grows by the same integer the world shifts down by.
   */
  private getTopAirspace(): number {
    return Math.round(this.layoutHeight * PlinkoEngine.TOP_AIRSPACE_RATIO);
  }

  private getWorldViewportYOffset(): number {
    return this.getBoardViewportYOffset() + this.getTopAirspace();
  }

  /** Pixi buffer height: host size plus viewport offset so bottom slots are not clipped. */
  private getRendererHeight(): number {
    return this.baseRendererHeight + this.getTopAirspace();
  }

  /**
   * Show the spawn airspace ABOVE the host box without moving the board a single pixel.
   *
   * The canvas box grows by a fraction `p = airspace / baseBuffer` of the host's height and is
   * pulled up by exactly that much, so its bottom edge stays on the host's bottom edge. Writing
   * `hostH` for the host's height and `k` for the squash the board is tuned around
   * (`hostH / baseBuffer` — the buffer has always been taller than the box CSS paints it into):
   *
   *   canvasHeight = hostH * (1 + p)      canvasTop = hostTop - hostH * p
   *   scale        = canvasHeight / buffer = hostH * (baseBuffer + airspace) / baseBuffer
   *                                          ÷ (baseBuffer + airspace)      = k   ← unchanged
   *   screenY(w)   = canvasTop + (w + boardOffset + airspace) * k
   *                = hostTop + (w + boardOffset) * k                        ← unchanged
   *
   * Expressed as a PERCENTAGE of the host box — the same thing the canvas's `height: 100%` already
   * resolves against. Client rects are measured after the game-area's `scale()` transform while CSS
   * boxes are laid out before it, so a px value taken from a rect would come out scaled; a
   * percentage sidesteps that (and any px rounding) entirely.
   *
   * Driven through CSS vars because the stylesheet's `height: 100% !important` (which is there to
   * override what Pixi's `autoDensity` writes inline) would otherwise win.
   */
  private syncCanvasViewportStyle(): void {
    const base = this.baseRendererHeight;
    if (!(base > 0)) return;
    const growPct = (this.getTopAirspace() / base) * 100;
    this.hostElement.style.setProperty('--plinko-canvas-height', `${100 + growPct}%`);
    this.hostElement.style.setProperty('--plinko-canvas-top', `${-growPct}%`);
  }

  /**
   * Keep the board visually lower inside a taller canvas so high spawn remains visible.
   * This is a render offset only; physics/layout coordinates remain unchanged.
   */
  private updateWorldViewportOffset(): void {
    this.world.position.set(0, this.getWorldViewportYOffset());
    this.syncCanvasViewportStyle();
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

  /**
   * 1-ball rapid tier: the center pocket is a plain 0× slot (bonus/free-spin features are hidden), so
   * the "SPIN" wording is replaced by a printed "0". Toggling re-runs the slot rebuild so the center
   * gains/loses its label and the glow spine's baked "SPIN" glyph is hidden/restored.
   */
  setRapidSingleBall(value: boolean): void {
    if (this.rapidSingleBall === value) return;
    this.rapidSingleBall = value;
    this.applyCenterSpinGlyphVisibility();
    // Rebuild the slots directly rather than via `refreshLayoutSync()`: a ball-per-drop switch leaves
    // the viewport dimensions unchanged, so `refreshLayoutSync` would hit its dedupe guard and skip the
    // slot rebuild — leaving the center "0" label (or the restored "SPIN" glyph) out of sync.
    this.rebuildScene();
  }

  /** Hide (rapid 1-ball) or restore the glow spine's center "SPIN" glyph. Safe to call before load. */
  private applyCenterSpinGlyphVisibility(): void {
    const slot = this.glowSpinSlot;
    if (!slot) return;
    // Spine 4.3 exposes the slot's attachment via `slot.pose` (same place bone transforms live).
    slot.pose.setAttachment(this.rapidSingleBall ? null : this.glowSpinDefaultAttachment);
  }

  /** Spin uses spin asset; neighbors use tier 1..7 by distance from center. */
  private getMultiplierSlotTextureForIndex(idx: number): Sprite['texture'] | undefined {
    const middle = this.getMiddleSlotIndex();
    if (idx === middle) return this.multiplierSlotSpinTexture;
    const distance = Math.abs(idx - middle);
    const tier = Math.min(7, Math.max(1, distance));
    return this.multiplierSlotTextures[tier];
  }

  /** True when the glow spine loaded and the current board matches its authored slot count. */
  private get glowSpineActive(): boolean {
    return (
      this.glowSpineReady &&
      !!this.glowSpine &&
      this.slots.length === PlinkoEngine.GLOW_SPINE_SLOT_COUNT
    );
  }

  /**
   * Load the glow-number spine once and add it to the slot layer. The skeleton is a single strip
   * of 15 numbers; we drive each number's bone to its slot center in `layoutGlowSpine`. Baked
   * glyphs are removed (the real multiplier is printed on top by the label layer) while the
   * animated glow "cards" (the `Rectangle*` slots) are kept. Loading is best-effort: on any
   * failure the board falls back to the existing slot sprites + labels.
   */
  private async loadGlowSpine(): Promise<void> {
    try {
      const asset = getGlowNumbersAsset();
      const atlasAlias = `${asset.id}-atlas`;
      const skeletonAlias = `${asset.id}-skeleton`;
      // `Assets` is a global singleton; register the aliases only once across engine remounts
      // (re-adding the same key logs a Pixi resolver "overwriting" warning).
      if (!PlinkoEngine.glowAssetsRegistered) {
        Assets.add({ alias: atlasAlias, src: asset.atlas, data: { images: asset.images } });
        Assets.add({ alias: skeletonAlias, src: asset.skeleton });
        PlinkoEngine.glowAssetsRegistered = true;
      }
      await Assets.load([atlasAlias, skeletonAlias]);

      const atlas = Assets.get(atlasAlias);
      const skeletonSource = Assets.get(skeletonAlias);
      if (!atlas || !skeletonSource) {
        console.warn('[PlinkoEngine] glow_numbers spine assets missing');
        return;
      }

      const skeletonData = readSkeletonData(asset, atlas, skeletonSource);
      const spine = new Spine({ skeletonData, autoUpdate: true });
      spine.state.setAnimation(0, asset.animation, true);

      this.glowBoneBySlotIndex = PlinkoEngine.GLOW_BONE_ORDER.map(
        (name) => spine.skeleton.findBone(name) ?? undefined
      );

      if (PlinkoEngine.HIDE_GLOW_BAKED_NUMBERS) {
        for (const slot of spine.skeleton.slots) {
          const name = slot.data.name;
          // Keep the animated glow cards (`Rectangle*`) and the center "spin" glyph; drop the
          // baked number glyphs so the printed real multiplier is the only number shown.
          const keep = name.startsWith('Rectangle') || name === 'spin' || name === 'UPDATED WALL SHIP';
          if (!keep) spine.skeleton.setAttachment(name, null);
        }
      }

      // Capture the center "SPIN" glyph so it can be hidden on the 1-ball rapid tier (plain 0× pocket).
      this.glowSpinSlot = spine.skeleton.findSlot('spin') ?? undefined;
      this.glowSpinDefaultAttachment = this.glowSpinSlot?.pose.getAttachment() ?? null;

      spine.visible = false;
      this.slotSpineLayer.addChild(spine);
      this.glowSpine = spine;
      this.glowSpineReady = true;
      // Honor a rapid-mode flag set before the spine finished loading.
      this.applyCenterSpinGlyphVisibility();
    } catch (err) {
      console.warn('[PlinkoEngine] glow_numbers spine failed to load', err);
      this.glowSpineReady = false;
    }
  }

  /**
   * Position the glow spine so each number sits exactly on its slot center (same x as the printed
   * label) and on the slot row. One uniform scale controls glyph/card size; horizontal placement
   * is per-bone (`bone.x = slotCenterX / scale`) so the authored center-wider spacing is replaced
   * by the engine's responsive, peg-aligned slot centers. Bone overrides persist across frames
   * (the spine's animation only drives slot colors, never bone transforms).
   */
  private layoutGlowSpine(): void {
    const spine = this.glowSpine;
    if (!spine) return;
    if (!this.glowSpineActive) {
      spine.visible = false;
      return;
    }

    const h = this.slotHeight * 0.82;
    const rowY = this.slots[0].y + h * PlinkoEngine.GLOW_Y_OFFSET_RATIO;
    // UNIFORM scale driven by slot width: cards track slot width (GLOW_WIDTH_FILL controls the gaps)
    // while keeping the authored card aspect (no vertical stretch). `slots[0]` is a corner
    // (non-center) slot, so its width is the base unit width.
    const unitWidth = this.slots[0].width;
    const scale = (unitWidth * PlinkoEngine.GLOW_WIDTH_FILL) / PlinkoEngine.GLOW_REF_CARD_WIDTH;
    this.glowScale = scale;

    spine.visible = true;
    spine.scale.set(scale);
    spine.position.set(0, rowY);

    for (let i = 0; i < this.slots.length; i++) {
      const bone = this.glowBoneBySlotIndex[i];
      if (!bone) continue;
      // Spine 4.3 exposes the local transform via `bone.pose` (set by application code).
      bone.pose.setPosition(this.slots[i].centerX / scale, 0);
    }
    spine.skeleton.updateWorldTransform(Physics.update);
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
    for (const s of this.slotLabelSprites) {
      s?.destroy();
    }
    this.slotLabelSprites = [];

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

      // The center pocket normally shows the "SPIN" glyph (no printed label). On the 1-ball rapid tier
      // it becomes a plain 0× slot, so fall through to build a "0" text label instead.
      if (this.isSpinSlotIndex(i) && !this.rapidSingleBall) {
        this.slotLabels.push(undefined);
        this.slotLabelSprites.push(undefined);
        continue;
      }

      // Prefer the label IMAGE (`multiplier_slot_text_<label>.png`); fall back to text if absent.
      const labelTexture = this.multiplierTextTextures[this.slots[i].labelText];
      if (labelTexture) {
        const labelSprite = new Sprite(labelTexture);
        // Centered anchor so the label sits in the middle of the slot.
        labelSprite.anchor.set(0.5, 0.5);
        this.labelLayer.addChild(labelSprite);
        this.slotLabelSprites.push(labelSprite);
        this.slotLabels.push(undefined);
        continue;
      }
      this.slotLabelSprites.push(undefined);

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
    const prevWidth = this.containerWidth || this.lastWidth;
    const prevHeight = this.containerHeight || this.lastHeight;
    const { width, height } = this.getContainerSize();
    // Size the buffer exactly as `resizeCanvasToContainer` does — including the viewport offset and
    // spawn airspace. Resizing to the bare host height here dropped the airspace right when balls
    // spawn, and left `lastHeight` in units the other path never matches (so each undid the
    // other's dedupe and the buffer flip-flopped until a later pass settled it).
    this.containerWidth = width;
    this.containerHeight = height;
    const renderHeight = this.getRendererHeight();
    const winW = typeof window !== 'undefined' ? window.innerWidth : 0;
    const winH = typeof window !== 'undefined' ? window.innerHeight : 0;
    if (
      width === this.lastWidth &&
      renderHeight === this.lastHeight &&
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
    this.app.renderer.resize(width, renderHeight);
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
      const pegsInRow = row + PlinkoEngine.TOP_ROW_PEGS;
      const rowSpacingX = this.pegSpacingXForRow(row);
      for (let col = 0; col < pegsInRow; col++) {
        if (PlinkoEngine.REMOVED_PEG_KEYS.has(`${row}:${col}`)) continue;
        const pegX = centerX - ((pegsInRow - 1) * rowSpacingX) / 2 + col * rowSpacingX;
        this.pegs.push({
          x: pegX,
          y: rowY,
          row,
          col,
          bounceEffect: 0,
          bounceTime: 0,
          isTouched: false,
          key: `${row}:${col}`,
          isFeatured: false
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
    this.indexFeaturedPegs();
  }

  /**
   * Precompute featured-peg lookups that the per-frame physics hot path otherwise rebuilt on
   * every call (string-keyed Set lookups, `.filter` arrays, cluster min/max spreads). Pegs are
   * static between rebuilds, so this runs once per layout and the hot path becomes allocation-free.
   */
  private indexFeaturedPegs(): void {
    this.regularPegsByRow.clear();
    this.featuredRowsSet.clear();
    this.clusterSpanByRow.clear();

    let centroidX = 0;
    let centroidY = 0;
    let featuredCount = 0;
    for (const peg of this.pegs) {
      peg.isFeatured = this.featuredPegKeys.has(peg.key);
      if (peg.isFeatured) {
        this.featuredRowsSet.add(peg.row);
        centroidX += peg.x;
        centroidY += peg.y;
        featuredCount++;
      }
    }
    this.featuredCentroidX = featuredCount ? centroidX / featuredCount : 0;
    this.featuredCentroidY = featuredCount ? centroidY / featuredCount : 0;

    for (const [row, rowPegs] of this.pegsByRow) {
      const regular: Peg[] = [];
      let minX = Infinity;
      let maxX = -Infinity;
      let hasFeatured = false;
      for (const peg of rowPegs) {
        if (peg.isFeatured) {
          hasFeatured = true;
          if (peg.x < minX) minX = peg.x;
          if (peg.x > maxX) maxX = peg.x;
        } else {
          regular.push(peg);
        }
      }
      this.regularPegsByRow.set(row, regular);
      if (hasFeatured) this.clusterSpanByRow.set(row, { minX, maxX });
    }
  }

  private generateSlots(): void {
    this.slots = [];
    if (!this.app || !this.coefficients.length) return;

    const centerX = this.containerWidth / 2;
    const bottomY = this.topMargin + (this.rows + 0.5) * this.pegSpacing - this.vwHost(0.52);
    const slotsCount = this.coefficients.length;
    const lastRowPegs = this.rows - 1 + PlinkoEngine.TOP_ROW_PEGS;
    const bottomSpacingX = this.pegSpacingXForRow(this.rows - 1);
    const totalWidth = (lastRowPegs - 1) * bottomSpacingX * this.slotWidthScale;
    const availableWidth = this.containerWidth * 0.99;
    let finalTotalWidth = totalWidth;
    if (totalWidth > availableWidth) {
      finalTotalWidth = availableWidth;
    }
    const middleIndex = Math.floor(slotsCount / 2);
    // Wider center to fit the spine's broader SPIN card (its authored width ~2× a number card).
    const centerWeight = 1.95;
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
        // The centre pocket normally shows the spine's "SPIN" glyph (empty label). On the feature-free
        // 1-ball tier it is an ordinary paying pocket, so print its own board value there.
        labelText:
          i === middleIndex && !this.rapidSingleBall
            ? ''
            : String(formatCoefficientLabel(coefficient)),
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
   * Gold featured (coin) pegs as a SPREAD downward triangle (per the reference art): the top two
   * coins are separated by a regular peg and the bottom drops two rows. Zero-based keys for the
   * 12-row / 6-top layout: row 3 cols 3 & 5 (straddle center col 4, gap between), row 5 col 5
   * (center, two rows below) — occupying more pegs to the left and below than a tight cluster.
   */
  private getFeaturedPegKeys(): Set<string> {
    const fixed: Array<[number, number]> = [
      [3, 3],
      [3, 5],
      [5, 5]
    ];
    const keys = new Set<string>();
    for (const [row, col] of fixed) {
      if (row >= 0 && row < this.rows && col >= 0 && col < row + PlinkoEngine.TOP_ROW_PEGS) {
        keys.add(`${row}:${col}`);
      }
    }
    return keys;
  }

  /** Launch side + strength from a unit random. Four buckets, none of them centre. */
  private spawnDirectionFromUnit(unit: number): SpawnDirection {
    const bucket = Math.floor(Math.min(0.9999999, Math.max(0, unit)) * 4);
    if (bucket === 0) return -2; // far left
    if (bucket === 1) return -1; // left
    if (bucket === 2) return 1; // right
    return 2; // far right
  }

  private randomSpawnDirection(): SpawnDirection {
    return this.spawnDirectionFromUnit(Math.random());
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
    return peg.isFeatured;
  }

  private rowHasFeaturedPeg(row: number): boolean {
    return this.featuredRowsSet.has(row);
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
    return this.clusterSpanByRow.get(row) ?? null;
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
    const regular = this.regularPegsByRow.get(row) ?? [];
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
      ? this.regularPegsByRow.get(row) ?? rowPegs.filter((peg) => !this.isFeaturedPeg(peg))
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
    const regularPegs = this.regularPegsByRow.get(pathPoint.row) ?? rowPegs;
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
    // Thrown out of the skull's mouth, which is painted above the board; peg/slot layout unchanged.
    const spawn = this.resolveSpawnPoint();
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
    // Which way this ball is thrown: far-left, left, right, far-right — never straight down.
    const spawnDirection = pathOptions?.deterministic
      ? this.spawnDirectionFromUnit(nextRandom())
      : this.randomSpawnDirection();
    // Keep launch direction consistent with first peg impact so the ball
    // doesn't visually launch to one side and immediately snap to the other.
    if (turns.length > 1) {
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

    // Born already off-centre, on the side it is thrown — the reference game never shows a ball
    // appearing in the middle of the cavity. `spawnLaneBias` is the larger offset, so the ball
    // keeps travelling outward from here rather than doubling back across the mouth. Clamped to the
    // black cavity (less a ball radius) so the spawn can't creep onto a tooth on a narrow layout.
    const cavityLimit = Number.isFinite(spawn.cavityHalfWidth)
      ? Math.max(0, spawn.cavityHalfWidth - this.ballRadius)
      : Number.POSITIVE_INFINITY;
    const spawnMouthOffset = Math.max(
      -cavityLimit,
      Math.min(
        cavityLimit,
        spawnDirection * this.pegSpacingXForRow(0) * PlinkoEngine.SPAWN_MOUTH_OFFSET_RATIO,
      ),
    );

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

    const spawnX = spawn.x + spawnMouthOffset;
    const entryY = this.topMargin - this.pegSpacing * 0.32;

    const path: PathPoint[] = [];
    // Born off-centre, inside the black cavity.
    path.push({
      x: spawnX,
      y: spawn.y,
      row: -1,
      closestPeg: null,
      bounceIntensity: 0,
      travelDir: 0,
    });
    // Thrown: most of the sideways motion happens here, in the first stretch below the mouth. The
    // ball overshoots the entry point and arcs back onto it, which is what a thrown ball does.
    path.push({
      x:
        spawnX +
        spawnDirection * this.pegSpacingXForRow(0) * PlinkoEngine.SPAWN_LAUNCH_BURST_RATIO,
      y: spawn.y + (entryY - spawn.y) * PlinkoEngine.SPAWN_LAUNCH_APEX_FALL,
      row: -1,
      closestPeg: null,
      bounceIntensity: 0,
      travelDir: 0,
    });
    // Peg-field entry — unchanged, so nothing downstream of the launch moves.
    path.push({
      x: centerX + spawnLaneBias + earlyAvoidBias * 0.12,
      y: entryY,
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
      emerge: 0,
      isDropping: true,
      currentPoint: 0,
      path,
      bouncedRows: new Set<number>(),
      lastBounceTime: 0,
      visitedPoints: new Set<number>(),
      // Spawn already moving at the mode's cruise speed so the airspace fall from spawn → first peg
      // isn't stuck at normal speed while the rest of the board runs fast. `normalSpeed * animationSpeed`
      // is the cruise base speed; the max() keeps normal mode's slightly-faster historical launch.
      currentSpeed: Math.max(
        this.pyramidConfig.normalSpeed,
        this.pyramidConfig.normalSpeed * this.animationSpeed
      ),
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

  /**
   * Advance the ball simulation while the tab is backgrounded. The browser pauses Pixi's ticker
   * (rAF) when the tab is hidden, which would freeze every in-flight drop and stall Autobet (the
   * round never settles, so the loop waits forever / times out). The board drives this off a
   * timer instead — but background timers are throttled (often to ≥1s), so we step enough fixed
   * 60fps physics frames to cover the real elapsed time. A drop therefore completes at roughly
   * the same wall-clock rate it would if visible, and `onBallDropped` fires so the round settles.
   * No-op when nothing is animating. Rendering is skipped (nothing is on screen); the ticker
   * repaints the current state when the tab becomes visible again.
   */
  advanceWhileHidden(deltaSeconds: number): void {
    if (!this.app || !this.isAnimating) return;
    const elapsedMs = this.hiddenStepCarryMs + Math.max(0, deltaSeconds) * 1000;
    let steps = Math.floor(elapsedMs / PlinkoEngine.HIDDEN_FRAME_MS);
    if (steps > PlinkoEngine.HIDDEN_MAX_STEPS_PER_TICK) {
      // Drop the backlog after a long stall so returning/odd timers can't fast-forward minutes.
      steps = PlinkoEngine.HIDDEN_MAX_STEPS_PER_TICK;
      this.hiddenStepCarryMs = 0;
    } else {
      this.hiddenStepCarryMs = elapsedMs - steps * PlinkoEngine.HIDDEN_FRAME_MS;
    }
    for (let i = 0; i < steps && this.isAnimating; i++) {
      this.animateFrame();
    }
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
              this.bounceScale;
            const directedDrift =
              ball.bounceTravelDir *
              this.pyramidConfig.bounceAmplitude *
              ball.driftMultiplier *
              0.132 *
              this.bounceScale *
              Math.sin(bounceProgress * Math.PI);
            const wobble =
              this.pyramidConfig.horizontalDrift *
              ball.driftMultiplier *
              0.18 *
              Math.sin(bounceProgress * Math.PI * 2) *
              this.bounceScale;
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

        // Emerging from the skull: driven by distance fallen clear of the mouth rather than by a
        // timer, so it costs no extra time and reads the same at any animation speed. Ratcheted
        // forward only — the ball must never appear to sink back into the mouth.
        if (ball.emerge < 1) {
          const span = this.ballRadius * PlinkoEngine.EMERGE_FALL_RADII;
          const fallen = ball.y - ball.path[0].y;
          const reached = span > 0 ? Math.max(0, Math.min(1, fallen / span)) : 1;
          if (reached > ball.emerge) ball.emerge = reached;
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
    const dropping = this.collisionScratch;
    dropping.length = 0;
    for (let i = 0; i < this.balls.length; i++) {
      const b = this.balls[i];
      if (b.isDropping && b.scale > 0) dropping.push(b);
    }
    if (dropping.length < 2) {
      dropping.length = 0;
      return;
    }

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
    // Drop ball references so the scratch buffer doesn't pin them after the burst settles.
    dropping.length = 0;
  }

  /**
   * Factor in (0, 1] that slows currentPoint advancement on path segments longer than one row gap,
   * keeping the ball's on-screen speed consistent regardless of segment length. Returns exactly 1
   * for normal (≤ one row) segments — i.e. everywhere a peg bounce happens — so only the long final
   * plunge into the slot is tamed; bounces and normal-mode feel are untouched. Floored so a very
   * long segment can never make the ball crawl.
   */
  private segmentSpeedNormalization(ball: Ball): number {
    const pathLen = ball.path.length;
    if (pathLen < 2) return 1;
    const segProgress = ball.currentPoint * (pathLen - 1);
    const segIdx = Math.min(pathLen - 2, Math.max(0, Math.floor(segProgress)));
    const segDeltaY = Math.abs(ball.path[segIdx + 1].y - ball.path[segIdx].y);
    const rowGap = this.pegSpacing;
    if (!(rowGap > 0) || segDeltaY <= rowGap) return 1;
    return Math.max(0.35, rowGap / segDeltaY);
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

    // Keep the ball's ON-SCREEN speed consistent across path segments of different lengths. Almost
    // every segment spans exactly one row gap, but the final segment (last peg row → slot center) is
    // ~2.3× longer and has no bounce, so advancing currentPoint at the same rate made the ball lurch
    // into the slot — the "sudden speed-up near the bottom / gold pegs" in Fast Game mode (the long
    // segment ran at ~3.8× a normal row's on-screen speed). Slow the advance on longer-than-a-row
    // segments so the descent stays smooth; segments at/under one row gap are unaffected (factor = 1),
    // so peg bounces and normal-mode feel are unchanged.
    ball.currentPoint += ball.currentSpeed * this.segmentSpeedNormalization(ball);

    const maxLaneDrift = this.minPegSpacingX * 0.28;
    ball.velocityX = Math.max(-maxLaneDrift, Math.min(maxLaneDrift, ball.velocityX));
    if (!ball.isInBounce) {
      ball.velocityY += this.pyramidConfig.verticalGravity * this.bounceScale;
      ball.velocityY *= this.pyramidConfig.verticalDamping;
      const maxVerticalOffset = this.pyramidConfig.bounceAmplitude * this.bounceScale * 0.4;
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

  /**
   * Client (screen) px → world coords. Reads the canvas's live rect, so it already accounts for the
   * spawn airspace shift and the CSS squash without repeating either.
   */
  private clientPointToWorld(clientX: number, clientY: number): { x: number; y: number } | null {
    const canvas = this.app?.canvas as HTMLCanvasElement | undefined;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: ((clientX - rect.left) / rect.width) * this.containerWidth,
      y:
        ((clientY - rect.top) / rect.height) * this.getRendererHeight() -
        this.getWorldViewportYOffset(),
    };
  }

  /**
   * Where a ball is thrown from: the black cavity in the skull's mouth, resolved from the frame art
   * so it stays glued to the picture at any size. Falls back to the board's own centre and launch
   * height when the art isn't on screen — e.g. the board rendered bare in Storybook.
   */
  private resolveSpawnPoint(): { x: number; y: number; cavityHalfWidth: number } {
    const fallbackX = this.containerWidth / 2;
    const fallbackY = this.topMargin - this.pegSpacing * 1.35;
    // With no art on screen there is no cavity to stay inside, so the launch offset goes unclamped.
    const unbounded = Number.POSITIVE_INFINITY;
    const anchor = this.resolveSpawnAnchor?.();
    if (!anchor) return { x: fallbackX, y: fallbackY, cavityHalfWidth: unbounded };
    const world = this.clientPointToWorld(anchor.x, anchor.y);
    if (!world || !Number.isFinite(world.x) || !Number.isFinite(world.y)) {
      return { x: fallbackX, y: fallbackY, cavityHalfWidth: unbounded };
    }
    // The cavity's half-width arrives in client px; map it through the same transform as the centre
    // so it tracks the art's scale and fit mode rather than being a fixed world distance.
    let cavityHalfWidth = unbounded;
    if (anchor.halfWidth != null && anchor.halfWidth > 0) {
      const edge = this.clientPointToWorld(anchor.x + anchor.halfWidth, anchor.y);
      if (edge && Number.isFinite(edge.x)) cavityHalfWidth = Math.abs(edge.x - world.x);
    }
    // Never spawn off the top of the buffer: a ball there would pop into existence at the canvas
    // edge instead of rising out of the mouth. `getTopAirspace` is sized so this shouldn't bite.
    const minY = -this.getWorldViewportYOffset() + this.ballRadius * 0.5;
    return { x: world.x, y: Math.max(minY, world.y), cavityHalfWidth };
  }

  private easeOutCubic(t: number): number {
    const c = Math.max(0, Math.min(1, t));
    return 1 - (1 - c) ** 3;
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
    // Shorten the cooldown in fast mode so the ball is free to bounce again ~one row later instead
    // of coasting past several pegs between hits (see simSpeedFactor).
    const bounceCooldown = this.pyramidConfig.bounceCooldown / this.simSpeedFactor;

    for (
      let i = Math.max(0, segmentIndex - 1);
      i <= Math.min(pathLength - 1, segmentIndex + 1);
      i++
    ) {
      const pathPoint = ball.path[i];
      if (
        pathPoint.bounceIntensity <= 0 ||
        ball.bouncedRows.has(pathPoint.row) ||
        currentTime - ball.lastBounceTime <= bounceCooldown
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
        // Fires once per peg contact (row is added to bouncedRows below, so no re-fire) — drives the
        // per-bounce "thunk" sound. `featured` flags a coin-peg hit so the UI can pitch it up.
        this.onPegBounce?.({
          row: bouncePeg.row,
          col: bouncePeg.col,
          ballId: ball.id,
          featured: this.isFeaturedPeg(bouncePeg),
        });
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
        // Compress the hop in fast mode so it spans ~one row (bounce on nearly every peg, like normal
        // mode) instead of one long arc across several; floored at MIN_FAST_BOUNCE_MS so the arc stays
        // long enough to read. Normal mode (simSpeedFactor 1) keeps the full 240 ms duration.
        ball.bounceDuration = Math.max(
          PlinkoEngine.MIN_FAST_BOUNCE_MS,
          (this.pyramidConfig.bounceDuration *
            ball.bounceDurationMultiplier *
            (0.85 + Math.random() * 0.3)) /
            this.simSpeedFactor
        );
        ball.bounceTravelDir = travelDir;
        ball.x = contactX + (ball.x - contactX) * 0.15;
        ball.y = Math.min(ball.y, contactY);

        const impulseScale =
          this.pyramidConfig.bounceImpulseMin +
          Math.random() * (this.pyramidConfig.bounceImpulseMax - this.pyramidConfig.bounceImpulseMin);
        const force = pathPoint.bounceIntensity * impulseScale * this.bounceScale;
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
    const pr = this.pegRadius;
    // Coin size tracks the LANE SPACING (not the height-only peg radius) so it scales with the board
    // at every viewport/aspect — the spacing includes the horizontal width-fit the radius ignores.
    const coinBaseSize = this.pegSpacingXForRow(4) * PlinkoEngine.COIN_SIZE_FACTOR;
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

      const isFeaturedPeg = peg.isFeatured;

      if (isFeaturedPeg) {
        const sprite = this.featuredPegSprites.get(peg.key);
        const hasCoinSprite = !!(
          sprite &&
          this.coinPegTexture &&
          (sprite.texture.width ?? 0) > 0
        );
        if (hasCoinSprite && sprite) {
          const coinGrow = glowIntensity > 0 ? 1 + glowIntensity * 0.5 : 1;
          // Lane-spacing-based so the coins scale with the board (see `coinBaseSize`).
          const size = coinBaseSize * coinGrow;
          const tw = sprite.texture.width || 1;
          sprite.scale.set(size / tw);
          // Pull the coin SPRITE toward the cluster centroid (the middle space) so the three coins
          // sit closer together. Peg grid positions (regular + featured) are untouched — visual only.
          const pull = PlinkoEngine.COIN_CLUSTER_PULL;
          sprite.position.set(
            peg.x + (this.featuredCentroidX - peg.x) * pull,
            peg.y + (this.featuredCentroidY - peg.y) * pull
          );
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
    // Glow spine replaces the slot background art when it's the active slot count.
    if (this.glowSpineActive) {
      sp.visible = false;
      return;
    }

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

  /**
   * One shared scale for ALL label images so they render at the same size/ratio. Sized to the slot
   * body height, then reduced uniformly if the WIDEST label would exceed the slot width — so every
   * label shrinks together rather than only the wide ones (which made "100" smaller than "5").
   */
  private computeUniformLabelScale(): void {
    let maxTexW = 1;
    let maxTexH = 1;
    for (const tex of Object.values(this.multiplierTextTextures)) {
      if (!tex) continue;
      maxTexW = Math.max(maxTexW, tex.width || 1);
      maxTexH = Math.max(maxTexH, tex.height || 1);
    }
    const refSlot = this.slots[0];
    if (!refSlot) {
      this.uniformLabelScale = 1;
      return;
    }
    const w = refSlot.width - this.pegRadius;
    const h = this.slotHeight * 0.82;
    const targetH = h * PlinkoEngine.SLOT_TEXT_HEIGHT_RATIO;
    const maxW = w * PlinkoEngine.SLOT_TEXT_MAX_WIDTH_RATIO;
    this.uniformLabelScale = Math.min(targetH / maxTexH, maxW / maxTexW);
  }

  private drawAllSlotsPixi(currentTime: number): void {
    if (!this.slots.length) return;

    const glowActive = this.glowSpineActive;

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

      // Bounce the whole glow tile (card) with the slot, so the entire slot dips down and back up
      // on a landing — not just the printed number. Skeleton y is up, so a downward (positive)
      // offset maps to a negative bone y, divided out by the spine scale.
      if (glowActive) {
        const bone = this.glowBoneBySlotIndex[idx];
        if (bone) bone.pose.y = -slot.animationOffset / this.glowScale;
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

      const labelSprite = this.slotLabelSprites[idx];
      if (labelSprite) {
        // The 1-ball tier's centre pocket prints a real value (`0.1`) on the wider centre tile: bigger
        // and vertically centred. Every other label keeps the shared scale + placement.
        const oneBallCenter = this.rapidSingleBall && this.isSpinSlotIndex(idx);
        const labelScale = oneBallCenter ? PlinkoEngine.ONE_BALL_CENTER_LABEL_SCALE : 1;
        // Same scale for every label (computed once in `computeUniformLabelScale`), centered in the slot.
        labelSprite.scale.set(this.uniformLabelScale * textScale * labelScale);
        // `SLOT_TEXT_X_RATIO` is a small leftward nudge off the slot's midpoint. Derive it from the
        // REFERENCE slot width so it stays the same number of PIXELS on every label — the centre pocket
        // is wider than the rest, and scaling the nudge by its own width visibly pulled its label
        // (the 1-ball board's `0.1`) off centre. Identical to `x + w * RATIO` on the normal slots.
        const nudge = (this.slots[0]?.width ?? w) * (PlinkoEngine.SLOT_TEXT_X_RATIO - 0.5);
        const yRatio = oneBallCenter
          ? PlinkoEngine.ONE_BALL_CENTER_LABEL_Y_RATIO
          : PlinkoEngine.SLOT_TEXT_Y_RATIO;
        labelSprite.position.set(
          Math.round(x + w / 2 + nudge),
          Math.round(y + h * yRatio)
        );
      }
    }

    // Apply the per-slot bone bounce to the glow spine in one pass (kept in sync with the labels).
    if (glowActive && this.glowSpine) {
      // Keep the center "SPIN" glyph hidden every frame in rapid mode — the spine animation re-applies
      // the setup pose each tick, which would otherwise restore the glyph over the printed "0".
      if (this.rapidSingleBall && this.glowSpinSlot?.pose.getAttachment()) {
        this.glowSpinSlot.pose.setAttachment(null);
      }
      this.glowSpine.skeleton.updateWorldTransform(Physics.update);
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

  /** Scale a packed RGB colour's channels by `k` (0 = black, 1 = unchanged). */
  private shadeColor(color: number, k: number): number {
    const r = Math.round(((color >> 16) & 255) * k);
    const g = Math.round(((color >> 8) & 255) * k);
    const b = Math.round((color & 255) * k);
    return (r << 16) | (g << 8) | b;
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
      // Thrown up out of the skull's throat: it starts tiny and near-black (far back, in shadow)
      // and swells to full size and full colour as it clears the mouth.
      const t = this.easeOutCubic(ball.emerge);
      const emergeScale =
        PlinkoEngine.EMERGE_MIN_SCALE + (1 - PlinkoEngine.EMERGE_MIN_SCALE) * t;
      const lit =
        PlinkoEngine.EMERGE_MIN_BRIGHTNESS + (1 - PlinkoEngine.EMERGE_MIN_BRIGHTNESS) * t;
      const r = this.ballRadius * ball.scale * emergeScale;
      const x = ball.x;
      const y = ball.y;
      g.circle(x, y, r).fill({ color: this.shadeColor(0xd9e7ff, lit), alpha: 0.95 });
      if (!useSimpleBallRender) {
        g.circle(x - r * 0.22, y - r * 0.22, r * 0.72).fill({
          color: this.shadeColor(0xf3f8ff, lit),
          alpha: 0.92,
        });
        g.circle(x - r * 0.32, y - r * 0.32, r * 0.38).fill({
          color: this.shadeColor(0xffffff, lit),
          alpha: 0.98,
        });
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
