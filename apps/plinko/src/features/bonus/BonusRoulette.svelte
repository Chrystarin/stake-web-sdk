<script lang="ts">
	import { onMount } from 'svelte';

	import { bonusRouletteSegmentsForTier } from '../../game-logic/constants';
	import { stateGame } from '../../game/stateGame.svelte';
	import { isMobile } from '../../lib/format';
	import { staticUrl } from '../../lib/staticUrl';

	export type BonusRouletteResult = {
		segmentIndex: number;
		segmentLabel: string;
		freeBallCount: number;
	};

	type Props = {
		mode?: 'roulette' | 'message';
		messageTitle?: string;
		messageValue?: string;
		messageHint?: string;
		targetFreeBalls?: number;
		/** When true, wheel outcome must come from `targetFreeBalls` (RGS/math book). */
		serverAuthoritative?: boolean;
		/** Replay mode: auto-press the "press anywhere" announcement (no player to click). */
		autoDismiss?: boolean;
		onFinished?: (result: BonusRouletteResult) => void;
		onResultReady?: (result: BonusRouletteResult) => void;
		onClosed?: () => void;
	};

	const props: Props = $props();

	/** Shared wheel diameter from viewport; label/base/marker derive from this. */
	const ROULETTE_SIZE_VW = 0.72;
	const LABEL_HEIGHT_TO_WIDTH = 594 / 1280;
	/** Bonus medallion sits inside the wheel's center hole (~0.53 of the wheel). */
	const BASE_TO_WHEEL = 0.53;
	const MARKER_WIDTH_TO_WHEEL = (151 / 1348) * 0.65;
	const MARKER_HEIGHT_TO_WHEEL = (435 / 1348) * 0.65;

	let slidePhase = $state<'enter' | 'idle' | 'exit'>('enter');
	let bgJoined = $state(false);
	let labelVisible = $state(false);
	let wheelVisible = $state(false);
	let markerVisible = $state(false);
	let wheelSpinClass = $state(false);
	let wheelRotationDeg = $state(0);
	let announcementVisible = $state(false);
	let announcementBgVisible = $state(false);
	let announcementTextVisible = $state(false);
	let wonFreeBalls = $state(0);
	let wheelEl = $state<HTMLImageElement | undefined>(undefined);
	let stageEl = $state<HTMLDivElement | undefined>(undefined);
	let rouletteSizePx = $state(0);
	let pendingResult: BonusRouletteResult | null = null;
	let resultReadyEmitted = false;
	const timers: ReturnType<typeof setTimeout>[] = [];
	const mobile = isMobile();

	function updateRouletteLayout() {
		const stage = stageEl;
		if (!stage) return;
		const rect = stage.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return;
		const labelGapPx = Math.min(Math.max(window.innerWidth * 0.015, 4), 16);
		const vwCap = window.innerWidth * ROULETTE_SIZE_VW;
		const maxWidth = Math.min(vwCap, rect.width);
		const fromHeight = Math.max(0, rect.height - labelGapPx) / (1 + LABEL_HEIGHT_TO_WIDTH);
		rouletteSizePx = Math.max(0, Math.floor(Math.min(maxWidth, fromHeight)));
	}

	const labelWidthPx = $derived(rouletteSizePx > 0 ? `${rouletteSizePx}px` : undefined);
	const stackSizePx = $derived(rouletteSizePx > 0 ? `${rouletteSizePx}px` : undefined);
	const baseWidthPx = $derived(
		rouletteSizePx > 0 ? `${Math.round(rouletteSizePx * BASE_TO_WHEEL)}px` : undefined,
	);
	const markerWidthPx = $derived(
		rouletteSizePx > 0 ? `${Math.round(rouletteSizePx * MARKER_WIDTH_TO_WHEEL)}px` : undefined,
	);
	const markerHeightPx = $derived(
		rouletteSizePx > 0 ? `${Math.round(rouletteSizePx * MARKER_HEIGHT_TO_WHEEL)}px` : undefined,
	);
	const markerYOffsetPx = $derived(
		rouletteSizePx > 0 ? `-${Math.round(rouletteSizePx * 0.5)}px` : undefined,
	);
	// Data-driven labels on the label-less `bonus-roulette-wheel-empty.png`: segment `i` sits at `i*45°`
	// from the top marker (same angle the spin lands on), so the value under the marker matches the
	// book result. Per-tier values (resize with balls-per-drop). Radius/font tunables mirror the
	// free-spin wheel.
	const labelRadiusPx = $derived(
		rouletteSizePx > 0 ? `${Math.round(rouletteSizePx * 0.315)}px` : '0px',
	);
	const labelFontPx = $derived(
		rouletteSizePx > 0 ? `${Math.round(rouletteSizePx * 0.072)}px` : '0px',
	);

	const headlineText = $derived(
		props.mode === 'message' ? (props.messageTitle ?? 'CONGRATULATIONS!') : 'CONGRATULATIONS!',
	);
	const rewardText = $derived(
		props.mode === 'message' ? (props.messageValue ?? '') : `YOU WON ${wonFreeBalls} DROPS`,
	);

	// Per-tier wheel values (avg ≈ balls-per-drop). `stateGame.ballPerDrop` is the real selected tier
	// (the HUD shows 1 during the bonus, but the tier is unchanged), so the wheel resizes per tier.
	const segments = $derived(
		bonusRouletteSegmentsForTier(stateGame.ballPerDrop).map((freeBalls, i) => ({
			label: String(freeBalls),
			freeBalls,
			index: i,
		})),
	);
	// N equal slices (the labeled bonus wheel has 8 → 45° each); the per-segment angle and landing target
	// derive from the segment count so they always match the wheel image.
	const segAngle = $derived(segments.length > 0 ? 360 / segments.length : 45);

	onMount(() => {
		if (props.mode === 'message') {
			requestAnimationFrame(() => (slidePhase = 'idle'));
			startAnnouncementSequence();
			return cleanup;
		}
		requestAnimationFrame(() => {
			slidePhase = 'idle';
			bgJoined = true;
		});
		const assembleTimer = setTimeout(() => {
			labelVisible = true;
			wheelVisible = true;
			markerVisible = true;
			const spinTimer = setTimeout(() => startSpin(), 760);
			timers.push(spinTimer);
		}, 620);
		timers.push(assembleTimer);
		return cleanup;
	});

	function cleanup() {
		timers.forEach(clearTimeout);
	}

	$effect(() => {
		const stage = stageEl;
		if (!stage) return;
		const observer = new ResizeObserver(() => updateRouletteLayout());
		observer.observe(stage);
		const onResize = () => updateRouletteLayout();
		window.addEventListener('resize', onResize);
		updateRouletteLayout();
		return () => {
			observer.disconnect();
			window.removeEventListener('resize', onResize);
		};
	});

	function resolveWinnerIndex(): number {
		if (props.targetFreeBalls != null) {
			const match = segments.findIndex((s) => s.freeBalls === props.targetFreeBalls);
			if (match >= 0) return match;
		}
		if (props.serverAuthoritative) return 0;
		return Math.floor(Math.random() * segments.length);
	}

	function startSpin() {
		const winner = resolveWinnerIndex();
		const extraRounds = 5 + Math.floor(Math.random() * 3);
		const targetDeg = wheelRotationDeg + extraRounds * 360 - winner * segAngle;
		let settled = false;
		const settle = () => {
			if (settled) return;
			settled = true;
			afterSpin(winner);
		};
		requestAnimationFrame(() => {
			wheelSpinClass = true;
			wheelRotationDeg = targetDeg;
		});
		const el = wheelEl;
		if (el) {
			const onEnd = (e: TransitionEvent) => {
				if (e.propertyName !== 'transform') return;
				el.removeEventListener('transitionend', onEnd);
				settle();
			};
			el.addEventListener('transitionend', onEnd);
			timers.push(setTimeout(settle, 5200));
		} else {
			timers.push(setTimeout(settle, 4200));
		}
	}

	function afterSpin(winner: number) {
		wheelSpinClass = false;
		const landed = segments[winner];
		const freeBallCount =
			props.serverAuthoritative && props.targetFreeBalls != null
				? props.targetFreeBalls
				: landed.freeBalls;
		timers.push(
			setTimeout(() => {
				labelVisible = false;
				wheelVisible = false;
				markerVisible = false;
				pendingResult = {
					segmentIndex: winner,
					segmentLabel: String(freeBallCount),
					freeBallCount,
				};
				wonFreeBalls = freeBallCount;
				startAnnouncementSequence();
			}, 850),
		);
	}

	/** Replay has no player to dismiss the "press anywhere" screen — show it briefly, then advance. */
	const AUTO_DISMISS_DELAY_MS = 1800;

	function startAnnouncementSequence() {
		announcementVisible = true;
		if (pendingResult && !resultReadyEmitted) {
			resultReadyEmitted = true;
			props.onResultReady?.(pendingResult);
		}
		requestAnimationFrame(() => (announcementBgVisible = true));
		timers.push(setTimeout(() => (announcementTextVisible = true), 620));
		if (props.autoDismiss) {
			timers.push(setTimeout(() => onAnnouncementClick(), AUTO_DISMISS_DELAY_MS));
		}
	}

	function onAnnouncementClick() {
		if (!announcementVisible) return;
		announcementTextVisible = false;
		slidePhase = 'exit';
		timers.push(
			setTimeout(() => {
				props.onClosed?.();
				if (props.mode === 'message') return;
				const result = pendingResult;
				pendingResult = null;
				if (result) props.onFinished?.(result);
			}, 520 + 320),
		);
	}
</script>

<div
	class="bonus-spin-overlay"
	class:bonus-spin-overlay--idle={slidePhase === 'idle'}
	class:bonus-spin-overlay--exit={slidePhase === 'exit'}
	role="dialog"
	aria-modal="true"
	aria-label="Bonus roulette wheel"
>
	{#if props.mode !== 'message'}
		<div
			class="bonus-spin-bg-drop"
			class:bonus-spin-bg-drop--visible={bgJoined}
			style:background-image="url({mobile ? staticUrl('img/bonus-roulette-background-mobile.png') : staticUrl('img/bonus-roulette-background.png')})"
		></div>
		<div class="bonus-spin-content">
			<div class="bonus-spin-stage" bind:this={stageEl}>
				<img
					class="bonus-spin-title"
					class:bonus-spin-title--visible={labelVisible}
					style:width={labelWidthPx}
					src={staticUrl('img/bonus-roulette-label.png')}
					alt="Free balls"
				/>
				<div class="bonus-spin-wheel-stack" style:width={stackSizePx} style:height={stackSizePx}>
					<img
						class="bonus-spin-marker"
						class:bonus-spin-marker--visible={markerVisible}
						style:width={markerWidthPx}
						style:height={markerHeightPx}
						style:--marker-y-offset={markerYOffsetPx}
						src={staticUrl('img/free-spin-marker.png')}
						alt=""
					/>
					<img
						bind:this={wheelEl}
						class="bonus-spin-wheel"
						class:bonus-spin-wheel--animating={wheelSpinClass}
						class:bonus-spin-wheel--visible={wheelVisible}
						style:--wheel-rotation-deg="{wheelRotationDeg}deg"
						src={staticUrl('img/bonus-roulette-wheel.png')}
						alt="Bonus roulette wheel"
					/>
					<img
						class="bonus-spin-center-base"
						class:bonus-spin-center-base--visible={wheelVisible}
						style:width={baseWidthPx}
						src={staticUrl('img/bonus-roulette-center-base.png')}
						alt=""
					/>
				</div>
			</div>
		</div>
	{/if}

	{#if announcementVisible}
		<button
			type="button"
			class="bonus-announcement"
			class:bonus-announcement--win={props.mode === 'message'}
			class:bonus-announcement--mobile={mobile}
			class:bonus-announcement--bg-visible={announcementBgVisible}
			class:bonus-announcement--text-visible={announcementTextVisible}
			style:background-image="url({mobile ? staticUrl('img/announcement-message-background-mobile.png') : staticUrl('img/announcement-message-background.png')})"
			onclick={onAnnouncementClick}
		>
			<div class="bonus-announcement-main">
				<div class="bonus-announcement-headline">
					<span class="bonus-announcement-text-stroke" aria-hidden="true">{headlineText}</span>
					<span class="bonus-announcement-text-fill bonus-announcement-text-fill--headline">{headlineText}</span>
				</div>
				<div class="bonus-announcement-reward">
					<span class="bonus-announcement-text-stroke" aria-hidden="true">{rewardText}</span>
					<span class="bonus-announcement-text-fill bonus-announcement-text-fill--reward">{rewardText}</span>
				</div>
			</div>
			<div class="bonus-announcement-hint">
				{props.messageHint ?? 'PRESS ANYWHERE TO GO BACK TO THE GAME'}
			</div>
		</button>
	{/if}
</div>

<style>
	.bonus-spin-overlay {
		position: absolute;
		inset: 0;
		z-index: 12000;
		display: flex;
		overflow: hidden;
		transform: translateX(0);
		transition:
			transform 0.52s cubic-bezier(0.33, 1, 0.68, 1),
			opacity 0.3s ease;
		pointer-events: auto;
	}
	.bonus-spin-overlay--exit {
		transform: translateY(-100%);
		opacity: 0;
	}
	.bonus-spin-bg-drop {
		position: absolute;
		inset: 0;
		background-size: 100% 100%;
		transform: translateY(-100%);
		transition: transform 0.62s cubic-bezier(0.22, 1, 0.36, 1);
	}
	.bonus-spin-bg-drop--visible {
		transform: translateY(0);
	}
	.bonus-spin-content {
		position: relative;
		z-index: 1;
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-start;
		height: 100%;
		min-height: 0;
		box-sizing: border-box;
		overflow: hidden;
		padding: clamp(0.5rem, 3vh, 2rem) clamp(0.75rem, 4vw, 2rem) clamp(1rem, 5vh, 3rem);
	}
	.bonus-spin-stage {
		flex: 1;
		min-height: 0;
		width: 100%;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		justify-items: center;
	}
	.bonus-spin-title {
		width: min(72vw, 100%);
		max-width: 100%;
		height: auto;
		flex-shrink: 0;
		object-fit: contain;
		margin-bottom: clamp(0.25rem, 1.5vw, 1rem);
		opacity: 0;
		transform: translateY(-140%);
		transition:
			transform 0.5s cubic-bezier(0.22, 1, 0.36, 1),
			opacity 0.32s ease;
	}
	.bonus-spin-title--visible {
		opacity: 1;
		transform: translateY(0);
	}
	.bonus-spin-wheel-stack {
		position: relative;
		width: min(72vw, 100%);
		height: min(72vw, 100%);
		max-width: 100%;
		max-height: 100%;
		flex-shrink: 0;
		place-self: center;
	}
	.bonus-spin-marker {
		position: absolute;
		left: 50%;
		top: 50%;
		object-fit: contain;
		transform: translate(-50%, -50%) translateY(-150vh);
		transform-origin: 50% 50%;
		opacity: 0;
		pointer-events: none;
		transition:
			transform 0.68s cubic-bezier(0.22, 1, 0.36, 1),
			opacity 0.34s ease;
		z-index: 2;
	}
	.bonus-spin-marker--visible {
		transform: translate(-50%, -50%) translateY(var(--marker-y-offset, 0px));
		opacity: 1;
	}
	.bonus-spin-wheel {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
		transform-origin: 50% 50%;
		--wheel-rotation-deg: 0deg;
		transform: translateY(125vh) rotate(var(--wheel-rotation-deg));
		opacity: 0;
	}
	.bonus-spin-wheel--visible {
		transform: translateY(0) rotate(var(--wheel-rotation-deg));
		opacity: 1;
		transition:
			transform 0.68s cubic-bezier(0.22, 1, 0.36, 1),
			opacity 0.34s ease;
	}
	.bonus-spin-wheel--animating {
		transition: transform 4.1s cubic-bezier(0.12, 0.72, 0.12, 1);
	}
	/* Per-tier free-ball labels overlay — rotates in lock-step with the (label-less) wheel image so each
	   value stays glued to its wedge; the value under the marker is always the book result. */
	.bonus-spin-wheel-labels {
		position: absolute;
		inset: 0;
		z-index: 2;
		pointer-events: none;
		transform-origin: 50% 50%;
		--wheel-rotation-deg: 0deg;
		transform: translateY(125vh) rotate(var(--wheel-rotation-deg));
		opacity: 0;
	}
	.bonus-spin-wheel-labels--visible {
		transform: translateY(0) rotate(var(--wheel-rotation-deg));
		opacity: 1;
		transition:
			transform 0.68s cubic-bezier(0.22, 1, 0.36, 1),
			opacity 0.34s ease;
	}
	.bonus-spin-wheel-labels--animating {
		transition: transform 4.1s cubic-bezier(0.12, 0.72, 0.12, 1);
	}
	.bonus-spin-wheel-label {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%) rotate(var(--seg-angle, 0deg))
			translateY(calc(-1 * var(--label-radius, 0px)));
		transform-origin: 50% 50%;
		font-family: 'PotatoSans', sans-serif;
		font-weight: 800;
		font-size: var(--label-font-size, 16px);
		line-height: 1;
		color: #fff;
		white-space: nowrap;
		-webkit-text-stroke: 0.06em #3a1d05;
		paint-order: stroke fill;
		text-shadow: 0 0.04em 0.06em rgba(0, 0, 0, 0.55);
		user-select: none;
	}
	.bonus-spin-center-base {
		position: absolute;
		left: 50%;
		top: 50%;
		height: auto;
		object-fit: contain;
		transform: translate(-50%, -50%) translateY(125vh);
		opacity: 0;
		z-index: 3;
		transition:
			transform 0.68s cubic-bezier(0.22, 1, 0.36, 1),
			opacity 0.34s ease;
	}
	.bonus-spin-center-base--visible {
		transform: translate(-50%, -50%) translateY(0);
		opacity: 1;
	}
	.bonus-announcement {
		position: absolute;
		inset: 0;
		z-index: 20;
		border: 0;
		width: 100%;
		height: 100%;
		background-color: transparent;
		background-size: 100% 100%;
		transform: translateY(-100%);
		transition: transform 0.62s cubic-bezier(0.22, 1, 0.36, 1);
		cursor: pointer;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		color: #f4d36d;
	}
	.bonus-announcement-main {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: clamp(10px, 2vh, 18px);
	}
	.bonus-announcement-hint {
		position: absolute;
		left: 0;
		right: 0;
		bottom: clamp(16px, 5vh, 56px);
		margin-top: 0;
		padding: 0 clamp(1rem, 4vw, 2rem);
		box-sizing: border-box;
		font-family: 'Perpetua', serif;
		font-size: clamp(16px, 1.6vw, 26px);
		line-height: 1.1;
		letter-spacing: 0.03em;
		color: #f0ddaa;
		text-shadow: 0 2px 7px rgba(0, 0, 0, 0.7);
	}
	.bonus-announcement--bg-visible {
		transform: translateY(0);
	}
	.bonus-announcement-headline,
	.bonus-announcement-reward,
	.bonus-announcement-hint {
		opacity: 0;
		transition: opacity 0.32s ease;
		text-align: center;
	}
	.bonus-announcement--text-visible .bonus-announcement-headline,
	.bonus-announcement--text-visible .bonus-announcement-reward,
	.bonus-announcement--text-visible .bonus-announcement-hint {
		opacity: 1;
	}
	.bonus-announcement-headline,
	.bonus-announcement-reward {
		display: inline-grid;
		width: max-content;
		max-width: 100%;
	}
	.bonus-announcement-headline > *,
	.bonus-announcement-reward > * {
		grid-area: 1 / 1;
		font-family: inherit;
		font-size: inherit;
		font-weight: inherit;
		line-height: inherit;
		letter-spacing: inherit;
		white-space: inherit;
	}
	.bonus-announcement-text-stroke {
		color: transparent;
		-webkit-text-stroke: var(--announcement-stroke-width) var(--announcement-stroke-color);
		paint-order: stroke fill;
		pointer-events: none;
		user-select: none;
	}
	.bonus-announcement-text-fill {
		background-clip: text;
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		color: transparent;
		text-shadow: var(--announcement-glow-shadow), var(--announcement-highlight-shadow);
	}
	.bonus-announcement-headline {
		--announcement-stroke-width: 0.04em;
		--announcement-stroke-color: #4a2f0a;
		--announcement-glow-shadow:
			0 0 0.48em rgba(255, 200, 70, 0.52), 0 0.05em 0.08em rgba(0, 0, 0, 0.28);
		--announcement-highlight-shadow: 0 -0.02em 0.03em rgba(255, 208, 75, 0.36);
		font-family: 'PiecesOfEight', serif;
		font-size: clamp(48px, 8.2vw, 116px);
		line-height: 0.95;
		letter-spacing: 0.02em;
	}
	.bonus-announcement-text-fill--headline {
		background-image: linear-gradient(180deg, #fad04a 0%, #f0b82e 56.7%, #de951a 100%);
	}
	.bonus-announcement-reward {
		--announcement-stroke-width: 0.05em;
		--announcement-stroke-color: #5c4010;
		--announcement-glow-shadow:
			0 0 0.4em rgba(255, 228, 120, 0.48), 0 0.04em 0.08em rgba(0, 0, 0, 0.25);
		--announcement-highlight-shadow: 0 -0.02em 0.03em rgba(245, 200, 95, 0.32);
		font-family: 'PotatoSans', sans-serif;
		font-size: clamp(30px, 5.2vw, 76px);
		line-height: 1;
		letter-spacing: 0.01em;
	}
	.bonus-announcement-text-fill--reward {
		background-image: linear-gradient(180deg, #f9e4bc 0%, #e0c48a 56.7%, #d49420 100%);
	}
	.bonus-announcement--win .bonus-announcement-headline {
		font-size: clamp(44px, 7.2vw, 100px);
	}
	.bonus-announcement--win .bonus-announcement-reward {
		font-size: clamp(42px, 7vw, 96px);
	}
	.bonus-announcement--mobile .bonus-announcement-headline,
	.bonus-announcement--mobile .bonus-announcement-reward,
	.bonus-announcement--mobile .bonus-announcement-hint {
		max-width: calc(100vw - 10vw);
		margin-left: auto;
		margin-right: auto;
		box-sizing: border-box;
		white-space: nowrap;
	}
	.bonus-announcement--mobile .bonus-announcement-headline {
		font-size: 10vw;
		line-height: 0.95;
	}
	.bonus-announcement--mobile .bonus-announcement-reward {
		font-size: 7vw;
		line-height: 1.05;
	}
	.bonus-announcement--mobile .bonus-announcement-hint {
		bottom: clamp(12px, 3.5vh, 32px);
		font-size: 3.5vw;
		line-height: 1.2;
	}
</style>
