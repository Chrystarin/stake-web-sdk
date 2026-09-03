import { Application, Assets, Container, Graphics, Sprite, Text, type Ticker } from 'pixi.js';
import { boardVitals } from './boardVitals';
import {
  Spine,
  Physics,
  MeshAttachment,
  RegionAttachment,
  type Bone,
  type Slot as SpineSlot,
  type Attachment as SpineAttachment
} from '@esotericsoftware/spine-pixi-v8';
import { BOARD_LABELS } from '../game-logic/boardMultipliers';
import { slotColorForMultiplier } from '../game-logic/slotColors';
import { formatCoefficientLabel } from '../lib/format';
import { getGlowNumbersAsset } from '../lib/spine/glowNumbersAsset';
import { loadSpineAsset } from '../lib/spine/spineAssetCache';
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
  /** Time of this ball's last coin-peg sound — dedupes the two routes that can register a hit. */
  coinSfxTime: number;
  /**
   * Which coin that last sound was for, and whether it was the chime rather than the plain thunk.
   * The dedupe is only allowed to swallow a REPEAT of the same coin: a ball that brushes an
   * incidental coin on its way in (a thunk) and then lands on its designated one must still get the
   * chime, and two different coins in quick succession are two contacts, not one.
   */
  coinSfxRow: number;
  coinSfxCol: number;
  coinSfxFeatured: boolean;
  /**
   * Height the previous bounce arc still had when a new bounce cut it short, decayed away across the
   * new arc. A hop is nearly a row tall at its peak, so restarting one from zero would drop the ball
   * that far in a single frame; carrying the leftover height keeps the handover continuous.
   */
  bounceCarryY: number;
  /** Per-ball motion variation (small random spread at spawn). */
  speedMultiplier: number;
  bounceHeightMultiplier: number;
  driftMultiplier: number;
  bounceDurationMultiplier: number;
  laneOffsetX: number;
  /**
   * Correction on the in-hop slowdown that keeps a row-spanning arc from costing descent speed.
   * Re-solved at every contact by `fitHopToRow`; 1 until the ball's first bounce.
   */
  hopSlowdownScale: number;
  /** Visual-only separation from other balls (no velocity impulse). */
  collisionOffsetX: number;
  collisionOffsetY: number;
  /**
   * The BASE path x this step — the lane position before any of the offsets (velocity, drift,
   * wobble, ball-to-ball push) are added. Fallback side anchor for the coin keep-out when a body
   * appears that `coinPassSides` has no entry for (a board rebuilt mid-flight).
   */
  laneBaseX: number;
  /**
   * Which side of each coin body this ball's PLAN passes on, keyed by the body's `key`, decided
   * once at path build. The plan's row position at a coin's row is already clamped clear of it, so
   * the side is known before the ball is even spawned — and holding it for the whole flight is
   * what makes crossing a coin geometrically impossible. Anything read live (the ball's own
   * position, even the interpolated lane) can flip sides mid-encounter — the rows ABOVE a coin's
   * are not clamped, so the lane's diagonal into the coin row may cross the coin's centreline
   * inside its disc — and every side flip turned the keep-out into an escort through the coin.
   */
  coinPassSides: Record<string, 1 | -1>;
  /**
   * Ricochet off a coin: a displacement from the path, and the velocity still feeding it.
   *
   * Its own channel rather than `velocityX`/`collisionOffsetX` because it needs to reach much
   * further than either is allowed to — `velocityX` is capped at 0.28 of a lane and the collision
   * offset at 0.26, while clearing a coin takes most of a lane. Everything here is a visual offset
   * from the path, so the ball still arrives in the same slot.
   */
  coinKickX: number;
  coinKickY: number;
  coinKickVX: number;
  coinKickVY: number;
  /** Which coin last kicked this ball, and when — so the impulse fires on contact, not every step. */
  coinKickPegKey: string;
  coinKickTime: number;
  /** Which side of that coin it left on. It is not allowed back across to the other one. */
  coinKickSide: 1 | -1;
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
  /** Grid position. Drives lane/row math only — NEVER drawing or contact (see `cx`/`cy`). */
  x: number;
  y: number;
  /**
   * Where the peg is actually DRAWN and COLLIDED. Identical to `x`/`y` for regular pegs; coin pegs
   * are pulled toward the cluster centroid, and baking that pull in here (rather than applying it
   * at draw time) is what keeps the art, the glow and the bounce contact on the same spot.
   */
  cx: number;
  cy: number;
  /** Contact radius at `cx`/`cy` — the peg radius normally, 82% of the coin art for coin pegs. */
  hitRadius: number;
  /**
   * The radius the ball is not allowed inside — the peg body normally, the coin's full DRAWN radius
   * for a coin wearing the art. Distinct from `hitRadius`, which is deliberately held to 82% of the
   * art so a graze doesn't count as a hit: that makes it the wrong number for "is the ball inside
   * this thing", and using it there let the ball sit 3.3px into every coin it passed.
   */
  solidRadius: number;
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
		// Mobile used to knock `bounceAmplitude` down to 12 here because the desktop 26 was far too
		// tall for a phone. 12 is now the shared default (it was too tall on desktop as well — see
		// `pyramidConfig`), so the override said exactly what the default already says. The bounce is
		// measured in row gaps via `bounceScale`, so one number is correct at every viewport and the
		// UA no longer needs a say in it.
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
			const prevWidth = this.containerWidth;
			const prevHeight = this.containerHeight;
			this.updateContainerSize();
			this.ensureLayoutDimensionsFromRendererIfNeeded();
			this.rebuildScene();
			// `rebuildScene` re-measures the host and regenerates every peg and slot, but the balls already
			// in the air keep the coordinates (and `Peg` references) of the layout they were spawned into.
			// The resize path remaps them for exactly this reason; this path — driven by the host's
			// ResizeObserver, which is what a portrait↔landscape rotation trips — has to do the same, or the
			// drop carries on falling through geometry that no longer exists and the balls leave the visible
			// board. Rescaling is a no-op when only the coefficients changed (identical host size), and never
			// double-applies: `refreshLayoutSync` / `resizeCanvasToContainer` run afterwards with the new
			// dimensions already in place, so their own remap scales by 1.
			if (this.balls.length) {
				if (this.containerWidth !== prevWidth || this.containerHeight !== prevHeight) {
					this.remapActiveBallsForResize(
						prevWidth,
						prevHeight,
						this.containerWidth,
						this.containerHeight,
					);
				}
				// Always rebind: `generatePegs` replaced every `Peg` object, so a path still pointing at the
				// old ones would light up detached pegs (no bounce visual) for the rest of the drop.
				this.rebindActiveBallPathPegs();
			}
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
  /**
   * Idle peg bodies. This is geometry that only changes when the board is laid out, so it is
   * tessellated once and then left alone — a drop frame no longer re-issues ~530 primitives for a
   * field that isn't moving. See `rebuildStaticPegs`.
   */
  private readonly pegStaticGraphics = new Graphics();
  /** Only the pegs lit by a bounce this frame; cleared and rebuilt per frame (usually 0–4 pegs). */
  private readonly pegGraphics = new Graphics();
  /** True while `pegGraphics` holds geometry, so an unlit frame clears it exactly once. */
  private pegGraphicsHasContent = false;
  /** Set whenever peg positions/size change; the idle layer is rebuilt on the next draw. */
  private pegStaticDirty = true;
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
  /** Authored card width (px) used to derive a UNIFORM display scale (keeps the authored aspect). */
  private static readonly GLOW_REF_CARD_WIDTH = 82;
  /** Card width as a fraction of slot width — ~1 packs the glow cards edge-to-edge (tiny gaps). */
  private static readonly GLOW_WIDTH_FILL = 1.02;
  /** Authored width (px) of a number card's FACE (the solid tile the value prints on) — the beam
   * (`GLOW_REF_CARD_WIDTH`) minus a 4px transparent glow margin per side. */
  private static readonly GLOW_REF_FACE_WIDTH = 74;
  /** Authored width (px) of the SPIN card's beam mesh (`Spin/Rectangle 240647904`, hull -86.43..83.57). */
  private static readonly GLOW_SPIN_CARD_WIDTH = 170;
  /** Authored width (px) of the SPIN card's FACE (`Spin/Rectangle 240647908`). */
  private static readonly GLOW_SPIN_FACE_WIDTH = 144;
  /**
   * Beam width the SPIN card is normalized TO at load (`normalizeSpinCardGeometry`): its face plus the
   * same 4px-per-side margin the number cards have. Authored, the spin beam carries a 13px margin —
   * over 3× the number cards' — so a centre slot wide enough for the beam left the FACE gaps flanking
   * the centre reading ~2.7× wider than every other seam, and a slot sized for even face gaps put the
   * beam's bright edges on top of both green neighbours. Same margin everywhere resolves both at once.
   */
  private static readonly GLOW_SPIN_BEAM_TARGET_WIDTH =
    PlinkoEngine.GLOW_SPIN_FACE_WIDTH +
    (PlinkoEngine.GLOW_REF_CARD_WIDTH - PlinkoEngine.GLOW_REF_FACE_WIDTH);
  /**
   * The SPIN card's attachments are authored slightly LEFT of their bone (beam mesh centre -1.43,
   * face -2.29, glyph -1.72; every number card sits at 0). `normalizeSpinCardGeometry` re-centres
   * them, or the centre pocket — card, "SPIN" glyph and the 1-ball "0" printed on it — sits left of
   * the pocket centre and eats further into the LEFT neighbour than the right one. This constant is
   * the beam mesh's authored centre, negated (the regions carry their own `x` and just get zeroed).
   */
  private static readonly GLOW_SPIN_CARD_MESH_OFFSET = 1.43;
  private static readonly GLOW_Y_OFFSET_RATIO = 0.52;

  /** Multiplier-label IMAGES (`img/multiplier_slot_text_<label>.webp`) keyed by the slot's label. */
  private readonly multiplierTextTextures: Partial<Record<string, Sprite['texture']>> = {};
  /** Image-based slot labels (parallel to `slotLabels`); a slot uses the sprite OR the text, not both. */
  private slotLabelSprites: (Sprite | undefined)[] = [];
  /** Label image files (loaded once, matched to slots by `slot.labelText`). A label without an asset
   * falls back to a Pixi Text — silently, so a missing one is easy to ship. `BOARD_LABELS` derives the
   * set from the board tables so it cannot fall behind a re-cut; every label shares the same uniform
   * scale and placement, and none is wider than `100`, so none shrinks the others. */
  private static readonly MULTIPLIER_TEXT_LABELS = BOARD_LABELS;
  /** Label image height as a fraction of the slot body height (drives the shared scale). */
  private static readonly SLOT_TEXT_HEIGHT_RATIO = 0.72;
  /** Cap the (widest) label to this fraction of the slot width — applied uniformly to all labels. */
  private static readonly SLOT_TEXT_MAX_WIDTH_RATIO = 0.95;
  /** Vertical center of the label within the slot body (0.5 = dead center of `y..y+h`). */
  private static readonly SLOT_TEXT_Y_RATIO = 0.7;
  /** 1-BALL TIER ONLY — the centre pocket is a plain board slot there (`0`) rather than the SPIN card, and
   * it sits on the wider centre tile: print it 25% larger than the shared label scale and raise it to
   * the card's optical centre (the 0.7 ratio above is tuned for the narrow tiles). */
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
  /**
   * How far each coin is pulled toward the cluster centroid (0 = on its peg, 1 = at centre).
   *
   * This is the root of everything that made the cluster misbehave. At 0.25 it squeezed the row-3
   * pair from their natural 29.8px apart down to 22.4px, and with a 9.8px exclusion each that left a
   * 2.8px slot between them — 0.46 of a ball diameter. A ball could not pass without touching both
   * sides at once, so it was funnelled, wedged and slid down onto the third coin sitting directly
   * beneath the slot. No collision tuning fixes a corridor narrower than the thing moving through it;
   * several rounds of trying (gap blockers, multi-pass separation) each traded one artifact for
   * another.
   *
   *   pull   separation   slot      in ball diameters
   *   0.25   22.4px       2.8px     0.46   <- a trap
   *   0.15   25.4px       5.8px     0.94
   *   0.10   26.8px       7.3px     1.19   <- a ball fits through cleanly
   *   0.00   29.8px      10.3px     1.67
   *
   * 0.10 keeps the coins visibly grouped while leaving a slot a ball can actually take. Raising it
   * back tightens the cluster and brings the squeeze with it.
   */
  private static readonly COIN_CLUSTER_PULL = 0.1;
  /** Coin diameter as a fraction of the lane spacing — scales the coins with the board at any viewport. */
  private static readonly COIN_SIZE_FACTOR = 0.9;
  /**
   * Contact disc as a fraction of the coin's drawn radius. Slightly inside the art so the ball hits
   * the coin face rather than the transparent corners of its texture bounds.
   */
  private static readonly COIN_HIT_RADIUS_FACTOR = 0.82;
  /**
   * Additive pass laid over the coin art, tinted and scaled by the alphas below. Tint alone can only
   * darken (it multiplies), so lifting the coin to a brighter yellow takes light ADDED back on top,
   * masked by the coin's own alpha so it never spills past the rim.
   */
  private static readonly COIN_BRIGHTEN_COLOR = 0xffe83c;
  private static readonly COIN_BRIGHTEN_ALPHA = 0.3;
  /** Extra brightening at the peak of a hit — the coin flares rather than only growing its halo. */
  private static readonly COIN_BRIGHTEN_HIT_ALPHA = 0.26;
  /**
   * Resting halo: `RINGS` concentric discs from `RADIUS` down to the coin's edge, each adding
   * `ALPHA` on top of the last. Stacking thin steps is what fakes the falloff — two fat discs read
   * as a hard-edged plate behind the coin rather than as light coming off it.
   */
  private static readonly COIN_IDLE_GLOW_RADIUS = 1.52;
  private static readonly COIN_IDLE_GLOW_RINGS = 9;
  private static readonly COIN_IDLE_GLOW_ALPHA = 0.03;
  /**
   * Two coin contacts closer together than this belong to the same hit, so only the first one plays
   * the chime. Guards the SFX against the path-index credit and the physical bounce double-firing.
   */
  private static readonly COIN_SFX_DEDUPE_MS = 120;
  private readonly pegsByRow = new Map<number, Peg[]>();
  /** The featured (coin) pegs themselves — three of them, laid out every draw pass. */
  private readonly featuredPegs: Peg[] = [];
  /**
   * Invisible bodies that close the slot between two coins of a row. They collide and nothing else:
   * no art, no glow, no chime, no meter, never a bounce target.
   *
   * Sized to just close the corridor rather than to match a coin. A coin-sized blocker was tried and
   * overlapped each coin by 8.4px, so a ball shoved off the blocker landed inside a coin; this one
   * overlaps by 0.5px, small enough that the single deepest-body separation stays correct.
   *
   * The lane already steers balls around the cluster, but the lane is only the base position — the
   * drift, wobble and bounce impulse riding on top of it are what put balls back in the slot.
   */
  private readonly coinGapBlockers: {
    cx: number;
    cy: number;
    solidRadius: number;
    key: string;
    row: number;
    minCx: number;
    maxCx: number;
  }[] = [];

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
  /**
   * Pixi's ticker re-arms `requestAnimationFrame` only AFTER its listeners return, with no try/catch
   * around them. An exception escaping this callback therefore ends the board's frames for good —
   * `tickerRegistered` and `isAnimating` stay true, no ball ever lands, `onBallDropped` never fires,
   * and the round (and an Autobet run behind it) waits on a landing that cannot come: the exact face of
   * a "frozen" board with a live HUD. Contain it here and carry on; the next frame re-runs the step
   * with the same state. See also `reviveStalledTicker` for the case where the ticker still dies.
   */
  private animTickerBound = (ticker: Ticker): void => {
    this.lastTickAt = performance.now();
    boardVitals.lastTickAt = this.lastTickAt;
    try {
      this.animateFrame(ticker.deltaMS);
    } catch (err) {
      boardVitals.stepErrors += 1;
      console.error('[PlinkoEngine] frame step threw; keeping the ticker alive', err);
    } finally {
      boardVitals.animating = this.isAnimating;
    }
  };
  /** `performance.now()` of the last ticker callback; read by `reviveStalledTicker`. */
  private lastTickAt = 0;

  /**
   * Re-arm the board's frame loop if it has silently died while a drop is in flight.
   *
   * Belt to the try/catch above's braces: Pixi's own render listener runs on the same ticker and is
   * outside our reach (a GL call on a context iOS just reaped, for one), and if it throws, the ticker
   * never requests another frame. Called from the board's 100 ms driver: if the page is being painted,
   * a drop is animating, and no ticker callback has run for `TICKER_STALL_MS`, remove + re-add our
   * listener — Pixi's `add` requests a frame when none is pending, which is precisely the dead state,
   * and is a no-op when a frame IS pending (rAF merely throttled), so this cannot double-step.
   */
  reviveStalledTicker(): void {
    if (!this.app || !this.isAnimating || !this.tickerRegistered) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    const now = performance.now();
    if (now - this.lastTickAt < PlinkoEngine.TICKER_STALL_MS) return;
    boardVitals.revives += 1;
    console.warn('[PlinkoEngine] frame loop stalled while visible; re-arming the ticker');
    this.lastTickAt = now;
    this.stopTicker();
    this.startTicker();
  }
  private static readonly TICKER_STALL_MS = 2000;

  // Host callbacks run inside the physics step. A throw in one (a sound backend, a state handler)
  // must not abort the step for every other ball in flight — or, for a landing, lose the one event
  // the round is waiting on after `isDropping` has already been cleared.
  private emitPegBounce(event: PegBounceEvent): void {
    try {
      this.onPegBounce?.(event);
    } catch (err) {
      boardVitals.callbackErrors += 1;
      console.error('[PlinkoEngine] onPegBounce threw', err);
    }
  }
  private emitCoinPegHit(event: CoinPegHitEvent): void {
    try {
      this.onCoinPegHit?.(event);
    } catch (err) {
      boardVitals.callbackErrors += 1;
      console.error('[PlinkoEngine] onCoinPegHit threw', err);
    }
  }
  private emitBallDropped(event: BallDroppedEvent): void {
    try {
      this.onBallDropped?.(event);
    } catch (err) {
      boardVitals.callbackErrors += 1;
      console.error('[PlinkoEngine] onBallDropped threw', err);
    }
  }
  private tickerRegistered = false;
  /**
   * The one physics step the whole engine advances in (~60fps). A rendered frame is only a sampling
   * rate: it runs however many of these fit the real time elapsed, so a drop covers the same ground
   * per second at 144 Hz, at 60 Hz, and on a device painting at 15 fps under a 4x CPU throttle.
   */
  private static readonly FIXED_STEP_MS = 1000 / 60;
  /** Cap on physics steps per background tick, so a long hidden stretch can't fast-forward minutes. */
  private static readonly HIDDEN_MAX_STEPS_PER_TICK = 120;
  /** Sub-frame leftover carried between background ticks so paced advancement stays accurate. */
  private hiddenStepCarryMs = 0;
  /**
   * Longest real frame the accumulator will honour. A stall longer than this (GC pause, a tab that
   * just came back, a debugger break) is billed as this much time so the backlog can never explode
   * into a spiral of death — the drop simply loses that slice rather than teleporting.
   */
  private static readonly MAX_FRAME_DELTA_MS = 100;
  /** Hard cap on fixed steps per rendered frame (MAX_FRAME_DELTA_MS / FIXED_STEP_MS). */
  private static readonly MAX_STEPS_PER_FRAME = 6;
  /** Sub-step remainder carried between rendered frames so the pacing stays exact. */
  private frameStepCarryMs = 0;
  /**
   * The simulation's OWN clock, advanced by exactly FIXED_STEP_MS per physics sub-step.
   *
   * Everything time-shaped in a drop — the peg-hop arc, the bounce cooldown, peg glow, slot bounces,
   * the coin chime dedupe — is timestamped from this rather than from `Date.now()`. The two are not
   * interchangeable: the path advances in whole fixed steps, so on any frame the sim can't fully
   * catch up (a GC pause, a slow device, `MAX_STEPS_PER_FRAME` capping a long hitch at 100ms) the
   * wall clock runs ahead of the simulated one and never gives the time back. A hop timed off the
   * wall clock would then be declared finished while the ball was still mid-row: the arc collapses,
   * the ball snaps flat onto the path and slides into the next peg without ever hopping — the
   * "phasing through a peg" case, and it shows up exactly on the devices least able to absorb it.
   * Tied to the step count instead, an arc always spans the path distance it was cut to, however
   * badly the frames are landing.
   */
  private simClockMs = 0;
  /** Smoothed cost of a rendered frame, used to shed effect work when the device is struggling. */
  private smoothedFrameMs = 1000 / 60;
  /** Below ~45fps: halve the effect-layer redraw rate and drop the balls' inner highlights. */
  private static readonly SLOW_FRAME_MS = 22;
  /** Below ~25fps (a 4x-throttled device): redraw effect layers only every third frame. */
  private static readonly VERY_SLOW_FRAME_MS = 40;
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

  /**
   * How far off centre a ball may ENTER the peg field, in whole top-row peg spacings.
   *
   * The Galton lane starts at board centre and its first turn moves half a spacing, so without this
   * the top row could only ever resolve to one of the two middle pegs — every ball entered the field
   * in the same place. One spacing of entry offset puts the first bounce on the shoulder pegs, two
   * puts it on the outermost peg of the 6-wide top row (lane sits at ±2.5 spacings after the turn).
   * Whole spacings only, so a wide entry still lands ON a peg rather than in the gap beside it.
   */
  private static readonly ENTRY_WANDER_MAX_COLUMNS = 2;

  /**
   * Rows over which an off-centre entry eases back onto the pure Galton lane (randomised per ball
   * within this range). Ends in the lower-middle of the 12-row pyramid: long enough that the ball
   * visibly travels down one flank before converging, short enough that the last rows are back on the
   * Galton lane so the final snap into the target slot stays a normal-length step.
   */
  private static readonly ENTRY_WANDER_DECAY_ROWS_MIN = 6;
  private static readonly ENTRY_WANDER_DECAY_ROWS_MAX = 9;

  /** Lateral jitter on the entry offset, in peg spacings, so wide entries aren't rail-straight.
   * Raised from 0.12: at 0.12 the entry lanes quantised visibly onto whole peg columns and the
   * top-row bounces lined up on the same few pegs drop after drop. */
  private static readonly ENTRY_WANDER_JITTER_RATIO = 0.26;

  /**
   * How much of the way from the launch bias toward the first row's lane the peg-field entry point
   * sits. Below 1 so the ball is still visibly moving sideways as it meets the first peg row instead
   * of arriving pre-aligned and dropping straight in.
   */
  private static readonly ENTRY_APPROACH_RATIO = 0.6;

  /**
   * Most sideways travel a lane may demand in one row gap, in peg spacings. Above roughly one
   * spacing per row the ball stops reading as falling through pegs and starts reading as sliding
   * sideways, so a wide entry that the coin-avoidance plan then routes around the OPPOSITE flank
   * gets backed off (see `ENTRY_WANDER_FALLBACK_SCALES`) until it fits.
   */
  private static readonly LANE_MAX_STEP_RATIO = 1.25;

  /**
   * Entry-wander strengths to fall back through when the full-strength lane moves too fast
   * sideways. Ends at 0 — the pure Galton lane — so the governor can never do worse than the
   * old centre-only entry.
   */
  private static readonly ENTRY_WANDER_FALLBACK_SCALES = [0.7, 0.45, 0.2, 0];

  /**
   * Which flank the lane routes around the coin cluster on: how much the choice is pulled by the
   * target slot vs. by the side the ball is already falling down.
   *
   * The cluster's first row is row 3, so there are only three rows of runway — crossing to the far
   * flank from a wide entry would need multiple peg spacings per row. Approach outweighs target so
   * the ball rounds the cluster on the side it arrived on and drifts toward its slot over the eight
   * rows below, which both looks better and leaves the entry wander intact.
   */
  private static readonly FLANK_TARGET_WEIGHT = 0.4;
  private static readonly FLANK_APPROACH_WEIGHT = 0.65;

  /**
   * Rows over which the lane eases onto the target slot's centre.
   *
   * The Galton walk steps half a peg spacing per row from board centre, so over 12 rows it can only
   * reach ±6 spacings — but the bottom peg row is 17 wide (±8) and the outer slot centres sit at
   * ±7.69. `galtonPosition` is rounded to a whole turn count on top of that, so the walk ends on a
   * half-spacing grid while slot centres sit on a ~1.03-spacing one. Together those left a residual
   * of up to 1.69 spacings (over 3× a normal row step) that the final — longest, bounce-free —
   * segment had to cover in one sideways lurch. Easing it in over the last few rows instead makes
   * the drop into the pocket vertical.
   */
  private static readonly TARGET_CONVERGE_ROWS = 5;

  /** Ball size the instant it appears in the mouth, as a fraction of its real radius. */
  private static readonly EMERGE_MIN_SCALE = 0.12;

  /** Ball brightness the instant it appears — near-black, so it reads as deep inside the skull. */
  private static readonly EMERGE_MIN_BRIGHTNESS = 0.14;

  /** Emergence finishes once the ball has fallen this many of its own radii clear of the mouth. */
  private static readonly EMERGE_FALL_RADII = 2.4;
  private frameTick = 0;
  /**
   * Set when a peg was struck during this frame's physics steps, cleared once it has been drawn.
   *
   * The effect layers are thinned to every 2nd or 3rd frame under load (`effectInterval`), which is
   * the right trade for glow DECAY — nobody reads a fade at that resolution. It is the wrong trade
   * for the frame a peg is first lit: that one is the hit cue, and delaying it by up to two frames
   * (~33ms at 60fps, ~80ms on a struggling device) is felt directly as the peg reacting late, on
   * exactly the devices and the multi-ball bursts where it is already worst. Lighting up is never
   * skipped; only the fade afterwards is.
   */
  private pegContactPending = false;
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
   * `bounceAmplitude / BOUNCE_REFERENCE_SPACING` of a row gap — 20/30 = 0.67 — and that ratio holds
   * at every viewport. LOWER this to bounce higher, raise it to bounce lower.
   *
   * The ceiling worth respecting: the ball's TOP at the peak is `peak * 1.14 + ballRadius` (the 1.14
   * is the per-ball `bounceHeightMultiplier`), and once that passes `pegSpacing - pegRadius` the ball
   * visibly bounces back up into the row it just came from. On a desktop board that caps the peak at
   * about 0.62 of a gap; 0.40 sits comfortably under it.
   *
   * Prefer changing `bounceAmplitude` for height alone — this constant is the denominator for the
   * hop's lateral drift, wobble and impulse too, so moving it retunes the whole bounce, not just how
   * high it goes.
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
   * Ceiling on a row-fitted hop (`fitHopToRow`). Only reachable under a heavy slow-motion
   * dev override, where a row can take seconds; it stops one arc from stretching past the point
   * where the sine still reads as a bounce.
   */
  private static readonly MAX_HOP_MS = 1400;

  /**
   * Coin ricochet (see `coinKickX` on Ball). Departure speed is a fraction of the coin's own contact
   * reach, so it scales with the board; the velocity decay sets how far the ball actually gets, and
   * the offset decay eases it back onto its lane afterwards. The side bias is what turns a
   * straight-up normal into a sideways departure.
   *
   * 0.3 is the first value that gets the ball completely OFF the coin. Measured as the number of
   * steps the non-penetration constraint still has to fire after contact — every one of those is a
   * step spent being projected back onto the coin's surface, which is the slide:
   *
   *   kick   0     0.135   0.2   0.25   0.3   0.4
   *   normal 19    9       6     2      0     0
   *   fast   8     6       2     0      0     0
   *
   * It throws the ball ~20px sideways and ~23px up at the peak, against a 40px lane and a 39px row
   * — a firm ricochet that still lands inside its own lane. 0.4 also reads as clean but flings it a
   * full lane, which starts to look like the ball was hit by something rather than that it bounced.
   */
  private static readonly COIN_KICK_SPEED = 0.3;
  private static readonly COIN_KICK_VELOCITY_DECAY = 0.86;
  private static readonly COIN_KICK_OFFSET_DECAY = 0.94;
  private static readonly COIN_KICK_SIDE_BIAS = 0.9;
  /**
   * How long before the SAME coin may kick the same ball again. Long enough that a ball held against
   * a coin for a few steps is kicked once rather than accelerated every step, short enough that a
   * ball which genuinely comes back to it is answered again.
   */
  private static readonly COIN_KICK_RECONTACT_MS = 260;
  /**
   * Extra room, in ball radii, that a lane routed AROUND the coin cluster leaves beyond the coins'
   * drawn edge. Without it the detour rides the cluster's outline and clips a coin on the way past.
   */
  private static readonly COIN_CLUSTER_LANE_MARGIN = 0.6;
  /**
   * How wide the slot between two coins must be, in ball radii, before it counts as a real route and
   * is left open rather than plugged. At the current cluster the slot is 1.19 ball diameters, so it
   * is plugged for every ball except the one whose coin sits below it.
   */
  private static readonly COIN_GAP_PASSABLE_BALLS = 2;
  /**
   * Extra standoff, in ball radii, that a ball carrying NO coin credit keeps from every coin.
   *
   * The RGS decides which balls hit a coin (`hitBonusPeg`); everyone else's lane is routed clear of
   * the cluster — but the offsets riding on the lane (bounce impulse, wobble, ball-to-ball push) can
   * still drift a ball onto a coin's rim, where it used to take the same ricochet as a paying hit.
   * The pad holds those balls a visible hair off the art, so the closest a non-paying ball can come
   * is a near miss. Credit balls keep the exact geometry: their coin is a real contact, and the one
   * routed down the slot between the row-3 pair needs the corridor's full 1.19-ball width.
   */
  private static readonly COIN_AVOID_PAD_BALLS = 0.35;
  /**
   * How much of its own position a ball KEEPS when a peg contact settles it toward the contact
   * point. 0 would teleport it onto the peg; 1 would leave it untouched. 0.75 is a nudge.
   */
  private static readonly PEG_SETTLE_KEEP = 0.75;
  /**
   * How far past true ball-to-peg contact the DEADLINE bounce may still fire, as a multiple of
   * `ballRadius + hitRadius`. Constant in pixels, which is the point: the reach it caps used to be
   * half a lane, and lanes widen toward the bottom of the board, so bounces fired further off-column
   * the lower the ball got. Swept live across 8-ball samples:
   *
   *   cap        missed bounces   mean offset (bottom rows)   worst offset
   *   uncapped   3 / 96           3.1px, climbing to 4.4      8.5px
   *   1.00x      23 / 96          1.9px                       6.4px
   *   1.35x      2 / 48           2.2px, flat                 5.2px
   *
   * 1.0 is geometrically pure and silences a quarter of the pegs; 1.35 keeps them all and still
   * holds the worst case to about the touching distance.
   */
  private static readonly DEADLINE_REACH_SLACK = 1.35;

  /**
   * How many times faster than NORMAL play the sim is running (1 in normal, ~3.4 in Fast Game mode
   * where animationSpeed = 2.4, below 1 only under the `plinkoSetSpeed` dev override). Used ONLY to
   * scale the bounce TIMING (duration + cooldown) so a hop still spans ~one row whatever the speed —
   * compressed when fast, so the ball bounces on (nearly) every peg like normal mode instead of
   * holding one long arc across several rows; STRETCHED when slow, so the hop itself slows down with
   * the descent rather than snapping through its full-speed arc over a crawling ball. The bounce
   * shape/depth is untouched, so bounces stay crisp, and normal mode (factor 1) is unchanged.
   */
  private get simSpeedFactor(): number {
    const f = this.animationSpeed / PlinkoEngine.NORMAL_ANIMATION_SPEED;
    if (!Number.isFinite(f) || f <= 0) return 1;
    return f;
  }

  /**
   * The SLOW half of `simSpeedFactor`, i.e. `min(1, factor)` — exactly 1 at normal speed and at every
   * speed above it, below 1 only under a slowed-down `plinkoSetSpeed` dev override.
   *
   * `animationSpeed` alone scales just `normalSpeed`; every other term in the speed model is a raw
   * per-STEP constant (the `minSpeed` floor, the gravity ramp, the in-bounce `bounceSlowdown`, the
   * acceleration). Those are what put a hard floor under how slow the balls can be made to fall — the
   * `minSpeed` floor and the gravity ramp between them hold the ball at about a fifth of normal speed
   * however small `animationSpeed` gets, so past that point asking for less changes nothing. Scaling
   * them by this makes the whole model proportional: a requested 0.01x really is 100x slower.
   *
   * Deliberately one-sided: at 1 every multiplication below is a no-op, so normal play and Fast Game
   * run precisely the tuned numbers they always have. Only the dev slow-down takes the scaled path.
   */
  private get slowMotionScale(): number {
    return Math.min(1, this.simSpeedFactor);
  }

  /**
   * Re-base a per-STEP decay factor (`velocity *= 0.86`) onto the slowed clock. A decay applied once
   * per frame empties in a fixed number of FRAMES, so on a crawling ball the sideways kick from a
   * bounce would snap back to the path while the descent inched along. Raising it to the slow scale
   * spreads the same decay over the same board DISTANCE instead. Returns the constant untouched at
   * normal speed and above.
   */
  private slowDecay(perStepFactor: number): number {
    const scale = this.slowMotionScale;
    return scale >= 1 ? perStepFactor : perStepFactor ** scale;
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
    // Peg-hop height. The arc peak is `bounceAmplitude / BOUNCE_REFERENCE_SPACING` of a row gap, so
    // 20/30 = 0.67 of a gap — about 26px against a 39.2px desktop row.
    //
    // Was 26, which put the peak at 0.87 of a gap. Adding the ball's own radius, the top of the ball
    // reached 48px above the peg it had just hit while the row above sits only 39.2px up: at the top
    // of every hop the ball overlapped the previous peg row by ~14px, which is what read as the
    // bounce being too tall.
    //
    // 16 was the ceiling under a strict "never overlap the row above" rule: the ball's highest pixel
    // is `peak * 1.14 + ballRadius` (`bounceHeightMultiplier` tops out at 1.14), and 16 lands that
    // about level with the peg row above. 18 pushed roughly 1px past it on the tallest hops; 20
    // reaches ~5px past — a quarter of a row gap short of the old 26, and balls draw OVER pegs
    // (`ballsGraphics` is the last layer), so the tallest hops read as the ball passing in front of
    // the upper peg rather than clipping into it. Raised 18 -> 20 for a springier bounce on
    // request; 26 remains the measured "too tall".
    bounceAmplitude: 20,
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
    this.featuredPegSprites.forEach((sprite) => sprite.destroy({ children: true }));
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
        // MSAA only smooths GEOMETRY edges — here the tessellated ball/peg circles — and on touch
        // devices those already render at resolution 2 on a DPR-3 screen, where the remaining
        // stair-step is invisible under a moving ball. What MSAA costs there is a 4x-sample
        // backbuffer on the game's second-biggest canvas: tens of MB of GPU memory on the phones
        // where iOS reaps WebGL contexts under memory pressure (the QA "background turns black
        // mid-autoplay" report — the same pressure this canvas contributes to even when the
        // BACKGROUND context is the one that dies). Desktops keep MSAA: many sit at DPR 1, where
        // circle edges genuinely need it, and desktop GPUs have memory to spare.
        antialias: !(
          typeof window !== 'undefined' && window.matchMedia?.('(any-pointer: coarse)').matches
        ),
        backgroundAlpha: 0,
        preference: 'webgl',
      });
    } catch (err) {
      console.error('[PlinkoEngine] Pixi Application.init failed', err);
      throw err;
    }

    this.hostElement.appendChild(app.canvas as HTMLCanvasElement);

    // iOS Safari reaps WebGL contexts under memory pressure (seen on the background renderer as a
    // black backdrop mid-bonus). If it takes THIS context the board stops painting — balls frozen
    // mid-air — while physics keeps stepping, so rounds still settle invisibly. Pixi's GlContextSystem
    // `preventDefault()`s the loss (asking the browser for a restore) and, when `webglcontextrestored`
    // arrives, resets its GPU caches and re-uploads everything on the next render — so a board that
    // the browser gives back comes back by itself. What never returns is a context iOS has decided
    // not to restore; no rebuild is attempted for that here (rebuilding the board mid-drop means
    // reconstructing live ball state). Log both edges loudly so a device run that "froze" can be told
    // apart from a logic hang in one look at the console / the ?vitals=1 overlay.
    (app.canvas as HTMLCanvasElement).addEventListener('webglcontextlost', () => {
      boardVitals.contextLost += 1;
      console.error('[PlinkoEngine] WebGL context lost — the board cannot render until it is restored');
    });
    (app.canvas as HTMLCanvasElement).addEventListener('webglcontextrestored', () => {
      boardVitals.contextRestored += 1;
      console.warn('[PlinkoEngine] WebGL context restored — re-uploading the board');
      this.pegStaticDirty = true;
    });

    this.world.sortableChildren = true;
    this.pegStaticGraphics.zIndex = 0.9;
    this.pegGraphics.zIndex = 1;
    this.featuredPegLayer.zIndex = 1.5;
    this.slotAssetLayer.zIndex = 2;
    this.slotSpineLayer.zIndex = 2.05;
    this.bulletsLayer.zIndex = 2.5;
    this.ballsGraphics.zIndex = 2.6;
    this.labelLayer.zIndex = 4;

    this.world.addChild(this.pegStaticGraphics);
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
      // No ball art here on purpose: balls are drawn as vector circles in `drawBallsPixi`, so there
      // is no ball texture to load.
      const [coinPegTex, spinTex, ...tierTex] = await Promise.all([
        loadOptional(staticUrl('img/coin_peg.webp')),
        loadOptional(staticUrl('img/multiplier_slot_spin.webp')),
        ...([1, 2, 3, 4, 5, 6, 7] as const).map((tier) =>
          loadOptional(staticUrl(`img/multiplier_slot_${tier}.webp`))
        )
      ]);
      this.coinPegTexture = coinPegTex;
      this.multiplierSlotSpinTexture = spinTex;
      for (let i = 0; i < 7; i++) {
        const tier = i + 1;
        if (tierTex[i]) this.multiplierSlotTextures[tier] = tierTex[i];
      }

      const textLabels = PlinkoEngine.MULTIPLIER_TEXT_LABELS;
      const textTex = await Promise.all(
        textLabels.map((label) => loadOptional(staticUrl(`img/multiplier_slot_text_${label}.webp`)))
      );
      textLabels.forEach((label, i) => {
        if (textTex[i]) this.multiplierTextTextures[label] = textTex[i];
      });
    } catch {
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
        left = Math.min(left, peg.cx - peg.hitRadius);
        right = Math.max(right, peg.cx + peg.hitRadius);
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
        sprite.destroy({ children: true });
        this.featuredPegSprites.delete(key);
      }
    }
    if (!this.coinPegTexture) return;
    for (const key of this.featuredPegKeys) {
      if (this.featuredPegSprites.has(key)) continue;
      const sprite = new Sprite(this.coinPegTexture);
      sprite.anchor.set(0.5);
      // A second copy of the coin, blended additively, rides the first as a child: it inherits the
      // parent's position and hit-pulse scale for free, and its own texture alpha keeps the added
      // light inside the coin's silhouette. `layoutFeaturedPegSprites` only touches its alpha.
      const brighten = new Sprite(this.coinPegTexture);
      brighten.anchor.set(0.5);
      brighten.blendMode = 'add';
      brighten.tint = PlinkoEngine.COIN_BRIGHTEN_COLOR;
      brighten.alpha = PlinkoEngine.COIN_BRIGHTEN_ALPHA;
      brighten.label = 'coin-brighten';
      // Pixi v8 treats a Sprite as leaf-only unless it opts in, and logs the "addChild: Only
      // Containers will be allowed to add children" deprecation on every parent that has not.
      // `allowChildren` IS that opt-in — it is the only thing `addChild` gates on, so setting it
      // changes nothing about how the pair is built, drawn or destroyed; it just stops the warning.
      sprite.allowChildren = true;
      sprite.addChild(brighten);
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
      // `Assets` is a global singleton; the shared spine cache registers each alias only once across
      // engine remounts (re-adding the same key logs a Pixi resolver "overwriting" warning) and hits
      // the entry the intro loader already preloaded, so this resolves without a fetch.
      const { atlasAlias, skeletonAlias } = await loadSpineAsset(asset);

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

      this.normalizeSpinCardGeometry(spine);

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
   * Normalize the SPIN card to the number cards' proportions so the slot row tiles evenly — see
   * `GLOW_SPIN_BEAM_TARGET_WIDTH` (margin) and `GLOW_SPIN_CARD_MESH_OFFSET` (centring) for why.
   * The face and glyph keep their authored size; only the transparent beam margin narrows, and all
   * three land dead-centre on the Spin bone. Safe to mutate: `readSkeletonData` parses a fresh
   * `SkeletonData` per load rather than a shared cached one, so this can't compound across remounts
   * (same argument as `BalanceCoinGlowRenderer.applyBoneScale`). Animation only keys slot colors —
   * no deform/bone timelines fight these edits. Best-effort: if the skeleton is re-cut and a lookup
   * misses, the board still renders with the authored (overlapping) card.
   */
  private normalizeSpinCardGeometry(spine: Spine): void {
    const skeleton = spine.skeleton;

    // Beam mesh: re-centre on the bone, then narrow to the number cards' glow margin.
    const beam = skeleton.findSlot('Rectangle 240647931')?.pose.getAttachment();
    if (beam instanceof MeshAttachment && !beam.bones) {
      const k = PlinkoEngine.GLOW_SPIN_BEAM_TARGET_WIDTH / PlinkoEngine.GLOW_SPIN_CARD_WIDTH;
      const verts = beam.vertices;
      for (let i = 0; i < verts.length; i += 2) {
        verts[i] = (verts[i] + PlinkoEngine.GLOW_SPIN_CARD_MESH_OFFSET) * k;
      }
    } else {
      console.warn('[PlinkoEngine] glow_numbers spin beam mesh missing; centre card may overlap');
    }

    // Face card + "SPIN" glyph: regions carry their own local x — zero it (4.3 bakes region offsets
    // into the sequence, so re-bake after the change).
    for (const slotName of ['Rectangle 240647932', 'spin']) {
      const att = skeleton.findSlot(slotName)?.pose.getAttachment();
      if (att instanceof RegionAttachment) {
        att.x = 0;
        att.updateSequence();
      }
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
      // Spine 4.3 exposes the local transform via `bone.pose` (set by application code). Every card
      // sits centred on its bone — the SPIN card's authored offsets are removed at load by
      // `normalizeSpinCardGeometry` — so bone-on-centerX puts every card on its pocket's axis.
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
        // Those pegs are omitted only to clear room for the coin cluster. The 1-ball tier has no
        // coins, so it keeps them and the pyramid stays whole — no gap where the cluster would be.
        if (!this.rapidSingleBall && PlinkoEngine.REMOVED_PEG_KEYS.has(`${row}:${col}`)) continue;
        const pegX = centerX - ((pegsInRow - 1) * rowSpacingX) / 2 + col * rowSpacingX;
        this.pegs.push({
          x: pegX,
          y: rowY,
          // Provisional — `indexFeaturedPegs` finalises these once the coin cluster is known.
          cx: pegX,
          cy: rowY,
          hitRadius: this.pegRadius,
          solidRadius: this.pegRadius,
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
    this.featuredPegs.length = 0;
    this.coinGapBlockers.length = 0;
    // Peg coordinates and radius have just been recomputed, so the cached idle bodies are stale.
    this.pegStaticDirty = true;

    const pegRadius = this.pegRadius;
    let centroidX = 0;
    let centroidY = 0;
    let featuredCount = 0;
    for (const peg of this.pegs) {
      peg.isFeatured = this.featuredPegKeys.has(peg.key);
      // Regular pegs are drawn and contacted exactly on their grid position.
      peg.cx = peg.x;
      peg.cy = peg.y;
      peg.hitRadius = pegRadius;
      peg.solidRadius = pegRadius;
      if (peg.isFeatured) {
        this.featuredPegs.push(peg);
        this.featuredRowsSet.add(peg.row);
        centroidX += peg.x;
        centroidY += peg.y;
        featuredCount++;
      }
    }
    this.featuredCentroidX = featuredCount ? centroidX / featuredCount : 0;
    this.featuredCentroidY = featuredCount ? centroidY / featuredCount : 0;

    // Bake the cluster pull into the coin pegs themselves. This used to be applied only when the
    // sprite was positioned, which left the collision peg, the glow ring and the coin art in three
    // different places — the ball bounced off a spot with no art on it, the gold glow sat off the
    // coin, and a ball crossing the drawn coin passed straight through it. One position now.
    // Only when the coin art actually loaded — without it a featured peg falls back to a plain peg
    // body, and it must keep plain-peg geometry so the fallback doesn't collide bigger than it draws.
    // Matches the test `featuredPegCoinSprite` uses to decide whether a coin peg wears the coin art.
    const hasCoinArt = !!this.coinPegTexture && (this.coinPegTexture.width ?? 0) > 0;
    const coinRadius = hasCoinArt ? this.coinBaseSize() / 2 : 0;
    for (const peg of this.featuredPegs) {
      if (!coinRadius) continue;
      const pull = PlinkoEngine.COIN_CLUSTER_PULL;
      peg.cx = peg.x + (this.featuredCentroidX - peg.x) * pull;
      peg.cy = peg.y + (this.featuredCentroidY - peg.y) * pull;
      // The coin art is far wider than a peg body, so it needs the matching contact disc — otherwise
      // the ball only ever "touches" a peg-sized dot at the middle of a much larger coin.
      peg.hitRadius = Math.max(pegRadius, coinRadius * PlinkoEngine.COIN_HIT_RADIUS_FACTOR);
      // The ball may not be drawn inside the ART, which is the full coin — a fifth wider than the
      // 82% contact disc above.
      peg.solidRadius = Math.max(pegRadius, coinRadius);
    }

    // Close the slot between neighbouring coins of a row, sized to the corridor that is actually
    // there — just enough that a ball centre cannot fit down the middle.
    const coinsByRow = new Map<number, Peg[]>();
    for (const peg of this.featuredPegs) {
      const list = coinsByRow.get(peg.row);
      if (list) list.push(peg);
      else coinsByRow.set(peg.row, [peg]);
    }
    for (const [gapRow, rowCoins] of coinsByRow) {
      if (rowCoins.length < 2) continue;
      rowCoins.sort((a, b) => a.cx - b.cx);
      for (let i = 1; i < rowCoins.length; i++) {
        const left = rowCoins[i - 1];
        const right = rowCoins[i];
        const halfCorridor =
          (right.cx - left.cx - (left.solidRadius + right.solidRadius) - this.ballRadius * 2) / 2;
        // Already wide enough for a ball to pass cleanly: leave it as a real route.
        if (halfCorridor > this.ballRadius * PlinkoEngine.COIN_GAP_PASSABLE_BALLS) continue;
        this.coinGapBlockers.push({
          cx: (left.cx + right.cx) / 2,
          cy: (left.cy + right.cy) / 2,
          solidRadius: Math.max(0.1, halfCorridor - this.ballRadius + 0.5),
          key: `gap:${gapRow}:${i}`,
          row: gapRow,
          minCx: left.cx,
          maxCx: right.cx,
        });
      }
    }

    for (const [row, rowPegs] of this.pegsByRow) {
      const regular: Peg[] = [];
      let minX = Infinity;
      let maxX = -Infinity;
      let hasFeatured = false;
      for (const peg of rowPegs) {
        if (peg.isFeatured) {
          hasFeatured = true;
          // Span the coin's drawn extent, not its centre — lanes planned to avoid the cluster have
          // to clear the art the player can see, or the ball visibly clips the coin's edge.
          //
          // `hitRadius` is NOT that extent: it is the contact disc, deliberately held to 82% of the
          // art (COIN_HIT_RADIUS_FACTOR) so a ball has to reach the coin properly to count as
          // touching it. Spanning by it left the outer 18% of every coin outside the cluster as far
          // as lane planning was concerned — a ball routed to just clear the cluster still crossed
          // the visible rim, which is the near-miss that looks like a coin hit and makes no coin
          // sound. Span the art.
          const drawnRadius = Math.max(peg.hitRadius, coinRadius);
          if (peg.cx - drawnRadius < minX) minX = peg.cx - drawnRadius;
          if (peg.cx + drawnRadius > maxX) maxX = peg.cx + drawnRadius;
        } else {
          regular.push(peg);
        }
      }
      this.regularPegsByRow.set(row, regular);
      if (hasFeatured) this.clusterSpanByRow.set(row, { minX, maxX });
    }
  }

  /**
   * Push a planned lane out of any coin it would otherwise pass through, leaving it on the side it
   * already favours so the detour is the shorter one. `allow` is the one coin this ball is meant to
   * hit (null when it must clear every one of them).
   *
   * The ramp that steers a ball onto its coin interpolates between the Galton lane and the coin, and
   * nothing in that interpolation knew about the OTHER coins. Rows 3 and 5 both carry coins, so the
   * approach to the row-5 coin passes right between the row-3 pair — and for a wide band of starting
   * lanes it passed straight through one of them.
   */
  private clampLaneClearOfCoins(
    row: number,
    laneX: number,
    allow: Peg | null,
    headingX?: number,
  ): number {
    let x = laneX;
    /** Whether a coin moved the lane, so the peg-column snap at the end knows to run. */
    let movedForCoin = false;

    // Clear the whole CLUSTER, not each coin on its own.
    //
    // The row-3 pair sits 22.4px apart with a 9.8px exclusion each, so the corridor between them is
    // 2.8px wide — for a ball 6.1px across. Per-coin clearance is satisfied at the midpoint, so this
    // clamp was free to drop a lane straight down that slot, where the ball is pinned by one coin,
    // shoved into the other, and pinned again: the shake. And the row-5 coin sits at exactly the gap
    // centre, so anything that does thread it falls straight onto a third coin.
    //
    // `planSmoothFeaturedAvoidance` already routes around the cluster on one flank, but this runs
    // last and was undoing it. Skipped when the ball is MEANT to hit a coin in this row (`allow`),
    // which is the one case that has business being in there.
    // Deliberately this row only.
    //
    // A coin's exclusion disc does reach ~0.76 of a row above and below its own, so extending this
    // to the neighbouring rows looks right on paper — and measured far worse on a live drop: lane
    // detours of 45px on a 6.1px ball, and contact with a coin going from 4 frames to 17. Forcing
    // three consecutive rows out to the cluster's edge and then releasing the fourth zigzags the
    // lane, and the ball is thrown across the board between rows. The per-row clamp plus the
    // in-flight separation is the combination that measured best.
    const clusterSpan = this.getFeaturedClusterSpan(row);
    const allowInRow = allow != null && allow.row === row;
    // The ball whose designated coin sits BELOW this row, inside this row's span, goes THROUGH the
    // row — the gap between this row's coins is the only way onto its coin, and it is meant to be
    // there. Without this the cluster detour below shoved exactly that ball out to a flank, and it
    // reached the bottom coin by cutting back across sideways instead of dropping through the gap.
    const allowBelowInSpan =
      allow != null &&
      allow.row > row &&
      clusterSpan != null &&
      allow.cx > clusterSpan.minX &&
      allow.cx < clusterSpan.maxX;
    if (clusterSpan && !allowInRow && !allowBelowInSpan) {
      // Plus a margin, or the lane is parked exactly on the cluster's edge and every ball routed
      // past it grazes a coin on the way by (measured: 10 of 10 balls touching). The detour should
      // clear the coins, not trace them.
      const margin = this.ballRadius * PlinkoEngine.COIN_CLUSTER_LANE_MARGIN;
      const left = clusterSpan.minX - this.ballRadius - margin;
      const right = clusterSpan.maxX + this.ballRadius + margin;
      if (x > left && x < right) {
        const preferRight =
          headingX == null ? x - left >= right - x : headingX >= (left + right) / 2;
        x = preferRight ? right : left;
        movedForCoin = true;
      }
    }

    // The gap BETWEEN two coins of a row is not a route, and this holds even for a ball that is
    // meant to hit a coin in this row — `allowInRow` above waives the cluster detour for those, and
    // that waiver was leaving the slot wide open to exactly the balls most likely to be aimed near
    // it. A ball headed for one of the top coins should reach it from the outside.
    //
    // The single exception is the ball whose designated coin sits BELOW the gap: the lower coin is
    // directly under the slot, so threading it is the only way in, and that ball is supposed to be
    // there. Everyone else goes round.
    const rowCoins = this.featuredPegs
      .filter((p) => p.row === row)
      .sort((a, b) => a.cx - b.cx);
    for (let i = 1; i < rowCoins.length; i++) {
      const left = rowCoins[i - 1];
      const right = rowCoins[i];
      if (x <= left.cx || x >= right.cx) continue;
      // One exception, matching the one the in-flight plug makes (`coinGapBlockers`): the ball whose
      // coin sits BELOW this slot is routed through it, because that is the only way in and it is
      // meant to be there. Keeping the two rules in agreement matters — with the lane steering that
      // ball around the cluster while the plug let it through, it spent the approach being pulled
      // two ways, which is the "acts weird near the coins" behaviour.
      const targetIsBelowThisGap =
        allow != null && allow.row > row && allow.cx > left.cx && allow.cx < right.cx;
      if (targetIsBelowThisGap) continue;
      const margin = this.ballRadius * PlinkoEngine.COIN_CLUSTER_LANE_MARGIN;
      const outLeft = left.cx - left.solidRadius - this.ballRadius - margin;
      const outRight = right.cx + right.solidRadius + this.ballRadius + margin;
      // Leave on the side it is heading for, so the detour is the shorter one and the ball is not
      // sent back across the board — same reasoning as the per-coin clamp below.
      const goRight =
        headingX == null ? x - left.cx >= right.cx - x : headingX >= (left.cx + right.cx) / 2;
      x = goRight ? outRight : outLeft;
      movedForCoin = true;
    }

    for (let i = 0; i < this.featuredPegs.length; i++) {
      const peg = this.featuredPegs[i];
      if (peg.row !== row || peg === allow) continue;
      // Clear the coin's DRAWN edge, not its 82% contact disc: a lane planned to just clear
      // `hitRadius` still put the ball 3.3px inside the visible coin, which is the near-miss that
      // looks like a hit and plays no sound.
      const clearance = peg.solidRadius + this.ballRadius;
      const dx = x - peg.cx;
      if (Math.abs(dx) >= clearance) continue;
      // Detour on the side the lane is HEADING, not merely the nearer one.
      //
      // Nearest-side is what put a ball on a coin's right shoulder while its lane was bound for a
      // peg on the left. Contact then says one thing and the path says the opposite: the ball is
      // deflected right, the lane hauls it left, and it spends 7-10 frames being scraped across the
      // coin's face between the two. Approaching on the side it is already going to leave on turns
      // the same contact into a clean touch-and-go (measured: 0 frames of contact at every landing
      // offset, against 7-10 the other way). Costs up to ~20px more lane detour in the cases where
      // the two disagree, which is inside what this clamp was already free to move.
      const side =
        headingX == null ? (dx >= 0 ? 1 : -1) : headingX >= peg.cx ? 1 : -1;
      x = peg.cx + side * clearance;
      movedForCoin = true;
    }

    // Land the detour ON a peg, not in the space beside the coin.
    //
    // Everything above places the lane at a distance set by the COIN's size, and a coin is not the
    // same width as a lane — so the lane ends up parked between the coin and the next real peg. On
    // the lower coin's row that lands it at 130.3 with the nearest peg at 135.4: 5.13px away against
    // a 5.07px touching reach, so the ball bounced from just past contact every single time. It is
    // the worst offset on the board (4.98px measured, where every other row is under 3px) and it is
    // entirely self-inflicted by this clamp.
    //
    // Snapping to the nearest peg column that still clears every coin costs a little more detour and
    // puts the ball on something real.
    //
    // Applies to EVERY row carrying a coin, not only rows this clamp happened to move. Gating it on
    // the clamp firing barely helped (4.98px -> 4.72px) because on a coin row the lane is usually
    // placed by `planSmoothFeaturedAvoidance` routing around the cluster, which lands wherever the
    // flank happens to be rather than on a peg column — so the clamp never ran and the snap never
    // got its turn. Skipped when the ball is meant to HIT a coin in this row: its lane belongs on
    // the coin, not on the peg next to it.
    // ...and not for the gap-threading ball either: its lane belongs mid-corridor, and the nearest
    // "clear" column is a flank peg two lanes out — snapping there is the detour all over again.
    const targetsCoinInThisRow = allow != null && allow.row === row;
    if ((movedForCoin || this.rowHasFeaturedPeg(row)) && !targetsCoinInThisRow && !allowBelowInSpan) {
      const regular = this.regularPegsByRow.get(row);
      if (regular?.length) {
        let bestX: number | null = null;
        let bestDist = Infinity;
        for (const candidate of regular) {
          let clearsCoins = true;
          for (let i = 0; i < this.featuredPegs.length; i++) {
            const coin = this.featuredPegs[i];
            if (coin.row !== row || coin === allow) continue;
            if (Math.abs(candidate.cx - coin.cx) < coin.solidRadius + this.ballRadius) {
              clearsCoins = false;
              break;
            }
          }
          if (!clearsCoins) continue;
          const dist = Math.abs(candidate.cx - x);
          if (dist < bestDist) {
            bestDist = dist;
            bestX = candidate.cx;
          }
        }
        if (bestX != null) x = bestX;
      }
    }

    return x;
  }

  /** The coin peg whose drawn disc contains this point, if any — used to catch grazing contacts. */
  private featuredPegAtPoint(row: number, x: number, y: number): Peg | null {
    for (let i = 0; i < this.featuredPegs.length; i++) {
      const peg = this.featuredPegs[i];
      if (peg.row !== row) continue;
      const dx = x - peg.cx;
      const dy = y - peg.cy;
      // Overlapping the coin ART counts as touching it — same reason as `clampLaneClearOfCoins`.
      const reach = peg.solidRadius + this.ballRadius;
      if (dx * dx + dy * dy <= reach * reach) return peg;
    }
    return null;
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
    // Wider center to fit the spine's broader SPIN card (its face is ~2× a number card's). Sized so
    // the centre card's two seams follow the SAME rule as every other seam: adjacent beams overlap
    // their transparent glow margin by `(GLOW_WIDTH_FILL - 1)` of a slot. Half the (normalized —
    // see `normalizeSpinCardGeometry`) SPIN beam plus half a number beam, minus that shared overlap
    // per side, spans centre-to-neighbour-centre — and because the normalized margin matches the
    // number cards', the VISIBLE face gaps come out equal across the whole row. Hardcoded at 1.95
    // this was 0.18 slot widths short of the authored card and the SPIN card clipped over both
    // neighbours; derived from the same authored widths + fill the glow spine is scaled by, a re-cut
    // of the card art or the packing can't silently reintroduce the overlap.
    const centerWeight =
      ((PlinkoEngine.GLOW_SPIN_BEAM_TARGET_WIDTH + PlinkoEngine.GLOW_REF_CARD_WIDTH) *
        PlinkoEngine.GLOW_WIDTH_FILL) /
        PlinkoEngine.GLOW_REF_CARD_WIDTH -
      1 -
      2 * (PlinkoEngine.GLOW_WIDTH_FILL - 1);
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
    // The 1-ball rapid tier is feature-free: no bonus meter, no spin pocket, and so nothing for a
    // coin peg to feed. It plays on a plain pyramid instead (see also `generatePegs`, which keeps
    // the cluster's interior pegs on this tier rather than clearing room for coins that aren't there).
    if (this.rapidSingleBall) return new Set<string>();
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

  /** Half-width of a peg row, centre → outermost peg centre. */
  private laneHalfSpanForRow(row: number): number {
    const pegsInRow = row + PlinkoEngine.TOP_ROW_PEGS;
    return ((pegsInRow - 1) / 2) * this.pegSpacingXForRow(row);
  }

  /**
   * Keep a lane position inside the pyramid — never wider than the row's outermost peg. `reachX`
   * widens the bound to include that x: the outer slots sit BEYOND the pyramid's span, so the lane
   * converging onto one has to be allowed past the outermost peg, otherwise the clamp would re-open
   * the very end-gap the convergence is closing.
   */
  private clampLaneToRow(row: number, x: number, reachX?: number): number {
    const centerX = this.containerWidth / 2;
    let limit = this.laneHalfSpanForRow(row);
    if (reachX != null) limit = Math.max(limit, Math.abs(reachX - centerX));
    return Math.max(centerX - limit, Math.min(centerX + limit, x));
  }

  /**
   * Ease the lane onto the target slot's centre over the last `TARGET_CONVERGE_ROWS` rows, so the
   * final segment into the pocket is a straight drop rather than a sideways lurch. Zero at the start
   * of the ramp and exactly the full residual at the last peg row, so nothing above the ramp moves.
   */
  private planTargetConvergence(lane: number[], targetX: number): number[] {
    const offsets = new Array<number>(this.rows).fill(0);
    const lastRow = this.rows - 1;
    if (lastRow < 1) return offsets;

    // Converge onto the PEG COLUMN nearest the slot, not onto the slot centre itself.
    //
    // There are 17 pegs across the last row and 15 slots, so slot centres do not line up with peg
    // columns — driving the lane all the way to `targetX` by the last peg row parks it in the GAP
    // between two pegs. Measured on a live drop: every ball that lost its final bounce was 7.2-7.4px
    // from the nearest row-11 peg against a 7.46px half-lane, i.e. dead centre of the gap with
    // correctly nothing to hit, and 3 of 7 balls ended their last bounce on row 10 instead of 11.
    // That reads both as the ball passing straight through the last peg and as the bounce dying out
    // toward the bottom of the board.
    //
    // The leftover lateral travel is covered by the final path segment (last peg -> slot), which is
    // ~2.3 rows long and carries no peg of its own, so the slot the ball lands in is untouched.
    const lastRowPegs = this.pegsByRow.get(lastRow);
    let convergeX = targetX;
    if (lastRowPegs?.length) {
      let bestX = lastRowPegs[0].cx;
      let bestDist = Infinity;
      for (const peg of lastRowPegs) {
        const dist = Math.abs(peg.cx - targetX);
        if (dist < bestDist) {
          bestDist = dist;
          bestX = peg.cx;
        }
      }
      convergeX = bestX;
    }

    const residual = convergeX - (lane[lastRow] ?? convergeX);
    if (!residual) return offsets;

    const startRow = Math.max(0, lastRow - PlinkoEngine.TARGET_CONVERGE_ROWS);
    const span = Math.max(1, lastRow - startRow);
    for (let row = startRow + 1; row <= lastRow; row++) {
      offsets[row] = residual * this.smoothstep((row - startRow) / span);
    }
    return offsets;
  }

  /** Fastest sideways travel anywhere in a lane, in peg spacings per row gap. */
  private maxLaneStepRatio(lane: number[]): number {
    let worst = 0;
    for (let row = 1; row < lane.length; row++) {
      const step = Math.abs(lane[row] - lane[row - 1]) / this.pegSpacingXForRow(row);
      if (step > worst) worst = step;
    }
    return worst;
  }

  /**
   * Randomised off-centre ENTRY into the peg field.
   *
   * Returns a per-row lane offset that starts at a whole number of peg spacings to one side and eases
   * back to exactly 0 by `decayRows`. That lets the first bounce land anywhere across the top row
   * (including the outermost pegs) and lets the ball keep travelling down that flank through the
   * middle rows, while guaranteeing the lower rows are back on the pure Galton lane — so the target
   * slot is completely unaffected. This is a lane SHAPE only; it never touches the Galton turn counts.
   */
  private planEntryLaneShape(
    spawnDirection: SpawnDirection,
    targetIndex: number,
    nextRandom: () => number,
  ): { offsets: number[]; columns: number } {
    const offsets = new Array<number>(this.rows).fill(0);
    if (this.rows < 4) return { offsets, columns: 0 };

    const side = spawnDirection < 0 ? -1 : 1;

    // Headroom. A slot that is already far out on this side gives the Galton lane an extreme walk in
    // the same direction, so a wide entry on top of it would just pin the ball against the outer wall
    // for half the board (and get clamped anyway). Entering AWAY from the target keeps the full range
    // — that is the long cross-board sweep, and it is the case that reads best.
    const denom = Math.max(1, this.slots.length - 1);
    const targetBias = (targetIndex / denom) * 2 - 1; // -1 = leftmost slot, +1 = rightmost
    const maxColumns = Math.round(
      PlinkoEngine.ENTRY_WANDER_MAX_COLUMNS * (1 - Math.max(0, targetBias * side)),
    );
    if (maxColumns <= 0) return { offsets, columns: 0 };

    // Wide launches (|dir| 2) favour the outer pegs, shallow ones (|dir| 1) the shoulder pegs — and
    // sometimes still the middle, so the old centre entry stays part of the mix rather than
    // vanishing. Shallow throws also reach the outer pegs some of the time now: with the middle
    // over-weighted, half a burst's first bounces stacked on the same two centre pegs.
    const roll = nextRandom();
    const columns = Math.min(
      maxColumns,
      Math.abs(spawnDirection) === 2
        ? (roll < 0.55 ? 2 : 1)
        : roll < 0.5
          ? 1
          : roll < 0.75
            ? 2
            : 0,
    );
    if (columns <= 0) return { offsets, columns: 0 };

    const decaySpread =
      PlinkoEngine.ENTRY_WANDER_DECAY_ROWS_MAX - PlinkoEngine.ENTRY_WANDER_DECAY_ROWS_MIN + 1;
    const decayRows = Math.max(
      2,
      Math.min(
        this.rows - 2,
        PlinkoEngine.ENTRY_WANDER_DECAY_ROWS_MIN + Math.floor(nextRandom() * decaySpread),
      ),
    );
    const jitter = (nextRandom() * 2 - 1) * PlinkoEngine.ENTRY_WANDER_JITTER_RATIO;

    for (let row = 0; row < this.rows; row++) {
      const fade = 1 - this.smoothstep(row / decayRows);
      if (fade <= 0) break;
      // Offset is expressed in the ROW's own spacing, so it stays peg-aligned as rows widen.
      offsets[row] = side * (columns + jitter) * this.pegSpacingXForRow(row) * fade;
    }

    return { offsets, columns };
  }

  /**
   * Scale the entry wander back until it no longer walks a ball into the coin cluster that the pure
   * Galton lane would have missed.
   *
   * Only needed on the legacy (non-deterministic) path, where no avoidance plan runs and ANY featured
   * contact credits the bonus meter — there, a wider lane would silently raise the coin-hit rate.
   * Deterministic drops don't need this: `planSmoothFeaturedAvoidance` runs on the shaped lane and
   * routes it around the whole cluster, which is a better result than damping.
   */
  private dampEntryWanderNearFeatured(galtonLane: number[], entryOffsets: number[]): number[] {
    const featuredRows: number[] = [];
    for (let row = 0; row < this.rows; row++) {
      if (this.rowHasFeaturedPeg(row)) featuredRows.push(row);
    }
    if (!featuredRows.length) return entryOffsets;

    const createsThreat = (scale: number): boolean =>
      featuredRows.some((row) => {
        const galtonX = galtonLane[row] ?? 0;
        if (this.galtonLaneThreatensFeaturedCluster(row, galtonX)) return false; // already exposed
        const shapedX = this.clampLaneToRow(row, galtonX + (entryOffsets[row] ?? 0) * scale);
        return this.galtonLaneThreatensFeaturedCluster(row, shapedX);
      });

    if (!createsThreat(1)) return entryOffsets;
    for (const scale of [0.75, 0.5, 0.25]) {
      if (!createsThreat(scale)) return entryOffsets.map((offset) => offset * scale);
    }
    return new Array<number>(this.rows).fill(0);
  }

  private getFeaturedClusterSpan(row: number): { minX: number; maxX: number } | null {
    return this.clusterSpanByRow.get(row) ?? null;
  }

  /**
   * Full horizontal extent of the coin cluster (art edges) across EVERY featured row. Detours are
   * measured against this, not against each row's own span: the bottom coin's row is narrower than
   * the pair's, so a per-row flank there sat directly under a top coin — inside the V-shaped
   * channel between the top coins and the bottom one, where a passing ball reads as though it were
   * about to hit a coin. Clearing the whole extent keeps the detour outside that channel top to
   * bottom.
   */
  private getFeaturedClusterExtent(): { minX: number; maxX: number } | null {
    let minX = Infinity;
    let maxX = -Infinity;
    for (const span of this.clusterSpanByRow.values()) {
      if (span.minX < minX) minX = span.minX;
      if (span.maxX > maxX) maxX = span.maxX;
    }
    return Number.isFinite(minX) ? { minX, maxX } : null;
  }

  private galtonLaneThreatensFeaturedCluster(row: number, laneX: number): boolean {
    const span = this.getFeaturedClusterSpan(row);
    if (!span) return false;
    // `laneX` is the ball's CENTRE, and the span is now the coin art's edge, so clearing the cluster
    // takes a whole ball radius — a lane that merely clears it by the old flat 0.36 of a lane could
    // still have the ball's near half sitting on the coin. Keep that 0.36 as the floor: it is the
    // wider of the two on the narrow layouts the value was picked for.
    const buffer = Math.max(this.pegSpacingXForRow(row) * 0.36, this.ballRadius);
    return laneX >= span.minX - buffer && laneX <= span.maxX + buffer;
  }

  /**
   * Regular peg beside the bonus cluster on the given side, clear of the cluster's FULL extent
   * (see `getFeaturedClusterExtent` — a per-row flank could sit inside the inner channel).
   * `outwardIndex` 0 is the innermost clear peg; 1 is one column further out — the flank jitter
   * that stops every routed ball from tracing the identical column past the coins.
   */
  private pickFlankBouncePeg(row: number, side: -1 | 1, outwardIndex = 0): Peg | null {
    const extent = this.getFeaturedClusterExtent();
    if (!extent || !this.rowHasFeaturedPeg(row)) return null;
    const regular = this.regularPegsByRow.get(row) ?? [];
    const candidates = regular
      .filter((peg) => (side < 0 ? peg.cx < extent.minX : peg.cx > extent.maxX))
      .sort((a, b) => (side < 0 ? b.cx - a.cx : a.cx - b.cx));
    if (!candidates.length) return null;
    return candidates[Math.min(outwardIndex, candidates.length - 1)];
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
    flankRoll = 0,
  ): { offsets: number[]; flankPegByRow: Map<number, Peg> } {
    const offsets = new Array<number>(this.rows).fill(0);
    const flankPegByRow = new Map<number, Peg>();
    const featuredRows: number[] = [];
    for (let row = 0; row < this.rows; row++) {
      if (this.rowHasFeaturedPeg(row)) featuredRows.push(row);
    }
    if (!featuredRows.length) return { offsets, flankPegByRow };

    const firstFeatured = featuredRows[0];
    const lastFeatured = featuredRows[featuredRows.length - 1];

    // The cluster is one REGION, not a set of independent coin rows, and its interior is not a
    // corridor: the only thing allowed through it is the designated bottom-coin ball, vertically,
    // via the top gap (that ball never reaches this planner). So the trigger tests the whole
    // vertical band the coins occupy — including the coin-free row between them — against the
    // cluster's full horizontal extent, and additionally refuses a SIDE CHANGE across the band:
    // a lane that enters the band left of the cluster and leaves it on the right never lands a
    // row point inside the extent, but the segments between its rows sweep straight through the
    // interior — the "crosses between the coins to the other side" arc. Both cases route around
    // one flank instead.
    const extent = this.getFeaturedClusterExtent();
    const clusterMinX = extent?.minX ?? Infinity;
    const clusterMaxX = extent?.maxX ?? -Infinity;
    let needsAvoidance = false;
    let sawLeftFlank = false;
    let sawRightFlank = false;
    for (let row = firstFeatured; row <= lastFeatured; row++) {
      const x = galtonLane[row] ?? targetSlotX;
      const buffer = Math.max(this.pegSpacingXForRow(row) * 0.36, this.ballRadius);
      if (x >= clusterMinX - buffer && x <= clusterMaxX + buffer) {
        needsAvoidance = true;
        break;
      }
      if (x < clusterMinX) sawLeftFlank = true;
      else sawRightFlank = true;
    }
    if (sawLeftFlank && sawRightFlank) needsAvoidance = true;
    if (!needsAvoidance) return { offsets, flankPegByRow };
    const rampRows = Math.min(5, Math.max(3, firstFeatured));
    const easeInStart = Math.max(0, firstFeatured - rampRows);
    // Ease back out over EVERY remaining row rather than a fixed few. Coming off the flank the lane
    // may have most of the board to cross (a ball routed right around the cluster whose slot is on
    // the far left), and squeezing that into three rows made the ball slide sideways. Spread over the
    // rest of the descent it is a gradual drift, and the offset still reaches exactly 0 on the last
    // row so the final step into the slot is unchanged.
    const easeOutEnd = this.rows - 1;

    // Where the ball is when the detour STARTS, not where it would have been at the cluster itself.
    // By the cluster row the lane has already converged toward the slot, so scoring there makes both
    // flanks look equidistant and the target pulls the ball across — a crossing that has to fit
    // inside `rampRows` and reads as a sideways slide.
    const approachX = galtonLane[easeInStart] ?? targetSlotX;

    // Flank jitter: some balls take the innermost clear column, some the one beyond it, so the
    // routed traffic past the coins spreads over two columns per side instead of tracing one
    // identical line — the "balls lining up beside the cluster" look.
    const outwardIndex = flankRoll < 0.6 ? 0 : 1;

    let chosenSide: -1 | 1 = 1;
    let bestScore = -Infinity;
    for (const side of [-1, 1] as const) {
      let score = 0;
      let valid = true;
      for (const row of featuredRows) {
        const flank = this.pickFlankBouncePeg(row, side, outwardIndex);
        if (!flank) {
          valid = false;
          break;
        }
        score -= Math.abs(flank.x - targetSlotX) * PlinkoEngine.FLANK_TARGET_WEIGHT;
        score -= Math.abs(flank.x - approachX) * PlinkoEngine.FLANK_APPROACH_WEIGHT;
      }
      if (!valid) continue;
      if (score > bestScore) {
        bestScore = score;
        chosenSide = side;
      }
    }

    const targetLaneByRow = new Map<number, number>();
    for (const row of featuredRows) {
      const flank = this.pickFlankBouncePeg(row, chosenSide, outwardIndex);
      if (!flank) continue;
      flankPegByRow.set(row, flank);
      targetLaneByRow.set(row, flank.x);
    }
    if (!targetLaneByRow.size) return { offsets, flankPegByRow };

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
  private planSmoothFeaturedApproach(
    galtonLane: number[],
    featuredTarget: Peg,
    exitSide: 1 | -1,
  ): number[] {
    const offsets = new Array<number>(this.rows).fill(0);
    const targetRow = featuredTarget.row;
    if (targetRow < 0 || targetRow >= this.rows) return offsets;

    // A coin that sits under the GAP of a higher coin row (the bottom coin, under the row-3 pair)
    // is reached THROUGH that gap: the lane must already be dead on the target's column when it
    // crosses the pair, then run straight down onto the coin. So the ramp finishes at the gap row
    // rather than at the target row, and the rows between hold weight 1 — the visible result is
    // the ball threading the slot between the top coins and dropping onto the bottom one. For a
    // top-row coin no higher row qualifies and this reduces to the original ramp exactly.
    let holdFromRow = targetRow;
    for (let row = 0; row < targetRow; row++) {
      const span = this.getFeaturedClusterSpan(row);
      if (span && featuredTarget.cx > span.minX && featuredTarget.cx < span.maxX) {
        holdFromRow = row;
        break;
      }
    }

    // The exit stays pinned (weight 1) until the ball is BELOW the whole cluster, then eases to
    // its slot — easing out straight from the target row let a ball that struck the top-left coin
    // head for a far-right slot by cutting across the interior, over the bottom coin. Crossing
    // the board under the coins is fine; through them is not. For the bottom coin (no featured
    // rows below) this holds nothing extra.
    let holdToRow = targetRow;
    for (let row = targetRow + 1; row < this.rows; row++) {
      if (this.rowHasFeaturedPeg(row)) holdToRow = row;
    }

    const rampRows = Math.min(5, Math.max(3, holdFromRow));
    const easeInStart = Math.max(0, holdFromRow - rampRows);
    const easeOutEnd = Math.min(this.rows - 1, holdToRow + rampRows);

    for (let row = 0; row < this.rows; row++) {
      let weight = 0;
      if (row < easeInStart) {
        weight = 0;
      } else if (row < holdFromRow) {
        weight = this.smoothstep((row - easeInStart) / Math.max(1, holdFromRow - easeInStart));
      } else if (row <= holdToRow) {
        weight = 1;
      } else if (row <= easeOutEnd) {
        weight = 1 - this.smoothstep((row - holdToRow) / Math.max(1, easeOutEnd - holdToRow));
      }
      if (weight <= 0) continue;
      const galtonX = galtonLane[row] ?? featuredTarget.cx;
      // Approach rows aim at the coin. Exit rows walk AWAY from it, half a lane per row (a
      // natural Galton run off the hit, capped at one lane out and held there until the blend
      // takes over). Anchoring the exit on the coin's own column kept the lane inside the coin's
      // disc for the first stretch below the hit, so the departure arc dipped the ball back onto
      // the coin's face and the hold re-seated it there — the "hits the coin twice and sticks"
      // look. For a top coin `exitSide` is outward, so the walk also keeps the exit clear of the
      // cluster's interior.
      const anchorX =
        row <= targetRow
          ? featuredTarget.cx
          : featuredTarget.cx +
            exitSide * Math.min(row - targetRow, 2) * this.pegSpacingXForRow(row) * 0.5;
      offsets[row] = (anchorX - galtonX) * weight;
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
      let score = Math.abs(x - peg.cx);
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

    // `cx`, not `x`: the ball has to arrive where the coin is DRAWN, or it visibly bounces beside it.
    if (featuredTarget && row === featuredTarget.row) {
      return {
        pathX: featuredTarget.cx,
        closestPeg: featuredTarget,
        bounceIntensity: 0.92,
      };
    }

    let pathX = laneX;
    if (steerTowardFeatured && featuredTarget && row < featuredTarget.row) {
      const rowsUntil = Math.max(1, featuredTarget.row - row);
      const biasStrength = Math.min(0.42, 0.16 + 0.05 / rowsUntil);
      pathX = laneX + (featuredTarget.cx - laneX) * biasStrength;
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
    const finalDistance = Math.abs(pathX - closestPeg.cx);
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
      // Legacy / bonus-ball drops name no coin — ANY coin credits there, so any coin may be taken.
      if (ball.bonusPegEmitRow < 0 || ball.bonusPegEmitCol < 0) {
        return this.pickNearestPeg(rowPegs, ball.x, false) ?? pathPoint.closestPeg;
      }
      // Carrying a credit is not a licence to hit every coin. Picking the nearest of ALL the row's
      // pegs let a ball bound for the row-5 coin bounce off whichever of the row-3 pair it passed
      // closest to — a coin that cannot pay, so it lit up and stayed silent. Its own coin, or none.
      const designated =
        pathPoint.row === ball.bonusPegEmitRow ? this.designatedCoinPeg(ball) : null;
      if (designated) {
        const nearestRegular = this.pickNearestPeg(regularPegs, ball.x, false);
        if (
          !nearestRegular ||
          Math.abs(ball.x - designated.cx) <= Math.abs(ball.x - nearestRegular.cx)
        ) {
          return designated;
        }
        return nearestRegular;
      }
      // No coin of its own in this row, so it has to clear the ones that are here: fall through to
      // the same regular/flank routing a ball with no credit at all gets.
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
        Math.abs(ball.x - pathPoint.closestPeg.cx) <= this.pegSpacingXForRow(pathPoint.row) * 0.58 &&
        ball.y >= pathPoint.closestPeg.cy - this.pegRadius * 0.65 &&
        ball.y <= pathPoint.closestPeg.cy + this.pegRadius * 0.8;
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

    // A pocket whose centre sits directly under a bottom-row peg cannot take a straight vertical
    // finish. Only the SPIN pocket qualifies: its centre is the board centre, which is exactly the
    // middle peg's column on the 17-peg bottom row (every other pocket centre lands 0.5+ lanes from
    // the nearest column). `planTargetConvergence` parks the lane on that very peg, and the landing
    // point used to be the pocket centre — the same column — so the last bounce got `travelDir 0`
    // and the ball fell VERTICALLY off the crown, straight through the peg's body, into the pocket.
    // The fix is the landing point alone: it moves half a lane to one side, which turns the last
    // bounce into a shoulder hit that deflects the ball past the peg — the arc holds it above the
    // crown while the lane easing carries it off the column, so the descent clears the body. The
    // pocket mouth is ~2 lanes wide, so a half-lane entry point is still comfortably inside it.
    const lastRowIndex = this.rows - 1;
    let finishGuardPeg: Peg | null = null;
    for (const peg of this.pegsByRow.get(lastRowIndex) ?? []) {
      if (Math.abs(peg.cx - targetX) < peg.solidRadius + this.ballRadius) {
        finishGuardPeg = peg;
        break;
      }
    }

    // Turn split from the slot's ACTUAL x, not a proportional index mapping. The pockets are neither
    // evenly spaced (the centre one is ~1.9× wide) nor confined to the walk's reach — 12 rows of
    // half-spacing steps only span ±6 spacings, while the outer slot centres sit at ±7.69 — so the
    // old `round(targetIndex / (slots-1) * rows)` left a systematic end-gap of up to 1.69 spacings
    // for the final, bounce-free segment to cover in one sideways lurch.
    const halfStep = this.pegSpacingXForRow(this.rows - 1) / 2;
    const desiredSteps = halfStep > 0 ? (targetX - centerX) / halfStep : 0;
    let netSteps = Math.round(desiredSteps);
    // `rightTurns - leftTurns` must share parity with the row count for both to be whole numbers;
    // when it doesn't, nudge toward the value we actually wanted.
    if (Math.abs(netSteps % 2) !== this.rows % 2) netSteps += desiredSteps > netSteps ? 1 : -1;
    netSteps = Math.max(-this.rows, Math.min(this.rows, netSteps));
    const rightTurns = (this.rows + netSteps) / 2;
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

    // Where the ball actually comes to rest. Identical to the pocket centre except over a guard
    // peg, where it sits half a lane to one side — mid-gap between the guard peg and its
    // neighbour, clear of both, still well inside the pocket mouth. The side draw only runs for
    // guarded pockets, so every other ball's deterministic random stream is untouched.
    let landingX = targetX;
    if (finishGuardPeg) {
      const side = nextRandom() < 0.5 ? -1 : 1;
      const halfLane = this.pegSpacingXForRow(lastRowIndex) / 2;
      const halfMouth = Math.max(0, targetSlot.width / 2 - this.ballRadius * 1.4);
      const clearance = finishGuardPeg.solidRadius + this.ballRadius * 1.15;
      // The mouth cap wins over the clearance floor: coming to rest inside the PAID pocket is the
      // one thing the landing may never trade away.
      landingX = finishGuardPeg.cx + side * Math.min(halfMouth, Math.max(clearance, halfLane));
    }

    const featuredTarget = pathOptions?.hitBonusPeg
      ? this.pickFeaturedPegForPath(pathOptions.pathSeed)
      : null;
    // Which side the ball leaves its coin on. A top coin always bounces its ball OUTWARD, away
    // from the cluster; the bottom coin sits on the centroid, so its ball leaves on a seeded
    // coin-flip. The draw only runs for bottom-coin balls, leaving every other ball's
    // deterministic random stream untouched.
    const featuredExitSide: 1 | -1 = !featuredTarget
      ? 1
      : Math.abs(featuredTarget.cx - this.featuredCentroidX) > this.ballRadius
        ? featuredTarget.cx > this.featuredCentroidX
          ? 1
          : -1
        : nextRandom() < 0.5
          ? -1
          : 1;
    const avoidFeaturedPegs = pathOptions?.deterministic === true && pathOptions?.hitBonusPeg !== true;
    const steerToFeatured = pathOptions?.hitBonusPeg === true && featuredTarget != null;
    const galtonLane = this.buildGaltonLane(turns, centerX);

    // Off-centre entry: shift the whole lane sideways at the top and ease it back onto the Galton
    // lane by the lower-middle rows.
    const entryShape = this.planEntryLaneShape(spawnDirection, targetIndex, nextRandom);
    const entryOffsets =
      avoidFeaturedPegs || steerToFeatured
        ? entryShape.offsets
        : this.dampEntryWanderNearFeatured(galtonLane, entryShape.offsets);

    // One flank-jitter draw per ball, taken OUTSIDE buildLane so the governor's fallback rebuilds
    // reuse it instead of consuming fresh randomness per attempt.
    const flankRoll = nextRandom();

    // The coin-peg planners run on the SHAPED lane, not the raw Galton one, so they see where the
    // ball will actually be — otherwise a wandering lane could stroll into a coin the avoidance plan
    // believed was nowhere near it.
    const buildLane = (entryScale: number): { lane: number[]; flanks: Map<number, Peg> } => {
      const shaped = galtonLane.map((laneX, row) =>
        this.clampLaneToRow(row, laneX + (entryOffsets[row] ?? 0) * entryScale),
      );
      let offsets: number[];
      let flanks: Map<number, Peg>;
      if (avoidFeaturedPegs) {
        const avoidancePlan = this.planSmoothFeaturedAvoidance(shaped, targetX, flankRoll);
        offsets = avoidancePlan.offsets;
        flanks = avoidancePlan.flankPegByRow;
      } else if (steerToFeatured && featuredTarget) {
        offsets = this.planSmoothFeaturedApproach(shaped, featuredTarget, featuredExitSide);
        flanks = new Map<number, Peg>();
      } else {
        offsets = new Array<number>(this.rows).fill(0);
        flanks = new Map<number, Peg>();
      }
      const coinLane = shaped.map((laneX, row) =>
        this.clampLaneToRow(row, laneX + (offsets[row] ?? 0)),
      );
      // Last: close the residual gap onto the slot centre. Applied on top of the coin plan (whose
      // rows are all well above the ramp) so it can never pull the lane back into the cluster.
      const converge = this.planTargetConvergence(coinLane, targetX);
      return {
        // Last word on the lane: whatever the plans and the convergence ramp worked out, the ball
        // may not be routed through a coin it is not meant to hit.
        lane: coinLane.map((laneX, row) => {
          // Where this lane goes NEXT, so a coin detour is taken on the side the ball is already
          // leaving toward rather than merely the nearer one — see `clampLaneClearOfCoins`.
          const nextRow = row + 1;
          const headingX =
            nextRow < coinLane.length
              ? (coinLane[nextRow] ?? targetX) + (converge[nextRow] ?? 0)
              : landingX;
          return this.clampLaneClearOfCoins(
            row,
            this.clampLaneToRow(row, laneX + (converge[row] ?? 0), targetX),
            featuredTarget,
            headingX,
          );
        }),
        flanks,
      };
    };

    // Naturalness governor. A wide entry that the coin-avoidance plan then routes around the
    // OPPOSITE flank can demand two-plus peg spacings of sideways travel in a single row gap, which
    // reads as the ball sliding rather than falling. Back the wander off until every step fits.
    // The last fallback is 0 (pure Galton lane), so this can only ever match the old behaviour.
    let lanePlan = buildLane(1);
    for (const scale of PlinkoEngine.ENTRY_WANDER_FALLBACK_SCALES) {
      if (this.maxLaneStepRatio(lanePlan.lane) <= PlinkoEngine.LANE_MAX_STEP_RATIO) break;
      lanePlan = buildLane(scale);
    }
    const shapedLane = lanePlan.lane;
    const flankPegByRow = lanePlan.flanks;

    const spawnX = spawn.x + spawnMouthOffset;
    const entryY = this.topMargin - this.pegSpacing * 0.32;

    // Aim the peg-field entry most of the way at wherever the lane actually starts, so a wide entry
    // doesn't have to make up the whole sideways distance in the one segment below the mouth (which
    // would read as a sideways teleport rather than a throw). A centre entry is unchanged.
    const firstRowLaneX = shapedLane[0] ?? centerX;
    const launchBiasedX = centerX + spawnLaneBias;
    const entryX = this.clampLaneToRow(
      0,
      launchBiasedX + (firstRowLaneX - launchBiasedX) * PlinkoEngine.ENTRY_APPROACH_RATIO,
    );
    // Throw harder the further out the ball is entering, so the arc out of the mouth stays in
    // proportion to the distance it has to cover.
    const launchBurstRatio =
      PlinkoEngine.SPAWN_LAUNCH_BURST_RATIO *
      (1 + Math.min(1, entryShape.columns / PlinkoEngine.ENTRY_WANDER_MAX_COLUMNS));

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
      x: spawnX + spawnDirection * this.pegSpacingXForRow(0) * launchBurstRatio,
      y: spawn.y + (entryY - spawn.y) * PlinkoEngine.SPAWN_LAUNCH_APEX_FALL,
      row: -1,
      closestPeg: null,
      bounceIntensity: 0,
      travelDir: 0,
    });
    // Peg-field entry, lined up with the first row's lane.
    path.push({
      x: entryX,
      y: entryY,
      row: -1,
      closestPeg: null,
      bounceIntensity: 0,
      travelDir: 0,
    });

    for (let row = 0; row < this.rows; row++) {
      const rowY = this.topMargin + this.pegSpacing * 0.5 + row * this.pegSpacing;
      const laneX = shapedLane[row] ?? centerX;

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
          ? featuredTarget.cx
          : row + 1 < this.rows
            ? (shapedLane[row + 1] ?? targetX)
            : landingX;
      const pegX = closestPeg?.cx ?? pathX;
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
      x: landingX,
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

    // Freeze which side of every coin body this ball passes on, read off the plan's own row
    // positions (already clamped clear of the coins). See `coinPassSides` on Ball.
    const coinPassSides: Record<string, 1 | -1> = {};
    for (const coin of this.featuredPegs) {
      const rowIndex = path.findIndex((p) => p.row === coin.row);
      if (rowIndex < 0) continue;
      // A row point sitting ON the coin is the designated hit — its side is the EXIT side, which
      // the next row's point (the planned walk off the coin) carries. The post-hit glide reads
      // this side to usher the ball out instead of holding it on the coin.
      let refX = path[rowIndex].x;
      if (Math.abs(refX - coin.cx) < 0.001 && rowIndex + 1 < path.length) {
        refX = path[rowIndex + 1].x;
      }
      coinPassSides[coin.key] = refX >= coin.cx ? 1 : -1;
    }
    for (const blocker of this.coinGapBlockers) {
      const rowPoint = path.find((p) => p.row === blocker.row);
      if (rowPoint) coinPassSides[blocker.key] = rowPoint.x >= blocker.cx ? 1 : -1;
    }

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
      // is the cruise base speed; the max() keeps normal mode's slightly-faster historical launch —
      // itself scaled by `slowMotionScale`, or it would be a full-speed floor under a slowed board.
      currentSpeed: Math.max(
        this.pyramidConfig.normalSpeed * this.slowMotionScale,
        this.pyramidConfig.normalSpeed * this.animationSpeed
      ),
      isInBounce: false,
      bounceStartTime: 0,
      bounceDuration: this.pyramidConfig.bounceDuration,
      hopSlowdownScale: 1,
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
      coinSfxTime: Number.NEGATIVE_INFINITY,
      coinSfxRow: -1,
      coinSfxCol: -1,
      coinSfxFeatured: false,
      bounceCarryY: 0,
      collisionOffsetX: 0,
      collisionOffsetY: 0,
      laneBaseX: path[0].x,
      coinPassSides,
      coinKickX: 0,
      coinKickY: 0,
      coinKickVX: 0,
      coinKickVY: 0,
      coinKickPegKey: '',
      coinKickTime: Number.NEGATIVE_INFINITY,
      coinKickSide: 1,
      ...traits,
    };

    this.balls.push(ball);

    if (!this.isAnimating) {
      this.isAnimating = true;
      boardVitals.animating = true;
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
    let steps = Math.floor(elapsedMs / PlinkoEngine.FIXED_STEP_MS);
    if (steps > PlinkoEngine.HIDDEN_MAX_STEPS_PER_TICK) {
      // Drop the backlog after a long stall so returning/odd timers can't fast-forward minutes.
      steps = PlinkoEngine.HIDDEN_MAX_STEPS_PER_TICK;
      this.hiddenStepCarryMs = 0;
    } else {
      this.hiddenStepCarryMs = elapsedMs - steps * PlinkoEngine.FIXED_STEP_MS;
    }
    for (let i = 0; i < steps && this.isAnimating; i++) {
      this.simClockMs += PlinkoEngine.FIXED_STEP_MS;
      this.stepPhysics(this.simClockMs);
      this.retireFinishedBalls();
    }
  }

  /**
   * Ticker callback. Rendered frames are a sampling rate, not a clock: this converts the real time
   * since the last paint into whole FIXED_STEP_MS physics steps, runs them, then draws ONCE. A drop
   * therefore falls at the same wall-clock speed whether the device paints at 144 Hz, 60 Hz, or the
   * ~15 fps of a 4x CPU throttle — where the old one-advance-per-paint loop ran 4x slow.
   *
   * Never force a minimum of one step: above 60 Hz a frame legitimately steps zero times and the
   * carry averages it out. Forcing one would make a 144 Hz display run 2.4x fast again.
   */
  private animateFrame(deltaMS: number): void {
    if (!this.app) return;
    if (!this.isAnimating) return;

    const frameMs = Math.min(
      PlinkoEngine.MAX_FRAME_DELTA_MS,
      Math.max(0, Number.isFinite(deltaMS) ? deltaMS : PlinkoEngine.FIXED_STEP_MS)
    );
    this.smoothedFrameMs += (frameMs - this.smoothedFrameMs) * 0.15;

    const elapsedMs = this.frameStepCarryMs + frameMs;
    let steps = Math.floor(elapsedMs / PlinkoEngine.FIXED_STEP_MS);
    if (steps > PlinkoEngine.MAX_STEPS_PER_FRAME) steps = PlinkoEngine.MAX_STEPS_PER_FRAME;
    // Clamped to a single step so a capped frame can't hand the next one a pre-loaded backlog.
    this.frameStepCarryMs = Math.min(
      elapsedMs - steps * PlinkoEngine.FIXED_STEP_MS,
      PlinkoEngine.FIXED_STEP_MS
    );
    if (steps === 0) return;

    for (let i = 0; i < steps && this.isAnimating; i++) {
      // Each sub-step gets its own instant on the SIM clock: bounce arcs, peg glows and slot
      // bounces are all timestamped from it, so handing several sub-steps of one throttled frame
      // the same instant would desync the hops from the path advance they belong to.
      this.simClockMs += PlinkoEngine.FIXED_STEP_MS;
      this.stepPhysics(this.simClockMs);
    }

    this.drawFrame(this.simClockMs);
    this.retireFinishedBalls();
  }

  /** One fixed physics step: advance every ball, fire its events, then separate overlaps. No drawing. */
  private stepPhysics(currentTime: number): void {
    for (let i = 0; i < this.balls.length; i++) {
      const ball = this.balls[i];
      if (ball.isDropping) {
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
          if (ball.bonusPegEmitRow >= 0 && ball.bonusPegEmitCol >= 0) {
            const coinPeg = this.designatedCoinPeg(ball);
            if (coinPeg) {
              // Route the credit through the shared emitter so the coin lights up and the chime
              // plays here too. This branch used to credit the meter in silence whenever the
              // contact test hadn't already fired, which is the hit-but-no-SFX case.
              this.emitCoinPegContact(ball, coinPeg, currentTime);
            } else {
              // No peg to light (the designated coin isn't in the current featured set), but the
              // meter still fills — so the chime still has to play, or the credit lands in silence.
              ball.bonusPegEmitted = true;
              ball.coinSfxTime = currentTime;
              ball.coinSfxRow = ball.bonusPegEmitRow;
              ball.coinSfxCol = ball.bonusPegEmitCol;
              ball.coinSfxFeatured = true;
              this.emitPegBounce({
                row: ball.bonusPegEmitRow,
                col: ball.bonusPegEmitCol,
                ballId: ball.id,
                featured: true,
              });
              this.emitCoinPegHit({
                row: ball.bonusPegEmitRow,
                col: ball.bonusPegEmitCol,
                ballId: ball.id,
              });
            }
          } else {
            ball.bonusPegEmitted = true;
          }
        }

        let baseX = 0;
        let baseY = 0;
        if (segmentIndex < pathLength - 1) {
          const pointA = ball.path[segmentIndex];
          const pointB = ball.path[segmentIndex + 1];
          // Finish the sideways move by the time the ball meets the peg's CROWN, not its centre.
          //
          // Contact happens where the crown is — about 0.86 of the way down a segment — but the lane
          // transition was still only ~94.5% complete there, so the ball bounced a systematic 0.8px
          // SHORT of the peg column, always on the trailing side. Unlike the random terms
          // (`velocityX`, `laneOffsetX`) this one is a bias in a fixed direction, so it reads as the
          // ball never quite landing on the peg. Compressing the transition into the part of the
          // segment that ends at the crown puts the ball on the peg's column at the moment it
          // arrives, and holds it there for the short remainder.
          const crownFraction = Math.max(
            0.5,
            1 - (this.pegRadius * 0.92) / Math.max(1, this.pegSpacing)
          );
          const laneT = this.easeSmoothstep(Math.min(1, segmentFraction / crownFraction));
          // Vertical easing is chosen PER SEGMENT, and this is the single biggest thing separating
          // the descent from a real one.
          //
          // `easeInQuad` restarts at zero on every segment, so the ball's fall rate is reset to a
          // standstill at every peg row and has to build again. Sampled off a live drop, the
          // per-frame fall through one peg read:
          //
          //   ... 2.07  2.22  2.36  2.50 | 0.49  0.24 | 0.45  0.66  0.86 ...
          //
          // — accelerating cleanly, then collapsing to a fiftieth of its speed and starting over.
          // The incoming velocity is simply discarded at the boundary. Twelve of those on the way
          // down is the shake, and no amount of tuning the bounce hides it, because it is the BASE
          // path stuttering underneath the bounce.
          //
          // On a segment the ball hops across, the arc already supplies the vertical curve — a
          // linear base plus a sine arc is, to within the shape of the arc, projectile motion, and
          // its velocity is continuous across the boundary (the only jump is the arc reversing,
          // which is exactly what a bounce is). Segments with no hop under them — the entry fall
          // from the skull and the long final drop into the slot — keep `easeInQuad`, because there
          // the ball genuinely is in free fall and should accelerate.
          const segDeltaY = Math.abs(pointB.y - pointA.y);
          const hopsThisSegment =
            pointA.bounceIntensity > 0 && segDeltaY <= this.pegSpacing * 1.5;
          const fallT = hopsThisSegment ? segmentFraction : this.easeInQuad(segmentFraction);
          baseX = pointA.x + (pointB.x - pointA.x) * laneT;
          baseY = pointA.y + (pointB.y - pointA.y) * fallT;
        } else {
          const lastPoint = ball.path[pathLength - 1];
          baseX = lastPoint.x;
          baseY = lastPoint.y;
        }
        ball.laneBaseX = baseX;

        if (ball.isInBounce) {
          const bounceElapsed = currentTime - ball.bounceStartTime;
          const bounceProgress = Math.min(1, bounceElapsed / ball.bounceDuration);
          if (bounceProgress >= 1) {
            ball.isInBounce = false;
            ball.bounceTravelDir = 0;
            ball.bounceCarryY = 0;
            ball.velocityX *= 0.78;
            ball.x =
              baseX +
              ball.velocityX * this.pyramidConfig.laneCentering +
              ball.laneOffsetX +
              ball.collisionOffsetX +
              ball.coinKickX;
            ball.y = baseY + ball.velocityY + ball.collisionOffsetY + ball.coinKickY;
          } else {
            // Whatever height the previous hop still had when this one cut it short is added on and
            // faded out across this arc, so the handover is seamless (see `bounceCarryY`).
            const arcHeight =
              this.pyramidConfig.bounceAmplitude *
                ball.bounceHeightMultiplier *
                Math.sin(bounceProgress * Math.PI) *
                this.bounceScale +
              ball.bounceCarryY * (1 - bounceProgress);
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
              ball.collisionOffsetX +
              ball.coinKickX;
            ball.y = baseY + ball.velocityY - arcHeight + ball.collisionOffsetY + ball.coinKickY;
          }
        } else {
          ball.x =
            baseX +
            ball.velocityX * this.pyramidConfig.laneCentering +
            ball.laneOffsetX +
            ball.collisionOffsetX +
            ball.coinKickX;
          ball.y = baseY + ball.velocityY + ball.collisionOffsetY + ball.coinKickY;
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
        // Always run peg collisions so the ball still bounces; peg glow/scale is gated in drawActivePegs.
        this.checkForBounce(ball, currentTime);

        if (!ball.targetReached && ball.currentPoint >= 0.99) {
          ball.targetReached = true;
          ball.isDropping = false;
          if (this.animationEnabled) {
            this.triggerSlotAnimation(ball, currentTime);
          }
          const spinSlotIndex = Math.floor(this.slots.length / 2);
          this.emitBallDropped({
            multiplier: ball.target,
            ballId: ball.id,
            slotIndex: ball.targetIndex,
            isSpinSlot: ball.targetIndex === spinSlotIndex
          });
        }
      } else if (ball.scale > 0) {
        ball.scale *= 0.93;
        if (ball.scale < 0.05) ball.scale = 0;
      }
    }

    this.resolveBallCollisions();
    // Last thing in the step, after ball-ball separation has had its say — that writes positions
    // directly and could otherwise shove a ball into a coin behind this constraint's back.
    this.separateBallsFromCoins(currentTime);
  }

  /**
   * Hard guarantee that no ball is ever drawn inside a coin.
   *
   * Everything above this positions the ball by ADDING offsets to a path, and that path runs through
   * the peg rows — `path[i].y` is the row's centre line, so the ball's centre is meant to pass
   * through each peg. For a regular peg that is fine and is what the board has always looked like:
   * the body is 5.7px against a 9.3px ball, so the ball simply covers it. A coin is 18.1px — nearly
   * twice the ball's radius — so the same motion draws the ball fully SWALLOWED by the coin, and
   * then sliding back out the other side. That is the pass-through, and no amount of tuning the
   * bounce fixes it, because the bounce only decides when to add an arc, not where the surface is.
   *
   * So state the constraint directly instead: a ball's centre may never be nearer a coin's centre
   * than `solidRadius + ballRadius`. Any ball inside is pushed back out along the contact normal,
   * which is also what makes it ride over the coin's shoulder rather than through it — the "slides
   * off the coin" read. Applies to coins only, deliberately: extending it to regular pegs would lift
   * the ball off every peg centre on the board and change the whole descent.
   *
   * Only three coins exist, and the row test rejects almost every pair immediately.
   */
  private separateBallsFromCoins(currentTime: number): void {
    if (!this.featuredPegs.length) return;
    const ballRadius = this.ballRadius;
    for (let b = 0; b < this.balls.length; b++) {
      const ball = this.balls[b];
      if (!ball.isDropping || ball.scale <= 0) continue;

      // Resolve against ONE coin per step — the one the ball is deepest into.
      //
      // Pushing it out of every coin in sequence is what made it shake: clearing the left coin drove
      // it into the right one, whose push drove it back, and the rendered position was whichever
      // contradiction the loop ended on. With the cluster no longer squeezed (COIN_CLUSTER_PULL),
      // the coins do not overlap each other and one contact per step is both stable and sufficient.
      // The one ball allowed down a slot is the one whose coin sits BELOW it — that is the only way
      // in, and it is supposed to be there. Everyone else meets the plug.
      const target = this.designatedCoinPeg(ball);
      // A ball with no coin credit gets the coins padded out a little (see COIN_AVOID_PAD_BALLS),
      // so its closest approach is a visible near miss rather than a rim kiss. Credit balls keep
      // the true surface — their designated coin is a real contact, and the ball threading the
      // slot between the row-3 pair needs the corridor at its full width.
      const avoidPad = ball.creditBonusPegHit
        ? 0
        : ballRadius * PlinkoEngine.COIN_AVOID_PAD_BALLS;
      let peg: { cx: number; cy: number; solidRadius: number; key: string } | null = null;
      let pegCoin: Peg | null = null;
      let pegPad = 0;
      let dx = 0;
      let dy = 0;
      let deepest = 0;
      const bodies = this.featuredPegs.length + this.coinGapBlockers.length;
      for (let p = 0; p < bodies; p++) {
        let candidate: { cx: number; cy: number; solidRadius: number; key: string };
        let candidateCoin: Peg | null = null;
        let candidatePad = 0;
        if (p < this.featuredPegs.length) {
          candidateCoin = this.featuredPegs[p];
          candidate = candidateCoin;
          candidatePad = avoidPad;
        } else {
          const blocker = this.coinGapBlockers[p - this.featuredPegs.length];
          if (
            ball.creditBonusPegHit &&
            target &&
            target.row > blocker.row &&
            target.cx > blocker.minCx &&
            target.cx < blocker.maxCx
          ) {
            continue;
          }
          candidate = blocker;
        }
        const cdx = ball.x - candidate.cx;
        const cdy = ball.y - candidate.cy;
        const reach = candidate.solidRadius + ballRadius + candidatePad;
        const overlap = reach - Math.hypot(cdx, cdy);
        if (overlap > deepest) {
          deepest = overlap;
          peg = candidate;
          pegCoin = candidateCoin;
          pegPad = candidatePad;
          dx = cdx;
          dy = cdy;
        }
      }

      if (peg) {
        const minDist = peg.solidRadius + ballRadius + pegPad;
        const dist = Math.hypot(dx, dy);

        // A contact that cannot pay is not a hit — it is a near miss to be steered wider.
        //
        // The kick below used to fire for EVERY ball touching a coin, so a ball the RGS never
        // meant to hit one still visibly ricocheted off it, which reads as a bonus hit that then
        // pays nothing. Those balls now GLIDE: the overlap is resolved sideways only (the descent
        // is untouched), on the side the ball is already on, and the lateral pressure that pushed
        // the ball in is bled off so it eases past instead of grinding the rim. The gap blockers
        // take the same treatment — an impulse off an invisible body read as the ball bouncing off
        // thin air between the coins.
        // The paying hold lasts only until the hit is DELIVERED — meter credited and the ricochet
        // kicked. After that the coin owes this ball nothing, and keeping the on-surface hold just
        // re-seated the ball on the coin's face every time the departure arc dipped back into the
        // disc: the "lands on the coin a second time and sticks" look. Once delivered, the coin is
        // treated like any body the ball may not touch — the one-sided glide below, whose frozen
        // side is the planned EXIT side, ushers it out instead of catching it again.
        const hitDelivered =
          ball.bonusPegEmitted && pegCoin != null && ball.coinKickPegKey === pegCoin.key;
        const credits = pegCoin != null && this.coinPegCredits(ball, pegCoin) && !hitDelivered;
        if (!credits) {
          // One-sided lateral clamp, anchored to the PLAN.
          //
          // Every earlier cut of this branch anchored the keep-out to something read live — the
          // side the ball touched on, the rim under it, the interpolated lane. All of those can
          // change sides mid-encounter (the rows above a coin are not clamped, so the lane's
          // diagonal into the coin row can cross the coin's centreline inside its disc), and every
          // side flip turned the keep-out into an escort through the coin: fast sideways, phasing,
          // rim-sliding. `coinPassSides` was frozen at path build from the plan's own clamped row
          // position, so it cannot flip — the clamp is monotone for the whole flight, and crossing
          // a coin is geometrically impossible. The offsets riding on the lane (bounce impulse,
          // wobble, burst push) are absorbed at the boundary instead of carrying the ball onto the
          // coin, and the descent is untouched — no rim-following, no riding over the crown — so a
          // close pass reads as the ball declining to swerve into the coin, not as a contact.
          const passSide = ball.coinPassSides[peg.key];
          const laneDx = ball.laneBaseX - peg.cx;
          const side: 1 | -1 =
            passSide ??
            (Math.abs(laneDx) > 0.0001
              ? (Math.sign(laneDx) as 1 | -1)
              : ball.coinKickPegKey === peg.key
                ? ball.coinKickSide
                : ball.velocityX < 0
                  ? -1
                  : 1);
          ball.coinKickPegKey = peg.key;
          ball.coinKickTime = currentTime;
          ball.coinKickSide = side;
          // Where the (padded) disc's edge is at the ball's CURRENT height, on the lane's side.
          // `overlap > 0` guarantees |dy| < minDist, so the root is real.
          const lateral = Math.sqrt(Math.max(0, minDist * minDist - dy * dy));
          const boundary = peg.cx + side * lateral;
          const desiredX = side > 0 ? Math.max(ball.x, boundary) : Math.min(ball.x, boundary);
          // Backstop only. The clamp moves WITH the lane rather than against it, so the normal
          // correction is the offsets' overshoot — a couple of px. The cap exists for the one
          // transient that can ask for more (the lane's mid-segment diagonal clipping a coin's
          // shoulder), spreading that correction over a few frames instead of one.
          const maxGlidePush = ballRadius * 0.9;
          const pushDelta = desiredX - ball.x;
          ball.x +=
            Math.abs(pushDelta) <= maxGlidePush
              ? pushDelta
              : Math.sign(pushDelta) * maxGlidePush;
          if (Math.sign(ball.velocityX) === -side) ball.velocityX *= 0.7;
          if (Math.sign(ball.collisionOffsetX) === -side) ball.collisionOffsetX *= 0.7;
          continue;
        }

        // Fire the ricochet on the step the ball first reaches this coin. It lives here, not in
        // `checkForBounce`, because that only ever resolves a coin as the bounce peg for the ONE
        // ball designated to cash it. Only that designated hit reaches this point now — everyone
        // else took the glide above — so the ricochet is exclusively the paying contact's cue.
        const isNewContact =
          ball.coinKickPegKey !== peg.key ||
          currentTime - ball.coinKickTime > PlinkoEngine.COIN_KICK_RECONTACT_MS;
        if (isNewContact) {
          ball.coinKickPegKey = peg.key;
          ball.coinKickTime = currentTime;
          // The ricochet leaves on the PLANNED exit side — the same side the lane below the coin
          // walks off toward — so the kick and the path pull together instead of fighting. (It
          // encodes "outward" for a top coin and the seeded coin-flip for the bottom one.) The
          // landed-side reading is only the fallback for a ball with no planned side: it is
          // residual-velocity noise on a dead-centre arrival, and half the time it threw the
          // ricochet against the lane — the ball swung out and was hauled straight back.
          const nx0 = dist > 0.0001 ? dx / dist : 0;
          const plannedExit = ball.coinPassSides[peg.key];
          if (plannedExit != null) {
            ball.coinKickSide = plannedExit;
          } else {
            ball.coinKickSide =
              Math.abs(nx0) > 0.15 ? (Math.sign(nx0) as 1 | -1) : ball.velocityX < 0 ? -1 : 1;
            const outward = peg.cx - this.featuredCentroidX;
            if (Math.abs(outward) > ballRadius) {
              ball.coinKickSide = outward > 0 ? 1 : -1;
            }
          }
          let nx = nx0;
          let ny = dist > 0.0001 ? dy / dist : -1;
          nx += ball.coinKickSide * PlinkoEngine.COIN_KICK_SIDE_BIAS;
          const biased = Math.hypot(nx, ny) || 1;
          const speed = minDist * PlinkoEngine.COIN_KICK_SPEED;
          ball.coinKickVX = (nx / biased) * speed;
          ball.coinKickVY = (ny / biased) * speed;
        }

        // Hold the ball on the side it bounced off until it is clear of the coin.
        //
        // The impulse alone cannot win this: the ball's LANE is what carries it across. A ball that
        // lands on one shoulder and is heading for a peg on the other side has a path aimed straight
        // through the coin, so it gets dragged over the crown while the separation below keeps
        // re-seating it on whichever face is nearest — over the top, toward the middle, down the far
        // side. That is the slide, and it is a property of the path, not of the impulse.
        //
        // Refusing the crossing turns the same motion into the right one: the ball stays on its own
        // shoulder and the separation walks it down that face and off the edge, which is what a ball
        // landing off-centre on something round actually does.
        const held =
          ball.coinKickPegKey === peg.key
            ? ball.coinKickSide > 0
              ? Math.max(ball.x, peg.cx)
              : Math.min(ball.x, peg.cx)
            : ball.x;
        const hdx = held - peg.cx;
        const hDist = Math.hypot(hdx, dy);
        if (hDist < 0.0001) {
          // Dead centre: no normal to push along, so lift straight up — the ball arrived falling.
          ball.x = held;
          ball.y = peg.cy - minDist;
          continue;
        }
        const scale = minDist / hDist;
        // Correction is applied to the position only, deliberately. Banking it into `coinKickX` so
        // it would ease out instead of ending abruptly was tried and measured WORSE on a live drop
        // (worst single-frame reversal 3.3px -> 5.2px, on a ball 6.1px across): the banked push
        // compounds with the ricochet velocity already feeding that offset, so it overshoots.
        ball.x = peg.cx + hdx * scale;
        ball.y = peg.cy + dy * scale;
      }
    }
  }

  /**
   * One rendered frame's worth of drawing, however many physics steps preceded it.
   *
   * Balls are redrawn every frame — they carry the motion, so skipping them is what actually reads
   * as stutter. The effect layers (peg glows, slot bounces) are decorative and get thinned out when
   * the frame budget is already blown, either by a big ball burst or by a slow/throttled device.
   */
  private drawFrame(currentTime: number): void {
    this.frameTick++;

    const slowFrame = this.smoothedFrameMs > PlinkoEngine.SLOW_FRAME_MS;
    const verySlowFrame = this.smoothedFrameMs > PlinkoEngine.VERY_SLOW_FRAME_MS;
    const heavyLoad = this.balls.length >= 8 || slowFrame;
    const effectInterval = verySlowFrame ? 3 : heavyLoad ? 2 : 1;
    // A frame that lit a peg always draws: the thinning may cost a fade its smoothness, never a hit
    // its timing. The sound already fires on the contact step, so a skipped frame here is precisely
    // what put the glow behind the thunk.
    if (this.frameTick % effectInterval === 0 || this.pegContactPending) {
      if (this.hasActiveSlotVisuals()) {
        this.drawAllSlotsPixi(currentTime);
      }
      this.drawActivePegs(currentTime);
      this.pegContactPending = false;
    }
    this.drawBallsPixi(slowFrame);
  }

  /** Compact out balls that have finished and faded, and park the ticker once nothing is moving. */
  private retireFinishedBalls(): void {
    let activeBalls = 0;
    let nextLiveBallIndex = 0;
    for (let i = 0; i < this.balls.length; i++) {
      const ball = this.balls[i];
      if (ball.scale > 0 || ball.isDropping) {
        activeBalls++;
        this.balls[nextLiveBallIndex++] = ball;
      }
    }
    this.balls.length = nextLiveBallIndex;

    if (activeBalls === 0) {
      this.isAnimating = false;
      this.stopTicker();
      this.frameStepCarryMs = 0;
      this.smoothedFrameMs = PlinkoEngine.FIXED_STEP_MS;
      // Also runs for the hidden-tab driver: rAF is paused there, so this is the scene state the
      // renderer will paint the moment the tab comes back. Without it the settled balls would still
      // be sitting in `ballsGraphics` and would flash back on screen mid-drop.
      this.drawStaticPyramid();
    }
  }

  /**
   * Whether a pocket still needs drawing. Keyed on the flag alone, NOT on the animation still being
   * inside its duration.
   *
   * `resolveSlotAnimationOffset` is what retires a finished bounce — it clears `animationActive` and
   * zeroes the offset — and it only runs from `drawAllSlotsPixi`, which only runs when this returns
   * true. Gating on `elapsed < slotAnimationDuration` therefore switched the draw off one frame
   * BEFORE the frame that settles the pocket: the tile kept whatever offset the last in-window frame
   * left on it and stayed flagged active until something else redrew the board. Returning true while
   * the flag is set costs exactly one more slot pass per landing and puts the pocket back at rest.
   */
  private hasActiveSlotVisuals(): boolean {
    for (let i = 0; i < this.slots.length; i++) {
      if (this.slots[i].animationActive) return true;
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

    // Sweep and prune on y. Balls in a burst are strung out down the board, so once `b` is further
    // than one separation below `a` nothing after it can touch `a` either and the inner loop stops.
    // A 50-ball burst goes from ~3.7k distance tests per physics step to a few hundred — and with a
    // fixed timestep a throttled frame runs several steps, so this is now paid several times over.
    dropping.sort((a, b) => a.y - b.y);

    for (let pass = 0; pass < passes; pass++) {
      for (let i = 0; i < dropping.length; i++) {
        const a = dropping[i];
        for (let j = i + 1; j < dropping.length; j++) {
          const b = dropping[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          if (dy >= minSep) break;
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
    // Every per-step term below is scaled by this so the WHOLE speed model moves with the sim speed,
    // not just `normalSpeed`. It is exactly 1 in normal play and in Fast Game — see `slowMotionScale`.
    const slow = this.slowMotionScale;
    let baseSpeed = this.pyramidConfig.normalSpeed * this.animationSpeed;
    baseSpeed += this.pyramidConfig.gravityEffect * (ball.currentPoint + 0.5) * slow;
    // `hopSlowdownScale` re-fits the slowdown to a hop that now spans a whole row instead of ~70% of
    // one, so the row still takes exactly as long as it does today (see `fitHopToRow`). It is 1 for
    // a ball that has not bounced yet, which leaves the entry fall on the untouched model.
    const inBounceSpeed =
      this.pyramidConfig.bounceSlowdown *
      (0.5 + 0.5 * this.elementScale) *
      slow *
      ball.hopSlowdownScale;

    if (ball.isInBounce) {
      const bounceElapsed = currentTime - ball.bounceStartTime;
      if (bounceElapsed < ball.bounceDuration) {
        const bounceProgress = bounceElapsed / ball.bounceDuration;
        if (bounceProgress < 0.3) {
          ball.currentSpeed = inBounceSpeed;
        } else {
          const recovery = (bounceProgress - 0.3) / 0.7;
          ball.currentSpeed =
            inBounceSpeed + (baseSpeed - inBounceSpeed) * Math.max(0, Math.min(1, recovery));
        }
      } else {
        ball.currentSpeed = baseSpeed;
      }
    } else if (ball.currentSpeed < baseSpeed) {
      ball.currentSpeed += this.pyramidConfig.acceleration * this.elementScale * slow;
    }

    // The `minSpeed` floor is what a slow override runs into first: unscaled it pins the ball at about
    // a fifth of normal however small `animationSpeed` gets — "it won't go any slower".
    ball.currentSpeed = Math.max(
      this.pyramidConfig.minSpeed * slow,
      Math.min(ball.currentSpeed, this.pyramidConfig.maxSpeed * slow)
    );

    // Keep the ball's ON-SCREEN speed consistent across path segments of different lengths. Almost
    // every segment spans exactly one row gap, but the final segment (last peg row → slot center) is
    // ~2.3× longer and has no bounce, so advancing currentPoint at the same rate made the ball lurch
    // into the slot — the "sudden speed-up near the bottom / gold pegs" in Fast Game mode (the long
    // segment ran at ~3.8× a normal row's on-screen speed). Slow the advance on longer-than-a-row
    // segments so the descent stays smooth; segments at/under one row gap are unaffected (factor = 1),
    // so peg bounces and normal-mode feel are unchanged.
    ball.currentPoint += ball.currentSpeed * this.segmentSpeedNormalization(ball);

    // The offsets below are DISPLACEMENTS from the path, so their magnitudes and clamps are left
    // alone at any speed — only the rate they build and bleed off follows the slowed clock.
    const maxLaneDrift = this.minPegSpacingX * 0.28;
    ball.velocityX = Math.max(-maxLaneDrift, Math.min(maxLaneDrift, ball.velocityX));
    if (!ball.isInBounce) {
      ball.velocityY += this.pyramidConfig.verticalGravity * this.bounceScale * slow;
      ball.velocityY *= this.slowDecay(this.pyramidConfig.verticalDamping);
      const maxVerticalOffset = this.pyramidConfig.bounceAmplitude * this.bounceScale * 0.4;
      ball.velocityY = Math.max(-maxVerticalOffset, Math.min(maxVerticalOffset, ball.velocityY));
    } else {
      ball.velocityY *= this.slowDecay(0.9);
    }

    if (Math.abs(ball.velocityX) > 0.1) {
      ball.velocityX *= this.slowDecay(this.pyramidConfig.lateralFriction);
    } else {
      ball.velocityX = 0;
    }

    // Coin ricochet: integrate the departure velocity, bleed it off, then ease the displacement
    // itself back onto the lane so the ball is flying its own line again well before the slot.
    ball.coinKickX += ball.coinKickVX * slow;
    ball.coinKickY += ball.coinKickVY * slow;
    ball.coinKickVX *= this.slowDecay(PlinkoEngine.COIN_KICK_VELOCITY_DECAY);
    ball.coinKickVY *= this.slowDecay(PlinkoEngine.COIN_KICK_VELOCITY_DECAY);
    ball.coinKickX *= this.slowDecay(PlinkoEngine.COIN_KICK_OFFSET_DECAY);
    ball.coinKickY *= this.slowDecay(PlinkoEngine.COIN_KICK_OFFSET_DECAY);

    ball.collisionOffsetX *= this.slowDecay(0.91);
    ball.collisionOffsetY *= this.slowDecay(0.91);
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

  /**
   * Contact on the peg crown only: top, top-left, or top-right (never side/bottom). Measured from
   * the peg's drawn centre and its own radius, so a coin peg's crown is on the coin's rim rather
   * than a peg-sized dot buried in the middle of the art.
   */
  private getDirectionalPegContact(
    bouncePeg: Peg,
    travelDir: -1 | 0 | 1,
  ): { x: number; y: number } {
    // A coin is WIDER than the ball (18.1px of art against a 9.3px ball), so its contact point is
    // the tangent where the ball comes to rest ON the coin — `solidRadius + ballRadius` out from the
    // centre, on the circle. Using the peg formula here put the ball's centre 13.7px inside an
    // 18.1px coin, i.e. buried past its middle: the "ball sinks into the coin and slides off" read.
    // Regular pegs keep the original numbers exactly — the body is smaller than the ball, so the
    // ball covering it is correct and is how the whole board already looks.
    if (this.isCoinBody(bouncePeg)) {
      const rest = bouncePeg.solidRadius + this.ballRadius;
      // ~24 deg off vertical for a directional hit: still the coin's upper shoulder, and unlike the
      // peg formula it stays ON the rest circle instead of cutting across the inside of it.
      const angle = travelDir * 0.42;
      return {
        x: bouncePeg.cx + Math.sin(angle) * rest,
        y: bouncePeg.cy - Math.cos(angle) * rest,
      };
    }
    const crownY = bouncePeg.cy - bouncePeg.hitRadius * 0.92;
    if (travelDir === 0) {
      return { x: bouncePeg.cx, y: crownY };
    }
    const crownXOffset = bouncePeg.hitRadius * 0.4;
    return {
      x: bouncePeg.cx + travelDir * crownXOffset,
      y: crownY,
    };
  }

  /**
   * True when this peg is a coin wearing the art, so it collides as a disc bigger than the ball
   * rather than as a peg body smaller than it. `indexFeaturedPegs` only raises `solidRadius` above
   * the peg radius when the coin texture actually loaded, so this is also the "art is there" test —
   * a coin that fell back to a plain peg body collides as a plain peg, which is what it draws as.
   */
  private isCoinBody(peg: Peg): boolean {
    return peg.solidRadius > this.pegRadius;
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
    const targetX = ball.path[ball.path.length - 1]?.x ?? bouncePeg.cx;
    const lookAheadX = nextPoint?.closestPeg?.cx ?? nextPoint?.x ?? targetX;
    return this.resolveTravelDir(bouncePeg.cx, lookAheadX, targetX);
  }

  /**
   * The single place a coin-peg contact is announced. Both routes that can register a coin hit — the
   * physical bounce and the server-authoritative path-index credit — land here, so a hit always
   * lights the coin AND plays its chime exactly once, whichever route notices it first. Previously
   * only the bounce made a sound, so a credit that fired off the path index (the ball never quite
   * satisfying the contact test) lit nothing and played nothing.
   */
  /**
   * True when this coin is the one the ball's path was built to hit. A ball steered onto a coin can
   * brush PAST another one on the way (the row-3 pair straddles the approach to the row-5 coin), and
   * an incidental brush must not consume the round's single credit — the designated hit would then
   * land on a meter that has already been paid, which reads as a coin hit that did nothing.
   *
   * Legacy / bonus-ball drops carry no designated peg (row = -1); there ANY coin still credits.
   */
  private isDesignatedCoinPeg(ball: Ball, peg: Peg): boolean {
    if (ball.bonusPegEmitRow < 0 || ball.bonusPegEmitCol < 0) return true;
    return peg.row === ball.bonusPegEmitRow && peg.col === ball.bonusPegEmitCol;
  }

  /**
   * The single test for whether this ball may have anything to do with this coin. A contact that
   * pays is bounced off, lit and chimed; one that doesn't is none of the three, so a coin can never
   * flash for a hit that earns nothing.
   */
  private coinPegCredits(ball: Ball, peg: Peg): boolean {
    return ball.creditBonusPegHit && this.isDesignatedCoinPeg(ball, peg);
  }

  /** This ball's designated coin, if the board still carries one at that position. */
  private designatedCoinPeg(ball: Ball): Peg | null {
    for (let i = 0; i < this.featuredPegs.length; i++) {
      const peg = this.featuredPegs[i];
      if (peg.row === ball.bonusPegEmitRow && peg.col === ball.bonusPegEmitCol) return peg;
    }
    return null;
  }

  private emitCoinPegContact(
    ball: Ball,
    peg: Peg,
    currentTime: number,
    intensity = 0.92,
  ): void {
    const credits = this.coinPegCredits(ball, peg);

    // Light the coin only for a contact that pays. The glow and the chime are one cue, and the chime
    // is reserved for hits that feed the meter — so lighting on every contact meant a coin could
    // flash with nothing behind it, which reads as a hit the game noticed and then ignored. A real
    // hit still lights whichever route reaches here first, which is what `credits` covers.
    if (credits) {
      peg.bounceEffect = Math.max(peg.bounceEffect, intensity);
      peg.bounceTime = currentTime;
      peg.isTouched = true;
      // Also reached from the path-index credit in `stepPhysics`, which never runs the bounce test —
      // so the force-draw is claimed here too rather than only at the contact site.
      this.pegContactPending = true;
    }

    // What the dedupe is for: ONE coin reported twice, by the physical bounce and by the
    // path-index credit. Anything else is a real second contact and has to be heard.
    //
    // Judging it on time alone is what silenced the chime. A ball steered onto its coin can clip
    // another on the way (the row-3 pair straddles the approach to row 5), and that clip — a plain
    // thunk, since it earns nothing — used to start the window: reach the designated coin inside it
    // and the meter filled, the coin lit, and nothing played. So the window only closes over the
    // SAME coin, and only once that coin has already had the sound it is due.
    const repeatOfSameCoin = peg.row === ball.coinSfxRow && peg.col === ball.coinSfxCol;
    const withinDedupe = currentTime - ball.coinSfxTime <= PlinkoEngine.COIN_SFX_DEDUPE_MS;
    if (!(withinDedupe && repeatOfSameCoin && (ball.coinSfxFeatured || !credits))) {
      ball.coinSfxTime = currentTime;
      ball.coinSfxRow = peg.row;
      ball.coinSfxCol = peg.col;
      ball.coinSfxFeatured = credits;
      // A ball that merely clips a coin — because it is not a bonus ball, or because this is not the
      // coin it was sent to — still needs a bounce sound, but it gets the ordinary peg thunk. The
      // coin chime stays reserved for the hit that actually feeds the meter, so players never hear
      // the bonus cue without the bonus.
      this.emitPegBounce({
        row: peg.row,
        col: peg.col,
        ballId: ball.id,
        featured: credits,
      });
    }

    if (credits && !ball.bonusPegEmitted) {
      ball.bonusPegEmitted = true;
      this.emitCoinPegHit({ row: peg.row, col: peg.col, ballId: ball.id });
    }
  }

  /**
   * Every row bounces, exactly once.
   *
   * The contact test below is a NATURAL hit — the ball is on the peg's crown, travelling down, off
   * cooldown, not already mid-arc. It gives the prettiest timing, but it is a test the ball can
   * simply fail: mid-bounce it was not even consulted (the old early return), a bounce arc spanning
   * more than one row swallowed whatever rows it covered, the cooldown could span a row at speed,
   * and a lane nudged off-grid by ball-to-ball repulsion missed the column tolerance. Each of those
   * dropped a row silently — no bounce, no glow, and no peg SFX, which is what QA heard as audio
   * cutting in and out.
   *
   * So the natural test now only decides WHEN a row bounces early. Reaching the row's peg line is a
   * deadline: at that point the ball is out of road and bounces regardless. `bouncedRows` is still
   * what guarantees it happens only once.
   */
  /**
   * Height of the hop this ball is currently mid-way through, including whatever it inherited from
   * the hop before it. Mirrors the arc term in `stepPhysics` — keep the two in step.
   */
  private liveBounceArcHeight(ball: Ball, currentTime: number): number {
    if (!ball.isInBounce) return 0;
    const elapsed = currentTime - ball.bounceStartTime;
    const progress = Math.max(0, Math.min(1, elapsed / ball.bounceDuration));
    return (
      this.pyramidConfig.bounceAmplitude *
        ball.bounceHeightMultiplier *
        Math.sin(progress * Math.PI) *
        this.bounceScale +
      ball.bounceCarryY * (1 - progress)
    );
  }

  /**
   * Stretch this ball's next hop to span exactly one peg row, at no cost in descent speed.
   *
   * The old duration was a flat 240ms (`bounceDuration`), set with no reference to how long a row
   * actually takes. On the 12-row board a row runs ~277ms in normal play and ~118ms in Fast Game,
   * against a hop of 240ms and 90ms — so the arc always finished SHORT and the ball free-fell the
   * remainder of the row: about 20% of it normally, and fully 35% of it in Fast Game. Because
   * `baseY` eases in with `easeInQuad`, that leftover stretch is also the fastest part of the row.
   * Every hop therefore ended by dropping the ball into the next peg at maximum speed with no arc
   * left under it, which is both the "doesn't land on the peg" look and what made the old
   * point-sampled crown test miss (75% of pegs in Fast Game — see `checkForBounce`).
   *
   * Two numbers come back, and the second is what keeps this free:
   *
   * `durationMs` — how long the row ACTUALLY takes today, hop plus the free-fall that follows it,
   * computed from the same speed model in `updateBallPhysics` that moves the ball. The arc is cut
   * to that, so it comes down on the next peg instead of in mid-air.
   *
   * `slowdownScale` — the correction that stops the longer arc from slowing the drop down. The ball
   * is held at `bounceSlowdown` for the first 30% of a hop and recovers to `baseSpeed` over the
   * rest, so a hop's mean speed is `0.65*inBounce + 0.35*base`. Simply lengthening the hop would
   * apply that slow phase to ground the ball used to cover at full speed, costing ~5% of the drop
   * normally and ~23% in Fast Game. Scaling the in-hop floor so the row still covers `rowSpan` in
   * `durationMs` gives those milliseconds straight back: the descent keeps precisely the cadence it
   * has today, and only the shape of the speed WITHIN a row changes — from slow-then-sprint to an
   * even glide, which is itself the smoother read.
   *
   * Because it all comes off the live model, this follows Fast Game, the `plinkoSetSpeed` dev
   * override, the gravity ramp down the board and the row count on its own — no second set of
   * numbers to keep in sync and no per-speed special-casing.
   */
  private fitHopToRow(ball: Ball): { durationMs: number; slowdownScale: number } {
    const legacyMs = Math.max(
      PlinkoEngine.MIN_FAST_BOUNCE_MS,
      (this.pyramidConfig.bounceDuration * ball.bounceDurationMultiplier) / this.simSpeedFactor
    );
    const pathLen = ball.path.length;
    const slow = this.slowMotionScale;
    const baseSpeed =
      this.pyramidConfig.normalSpeed * this.animationSpeed +
      this.pyramidConfig.gravityEffect * (ball.currentPoint + 0.5) * slow;
    const inBounceSpeed =
      this.pyramidConfig.bounceSlowdown * (0.5 + 0.5 * this.elementScale) * slow;
    const meanSpeed = 0.65 * inBounceSpeed + 0.35 * baseSpeed;
    if (pathLen < 2 || !(meanSpeed > 0) || !(baseSpeed > 0)) {
      return { durationMs: legacyMs, slowdownScale: 1 };
    }

    // One path segment is one row gap everywhere the ball bounces — only the entry fall and the drop
    // into the slot are longer, and neither of those carries a hop.
    const rowSpan = 1 / (pathLen - 1);
    // What today's hop covers of the row, and how long the ball then free-falls to finish it.
    const hopSpan = (legacyMs / PlinkoEngine.FIXED_STEP_MS) * meanSpeed;
    const coastMs = Math.max(0, ((rowSpan - hopSpan) / baseSpeed) * PlinkoEngine.FIXED_STEP_MS);
    const rowMs = legacyMs + coastMs;
    if (!Number.isFinite(rowMs) || rowMs <= 0) {
      return { durationMs: legacyMs, slowdownScale: 1 };
    }

    // Mean speed the stretched hop must hold to clear the row in the same time, and the floor scale
    // that produces it. Capped at `baseSpeed` — once a row is too short to afford any slowdown at
    // all, the honest answer is to hold cruise speed through the hop rather than to speed the ball
    // UP on contact.
    const requiredMean = (rowSpan * PlinkoEngine.FIXED_STEP_MS) / rowMs;
    const requiredFloor = (requiredMean - 0.35 * baseSpeed) / 0.65;
    const scale = Math.min(baseSpeed, Math.max(0, requiredFloor)) / inBounceSpeed;

    // `rowMs` is returned as-is. `bounceDurationMultiplier` already shaped it through `legacyMs`,
    // and re-applying it here would stretch the arc back off the row it was just fitted to —
    // per-ball duration variation is fundamentally at odds with landing on a peg, which is why that
    // character now lives in the hop's height and drift instead.
    return {
      durationMs: Math.max(PlinkoEngine.MIN_FAST_BOUNCE_MS, Math.min(PlinkoEngine.MAX_HOP_MS, rowMs)),
      slowdownScale: Number.isFinite(scale) && scale > 0 ? scale : 1,
    };
  }

  private checkForBounce(ball: Ball, currentTime: number): void {
    const pathLength = ball.path.length;
    const segmentProgress = ball.currentPoint * (pathLength - 1);
    const segmentIndex = Math.floor(segmentProgress);
    // Scale the cooldown with the sim speed so the ball is free to bounce again ~one row later at any
    // speed — shortened in fast mode (instead of coasting past several pegs between hits), lengthened
    // when slowed so it still covers the stretched hop (see simSpeedFactor).
    const bounceCooldown = this.pyramidConfig.bounceCooldown / this.simSpeedFactor;

    // Reaches two indices back rather than one: at speed `currentPoint` can advance far enough in a
    // single substep to step the segment index by more than one, and a row whose index fell between
    // two scans was never looked at again. The altitude gates below are what keep the wider window
    // from bouncing anything retroactively.
    for (
      let i = Math.max(0, segmentIndex - 2);
      i <= Math.min(pathLength - 1, segmentIndex + 1);
      i++
    ) {
      const pathPoint = ball.path[i];
      // row < 0 (spawn/entry) and row === rows (the slot) carry no peg, so they carry no intensity.
      if (pathPoint.bounceIntensity <= 0 || ball.bouncedRows.has(pathPoint.row)) {
        continue;
      }
      // Cheap altitude gate before resolving a peg — this runs for every ball on every substep now
      // that a mid-arc ball is no longer turned away at the door.
      if (ball.y < pathPoint.y - this.pegSpacing * 0.75) {
        continue;
      }

      // A coin peg the ball is physically overlapping wins over the planned peg — but ONLY a coin
      // this ball can actually cash. Any overlap used to win, so a ball that drifted into a coin it
      // could not pay bounced off it and lit it, while the chime stayed reserved for hits that feed
      // the meter: the coin flashed in silence, which reads as a hit the game then threw away.
      // A coin it cannot cash is not a peg to this ball; it is routed past it like any other ball.
      const overlappedCoin = this.featuredPegAtPoint(pathPoint.row, ball.x, ball.y);
      const bouncePeg =
        (overlappedCoin && this.coinPegCredits(ball, overlappedCoin) ? overlappedCoin : null) ??
        this.resolveLiveBouncePeg(pathPoint, ball);
      if (!bouncePeg) {
        continue;
      }

      // Contact on the peg crown only (top / top-left / top-right).
      const travelDir = this.inferBounceTravelDir(ball, i, pathPoint, bouncePeg);
      const contact = this.getDirectionalPegContact(bouncePeg, travelDir);
      const contactX = contact.x;
      const contactY = contact.y;

      // --- Swept contact ---------------------------------------------------------------------
      // This used to sample the ball's position at the END of the step only, against a crown band
      // ~1.33 peg-radii tall — about 6.7px on a desktop board. A step near the bottom of a segment
      // falls 6-7px in normal play and ~16px in Fast Game: as tall as the band or taller. The ball
      // therefore stepped clean OVER the crown on a good share of pegs and the test never saw the
      // contact at all. Those rows fell through to the deadline below, which fires anywhere down to
      // half a row past the peg — so the ball visibly passed THROUGH the peg and then hopped off
      // nothing beneath it, with the thunk and the glow arriving just as late. Whether any given
      // peg was missed came down to where the fixed-step boundaries happened to land, which is
      // exactly why it was intermittent rather than consistent.
      //
      // So test the segment the ball SWEPT this step instead of the point it ended at, and evaluate
      // the contact at the instant it crosses the crown line. A tunnelling miss is not possible
      // from here: any step that ends below the crown began above it and is caught. The cost is one
      // subtract and one divide on pegs that already passed the altitude gate above — nothing is
      // allocated, and no extra pegs are visited.
      const stepFallY = ball.y - ball.prevY;
      const crossT =
        stepFallY > 1e-4 ? Math.max(0, Math.min(1, (contactY - ball.prevY) / stepFallY)) : 1;
      // Where the ball actually was when it reached crown height, rather than wherever the rest of
      // the step carried it afterwards.
      const sweptX = ball.prevX + (ball.x - ball.prevX) * crossT;
      const sweptTopY = Math.min(ball.prevY, ball.y);
      const sweptBottomY = Math.max(ball.prevY, ball.y);
      const descendingOntoPeg = ball.y >= ball.prevY - 0.5;
      let crossedCrown: boolean;
      if (this.isCoinBody(bouncePeg)) {
        // A coin is held on its own surface by `separateBallsFromCoins`, so "touching it" is the
        // whole test — and it has to be, because the ball can no longer reach the crown band at all
        // (the band tops out 18.6px above the centre; the ball is stopped 27.5px out). Contact is
        // therefore: resting on the coin, on its upper half, on the way down.
        //
        // The margin is a hair rather than a step's fall. A fall-sized one sounds prudent against a
        // fast arrival but it inflates the disc in EVERY direction, so a ball passing 30px to the
        // side of a coin — not touching it, never going to — registered a hit off it. Nothing is
        // lost by tightening it: the constraint runs every step and the forbidden disc is 54.9px
        // across, so no step this engine can take is capable of jumping over it, and a ball that
        // does touch is placed at exactly `rest` by the constraint before this ever reads it.
        const rest = bouncePeg.solidRadius + this.ballRadius;
        const cdx = ball.x - bouncePeg.cx;
        const cdy = ball.y - bouncePeg.cy;
        const reach = rest + 0.5;
        crossedCrown =
          descendingOntoPeg && cdy <= 0 && cdx * cdx + cdy * cdy <= reach * reach;
      } else {
        // The same crown band as before — it just has to be TOUCHED by the step now, not landed in.
        const crownTopY = bouncePeg.cy - bouncePeg.hitRadius * 1.25;
        const crownBottomY = bouncePeg.cy - bouncePeg.hitRadius * 0.08;
        crossedCrown = descendingOntoPeg && sweptBottomY >= crownTopY && sweptTopY <= crownBottomY;
      }

      // Reach is measured at the crossing instant, where the vertical gap to the crown is zero by
      // construction — so this is purely "did the ball pass over this peg's face", with none of the
      // end-of-step drift that used to leak into it.
      const dx = sweptX - contactX;
      const distanceSq = dx * dx;
      // Widened by however much this peg draws bigger than a peg body (zero for regular pegs), so a
      // coin is caught across its whole face instead of only at a peg-sized dot in its centre.
      const interactionRadius =
        this.ballRadius * 0.95 + Math.max(0, bouncePeg.hitRadius - this.pegRadius);
      const interactionRadiusSq = interactionRadius * interactionRadius;
      const rowWasCrossed = segmentProgress >= i - 0.02;
      // Featured rows keep a slightly wider catch so a ball routed around the cluster still bounces
      // off the flank peg instead of drifting through the row untouched — but no wider than that.
      // The old 0.52 let a ball more than half a lane away claim a bounce, and since a fallback hit
      // yanks the ball onto the contact point, that read as a bounce off empty board beside the coins.
      const laneTolerance =
        !ball.creditBonusPegHit && this.rowHasFeaturedPeg(pathPoint.row)
          ? this.pegSpacingXForRow(pathPoint.row) * 0.4
          : this.pegSpacingXForRow(pathPoint.row) * 0.32;
      // ...and no wider than the ball is actually TOUCHING, either. Being a fraction of the lane,
      // that tolerance grows as the rows widen (0.65 -> 0.75 width scale, so 38px of lane at the top
      // against 44px at the bottom) while the ball and peg stay the same size — so the lower the ball
      // got, the further off a peg it could be and still claim a solid hit, complete with the settle
      // yank onto the crown. On the bottom row the plain tolerance is 14.1px against a real touching
      // reach of 14.06px, and the featured-row 0.4 exceeds it from the middle of the board down.
      // Solving the contact circle at crown height caps it at genuine overlap: a peg cannot be hit
      // from further away than the ball can reach it, at any row width. Coins keep their wider catch
      // for free, since their `hitRadius` is in the reach.
      const crownDrop = bouncePeg.hitRadius * 0.92;
      const touchReach = this.ballRadius + bouncePeg.hitRadius;
      const overlapTolerance = Math.sqrt(Math.max(0, touchReach * touchReach - crownDrop * crownDrop));
      const columnTolerance = Math.min(laneTolerance, overlapTolerance);
      const nearPegColumn = Math.abs(sweptX - bouncePeg.cx) <= columnTolerance;
      const shouldUseFallback = rowWasCrossed && nearPegColumn;

      // A hop now spans exactly one row (see `fitHopToRow`), so the ball reaches the next
      // crown as its arc bottoms out. Floating point can still leave `isInBounce` set for the step
      // the crossing lands on; refusing the contact there would push a perfectly good hit back onto
      // the deadline and re-introduce the very lateness this is fixing. The last sixth of a spent
      // hop may hand the ball on — `bouncedRows` and the cooldown still prevent a double-bounce.
      const hopSpent =
        !ball.isInBounce || currentTime - ball.bounceStartTime >= ball.bounceDuration * 0.82;

      // For a coin, `crossedCrown` is already a full 2D test against the disc the ball is resting
      // on, so the column tests below it are not a second opinion — they are a peg-sized reach
      // (18.1px at best) applied to a body the ball can legitimately touch 27.5px from the centre
      // of, and all they can do is throw away real contacts. Regular pegs keep both.
      const withinPegReach =
        this.isCoinBody(bouncePeg) || distanceSq < interactionRadiusSq || shouldUseFallback;

      // The pretty path: a real swept crown contact, off cooldown, with the previous hop spent.
      // Only decides whether this row bounces EARLY — failing it no longer means the row is skipped.
      const naturalContact =
        hopSpent &&
        crossedCrown &&
        currentTime - ball.lastBounceTime > bounceCooldown &&
        withinPegReach;

      // The deadline: the ball has arrived at this row's peg line and has run out of road. The lower
      // bound stops a row that somehow slipped far past from yanking the ball back up to it — better
      // to leave one row behind than to bounce it retroactively half a board later. It opens to at
      // least this substep's own fall, so however far a single step travelled it cannot straddle the
      // window; in practice a step covers about a third of a row and the half-row floor governs.
      const belowPegLine = ball.y - bouncePeg.cy;
      const deadlineDepth = Math.max(this.pegSpacing * 0.5, ball.y - ball.prevY);
      // The deadline tested height alone, so it fired on a peg the ball was nowhere near across the
      // board. Out over the coin cluster that peg is the flank one a lane away: the ball hopped
      // where nothing is drawn — a bounce off an invisible peg. A peg only owns the half-lane around
      // its own column (plus whatever it draws wider than a peg body, so a coin still owns its
      // face). Outside that the row is simply left unbounced: a missing thunk beats a phantom one.
      //
      // Capped near what the ball can actually REACH, for the same reason `columnTolerance` above is.
      // Half a lane is not a peg's property, it is the board's, and lanes widen toward the bottom
      // (0.65 -> 0.75 width scale) while the ball and peg stay the same size — so this let a bounce
      // fire further and further off-column the lower the ball got, which is exactly the "offset to
      // the side, worse further down" it produced. Measured on a live drop: bounces landing up to
      // 8.5px off a peg the ball can only touch within 5.1px, i.e. off empty board, with the mean
      // offset climbing steadily through the bottom rows.
      //
      // The slack is load-bearing and was measured, not guessed. At an exact touch cap the deadline
      // stops firing on a QUARTER of the planned rows (23 of 96 across 8 balls) — a peg that goes
      // silent is worse than one hit slightly wide. See DEADLINE_REACH_SLACK.
      const deadlineColumnReach = Math.min(
        this.pegSpacingXForRow(pathPoint.row) * 0.5 +
          Math.max(0, bouncePeg.hitRadius - this.pegRadius),
        (this.ballRadius + bouncePeg.hitRadius) * PlinkoEngine.DEADLINE_REACH_SLACK,
      );
      const reachedPegLine =
        belowPegLine >= -bouncePeg.hitRadius * 0.15 &&
        belowPegLine <= deadlineDepth &&
        Math.abs(ball.x - bouncePeg.cx) <= deadlineColumnReach;

      if (naturalContact || reachedPegLine) {
        // Whatever the effect thinning would otherwise have decided, this frame draws (see
        // `pegContactPending`) — the glow has to land on the same frame as the thunk.
        this.pegContactPending = true;
        if (this.isFeaturedPeg(bouncePeg)) {
          // Coin contacts go through one emitter so the chime can't double-fire with the
          // path-index credit below, and can't go silent when that credit lands first. The coin's
          // GLOW belongs to it too — lighting the peg here first, as this did, lit every coin the
          // ball touched no matter what the emitter then decided, which is the silent flash.
          this.emitCoinPegContact(ball, bouncePeg, currentTime, pathPoint.bounceIntensity);
        } else {
          bouncePeg.bounceEffect = pathPoint.bounceIntensity;
          bouncePeg.bounceTime = currentTime;
          bouncePeg.isTouched = true;
          // Fires once per peg contact (row is added to bouncedRows below, so no re-fire) — drives
          // the per-bounce "thunk" sound.
          this.emitPegBounce({
            row: bouncePeg.row,
            col: bouncePeg.col,
            ballId: ball.id,
            featured: false,
          });
        }
        // Capture what is left of the hop in progress BEFORE the clock is restarted — a deadline
        // contact can land mid-arc, and without this the ball would drop that whole height at once.
        ball.bounceCarryY = this.liveBounceArcHeight(ball, currentTime);
        ball.isInBounce = true;
        ball.bounceStartTime = currentTime;
        // Cut the hop to the time this ball will actually take to reach the NEXT peg row, so the arc
        // lands on a peg instead of finishing in mid-air. See `fitHopToRow` — it derives
        // the span from the same speed model that advances the ball, so it tracks fast mode, the
        // slow-motion dev override, the gravity ramp and the row count with no separate tuning.
        //
        // Deliberately deterministic where the old duration carried a +/-15% random jitter: with a
        // fixed 240ms hop against a ~272ms row the arc always finished early and the ball free-fell
        // the rest of the way in, and the jitter made how MUCH of the row it free-fell different on
        // every hop. That is the "sometimes it looks wrong" — the hop has to span the row for the
        // ball to meet the peg, so the per-ball character lives in the hop's HEIGHT and drift
        // (`bounceHeightMultiplier`, `driftMultiplier`) rather than in its length.
        const hopFit = this.fitHopToRow(ball);
        ball.bounceDuration = hopFit.durationMs;
        ball.hopSlowdownScale = hopFit.slowdownScale;
        ball.bounceTravelDir = travelDir;
        // Settle onto the contact point, but never teleport: a wide fallback catch could otherwise
        // slide the ball most of a lane sideways in one frame, which reads as the ball snapping to a
        // peg it was never near. Correcting by at most the peg's own size keeps close bounces exact
        // (their correction is far smaller than the cap) and turns far ones into a visible nudge.
        // Settle from where the ball CROSSED the crown, not from wherever the remainder of the step
        // carried it — on a swept contact those differ by most of a step near the bottom of a
        // segment, and settling from the later point is what used to nudge the ball off the peg it
        // had just hit.
        // Coins are positioned by `separateBallsFromCoins`, which holds the ball exactly on the
        // coin's surface every step. Settling it toward a nominal shoulder point on top of that is
        // two rules fighting over the same pixel — and since a coin's `hitRadius` allows a 16.4px
        // correction, the loser is a visible sideways snap. Leave the constraint to place it.
        if (!this.isCoinBody(bouncePeg)) {
          const settleFromX = naturalContact ? sweptX : ball.x;
          // Keep most of where the ball actually was. This used to close 85% of the gap to the
          // nominal contact point in a single frame — the horizontal twin of the vertical stall
          // above, and worth up to 3.5px on a 6.1px ball. The swept test lands the ball close to
          // the peg to begin with, so a nudge is all that was ever needed; the lateral response to
          // a bounce belongs to `velocityX` below, which is a velocity rather than a teleport.
          const settledX = contactX + (settleFromX - contactX) * PlinkoEngine.PEG_SETTLE_KEEP;
          const maxSettle = bouncePeg.hitRadius * 1.1;
          const settleDelta = settledX - ball.x;
          ball.x =
            Math.abs(settleDelta) <= maxSettle
              ? settledX
              : ball.x + Math.sign(settleDelta) * maxSettle;
        }
        // NOTHING snaps the ball's height here, deliberately.
        //
        // This used to lift the ball onto the crown (`ball.y = contactY`) so it visibly touched the
        // peg. It does — but a bounce is a change of VELOCITY, and writing a position on top of one
        // fights the motion. Sampled off a live drop, the ball's per-frame fall through a peg read:
        //
        //   ... 1.93  2.07  2.22  2.36  2.50 | 0.49  0.24 | 0.45  0.66 ... -2.16 (arc)
        //
        // — accelerating cleanly, then almost STOPPING for two frames, then falling again, and only
        // then reversing. The stall is this lift cancelling most of the frame's fall. Three changes
        // of direction where a bounce has one, on every peg on the board, is the shake.
        //
        // Without it the ball can render up to one step's fall below the crown on the contact frame,
        // which on a peg smaller than the ball is not visible — the ball covers it either way. The
        // arc's own opening velocity (`-A*PI/duration`) is what lifts it away, and that is a single
        // clean reversal. The ricochet for coins lives in `separateBallsFromCoins`, not here.

        const impulseScale =
          this.pyramidConfig.bounceImpulseMin +
          Math.random() * (this.pyramidConfig.bounceImpulseMax - this.pyramidConfig.bounceImpulseMin);
        const force = pathPoint.bounceIntensity * impulseScale * this.bounceScale;
        ball.velocityX = travelDir * force * 2.82;
        ball.velocityY = Math.min(0, -force * this.pyramidConfig.bounceLift * 0.52);

        ball.bouncedRows.add(pathPoint.row);
        ball.lastBounceTime = currentTime;
        // Same re-fit as the in-hop floor above, or this kick-down would kill the speed the hop
        // duration was just solved to preserve.
        ball.currentSpeed =
          this.pyramidConfig.bounceSlowdown *
          (0.3 + Math.random() * 0.4) *
          this.slowMotionScale *
          ball.hopSlowdownScale;
        break;
      }
    }
  }

  /**
   * Bounce the pocket the ball is PAID at — `ball.targetIndex`, the same index that goes out on
   * `onBallDropped` — rather than re-deriving it from where the ball happens to be.
   *
   * This used to scan the slots for the tile `ball.x` was inside at the landing instant. `ball.x` is
   * not the path position: it is the lane plus every visual displacement the ball is carrying —
   * `velocityX * laneCentering`, the per-ball `laneOffsetX`, the ball-ball `collisionOffsetX`, a live
   * coin ricochet (`coinKickX`, which is allowed most of a lane), and, while the last peg hop is
   * still running, that hop's directed drift and wobble. Every one of those is a displacement FROM
   * the lane, so the ball is still paid its own pocket, but they stack: far enough to land inside the
   * NEIGHBOURING tile, so the wrong pocket bounces, and — because the outermost tiles end exactly at
   * the slot strip's edge, with nothing beyond them to catch an outward offset — far enough to match
   * no tile at all, which is a landing that bounces nothing anywhere. Both failures grow with the
   * distance from centre and with the number of balls in the air, which is why they read as "the
   * outer pockets don't react" rather than as an occasional miss.
   *
   * The ball has known its pocket since `dropBall`, so ask it instead of measuring.
   */
  private triggerSlotAnimation(ball: Ball, currentTime: number): void {
    const slot = this.slots[ball.targetIndex];
    if (!slot) return;
    slot.animationActive = true;
    slot.animationTime = currentTime;
    ball.slotAnimationStart = currentTime;
  }

  /** True when this featured peg wears the coin art (so it draws no classic peg body of its own). */
  private featuredPegCoinSprite(peg: Peg): Sprite | undefined {
    const sprite = this.featuredPegSprites.get(peg.key);
    if (!sprite || !this.coinPegTexture || (sprite.texture.width ?? 0) <= 0) return undefined;
    return sprite;
  }

  /**
   * Coin size tracks the LANE SPACING (not the height-only peg radius) so it scales with the board
   * at every viewport/aspect — the spacing includes the horizontal width-fit the radius ignores.
   */
  private coinBaseSize(): number {
    return this.pegSpacingXForRow(4) * PlinkoEngine.COIN_SIZE_FACTOR;
  }

  /** Only three of these, so they are laid out on every draw pass rather than being cached. */
  private layoutFeaturedPegSprites(currentTime: number): void {
    const base = this.coinBaseSize();
    for (let i = 0; i < this.featuredPegs.length; i++) {
      const peg = this.featuredPegs[i];
      const sprite = this.featuredPegCoinSprite(peg);
      if (!sprite) continue;
      // A gentle pulse only: the old 1.5× swell grew the coin faster than its halo, so the glow
      // spent the hit hidden behind the art instead of ringing it.
      const intensity = this.pegGlowIntensity(peg, currentTime);
      const size = base * (1 + intensity * 0.16);
      const tw = sprite.texture.width || 1;
      sprite.scale.set(size / tw);
      const brighten = sprite.children[0] as Sprite | undefined;
      if (brighten) {
        brighten.alpha =
          PlinkoEngine.COIN_BRIGHTEN_ALPHA + intensity * PlinkoEngine.COIN_BRIGHTEN_HIT_ALPHA;
      }
      // The cluster pull already lives in cx/cy (see indexFeaturedPegs), so the art lands exactly
      // where the ball bounces and where the glow is drawn.
      sprite.position.set(peg.cx, peg.cy);
      sprite.visible = true;
    }
  }

  /** 0 when the peg is dark. Read-only — the decay/expiry lives in `drawActivePegs`. */
  private pegGlowIntensity(peg: Peg, currentTime: number): number {
    if (peg.bounceEffect <= 0 || !this.animationEnabled) return 0;
    const duration = this.pyramidConfig.bounceEffectDuration;
    const elapsed = currentTime - peg.bounceTime;
    if (elapsed >= duration || elapsed < 0) return 0;
    return peg.bounceEffect * Math.sin((elapsed / duration) * Math.PI);
  }

  /**
   * The ~130 idle peg bodies, tessellated once per layout instead of being re-issued every frame.
   * At four primitives each that is ~530 draw commands a drop frame no longer rebuilds — the single
   * largest per-frame cost the board had, and the one that hurt most on a throttled device.
   */
  private rebuildStaticPegs(): void {
    const g = this.pegStaticGraphics;
    g.clear();
    const pr = this.pegRadius;
    for (let i = 0; i < this.pegs.length; i++) {
      const peg = this.pegs[i];
      // A coin peg wears its sprite instead of a body, and only ever adds glow on top. Its resting
      // halo belongs here rather than in the per-frame layer: it never changes, so it costs one
      // tessellation per layout instead of two discs every frame.
      if (peg.isFeatured && this.featuredPegCoinSprite(peg)) {
        this.drawCoinIdleGlow(g, peg);
        continue;
      }
      this.drawClassicPegIdleBody(g, peg, pr);
    }
    this.pegStaticDirty = false;
  }

  /**
   * Per-frame peg layer: only the pegs currently lit by a bounce, drawn OVER the cached idle bodies.
   * The hit art is an opaque white disc, so the body underneath shows through only as a hairline of
   * its own outline inside the white rim — sub-pixel at every board size.
   */
  private drawActivePegs(currentTime: number): void {
    if (this.pegStaticDirty) this.rebuildStaticPegs();
    this.layoutFeaturedPegSprites(currentTime);

    const g = this.pegGraphics;
    const pr = this.pegRadius;
    let lit = 0;

    for (let i = 0; i < this.pegs.length; i++) {
      const peg = this.pegs[i];
      if (peg.bounceEffect <= 0) continue;

      const duration = this.pyramidConfig.bounceEffectDuration;
      const elapsed = currentTime - peg.bounceTime;
      if (elapsed >= duration) {
        peg.bounceEffect = 0;
        peg.isTouched = false;
        continue;
      }
      const glowIntensity = this.pegGlowIntensity(peg, currentTime);
      peg.bounceEffect *= 0.95;
      if (glowIntensity <= 0) continue;

      // Cleared lazily so a frame with nothing lit doesn't touch the context at all.
      if (lit === 0) g.clear();
      lit++;

      if (peg.isFeatured) {
        // Sized off the COIN, not the peg body, and centred on cx/cy where the coin is drawn. The
        // glow layer sits under the coin sprite, so the halo has to clear the coin's edge to read
        // as a ring around it — a peg-radius bloom just hid behind the art, off to one side.
        const coinRadius = peg.hitRadius / PlinkoEngine.COIN_HIT_RADIUS_FACTOR;
        const expansion = Math.min(1, (elapsed / duration) * 1.35);
        const radialRadius = coinRadius * (1.16 + expansion * 0.78);
        g.circle(peg.cx, peg.cy, radialRadius).fill({
          color: 0xffea00,
          alpha: Math.min(0.5, glowIntensity * 0.42)
        });
        g.circle(peg.cx, peg.cy, radialRadius * 0.88).fill({
          color: 0xfff24a,
          alpha: Math.min(0.44, glowIntensity * 0.36)
        });
        g.circle(peg.cx, peg.cy, radialRadius + coinRadius * 0.1).stroke({
          width: Math.max(1.6, coinRadius * 0.13),
          color: 0xffd100,
          alpha: Math.min(0.56, glowIntensity * 0.46)
        });
      }
      // Featured pegs fall back to the classic body when the coin art failed to load.
      if (!peg.isFeatured || !this.featuredPegCoinSprite(peg)) {
        this.drawClassicPegHitGlow(g, peg, pr, glowIntensity);
      }
    }

    if (lit === 0 && this.pegGraphicsHasContent) g.clear();
    this.pegGraphicsHasContent = lit > 0;
  }

  /**
   * The always-on glow under a coin. Sized off the coin (not the peg body) and centred on cx/cy, so
   * it clears the art's edge and reads as a soft ring rather than a smudge hidden behind it. Kept
   * well below the hit glow's alpha — this is ambient warmth, not a second bounce cue.
   */
  private drawCoinIdleGlow(g: Graphics, peg: Peg): void {
    const coinRadius = peg.hitRadius / PlinkoEngine.COIN_HIT_RADIUS_FACTOR;
    if (!(coinRadius > 0)) return;
    const rings = PlinkoEngine.COIN_IDLE_GLOW_RINGS;
    const outer = PlinkoEngine.COIN_IDLE_GLOW_RADIUS;
    // Outermost first, so each smaller disc lands on top and the alpha accumulates toward the coin.
    for (let i = rings - 1; i >= 0; i--) {
      const t = i / (rings - 1);
      g.circle(peg.cx, peg.cy, coinRadius * (0.99 + (outer - 0.99) * t)).fill({
        color: i > rings / 2 ? 0xffe23a : 0xfff06a,
        alpha: PlinkoEngine.COIN_IDLE_GLOW_ALPHA
      });
    }
  }

  // Both classic draws work off cx/cy — the same point the ball is tested against. For regular pegs
  // that is their grid position; for a coin peg with no art it is wherever the fallback body sits.
  private drawClassicPegIdleBody(g: Graphics, peg: Peg, pr: number): void {
    g.circle(peg.cx, peg.cy, pr).fill({ color: 0xafafaf, alpha: 0.98 });
    g.circle(peg.cx - pr * 0.2, peg.cy - pr * 0.22, pr * 0.68).fill({ color: 0xc8c8c8, alpha: 0.55 });
    g.circle(peg.cx - pr * 0.28, peg.cy - pr * 0.3, pr * 0.36).fill({ color: 0xe2e2e2, alpha: 0.42 });
    g.circle(peg.cx, peg.cy, pr).stroke({ width: Math.max(0.5, pr * 0.07), color: 0x22181b, alpha: 0.95 });
  }

  private drawClassicPegHitGlow(g: Graphics, peg: Peg, pr: number, glowIntensity: number): void {
    const glowStrokeWidth = Math.max(1.2, pr * 0.62);
    g.circle(peg.cx, peg.cy, pr * 1.34 + glowStrokeWidth / 2).stroke({
      width: glowStrokeWidth,
      color: 0xffffff,
      alpha: Math.min(0.28, 0.08 + glowIntensity * 0.2)
    });
    g.circle(peg.cx, peg.cy, pr * 1.82).fill({ color: 0xffffff, alpha: Math.min(0.15, glowIntensity * 0.1) });
    g.circle(peg.cx, peg.cy, pr).fill({ color: 0xffffff, alpha: Math.min(1, 0.95 + glowIntensity * 0.3) });
    g.circle(peg.cx - pr * 0.2, peg.cy - pr * 0.22, pr * 0.68).fill({
      color: 0xffffff,
      alpha: Math.min(1, 0.75 + glowIntensity * 0.35)
    });
    g.circle(peg.cx - pr * 0.28, peg.cy - pr * 0.3, pr * 0.36).fill({
      color: 0xffffff,
      alpha: Math.min(1, 0.62 + glowIntensity * 0.35)
    });
    g.circle(peg.cx, peg.cy, pr).stroke({
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

  /**
   * Match the pocket beside centre as the reference slot size for all multiplier assets.
   *
   * This used to search for the slot LABELLED "0.2", which is the shared board's `middle - 1` pocket —
   * the same slot this picks, on every board shipped so far. Keying it on a pocket VALUE made the asset
   * scale hostage to the board tables: a 1-ball board whose centre paid 0.2× would have matched centre
   * first, distance 0 from middle, and given that one tier a visibly different `heightScale`. Position
   * is what the scale actually wants, so take it directly and let boards be re-cut freely.
   */
  private updateUniformSlotAssetScale(): void {
    const middle = this.getMiddleSlotIndex();
    const refIdx = middle > 0 ? middle - 1 : 0;

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

  private layoutSlotAssetSprite(idx: number, y: number, h: number): void {
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
    // On the pocket's own axis, exactly like the glow spine's cards — NOT on the midpoint of the
    // drawn box, which is the slot inset by a +3 and a pegRadius trim and so drifts left of centre
    // by a resolution-dependent amount.
    sp.position.set(this.slots[idx].centerX, y + h);
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

      const y = slot.y + slot.animationOffset;
      const h = this.slotHeight * 0.82;

      const sprite = this.slotSprites[idx];
      if (sprite) {
        this.layoutSlotAssetSprite(idx, y, h);
      }

      // Bounce the whole glow tile (card) with the slot, so the entire slot dips down and back up
      // on a landing — not just the printed number. Skeleton y is up, so a downward (positive)
      // offset maps to a negative bone y, divided out by the spine scale.
      if (glowActive) {
        const bone = this.glowBoneBySlotIndex[idx];
        if (bone) bone.pose.y = -slot.animationOffset / this.glowScale;
      }

      // The landing pulse is a 15% pop MULTIPLIED onto the resting scale, not a scale of its own.
      // Written as a bare `1 + 0.15 * ...` it replaced the 1.1 rest value outright, so the label
      // snapped 9% smaller on the frame a pocket was struck and 9% larger again on the frame the
      // bounce retired — two pops the pulse never asked for, bracketing the one it did.
      const restScale = 1.1;
      let textScale = restScale;
      if (slot.animationActive) {
        const elapsed = currentTime - slot.animationTime;
        const progress = Math.min(1, elapsed / this.pyramidConfig.slotAnimationDuration);
        textScale = restScale * (1 + 0.15 * Math.sin(progress * Math.PI * 4) * (1 - progress));
      }

      // Every label — sprite or text fallback — goes on `slot.centerX`, the pocket's own axis and the
      // exact x `layoutGlowSpine` puts the card's bone on, so the number lands dead centre on the tile
      // it is printed on. It used to follow the DRAWN BOX (`slot.x`, i.e. the slot inset by a fixed +3
      // and a pegRadius trim) plus a hand-tuned `SLOT_TEXT_X_RATIO` fudge. Only one of those three terms
      // scales with the board, so the fudge cancelled the insets at the one viewport it was eyeballed at
      // and nowhere else: measured at a 2560-wide window the labels sat ~3px (5% of a tile) left of their
      // cards. Centre on the axis and there is nothing left to cancel at any size.
      const label = this.slotLabels[idx];
      if (label) {
        label.position.set(slot.centerX, y + h * 0.52);
        label.scale.set(textScale, textScale);
      }

      const labelSprite = this.slotLabelSprites[idx];
      if (labelSprite) {
        // The 1-ball tier's centre pocket prints its own board value (`0`) on the wider centre tile,
        // so it alone is printed larger and sits higher on the card.
        const oneBallCenter = this.rapidSingleBall && this.isSpinSlotIndex(idx);
        const labelScale = oneBallCenter ? PlinkoEngine.ONE_BALL_CENTER_LABEL_SCALE : 1;
        // Same scale for every label (computed once in `computeUniformLabelScale`), centered in the slot.
        labelSprite.scale.set(this.uniformLabelScale * textScale * labelScale);
        const yRatio = oneBallCenter
          ? PlinkoEngine.ONE_BALL_CENTER_LABEL_Y_RATIO
          : PlinkoEngine.SLOT_TEXT_Y_RATIO;
        // NOT rounded. The card is drawn on the raw fractional `centerX` (the spine bone takes
        // `centerX / scale`), so snapping only the label to a whole CSS pixel re-introduces up to half a
        // pixel of the very offset this is centring — in a different direction per pocket, since each
        // centre lands on its own fraction. Portrait is where that shows: the tiles are ~22px wide there,
        // so the two 0.2 pockets either side of centre rounded opposite ways and visibly disagreed. The
        // sprite is already resampled by `uniformLabelScale`, so there is no crispness to protect.
        labelSprite.position.set(slot.centerX, y + h * yRatio);
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

  /**
   * `underLoad` drops each ball's two inner highlight circles, taking a ball from three primitives
   * to one. Passed true for a big burst OR a slow/throttled frame — the highlights are a specular
   * detail nobody reads on a moving ball, and cutting them keeps the motion itself smooth.
   */
  private drawBallsPixi(underLoad = false): void {
    const g = this.ballsGraphics;
    g.clear();
    const useSimpleBallRender = underLoad || this.balls.length >= 12;
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
    // Same clock the effects were stamped with, or every glow's age would be nonsense here.
    const now = this.simClockMs;
    this.pegGraphics.clear();
    this.pegGraphicsHasContent = false;
    this.pegStaticDirty = true;
    for (const sp of this.slotSprites) {
      if (sp) sp.visible = false;
    }

    this.drawAllSlotsPixi(now);
    this.drawActivePegs(now);

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
  ): number {
    // Returns how many spawns were scheduled: 0 when nothing can drop (no coefficients yet, malformed
    // delays), so the caller never counts spawns that will not happen — a phantom pending spawn keeps
    // the drop batch "in flight" until the round's 30 s force-unlock.
    const n = targetIndices?.length ?? 0;
    if (!n || !this.coefficients.length) return 0;
    if (!Array.isArray(spawnDelaysMs) || spawnDelaysMs.length !== n) return 0;
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
    return n;
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
    this.frameStepCarryMs = 0;
    this.hiddenStepCarryMs = 0;
    this.smoothedFrameMs = PlinkoEngine.FIXED_STEP_MS;
    this.drawStaticPyramid();
  }

  /**
   * Live ball + coin geometry for `window.plinkoDebugBoard()` (DEV only, wired in PlinkoBoard).
   *
   * Everything this board is judged on is motion, and a screenshot costs about a second — far too
   * coarse to tell a bounce from a slide, or to measure how close a ball ran to a coin. Sampling
   * this on an interval gives the trajectory as numbers instead.
   */
  /**
   * Fire the landing bounce on every pocket at once (or on one, by index) and report what each one
   * is wired to. There is no way to make a ball land in all fifteen pockets, and the outer ones are
   * hit so rarely in organic play that "does that pocket react?" is otherwise unanswerable — so ask
   * the pockets directly. Returns the bone each pocket drives on the glow spine, so a pocket that
   * stays still can be told apart from a pocket whose spine bone is missing.
   */
  debugBouncePockets(index?: number): {
    glowSpineActive: boolean;
    bounceHeightPx: number;
    durationMs: number;
    pockets: { index: number; label: string; centerX: number; glowBone: boolean }[];
  } {
    const targets = index == null ? this.slots.map((_, i) => i) : [index];
    for (const i of targets) {
      const slot = this.slots[i];
      if (!slot) continue;
      slot.animationActive = true;
      slot.animationTime = this.simClockMs;
    }
    // With a drop in flight the ticker already owns the sim clock and draws this for free. Idle, the
    // ticker is parked — and would park itself again immediately, since it retires on an empty ball
    // list — so drive the frames from here instead. The pump reads a wall-clock offset PAST
    // `simClockMs` rather than advancing it: the sim clock only ever moves in whole physics steps,
    // and a dev peek must not be the thing that moves it. It hands back the moment a real drop
    // starts, which is also the moment the ticker takes the job over.
    if (!this.isAnimating) {
      const startedAt = performance.now();
      const stampedAt = this.simClockMs;
      const pump = (): void => {
        if (this.isAnimating || !this.hasActiveSlotVisuals()) return;
        this.drawAllSlotsPixi(stampedAt + (performance.now() - startedAt));
        this.renderFrame();
        requestAnimationFrame(pump);
      };
      requestAnimationFrame(pump);
    }
    return {
      glowSpineActive: this.glowSpineActive,
      bounceHeightPx: +this.slotBounceHeight.toFixed(2),
      durationMs: this.pyramidConfig.slotAnimationDuration,
      pockets: this.slots.map((slot, i) => ({
        index: i,
        label: slot.labelText || String(formatCoefficientLabel(slot.coefficient)),
        centerX: +slot.centerX.toFixed(2),
        glowBone: !!this.glowBoneBySlotIndex[i],
      })),
    };
  }

  debugBoardSnapshot(): {
    ballRadius: number;
    pegRadius: number;
    pegSpacing: number;
    laneX: number;
    pegs: { row: number; cx: number; cy: number }[];
    coins: { key: string; cx: number; cy: number; solidRadius: number; hitRadius: number }[];
    balls: {
      id: number;
      x: number;
      y: number;
      inBounce: boolean;
      row: number;
      /** Overlap into each coin's art, px. Anything above 0 is a ball drawn inside a coin. */
      worstCoinOverlap: number;
      /** Distance to the nearest coin's surface, px. 0 means it is resting on one. */
      nearestCoinGap: number;
      /** Peg rows that have registered a bounce so far. Compare against `plannedBounceRows`. */
      bouncedRows: number;
      /** Rows this ball's PATH ever intended to bounce on — the ceiling `bouncedRows` can reach. */
      plannedBounceRows: number;
      /** Live height of the bounce arc, px. This IS the bounce the player sees, not an inference. */
      arcHeight: number;
      /** Highest peg row this ball has bounced on, so a skipped LAST row is visible. */
      lastBouncedRow: number;
    }[];
  } {
    const coins = this.featuredPegs.map((p) => ({
      key: p.key,
      cx: +p.cx.toFixed(2),
      cy: +p.cy.toFixed(2),
      solidRadius: +p.solidRadius.toFixed(2),
      hitRadius: +p.hitRadius.toFixed(2),
    }));
    const balls = this.balls
      .filter((b) => b.isDropping && b.scale > 0)
      .map((b) => {
        let worst = -Infinity;
        for (const p of this.featuredPegs) {
          const gap = Math.hypot(b.x - p.cx, b.y - p.cy) - (p.solidRadius + this.ballRadius);
          if (-gap > worst) worst = -gap;
        }
        return {
          id: b.id,
          x: +b.x.toFixed(2),
          y: +b.y.toFixed(2),
          inBounce: b.isInBounce,
          row: b.currentSegmentIndex - 2,
          worstCoinOverlap: +Math.max(0, worst).toFixed(2),
          nearestCoinGap: +Math.max(0, -worst).toFixed(2),
          bouncedRows: b.bouncedRows.size,
          plannedBounceRows: b.path.filter((p) => p.row >= 0 && p.bounceIntensity > 0).length,
          arcHeight: +this.liveBounceArcHeight(b, this.simClockMs).toFixed(2),
          lastBouncedRow: b.bouncedRows.size ? Math.max(...b.bouncedRows) : -1,
        };
      });
    return {
      ballRadius: +this.ballRadius.toFixed(2),
      pegRadius: +this.pegRadius.toFixed(2),
      pegSpacing: +this.pegSpacing.toFixed(2),
      laneX: +this.pegSpacingXForRow(4).toFixed(2),
      coins,
      balls,
      // Static for a given layout — fetch once and reuse, rather than per sample.
      pegs: this.pegs.map((p) => ({
        row: p.row,
        cx: +p.cx.toFixed(2),
        cy: +p.cy.toFixed(2),
      })),
    };
  }

  get activeBallsCount(): number {
    return this.balls.filter((b) => b.isDropping).length;
  }

  get isDropBatchActive(): boolean {
    return this.pendingBurstDrops > 0 || this.isAnimating || this.activeBallsCount > 0;
  }
}
