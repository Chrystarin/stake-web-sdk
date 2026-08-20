<script lang="ts">
	import {
		answerConfirmPrompt,
		CONFIRM_PROMPT_CAPTIONS,
		CONFIRM_PROMPT_TITLES,
		confirmPrompt,
		type ConfirmPromptKind,
	} from '../game/confirmPrompt.svelte';
	import { getContext } from '../game/context';
	import { staticUrl } from '../lib/staticUrl';

	/* ═══════════════════════════════════════════════════════════════════════════════════════════
	 * LAYOUT KNOBS — tune each prompt's art here. Nothing below this block needs editing.
	 *
	 * UNITS (this is the whole trick — read once and every number makes sense):
	 *   • `panel.maxWidthPx` / `panel.widthVw` size the panel against the VIEWPORT: it renders at
	 *     `min(maxWidthPx, widthVw vw)`. Its height follows from the art's own aspect ratio.
	 *   • EVERY other number is a percentage of the PANEL, so the whole prompt scales as one piece:
	 *       – `x`      → % of panel WIDTH  (0 = left edge, 50 = centre, 100 = right edge)
	 *       – `y`      → % of panel HEIGHT (0 = top edge,  50 = centre, 100 = bottom edge)
	 *       – `width`  → % of panel WIDTH
	 *       – `size`   → % of panel WIDTH (font sizes — width-based so type never jumps when a
	 *                    variant's art has a different aspect ratio)
	 *       – `scale`  → plain multiplier applied on top, 1 = as specified above
	 *   • `x`/`y` are the element's CENTRE, not its top-left. So `x: 50, y: 50` is dead centre of the
	 *     panel whatever the element's size — move it without having to re-derive an offset.
	 *
	 * The art files carry a soft outer glow that runs to the edge of their canvas, so each `aspect`
	 * below is the FULL canvas ratio (not the visible plate). Leave those alone unless the art is
	 * re-exported; they exist so the frame is never stretched.
	 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
	type PromptLayout = {
		/** Art file basenames inside `static/img/confirmation_popup/`. */
		art: { panel: string; yes: string; no: string };
		/** Full-canvas aspect ratios of that art — width / height. */
		aspect: { panel: number; button: number };
		panel: {
			/** Hard ceiling so the prompt can't grow without bound on an ultra-wide monitor. */
			maxWidthPx: number;
			widthVw: number;
			scale: number;
			/** Nudge the whole prompt off centre. % of panel width / height. */
			offsetX: number;
			offsetY: number;
		};
		/** Portrait override — `widthVw` alone would leave the prompt tiny on a phone. */
		portrait: { widthVw: number; offsetY: number };
		/**
		 * The "Start …?" headline. `shadowX` / `shadowY` / `shadowBlur` are the drop shadow beneath it,
		 * in `em` of the title's own font size so the shadow scales with the panel instead of staying a
		 * fixed px. It is drawn TWICE (see `.cf-title`), which is what gives it a dense core rather than
		 * the washed-out ramp a single blurred shadow produces.
		 */
		title: {
			x: number;
			y: number;
			size: number;
			scale: number;
			shadowX: number;
			shadowY: number;
			shadowBlur: number;
			/**
			 * The "?" is set in Noto Sans rather than PiecesOfEight (whose question mark is a decorative
			 * outlier next to the caps), so it carries its own size — this, as a multiple of the headline's
			 * own font size. Measured off the two faces: Noto's "?" and PiecesOfEight's caps both stand
			 * 0.724em above the baseline, so 1.0 — what every prompt is set to — stands the mark exactly as
			 * tall as the letters beside it. Above that it overhangs them; below, it reads as an afterthought.
			 *
			 * Noto's ascent is the taller of the two even at 1.0, so it is the mark and not the strut that
			 * sets the line box — 1.041em rather than 1.0 — and the headline sits ~0.02em lower than the caps
			 * alone would put it. Worth knowing when centring a headline against the frame: it is the ink that
			 * has to land centred, and the line box is not the ink.
			 */
			questionEm: number;
		};
		/**
		 * Plain-copy line under the headline, for the prompts that carry one (see
		 * CONFIRM_PROMPT_CAPTIONS). `width` caps the text block so a long line wraps inside the plate
		 * instead of running onto the frame; `lineHeight` is in `em` of the caption's own size.
		 */
		caption?: { x: number; y: number; size: number; width: number; lineHeight: number };
		/** The two choice plates. Give them different `y` values to stagger them. */
		yes: { x: number; y: number; width: number; scale: number };
		no: { x: number; y: number; width: number; scale: number };
		/** YES / NO wording drawn on top of the plates. `stroke` is the dark glyph edge. */
		label: { size: number; offsetX: number; offsetY: number; stroke: number };
	};

	const LAYOUT: Record<ConfirmPromptKind, PromptLayout> = {
		highBet: {
			art: {
				panel: 'high_bet_container.webp',
				yes: 'high_bet_yes_container.webp',
				no: 'high_bet_no_container.webp',
			},
			aspect: { panel: 4700 / 3205, button: 1501 / 821 },
			panel: { maxWidthPx: 1600, widthVw: 65, scale: 0.95, offsetX: 0, offsetY: -10 },
			portrait: { widthVw: 92, offsetY: -6 },
			title: {
				x: 50,
				y: 36,
				size: 8.1,
				scale: 1.05,
				shadowX: 0,
				shadowY: 0.08,
				shadowBlur: 0.035,
				questionEm: 1,
			},
			yes: { x: 33, y: 63, width: 31, scale: 1 },
			no: { x: 67, y: 63, width: 31, scale: 1 },
			label: { size: 6.4, offsetX: 0, offsetY: -0.31, stroke: 0.2 },
		},
		// Arming an Autobet run at a high-bet stake. Deliberately the HIGH BET board, not the Autobet
		// one: the thing being warned about is the stake, so it should read as the high-bet warning the
		// player already knows. Its headline is the longest of the set and it is the only prompt with a
		// caption, so it gets the widest plate of the three and the title is set smaller.
		highAutobet: {
			art: {
				panel: 'high_bet_container.webp',
				yes: 'high_bet_yes_container.webp',
				no: 'high_bet_no_container.webp',
			},
			aspect: { panel: 4700 / 3205, button: 1501 / 821 },
			// A wider board than the plain high-bet prompt (65 → 72vw) so the headline and caption are not
			// crowding the frame. Every `cqw` number below is re-based by 65/72 against that variant, so the
			// board grew and the type stayed exactly the size it already was. `offsetY` eases off with it: a
			// taller panel needs less lift to clear the bet panel, and -10 would run the frame off the top.
			panel: { maxWidthPx: 1775, widthVw: 72, scale: 0.95, offsetX: 0, offsetY: -7 },
			// Portrait is already near full-bleed, so it takes the last 8vw it has rather than the same 11%
			// the landscape plate gained — enough that the re-based type lands within a hair of its old size.
			portrait: { widthVw: 100, offsetY: -6 },
			// The `y` values below — title 29, caption 46, plates 67 — are the old 27 / 44 / 65 carried
			// down 2 as one block. Measured off the art rather than eyeballed: the frame's wooden interior
			// runs 16.8%–82.2% of the panel's height, and once the plates shrank the block was riding high
			// in it. The shift lands the headline's ink and the plates' bottom edge ~5.9cqw off the wood
			// top and bottom respectively. Note that is the ink, not the line box: PiecesOfEight's caps sit
			// well below the top of their em box, so centring the boxes instead drops it visibly too low.
			title: {
				x: 50,
				y: 29,
				// 6.8 re-based onto the wider plate, so it renders at the size it always did. Still a hair
				// under the plain high-bet headline's effective size (8.1 × 1.05 on its own plate): this
				// wording is four characters longer, and that keeps the run of caps the same width.
				size: 6.14,
				scale: 1,
				shadowX: 0,
				shadowY: 0.08,
				shadowBlur: 0.035,
				questionEm: 1,
			},
			caption: { x: 50, y: 46, size: 3.07, width: 57.8, lineHeight: 1.4 },
			// The plates are 25/31 of their former width, with `label` scaled by that same 25/31 so the
			// wording keeps its proportion on the plate rather than outgrowing it.
			//
			// Their `x` is set from the art: each button's opaque plate is 84.25% of its own canvas (the
			// rest is glow and drop shadow), so at 25cqw the visible plate is 21.1cqw, and the interior
			// wood runs 12.1%–88.0% of the panel's width. Centres of 34.7 / 65.3 leave 9.5cqw between the
			// plates against 12.1cqw of wood outside each — the gap is no longer the tightest space on the
			// board, and the two still read as a pair rather than as opposite corners.
			yes: { x: 34.7, y: 67, width: 25, scale: 1 },
			no: { x: 65.3, y: 67, width: 25, scale: 1 },
			label: { size: 5.16, offsetX: 0, offsetY: -0.25, stroke: 0.16 },
		},
		autobet: {
			art: {
				panel: 'autobet_container.webp',
				yes: 'autobet_yes_container.webp',
				no: 'autobet_no_container.webp',
			},
			aspect: { panel: 5167 / 2897, button: 1568 / 569 },
			panel: { maxWidthPx: 1600, widthVw: 69, scale: .95, offsetX: 0, offsetY: -13 },
			portrait: { widthVw: 94, offsetY: -6 },
			title: {
				x: 50,
				y: 38,
				size: 8.2,
				scale: 1.1,
				shadowX: 0,
				shadowY: 0.08,
				shadowBlur: 0.035,
				questionEm: 1,
			},
			// Plates sit roughly midway between the headline and the bottom rope — this board is the
			// shortest of the three, so leaving them tucked under the title stranded a wide run of
			// empty plank below them.
			yes: { x: 33, y: 64, width: 27.5, scale: 1.05 },
			no: { x: 67, y: 64, width: 27.5, scale: 1.05 },
			label: { size: 5.6, offsetX: 0, offsetY: -0.27, stroke: 0.17 },
		},
		buyBonus: {
			art: {
				panel: 'bonus_buy_container.webp',
				yes: 'bonus_buy_yes_container.webp',
				no: 'bonus_buy_no_container.webp',
			},
			aspect: { panel: 5280 / 3666, button: 1497 / 819 },
			panel: { maxWidthPx: 1600, widthVw: 71, scale: 1, offsetX: 0, offsetY: -10 },
			portrait: { widthVw: 92, offsetY: -6 },
			// The skull arch eats the top of this board and the coin piles eat the bottom corners, so
			// the headline sits lower here than on the other two and the plates are narrower.
			title: {
				x: 50,
				y: 44,
				size: 7.4,
				scale: 1,
				shadowX: 0,
				shadowY: 0.08,
				shadowBlur: 0.035,
				questionEm: 1,
			},
			yes: { x: 35, y: 66.5, width: 24, scale: 1.1 },
			no: { x: 65, y: 66.5, width: 24, scale: 1.1 },
			label: { size: 5.2, offsetX: 0, offsetY: -0.8, stroke: 0.2 },
		},
	};

	const context = getContext();

	const kind = $derived(confirmPrompt.kind);
	const layout = $derived(kind ? LAYOUT[kind] : null);
	const title = $derived(kind ? CONFIRM_PROMPT_TITLES[kind] : '');
	/**
	 * The headline split so every "?" can be handed to its own face (see `.cf-title-q`). Splitting on a
	 * CAPTURING group keeps the marks in the output, so the parts still concatenate back to `title`.
	 */
	const titleParts = $derived(
		title
			.split(/(\?)/)
			.filter((part) => part !== '')
			.map((part) => ({ text: part, question: part === '?' })),
	);
	/** Caption copy, pre-split on its authored line breaks (empty for the prompts without one). */
	const captionLines = $derived(kind ? (CONFIRM_PROMPT_CAPTIONS[kind]?.split('\n') ?? []) : []);

	const artUrl = (file: string) => staticUrl(`img/confirmation_popup/${file}`);

	function answer(confirmed: boolean) {
		// Same click SFX as the bet-panel steppers / buy-bonus modal.
		context.eventEmitter.broadcast({ type: 'soundOnce', name: 'clickUIButton' });
		answerConfirmPrompt(confirmed);
	}

	/** Escape is a cancel, matching the backdrop click. Guarded so it only fires while open. */
	function onKeydown(event: KeyboardEvent) {
		if (confirmPrompt.kind === null) return;
		if (event.key !== 'Escape') return;
		event.preventDefault();
		answer(false);
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#if kind && layout}
	<!-- Clicking the backdrop is a cancel — same outcome as "No", never a silent commit. -->
	<div class="cf-backdrop" role="presentation" onclick={() => answer(false)}>
		<div
			class="cf-panel"
			role="dialog"
			aria-modal="true"
			aria-label={title}
			onclick={(event) => event.stopPropagation()}
			style:--panel-max-w="{layout.panel.maxWidthPx}px"
			style:--panel-vw="{layout.panel.widthVw}vw"
			style:--panel-vw-p="{layout.portrait.widthVw}vw"
			style:--panel-aspect={layout.aspect.panel}
			style:--panel-scale={layout.panel.scale}
			style:--panel-dx="{layout.panel.offsetX}%"
			style:--panel-dy="{layout.panel.offsetY}%"
			style:--panel-dy-p="{layout.portrait.offsetY}%"
			style:--btn-aspect={layout.aspect.button}
			style:--label-size="{layout.label.size}cqw"
			style:--label-dx="{layout.label.offsetX}cqw"
			style:--label-dy="{layout.label.offsetY}cqw"
			style:--label-stroke="{layout.label.stroke}cqw"
		>
			<img class="cf-frame" src={artUrl(layout.art.panel)} alt="" aria-hidden="true" />

			<h2
				class="cf-title"
				style:--x="{layout.title.x}%"
				style:--y="{layout.title.y}%"
				style:--scale={layout.title.scale}
				style:--shadow-x="{layout.title.shadowX}em"
				style:--shadow-y="{layout.title.shadowY}em"
				style:--shadow-blur="{layout.title.shadowBlur}em"
				style:font-size="{layout.title.size}cqw"
				style:--q-em="{layout.title.questionEm}em"
			>
				<!-- prettier-ignore -->
				{#each titleParts as part}{#if part.question}<span class="cf-title-q">{part.text}</span>{:else}{part.text}{/if}{/each}
			</h2>

			{#if layout.caption && captionLines.length}
				<p
					class="cf-caption"
					style:--x="{layout.caption.x}%"
					style:--y="{layout.caption.y}%"
					style:--w="{layout.caption.width}cqw"
					style:--scale={1}
					style:font-size="{layout.caption.size}cqw"
					style:line-height={layout.caption.lineHeight}
				>
					<!-- prettier-ignore -->
					{#each captionLines as line, index}{#if index > 0}<br />{/if}{line}{/each}
				</p>
			{/if}

			<button
				type="button"
				class="cf-choice cf-choice--yes"
				style:--x="{layout.yes.x}%"
				style:--y="{layout.yes.y}%"
				style:--w="{layout.yes.width}cqw"
				style:--scale={layout.yes.scale}
				onclick={() => answer(true)}
			>
				<img class="cf-choice-frame" src={artUrl(layout.art.yes)} alt="" aria-hidden="true" />
				<span class="cf-choice-text">Yes</span>
			</button>

			<button
				type="button"
				class="cf-choice cf-choice--no"
				style:--x="{layout.no.x}%"
				style:--y="{layout.no.y}%"
				style:--w="{layout.no.width}cqw"
				style:--scale={layout.no.scale}
				onclick={() => answer(false)}
			>
				<img class="cf-choice-frame" src={artUrl(layout.art.no)} alt="" aria-hidden="true" />
				<span class="cf-choice-text">No</span>
			</button>
		</div>
	</div>
{/if}

<style>
	.cf-backdrop {
		position: fixed;
		inset: 0;
		/* Above the buy-bonus modal (60) and the info modal (18000) — the buy-bonus prompt is raised
		   FROM that modal, which stays open behind it — but below Toast (19000), MsgBox (20000) and the
		   offline overlay (21000), which must always be able to speak over a prompt. */
		z-index: 18500;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.72);
		/* No padding: the panel is sized and placed purely by its own knobs, and the art's built-in
		   transparent glow margin already keeps the visible frame off the screen edges. */
		padding: 0;
	}

	.cf-panel {
		position: relative;
		width: min(var(--panel-max-w), var(--panel-vw));
		aspect-ratio: var(--panel-aspect);
		/* THE unit that makes every knob above work: 1cqw = 1% of THIS box's width, so each child's
		   size and position is a plain percentage of the panel and the whole prompt scales together. */
		container-type: inline-size;
		transform: translate(var(--panel-dx), var(--panel-dy)) scale(var(--panel-scale));
		animation: cf-pop 0.16s ease-out;
	}

	/* Portrait swaps in the `portrait` knobs. Reassigning `--panel-dy` itself (rather than adding a
	   second transform) keeps the keyframes below working off one variable. */
	@media (orientation: portrait) {
		.cf-panel {
			width: min(var(--panel-max-w), var(--panel-vw-p));
			--panel-dy: var(--panel-dy-p);
		}
	}

	@keyframes cf-pop {
		from {
			opacity: 0;
			transform: translate(var(--panel-dx), var(--panel-dy)) scale(calc(var(--panel-scale) * 0.94));
		}
		to {
			opacity: 1;
			transform: translate(var(--panel-dx), var(--panel-dy)) scale(var(--panel-scale));
		}
	}

	.cf-frame {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		/* `contain`, not `fill`: the aspect-ratio above already matches the art, so this only ever
		   guards against a re-export with a slightly different ratio — it letterboxes instead of
		   distorting the frame. */
		object-fit: contain;
		pointer-events: none;
		user-select: none;
	}

	/* `--x` / `--y` are the element's CENTRE within the panel, hence the -50% pre-translate. */
	.cf-title,
	.cf-caption,
	.cf-choice {
		position: absolute;
		left: var(--x);
		top: var(--y);
		transform: translate(-50%, -50%) scale(var(--scale));
	}

	.cf-title {
		margin: 0;
		width: 100%;
		font-family: 'PiecesOfEight', serif;
		font-weight: 400;
		/* font-size is set inline from `title.size` (in cqw). */
		line-height: 1;
		text-align: center;
		text-transform: uppercase;
		letter-spacing: 0.02em;
		/* PiecesOfEight ships a very wide space glyph, so "START AUTOBET?" reads as a double space at
		   this size. Pull the word gap back to a single-space rhythm. */
		word-spacing: -0.14em;
		/* Gold gradient clipped to the glyphs. */
		background-image: linear-gradient(180deg, #f5b936 0%, #ebad26 56.7%, #d18a16 81.67%);
		background-clip: text;
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		color: transparent;
		/* ⚠️ The shadow MUST be a filter, not the `text-shadow` the spec was written as: under
		   `background-clip: text` the gradient paints in the element's BACKGROUND layer while a
		   text-shadow paints in the TEXT layer — i.e. in front — so a literal text-shadow would smear
		   black over the gold instead of falling behind it. drop-shadow composites behind the rendered
		   glyphs, which is what "shadow beneath the title" actually means.
		   Offsets are `em`, so the shadow scales with the headline instead of being pinned to px. */
		filter: drop-shadow(var(--shadow-x) var(--shadow-y) var(--shadow-blur) #000000)
			drop-shadow(var(--shadow-x) var(--shadow-y) var(--shadow-blur) #000000);
		pointer-events: none;
	}

	/* Only the "?" is Noto Sans — PiecesOfEight's own question mark is a decorative outlier that reads
	   as a different mark entirely next to its caps. Everything that makes the headline gold (the
	   clipped gradient, the drop shadow) lives on `.cf-title` and paints through this span's glyph
	   unchanged, so this only has to undo the parts that are specific to the display face: its size
	   ratio (`--q-em`) and the letter-spacing that was tuned for those caps. */
	.cf-title-q {
		font-family: 'Noto Sans', 'Instrument Sans', sans-serif;
		font-size: var(--q-em);
		font-weight: 600;
		letter-spacing: 0;
		word-spacing: 0;
	}

	.cf-caption {
		margin: 0;
		width: var(--w);
		font-family: 'Poppins', sans-serif;
		font-weight: 600;
		/* font-size / line-height are set inline from the `caption` knobs. */
		text-align: center;
		color: #ffffff;
		/* Plain text on a dark plank — a soft shadow is enough to keep it off the wood grain. Sized in
		   `em` so it scales with the caption rather than being pinned to px. */
		text-shadow: 0 0.06em 0.1em rgba(0, 0, 0, 0.9);
		pointer-events: none;
	}

	.cf-choice {
		width: var(--w);
		aspect-ratio: var(--btn-aspect);
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: none;
		padding: 0;
		cursor: pointer;
		transition: filter 0.1s ease;
	}

	.cf-choice-frame {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
		pointer-events: none;
		user-select: none;
	}

	.cf-choice-text {
		position: relative;
		z-index: 1;
		font-family: 'Poppins', sans-serif;
		font-style: normal;
		font-weight: 500;
		font-size: var(--label-size);
		line-height: 1;
		text-align: center;
		text-transform: uppercase;
		color: #eaeaea;
		text-shadow: 0px 4px 4px rgba(0, 0, 0, 0.25);
		/* The reference's `border: 10px solid #000` is a Figma stroke on the text, not a box — drawn
		   here as a glyph edge, sized in cqw so it tracks the panel instead of staying a fixed 10px.
		   Set `label.stroke: 0` above to drop it. */
		-webkit-text-stroke: var(--label-stroke) #000000;
		paint-order: stroke fill;
		translate: var(--label-dx) var(--label-dy);
		white-space: nowrap;
	}

	.cf-choice:hover {
		filter: brightness(1.08);
	}
	.cf-choice:active {
		filter: brightness(0.94);
	}
</style>
