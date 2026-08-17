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
	 * Two skins:
	 *  • `plaque` (default) — the betting bar's frame art and image steppers.
	 *  • `panel`  — the Buy Bonus modal's copy: the TIER CARD frame art 9-sliced into a wide rectangle,
	 *               and plain − / + glyphs instead of the bar's button art.
	 * Both are the same box, the same `.bp-*` classes (GameHud.scss) and the same stepping behaviour —
	 * only the frame and the two buttons differ.
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
	{#if variant === 'panel'}
		<!-- The tier-card frame, 9-sliced into a wide rectangle: the corner brackets stay intact at their
		     own scale, the rivetted edge bands tile along each side, and the middle (`fill`) paints the
		     card's wood texture across the interior. A DIV, not an <img>: `border-image` is the only way
		     to re-cut this square frame to a bar without squashing its corners. The URL rides in on a
		     custom property so SvelteKit's `base` still resolves it (see lib/staticUrl.ts). -->
		<div
			class="bp-field-frame bp-field-frame--panel"
			style:--panel-frame-img="url({staticUrl('img/buy_bonus_panel.webp')})"
			aria-hidden="true"
		></div>
	{:else}
		<img
			class="bp-field-frame"
			src={staticUrl('img/betting-component-frame.webp')}
			alt=""
			aria-hidden="true"
		/>
	{/if}
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
				{#if variant === 'panel'}
					<span class="bp-stepper-glyph" aria-hidden="true">−</span>
				{:else}
					<img
						src={staticUrl('img/betting-component-input-decrease.webp')}
						alt=""
						aria-hidden="true"
					/>
				{/if}
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
				{#if variant === 'panel'}
					<span class="bp-stepper-glyph" aria-hidden="true">+</span>
				{:else}
					<img
						src={staticUrl('img/betting-component-input-increase.webp')}
						alt=""
						aria-hidden="true"
					/>
				{/if}
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
	   The `plaque` skin is entirely the shared GameHud.scss rules; this one overrides the frame and the
	   two stepper buttons on top of them. */

	/* Frame band thickness, and with it the CORNER BRACKET SIZE — a border-image corner is drawn into a
	   border-width × border-width box, so the bracket can only grow by thickening the band. The two are
	   one knob, and the band eats interior at twice the rate it grows (top AND bottom), so a host that
	   raises this must give the field height to match or the label/value pair ends up on the frame —
	   see --bp-item-height on `.bb-bet-row` in BuyBonusModal.svelte, which is solved against this 0.24. */
	.bp-field--panel .bp-field-frame--panel {
		box-sizing: border-box;
		border-style: solid;
		border-width: calc(var(--bp-field-plaque-height) * 0.24);
		border-image-source: var(--panel-frame-img);
		/* 115px of the 741×694 source is exactly the corner bracket, so each corner renders whole. `fill`
		   also paints the middle slice — the card's wood texture — behind the value. */
		border-image-slice: 115 fill;
		/* `round`, not `stretch`: the edge bands tile at (near) their own scale instead of being squashed
		   to the band's length, so the rivets stay round and keep the source's spacing. */
		border-image-repeat: round;
	}

	/* − / + glyphs replace the bar's button art. The button box itself (size, absolute placement) is
	   still the shared `.bp-field--bet-controls .bp-stepper-btn` rule; only the contents change — plus
	   the two adjustments below, which the panel frame's thicker band calls for. */
	.bp-field--panel .bp-stepper-btn {
		/* Centre in the panel instead of hanging from the old frame's cavity top (see GameHud.scss). */
		top: 50%;
		transform: translateY(-50%);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	/* Push the − / + out to the panel's side edges, stopping just clear of the frame band so a glyph
	   never sits on the rivets. The inset looks tiny next to the band because it positions the BUTTON
	   BOX, which is much wider than the glyph centred in it: the visible glyph lands at
	   `inset + ~0.35 × plaque height`, i.e. roughly a band-and-a-half in. The box's outer half simply
	   overhangs the frame as extra hit area, which is all upside on touch. */
	.bp-field--panel .bp-stepper-btn--decrease {
		left: calc(var(--bp-field-plaque-height) * 0.03);
	}

	.bp-field--panel .bp-stepper-btn--increase {
		right: calc(var(--bp-field-plaque-height) * 0.03);
	}

	/* The shared rule scales the button on hover/press; with `top: 50%` that would drop the translate and
	   snap the glyph downward, so both states restate it. */
	.bp-field--panel .bp-stepper-btn:hover:not(:disabled) {
		transform: translateY(-50%) scale(1.12);
	}

	.bp-field--panel .bp-stepper-btn:active:not(:disabled) {
		transform: translateY(-50%) scale(0.94);
	}

	/* CONTENTS SCALE — the label, the value and the − / + glyphs are all the shared `.bp-*` clamps
	   (GameHud.scss) taken up a quarter, so the panel's insides read at their own weight rather than at
	   the betting bar's. Restated as literal clamps rather than a transform so the pair still lays out
	   (and centres) at its true size. The interior they have to fit in is
	   `plaque height − 2 × band`, so a bump here is bounded by the band factor above and the host's
	   --bp-item-height; 1.25 is what the current 0.24 / 7.7vw pair affords with ~5px of air left. */
	/* The LABEL is the exception: it stays at the shared size. The pair's height is what sets how short
	   the panel can be, and between "BET" and the number the number is the content worth the pixels —
	   so the label gives its 25% back, and the gap under it is tightened, to buy panel height. */
	.bp-field--panel .bp-field-label {
		--bp-label-value-gap: 0.04em;
	}

	.bp-field--panel .bp-select-display {
		/* .bp-select-display's clamp(0.92vw, 1.12vw, 1.4vw) × 1.25 */
		font-size: clamp(1.15vw, 1.4vw, 1.75vw);
	}

	.bp-field--panel .bp-stepper-glyph {
		font-family: 'Poppins', 'Instrument Sans', sans-serif;
		font-weight: 700;
		font-synthesis: none;
		/* The VALUE's size above × 1.2, NOT a fraction of the plaque height: the two are sized on
		   different curves, and a plaque-derived glyph ends up more than twice the value's size in
		   portrait, where the value sits on its clamp floor. Tracking the value keeps the − / + one step
		   heavier than the number in every orientation. */
		font-size: clamp(1.38vw, 1.68vw, 2.1vw);
		line-height: 1;
		color: #f2f4f6;
		text-shadow: 0 calc(var(--bp-field-plaque-height) * 0.03)
			calc(var(--bp-field-plaque-height) * 0.06) rgba(0, 0, 0, 0.85);
		user-select: none;
		pointer-events: none;
	}
</style>
