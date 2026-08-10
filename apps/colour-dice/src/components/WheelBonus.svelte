<script lang="ts">
	import { waitForTimeout } from 'utils-shared/wait';

	import { getContext } from '../game/context';
	import { WHEEL_VALUES } from '../game/constants';

	const context = getContext();

	const SEG = 360 / WHEEL_VALUES.length;
	const SEG_COLOURS = ['#e5484d', '#f5a524', '#30a46c', '#0091ff', '#8e4ec6', '#ffc53d'];

	let visible = $state(false);
	let rotation = $state(0);
	let spinning = $state(false);
	let landed = $state<number | null>(null);

	const conic = WHEEL_VALUES.map(
		(_, i) => `${SEG_COLOURS[i % SEG_COLOURS.length]} ${i * SEG}deg ${(i + 1) * SEG}deg`,
	).join(', ');

	const spinTo = (multiplier: number) =>
		new Promise<void>((resolve) => {
			const index = Math.max(0, WHEEL_VALUES.indexOf(multiplier as (typeof WHEEL_VALUES)[number]));
			// Land the target segment's centre under the top pointer, after 5 full turns.
			const target = 360 * 5 - (index * SEG + SEG / 2);
			spinning = true;
			rotation = target;
			window.setTimeout(() => {
				landed = multiplier;
				spinning = false;
				resolve();
			}, 2700);
		});

	context.eventEmitter.subscribeOnMount({
		wheelShow: async () => {
			landed = null;
			rotation = 0;
			visible = true;
			await waitForTimeout(500);
		},
		wheelSpin: async (emitterEvent) => {
			await spinTo(emitterEvent.multiplier);
			await waitForTimeout(1200);
		},
		wheelHide: async () => {
			visible = false;
		},
	});
</script>

{#if visible}
	<div class="wheel-overlay">
		<div class="wheel-title">LUCKY WHEEL</div>
		<div class="wheel-wrap">
			<div class="pointer"></div>
			<div
				class="wheel"
				class:spinning
				style="transform: rotate({rotation}deg); background: conic-gradient({conic});"
			>
				{#each WHEEL_VALUES as value, i (value)}
					<div class="seg-label" style="transform: rotate({i * SEG + SEG / 2}deg) translateY(-120px) rotate({-(i * SEG + SEG / 2)}deg);">
						{value}x
					</div>
				{/each}
			</div>
			<div class="hub">{landed !== null ? `${landed}x` : ''}</div>
		</div>
	</div>
{/if}

<style>
	.wheel-overlay {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 3vh;
		background: rgba(0, 0, 0, 0.72);
	}
	.wheel-title {
		font-family: 'Alexandria', sans-serif;
		font-weight: 700;
		font-size: 4vh;
		color: #ffe14d;
		letter-spacing: 0.1em;
		text-shadow: 0 2px 6px rgba(0, 0, 0, 0.6);
	}
	.wheel-wrap {
		position: relative;
		width: 300px;
		height: 300px;
	}
	.wheel {
		position: absolute;
		inset: 0;
		border-radius: 50%;
		border: 8px solid #fff;
		box-shadow: 0 0 0 6px #1a1a1a, 0 10px 40px rgba(0, 0, 0, 0.6);
	}
	.wheel.spinning {
		transition: transform 2.7s cubic-bezier(0.15, 0.85, 0.2, 1);
	}
	.seg-label {
		position: absolute;
		top: 50%;
		left: 50%;
		margin: -14px 0 0 -22px;
		width: 44px;
		text-align: center;
		font-family: 'Alexandria', sans-serif;
		font-weight: 700;
		font-size: 20px;
		color: #fff;
		text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
	}
	.pointer {
		position: absolute;
		top: -18px;
		left: 50%;
		transform: translateX(-50%);
		width: 0;
		height: 0;
		border-left: 16px solid transparent;
		border-right: 16px solid transparent;
		border-top: 30px solid #ffe14d;
		z-index: 3;
		filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.5));
	}
	.hub {
		position: absolute;
		top: 50%;
		left: 50%;
		width: 90px;
		height: 90px;
		margin: -45px 0 0 -45px;
		border-radius: 50%;
		background: #1a1a1a;
		border: 5px solid #ffe14d;
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: 'Alexandria', sans-serif;
		font-weight: 800;
		font-size: 26px;
		color: #ffe14d;
		z-index: 2;
	}
</style>
