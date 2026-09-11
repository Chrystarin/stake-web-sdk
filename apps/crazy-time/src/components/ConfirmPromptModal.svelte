<script lang="ts">
	/**
	 * The "Start Bonus Buy?" Yes/No board, ported from apps/plinko's ConfirmPromptModal with only the
	 * buy-bonus art. Every number below is a percentage of the PANEL (x/y are element centres), so
	 * the whole prompt scales as one piece; `cqw` makes that work.
	 */
	import {
		answerConfirmPrompt,
		CONFIRM_PROMPT_TITLES,
		confirmPrompt,
	} from '../game/confirmPrompt.svelte';
	import { playSound } from '../game/sound';
	import { staticUrl } from '../lib/staticUrl';

	const LAYOUT = {
		art: {
			panel: 'bonus_buy_container.webp',
			yes: 'bonus_buy_yes_container.webp',
			no: 'bonus_buy_no_container.webp',
		},
		aspect: { panel: 5280 / 3666, button: 1497 / 819 },
		panel: { maxWidthPx: 1600, widthVw: 71, scale: 1, offsetX: 0, offsetY: -10 },
		portrait: { widthVw: 92, offsetY: -6 },
		// The skull arch eats the top of this board and the coin piles the bottom corners, so the
		// headline sits low and the plates are narrow.
		title: { x: 50, y: 44, size: 7.4, scale: 1, shadowX: 0, shadowY: 0.08, shadowBlur: 0.035, questionEm: 1 },
		yes: { x: 35, y: 66.5, width: 24, scale: 1.1 },
		no: { x: 65, y: 66.5, width: 24, scale: 1.1 },
		label: { size: 5.2, offsetX: 0, offsetY: -0.8, stroke: 0.2 },
	};

	const kind = $derived(confirmPrompt.kind);
	const title = $derived(kind ? CONFIRM_PROMPT_TITLES[kind] : '');
	/** The headline split so the "?" can be handed to its own face (see `.cf-title-q`). */
	const titleParts = $derived(
		title
			.split(/(\?)/)
			.filter((part) => part !== '')
			.map((part) => ({ text: part, question: part === '?' })),
	);

	const artUrl = (file: string) => staticUrl(`img/buy-bonus/confirmation_popup/${file}`);

	function answer(confirmed: boolean) {
		playSound('click');
		answerConfirmPrompt(confirmed);
	}

	/**
	 * PRESS-THROUGH GUARD. The buy modal's Activate fires on `pointerdown` and raises this prompt while
	 * the finger is still down, so that same touch's release can land on a choice. A pointer click is
	 * honoured only if its press landed inside the prompt AFTER it opened; `event.detail === 0` is a
	 * keyboard / assistive-tech activation and passes straight through.
	 */
	let pressSeenSinceOpen = false;

	$effect(() => {
		kind;
		pressSeenSinceOpen = false;
	});

	function onChoiceClick(event: MouseEvent, confirmed: boolean) {
		if (event.detail !== 0 && !pressSeenSinceOpen) return;
		answer(confirmed);
	}

	function onKeydown(event: KeyboardEvent) {
		if (confirmPrompt.kind === null) return;
		if (event.key !== 'Escape') return;
		event.preventDefault();
		answer(false);
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#if kind}
	<div
		class="cf-backdrop"
		role="presentation"
		onpointerdown={() => (pressSeenSinceOpen = true)}
		onclick={(event) => onChoiceClick(event, false)}
	>
		<div
			class="cf-panel"
			role="dialog"
			aria-modal="true"
			aria-label={title}
			onclick={(event) => event.stopPropagation()}
			style:--panel-max-w="{LAYOUT.panel.maxWidthPx}px"
			style:--panel-vw="{LAYOUT.panel.widthVw}vw"
			style:--panel-vw-p="{LAYOUT.portrait.widthVw}vw"
			style:--panel-aspect={LAYOUT.aspect.panel}
			style:--panel-scale={LAYOUT.panel.scale}
			style:--panel-dx="{LAYOUT.panel.offsetX}%"
			style:--panel-dy="{LAYOUT.panel.offsetY}%"
			style:--panel-dy-p="{LAYOUT.portrait.offsetY}%"
			style:--btn-aspect={LAYOUT.aspect.button}
			style:--label-size="{LAYOUT.label.size}cqw"
			style:--label-dx="{LAYOUT.label.offsetX}cqw"
			style:--label-dy="{LAYOUT.label.offsetY}cqw"
			style:--label-stroke="{LAYOUT.label.stroke}cqw"
		>
			<img class="cf-frame" src={artUrl(LAYOUT.art.panel)} alt="" aria-hidden="true" />

			<h2
				class="cf-title"
				style:--x="{LAYOUT.title.x}%"
				style:--y="{LAYOUT.title.y}%"
				style:--shadow-x="{LAYOUT.title.shadowX}em"
				style:--shadow-y="{LAYOUT.title.shadowY}em"
				style:--shadow-blur="{LAYOUT.title.shadowBlur}em"
				style:font-size="{LAYOUT.title.size * LAYOUT.title.scale}cqw"
				style:--q-em="{LAYOUT.title.questionEm}em"
			>
				<!-- prettier-ignore -->
				{#each titleParts as part}{#if part.question}<span class="cf-title-q">{part.text}</span>{:else}{part.text}{/if}{/each}
			</h2>

			<button
				type="button"
				class="cf-choice cf-choice--yes"
				style:--x="{LAYOUT.yes.x}%"
				style:--y="{LAYOUT.yes.y}%"
				style:--w="{LAYOUT.yes.width}cqw"
				style:--scale={LAYOUT.yes.scale}
				onclick={(event) => onChoiceClick(event, true)}
			>
				<img class="cf-choice-frame" src={artUrl(LAYOUT.art.yes)} alt="" aria-hidden="true" />
				<span class="cf-choice-text">Yes</span>
			</button>

			<button
				type="button"
				class="cf-choice cf-choice--no"
				style:--x="{LAYOUT.no.x}%"
				style:--y="{LAYOUT.no.y}%"
				style:--w="{LAYOUT.no.width}cqw"
				style:--scale={LAYOUT.no.scale}
				onclick={(event) => onChoiceClick(event, false)}
			>
				<img class="cf-choice-frame" src={artUrl(LAYOUT.art.no)} alt="" aria-hidden="true" />
				<span class="cf-choice-text">No</span>
			</button>
		</div>
	</div>
{/if}

<style>
	.cf-backdrop {
		position: fixed;
		inset: 0;
		/* Above the buy-bonus modal (60), which stays open behind it. */
		z-index: 18500;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.72);
		padding: 0;
	}

	.cf-panel {
		position: relative;
		width: min(var(--panel-max-w), var(--panel-vw));
		aspect-ratio: var(--panel-aspect);
		/* 1cqw = 1% of THIS box's width, so every child is a plain percentage of the panel. */
		container-type: inline-size;
		transform: translate(var(--panel-dx), var(--panel-dy)) scale(var(--panel-scale));
		animation: cf-pop 0.16s ease-out;
	}

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
		object-fit: contain;
		pointer-events: none;
		user-select: none;
	}

	/* `--x` / `--y` are the element's CENTRE within the panel, hence the -50% pre-translate. */
	.cf-title,
	.cf-choice {
		position: absolute;
		left: var(--x);
		top: var(--y);
		transform: translate(-50%, -50%);
	}

	.cf-title {
		margin: 0;
		width: 100%;
		font-family: 'PiecesOfEight', serif;
		font-weight: 400;
		line-height: 1;
		text-align: center;
		text-transform: uppercase;
		letter-spacing: 0.02em;
		word-spacing: -0.14em;
		background-image: linear-gradient(180deg, #f5b936 0%, #ebad26 56.7%, #d18a16 81.67%);
		background-clip: text;
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		color: transparent;
		/* A filter, not text-shadow: under background-clip:text a text-shadow paints IN FRONT of the
		   gradient. drop-shadow composites behind the glyphs. */
		filter: drop-shadow(var(--shadow-x) var(--shadow-y) var(--shadow-blur) #000000)
			drop-shadow(var(--shadow-x) var(--shadow-y) var(--shadow-blur) #000000);
		pointer-events: none;
	}

	/* Only the "?" is Noto Sans: PiecesOfEight's own question mark is a decorative outlier. */
	.cf-title-q {
		font-family: 'Noto Sans', 'Alexandria', sans-serif;
		font-size: var(--q-em);
		font-weight: 600;
		letter-spacing: 0;
		word-spacing: 0;
	}

	.cf-choice {
		width: calc(var(--w) * var(--scale, 1));
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
		font-family: 'Alexandria', sans-serif;
		font-weight: 600;
		font-size: calc(var(--label-size) * var(--scale, 1));
		line-height: 1;
		text-align: center;
		text-transform: uppercase;
		color: #eaeaea;
		text-shadow: 0px 4px 4px rgba(0, 0, 0, 0.25);
		-webkit-text-stroke: calc(var(--label-stroke) * var(--scale, 1)) #000000;
		paint-order: stroke fill;
		translate: calc(var(--label-dx) * var(--scale, 1)) calc(var(--label-dy) * var(--scale, 1));
		white-space: nowrap;
	}

	.cf-choice:hover {
		filter: brightness(1.08);
	}
	.cf-choice:active {
		filter: brightness(0.94);
	}
</style>
