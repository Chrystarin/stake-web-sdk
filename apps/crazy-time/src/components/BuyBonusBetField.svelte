<script lang="ts">
	/**
	 * The Buy Bonus screen's bet control, copied from One-Eyed Willy's Plinko — apps/plinko
	 * BetPerBallField.svelte in its `panel` skin, with the GameHud.scss rules it leans on: the bet
	 * container plate with BET over the value, the wooden − / + walking the RGS bet grid one level at
	 * a time, and the value itself opening a popup of quick-jump presets under the plate.
	 *
	 * Plinko sizes it off its betting bar's vw metrics. This screen states everything in --ui-px, so
	 * the plate's height is the one knob (`--bb-bet-h`, set by the host) and every other length is a
	 * share of it: the frame and the buttons in the container art's own pixels, the type and the popup
	 * in pixels of the plate as Plinko draws it at the 1024×576 reference, where it is 80 tall.
	 *
	 * Set in Noto Sans, the face the rest of this screen is set in, rather than shipping Plinko's
	 * Poppins for one field.
	 */
	import { playSound } from '../game/sound';
	import { staticUrl } from '../lib/staticUrl';

	type Props = {
		/** The bet grid, ascending. */
		options: readonly number[];
		value: number;
		onChange: (value: number) => void;
		/** A round is running: the steppers and the presets go inert. */
		locked?: boolean;
	};
	let { options, value, onChange, locked = false }: Props = $props();

	/** How many quick-jumps the popup offers — Plinko's eight, spaced evenly from min to max. */
	const PRESET_COUNT = 8;

	let host: HTMLDivElement;
	let presetsOpen = $state(false);

	/** Where `value` sits in the grid — the nearest entry, should it ever be off it. */
	const current = $derived.by(() => {
		let best = -1;
		for (let i = 0; i < options.length; i++) {
			if (best < 0 || Math.abs(options[i] - value) < Math.abs(options[best] - value)) best = i;
		}
		return best;
	});

	const presets = $derived.by(() => {
		if (options.length <= PRESET_COUNT) return [...options];
		const picked = Array.from(
			{ length: PRESET_COUNT },
			(_, i) => options[Math.round((i * (options.length - 1)) / (PRESET_COUNT - 1))],
		);
		return [...new Set(picked)];
	});

	/** Plinko's compact figure: no sign, trailing zeros dropped, k and m past a thousand. */
	const compact = (amount: number) => {
		const trim = (n: number, decimals: number) => Number(n.toFixed(decimals)).toString();
		const abs = Math.abs(amount);
		if (abs >= 1_000_000) return `${trim(amount / 1_000_000, 2)}m`;
		if (abs >= 1_000) return `${trim(amount / 1_000, 2)}k`;
		return trim(amount, 2);
	};

	/** The bet one press away, or null when the press would walk off the grid (which disables it). */
	const stepped = (delta: -1 | 1): number | null => {
		const next = current + delta;
		return current < 0 || next < 0 || next >= options.length ? null : options[next];
	};

	const step = (delta: -1 | 1) => {
		if (locked) return;
		const next = stepped(delta);
		if (next === null) return;
		playSound('click');
		onChange(next);
	};

	const togglePresets = () => {
		if (locked) return;
		presetsOpen = !presetsOpen;
	};

	const pick = (preset: number) => {
		if (locked) return;
		presetsOpen = false;
		playSound('click');
		onChange(preset);
	};

	$effect(() => {
		if (locked) presetsOpen = false;
	});

	/** A press anywhere off the control puts the popup away. */
	const onWindowPointerDown = (event: PointerEvent) => {
		if (presetsOpen && !host.contains(event.target as Node)) presetsOpen = false;
	};
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div class="bet" class:locked bind:this={host}>
	<img class="frame" src={staticUrl('img/buy-bonus/buy_bonus_bet_container.webp')} alt="" aria-hidden="true" />
	<button
		type="button"
		class="step step--down"
		aria-label="Decrease bet"
		disabled={locked || stepped(-1) === null}
		onclick={() => step(-1)}
	>
		<img src={staticUrl('img/buy-bonus/buy_bonus_bet_button_decrease.webp')} alt="" aria-hidden="true" />
	</button>
	<div
		class="readout"
		role="button"
		tabindex={locked ? -1 : 0}
		aria-disabled={locked}
		aria-expanded={presetsOpen}
		aria-label="Open bet presets"
		onmousedown={(event) => event.preventDefault()}
		onclick={togglePresets}
		onkeydown={(event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				togglePresets();
			}
		}}
	>
		<span class="label">Bet</span>
		<span class="value" aria-live="polite">{compact(value)}</span>
	</div>
	<button
		type="button"
		class="step step--up"
		aria-label="Increase bet"
		disabled={locked || stepped(1) === null}
		onclick={() => step(1)}
	>
		<img src={staticUrl('img/buy-bonus/buy_bonus_bet_button_increase.webp')} alt="" aria-hidden="true" />
	</button>
	{#if presetsOpen}
		<div class="presets">
			{#each presets as preset (preset)}
				<button
					type="button"
					class="preset"
					class:active={preset === value}
					disabled={locked}
					onclick={() => pick(preset)}
				>
					{compact(preset)}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.bet {
		/* One pixel of the 661×308 container art. The plate is laid out at the art's own ratio, so this
		   is true both ways and the stretched frame never distorts. */
		--art-px: calc(var(--bb-bet-h) / 308);
		/* One pixel of Plinko's plate at the 1024×576 reference, where it is 80 tall. */
		--k: calc(var(--bb-bet-h) / 80);
		position: relative;
		width: calc(var(--art-px) * 661);
		height: var(--bb-bet-h);
	}
	.frame {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: fill;
		pointer-events: none;
		user-select: none;
		-webkit-user-drag: none;
	}

	/* The wooden − / +, 98 art px square, 96 in from each edge of the canvas and centred down it —
	   Plinko's placement, measured off this same file: 40 px of clear cavity between the frame band
	   and each button. */
	.step {
		position: absolute;
		top: 50%;
		z-index: 2;
		width: calc(var(--art-px) * 98);
		height: calc(var(--art-px) * 98);
		padding: 0;
		border: 0;
		background: transparent;
		cursor: pointer;
		transform: translateY(-50%);
		transition:
			transform 0.12s ease,
			opacity 0.12s ease;
	}
	.step img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		pointer-events: none;
		user-select: none;
		-webkit-user-drag: none;
	}
	.step--down {
		left: calc(var(--art-px) * 96);
	}
	.step--up {
		right: calc(var(--art-px) * 96);
	}
	.step:hover:not(:disabled) {
		transform: translateY(-50%) scale(1.12);
	}
	.step:active:not(:disabled) {
		transform: translateY(-50%) scale(0.94);
	}
	.step:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	/* BET over the value, in the 261 art px between the two buttons' gutters: the label stands on the
	   plate's centre line and the value hangs from it, as Plinko's two grid rows put them. The whole
	   pair is the presets trigger. */
	.readout {
		position: absolute;
		inset: 0 calc(var(--art-px) * 200);
		z-index: 1;
		display: grid;
		grid-template-rows: 1fr 1fr;
		justify-items: center;
		cursor: pointer;
		outline: none;
		user-select: none;
		-webkit-tap-highlight-color: transparent;
	}
	.locked .readout {
		cursor: not-allowed;
	}
	.label {
		align-self: end;
		margin-bottom: 0.11em;
		font-family: 'Noto Sans', sans-serif;
		font-size: calc(12.3 * var(--k));
		font-weight: 600;
		line-height: 1;
		letter-spacing: -0.02em;
		text-transform: uppercase;
		white-space: nowrap;
		color: #a9a1a1;
	}
	.value {
		align-self: start;
		font-family: 'Noto Sans', sans-serif;
		font-size: calc(15.85 * var(--k));
		font-weight: 400;
		line-height: 1;
		letter-spacing: -0.02em;
		white-space: nowrap;
		color: #f2f4f6;
	}

	/* The presets popup, hung under the plate and centred on it: Plinko's panel at the size its Buy
	   Bonus screen scales it to, four quick-jumps a row, in two inset frames. */
	.presets {
		position: absolute;
		top: calc(100% + 9.2 * var(--k));
		left: 50%;
		z-index: 6;
		box-sizing: border-box;
		width: calc(337 * var(--k));
		height: calc(99.5 * var(--k));
		padding: calc(13.4 * var(--k)) calc(12.8 * var(--k));
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		align-content: center;
		gap: calc(6.4 * var(--k));
		overflow: hidden;
		border-radius: calc(3.8 * var(--k));
		background: #382417;
		transform: translateX(-50%);
	}
	.presets::before {
		content: '';
		position: absolute;
		inset: calc(4 * var(--k));
		box-sizing: border-box;
		border: calc(2 * var(--k)) solid #271e17;
		border-radius: calc(1.2 * var(--k));
		background: #2a2420;
		box-shadow: inset calc(-1.2 * var(--k)) calc(1.2 * var(--k)) 0 #39302b;
		pointer-events: none;
	}
	.presets::after {
		content: '';
		position: absolute;
		inset: calc(8 * var(--k));
		border-radius: calc(1.2 * var(--k));
		background: #221a15;
		pointer-events: none;
	}
	.preset {
		position: relative;
		z-index: 1;
		box-sizing: border-box;
		height: calc(32 * var(--k));
		/* Optical centring: the figures sit on the baseline and never use the descender space the line
		   box keeps under it, so a hair of top padding lands them on the button's true middle. */
		padding: 0.1em 0 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border: calc(0.6 * var(--k)) solid #492a16;
		border-radius: calc(3.8 * var(--k));
		background: linear-gradient(180deg, #20150d 0%, #3b2c23 73.53%);
		box-shadow: inset 0 0 0 calc(0.6 * var(--k)) rgba(73, 42, 22, 0.2);
		font-family: 'Noto Sans', sans-serif;
		font-size: calc(20.3 * var(--k));
		font-weight: 500;
		line-height: 1;
		letter-spacing: -0.02em;
		color: #f2f4f6;
		text-shadow: 0 calc(1.5 * var(--k)) calc(3.4 * var(--k)) rgba(0, 0, 0, 0.7);
		cursor: pointer;
		transition:
			transform 0.1s ease,
			border-color 0.12s ease,
			box-shadow 0.12s ease,
			background 0.12s ease;
	}
	.preset:hover:not(:disabled) {
		border-color: #6b3d20;
		background: linear-gradient(180deg, #271a11 0%, #47352a 73.53%);
		box-shadow:
			inset 0 0 0 calc(0.6 * var(--k)) rgba(107, 61, 32, 0.32),
			0 0 calc(7 * var(--k)) rgba(255, 138, 58, 0.14);
	}
	.preset:active:not(:disabled) {
		transform: scale(0.97);
	}
	.preset:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.preset.active {
		border-color: rgba(255, 168, 84, 0.95);
		box-shadow:
			inset 0 0 0 calc(0.7 * var(--k)) rgba(255, 191, 129, 0.38),
			inset 0 calc(3.4 * var(--k)) calc(7.6 * var(--k)) rgba(255, 171, 67, 0.24),
			0 0 calc(7.6 * var(--k)) rgba(255, 155, 73, 0.24);
	}
</style>
