<script lang="ts">
	/**
	 * One chip of the tray, as the tray draws it: `chip_base.svg` tinted to its denomination
	 * (game/chips.ts), its face value on it, the selected chip raised on an orange disc inside a
	 * yellow ring, and a chip the balance does not cover greyed out and unpickable.
	 *
	 * Sized by the host: `--chip-size` is the disc's diameter, and every other length (the label, the
	 * ring, the lift) is a share of it, so the chip reads the same at any size.
	 */
	import { chipHueShift, chipTextColour, fmtChip } from '../game/chips';
	import { staticCssUrl } from '../lib/staticUrl';

	type Props = {
		value: number;
		/** Where the chip stands in the tray, and how many the tray holds: they pick its colour. */
		index: number;
		count: number;
		selected?: boolean;
		disabled?: boolean;
		onclick?: () => void;
	};
	let { value, index, count, selected = false, disabled = false, onclick }: Props = $props();
</script>

<button
	type="button"
	class="chip"
	class:selected
	{disabled}
	aria-pressed={selected}
	aria-label={`Chip ${fmtChip(value)}`}
	style="--chip-hue:{chipHueShift(index, count)}deg; --chip-text:{chipTextColour(index, count)}; --art-chip:{staticCssUrl('img/chip_base.svg')}"
	{onclick}
>
	<span>{fmtChip(value)}</span>
</button>

<style>
	.chip {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		flex: none;
		width: var(--chip-size);
		height: var(--chip-size);
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: transparent;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
		transition:
			scale 0.18s ease,
			translate 0.18s ease;
	}
	.chip::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 0;
		background: var(--art-chip) no-repeat center / contain;
		filter: hue-rotate(var(--chip-hue, 0deg));
	}
	.chip span {
		position: relative;
		z-index: 1;
		font-family: 'DDIN', sans-serif;
		font-size: calc(var(--chip-size) * 0.36);
		font-weight: 700;
		line-height: 1;
		letter-spacing: -0.5px;
		color: var(--chip-text, #1d5c28);
		pointer-events: none;
		user-select: none;
	}
	.chip:hover:not(:disabled):not(.selected) {
		translate: 0 calc(var(--chip-size) * -0.05);
	}
	.chip.selected {
		scale: 1.1;
		translate: 0 calc(var(--chip-size) * -0.1);
		background-color: #f3aa40;
		box-shadow: 0 0 calc(var(--chip-size) * 0.035) calc(var(--chip-size) * 0.05) #f3aa40;
		outline: calc(var(--chip-size) * 0.09) solid #ffe14d;
		cursor: default;
	}
	.chip:focus-visible {
		outline: calc(var(--chip-size) * 0.09) solid #ffffff;
	}
	.chip:disabled {
		cursor: not-allowed;
	}
	.chip:disabled::before {
		filter: hue-rotate(var(--chip-hue, 0deg)) grayscale(1) brightness(0.6);
		opacity: 0.5;
	}
	.chip:disabled span {
		color: #c8c8c8;
		opacity: 0.75;
	}
</style>
