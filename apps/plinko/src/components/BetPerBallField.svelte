<script lang="ts">
	import { stateUrlDerived } from 'state-shared';

	import { BET_PER_BALL_PRESETS } from '../game-logic/constants';
	import { getContext } from '../game/context';
	import {
		plinkoMaxStakePerBall,
		plinkoMinStakePerBall,
		plinkoStakePerBallOptions,
		plinkoStakePerBallSteps,
	} from '../game/plinkoBet';
	import { formatCompactAmount } from '../lib/format';
	import { staticUrl } from '../lib/staticUrl';

	import './GameHud.scss';

	/**
	 * The BET PER BALL control from the betting panel — − / + steppers that walk the RGS `betLevels`
	 * grid one level at a time, plus the quick-jump presets popup — as a standalone component.
	 *
	 * Two skins, which now differ ONLY in which three files `art` below points at:
	 *  • `plaque` (default) — the betting bar's frame art and image steppers.
	 *  • `panel`  — the Buy Bonus modal's copy: the delivered bet component — its own wide container
	 *               and its own wooden − / + buttons.
	 * Both are the same box, the same `.bp-*` classes (GameHud.scss) and the same stepping behaviour —
	 * only the art, and the geometry the panel skin solves from it, differ.
	 *
	 * Today the MODAL is the only caller; the bar itself still renders its own inline copy of the plaque
	 * skin (the `betPerBallField` snippet in GameHud.svelte). Keep the two in step, or point the bar here.
	 *
	 * Sizing comes entirely from the `--bp-*` metrics vars, so the host must be (or sit inside) an element
	 * carrying `.bottom-panel-row` or `.bp-field-host` — see the `bp-field-metrics` mixin in GameHud.scss.
	 */
	type Props = {
		betAmount: number;
		onBetAmountChange: (value: number) => void;
		/** Wager config is locked (round running, Autobet armed, …): steppers and presets go inert. */
		locked?: boolean;
		/** Bonus round: the − / + steppers are dropped entirely, leaving a read-only value. */
		steppersHidden?: boolean;
		/** Presets popup visibility. Bindable so the host can close it from its own click-outside /
		 *  one-panel-at-a-time logic. */
		presetsOpen?: boolean;
		/** Fired just before the popup opens — the host's chance to close any panel of its own. */
		onPresetsOpen?: () => void;
		/** Open the popup BELOW the field instead of above it (hosts that sit near the top of the screen). */
		presetsBelow?: boolean;
		/** Which skin to render — see the component note above. */
		variant?: 'plaque' | 'panel';
		/** Label the field just "Bet" instead of "Bet per ball" (Social Mode wording still applies). */
		shortLabel?: boolean;
	};

	let {
		betAmount,
		onBetAmountChange,
		locked = false,
		steppersHidden = false,
		presetsOpen = $bindable(false),
		onPresetsOpen,
		presetsBelow = false,
		variant = 'plaque',
		shortLabel = false,
	}: Props = $props();

	const context = getContext();

	/**
	 * Frame + stepper art for the skin. The panel set is the delivered Buy Bonus bet component: a
	 * 661×308 container (its drop shadow baked into the canvas) and two 123×123 buttons. How big those
	 * buttons render and how far in they sit is solved from those canvas dimensions in the `<style>`
	 * block below, so a redelivery at a different size means re-deriving the numbers there.
	 */
	const art = $derived(
		variant === 'panel'
			? {
					frame: 'img/buy_bonus/buy_bonus_bet_container.webp',
					decrease: 'img/buy_bonus/buy_bonus_bet_button_decrease.webp',
					increase: 'img/buy_bonus/buy_bonus_bet_button_increase.webp',
				}
			: {
					frame: 'img/betting-component-frame.webp',
					decrease: 'img/betting-component-input-decrease.webp',
					increase: 'img/betting-component-input-increase.webp',
				},
	);

	// Social Mode restricts the word "Bet": the wager-field label becomes "Play (per ball)" (rendered
	// uppercase by CSS). Non-social sessions keep the localized "Bet" wording.
	const label = $derived.by(() => {
		if (shortLabel) return stateUrlDerived.social() ? 'Play' : context.i18nDerived.t('Bet');
		return stateUrlDerived.social() ? 'Play per ball' : context.i18nDerived.t('Bet per ball');
	});

	const availablePresets = $derived(
		plinkoStakePerBallOptions().length
			? plinkoStakePerBallOptions()
			: BET_PER_BALL_PRESETS.filter(
					(v) => v >= plinkoMinStakePerBall() && v <= plinkoMaxStakePerBall(),
				),
	);

	/** Index of the entry in `values` nearest to `target` (values must be non-empty). */
	function closestIndex(values: readonly number[], target: number) {
		let best = 0;
		let bestDiff = Math.abs(values[0] - target);
		for (let i = 1; i < values.length; i++) {
			const diff = Math.abs(values[i] - target);
			if (diff < bestDiff) {
				bestDiff = diff;
				best = i;
			}
		}
		return best;
	}

	/**
	 * The stake one − / + press away from the current one, or `null` when that press would walk off the
	 * end of the grid (which is also what disables the button). The stepper walks the FULL `betLevels`
	 * grid one level at a time, unlike the preset popup's 8 sampled quick-jumps.
	 */
	function steppedStake(delta: number): number | null {
		if (delta === 0) return null;
		const steps = plinkoStakePerBallSteps();
		if (!steps.length) return null;
		const next = closestIndex(steps, betAmount) + (delta > 0 ? 1 : -1);
		if (next < 0 || next >= steps.length) return null;
		return steps[next];
	}

	function adjustStep(delta: number) {
		if (locked) return;
		const next = steppedStake(delta);
		if (next == null) return;
		onBetAmountChange(next);
		context.eventEmitter.broadcast({ type: 'soundOnce', name: 'clickUIButton' });
	}

	function isStepDisabled(delta: number) {
		if (locked) return true;
		// Reads `betAmount`, so each button re-evaluates as the value moves.
		return steppedStake(delta) == null;
	}

	function onPanelTrigger(event: MouseEvent) {
		event.stopPropagation();
		if (locked) return;
		if (!presetsOpen) onPresetsOpen?.();
		presetsOpen = !presetsOpen;
	}

	function selectPreset(value: number) {
		if (locked) return;
		onBetAmountChange(value);
		presetsOpen = false;
		context.eventEmitter.broadcast({ type: 'soundOnce', name: 'clickUIButton' });
	}
</script>

<div
	class="bp-field bp-field--bet bp-field--select bp-field--bet-controls bp-bet-presets-wrap"
	class:bp-field--panel={variant === 'panel'}
>
	<!-- Stretched to the field box by the shared `.bp-field-frame` rule (`object-fit: fill`). For the
	     panel skin that is only distortion-free while the box keeps the container art's 661/308 ratio,
	     which the host guarantees — see `--bp-field-plaque-width` on `.bb-bet-row` in BuyBonusModal. -->
	<img class="bp-field-frame" src={staticUrl(art.frame)} alt="" aria-hidden="true" />
	<span class="bp-field-label">{label}</span>
	<div class="bp-bet-input-wrap">
		{#if !steppersHidden}
			<button
				type="button"
				class="bp-stepper-btn bp-stepper-btn--decrease"
				disabled={isStepDisabled(-1)}
				aria-label="Decrease bet per ball"
				onclick={() => adjustStep(-1)}
			>
				<img src={staticUrl(art.decrease)} alt="" aria-hidden="true" />
			</button>
		{/if}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="bp-bet-input-mid"
			class:bp-bet-input-mid--disabled={locked}
			role="button"
			tabindex={locked ? -1 : 0}
			aria-disabled={locked}
			aria-label="Open bet per ball presets"
			onmousedown={(e) => e.preventDefault()}
			onclick={onPanelTrigger}
			onkeydown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') onPanelTrigger(e as unknown as MouseEvent);
			}}
		>
			<span class="bp-select-display" aria-live="polite">
				{formatCompactAmount(betAmount)}
			</span>
		</div>
		{#if !steppersHidden}
			<button
				type="button"
				class="bp-stepper-btn bp-stepper-btn--increase"
				disabled={isStepDisabled(1)}
				aria-label="Increase bet per ball"
				onclick={() => adjustStep(1)}
			>
				<img src={staticUrl(art.increase)} alt="" aria-hidden="true" />
			</button>
		{/if}
	</div>
	{#if presetsOpen}
		<div class="bp-bet-presets-panel" class:bp-bet-presets-panel--below={presetsBelow}>
			{#each availablePresets as preset}
				<button
					type="button"
					class="bp-bet-presets-option"
					class:bp-bet-presets-option--active={betAmount === preset}
					disabled={locked}
					onclick={() => selectPreset(preset)}
				>
					{formatCompactAmount(preset)}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style lang="scss">
	/* PANEL SKIN — everything below is scoped to this component and applies only to `variant="panel"`.
	   The `plaque` skin is entirely the shared GameHud.scss rules; this one overrides the two steppers
	   and the interior they leave on top of them (the frame itself is now just a different `src`).

	   ⚠️ EVERY number here is a fraction of the delivered container's 661×308 canvas, carried in through
	   --panel-art-px, so the whole layout is stated in the art's own pixels. Measured off that file:
	   the frame band runs x 30..56 / y 26..50 (its outer few px are the baked-in drop shadow), leaving
	   an interior cavity of x 56..605, y 50..258 centred on the canvas. */
	.bp-field--panel {
		/* One pixel of the 661×308 canvas. Valid only because the host sizes the plaque to the art's
		   ratio — --bp-field-plaque-width = height × 661/308 (see `.bb-bet-row` in BuyBonusModal.svelte),
		   which is also what keeps `object-fit: fill` from stretching the frame. */
		--panel-art-px: calc(var(--bp-field-plaque-height) / 308);

		/* Reserved on each side for a stepper: the button's outer edge (96 + 98 art px) plus a couple of
		   px of air. Stated here rather than inherited from --bp-stepper-side (a whole field height, cut
		   for the OTHER frame's cavity) because these buttons are sized to their own art. Overriding the
		   gutter means restating --bp-field-base-width with it: `.bp-field` is content-box, so content +
		   both gutters is what has to add back up to the plaque width. */
		--bp-panel-gutter: calc(var(--panel-art-px) * 200);
		--bp-field-base-width: calc(var(--bp-field-plaque-width) - 2 * var(--bp-panel-gutter));
	}

	.bp-field--panel.bp-field--bet-controls {
		padding-left: var(--bp-panel-gutter);
		padding-right: var(--bp-panel-gutter);
	}

	/* The − / + are delivered art now, so the shared rule's box — square, sized and top-anchored to the
	   betting bar frame's cavity — is replaced outright by the buttons' own 98×98 at 96 px in from each
	   canvas edge, vertically centred. That leaves 40 art px of clear cavity between the frame band and
	   each button, and 261 (39% of the width) between the two for the label/value pair. */
	.bp-field--panel .bp-stepper-btn {
		top: 50%;
		transform: translateY(-50%);
		width: calc(var(--panel-art-px) * 98);
		height: calc(var(--panel-art-px) * 98);
	}

	.bp-field--panel .bp-stepper-btn--decrease {
		left: calc(var(--panel-art-px) * 96);
	}

	.bp-field--panel .bp-stepper-btn--increase {
		right: calc(var(--panel-art-px) * 96);
	}

	/* The shared rule scales the button on hover/press; with `top: 50%` that would drop the translate and
	   snap the button downward, so both states restate it. */
	.bp-field--panel .bp-stepper-btn:hover:not(:disabled) {
		transform: translateY(-50%) scale(1.12);
	}

	.bp-field--panel .bp-stepper-btn:active:not(:disabled) {
		transform: translateY(-50%) scale(0.94);
	}

	/* CONTENTS SCALE — the value is the shared `.bp-select-display` clamp (GameHud.scss) taken up 15%, so
	   the panel's insides read at their own weight rather than at the betting bar's. Restated as a literal
	   clamp rather than a transform so the pair still lays out (and centres) at its true size. The LABEL
	   is left at the shared size: between "BET" and the number, the number is the content worth the pixels.

	   1.15 is bounded by WIDTH, not height — this frame's interior is 67% of its height (the old 9-sliced
	   card frame's was 52%), so the label/value pair has room to spare vertically, but the gutters above
	   leave it only 0.85 × the plaque height across, ~4.3em at this size. The widest value the field can
	   show is `formatCompactAmount`'s 6 characters ("999.99"), ~3.3em of Poppins, so the headroom is
	   about 30%; 1.25 (what the old frame ran) spends most of that. */
	.bp-field--panel .bp-select-display {
		/* .bp-select-display's clamp(0.92vw, 1.12vw, 1.4vw) × 1.15 */
		font-size: clamp(1.06vw, 1.29vw, 1.61vw);
	}
</style>
