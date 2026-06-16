<script lang="ts">
	import { onMount } from 'svelte';

	import { BONUS_ROULETTE_SEGMENTS } from '../../game-logic/constants';
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
		onFinished?: (result: BonusRouletteResult) => void;
		onResultReady?: (result: BonusRouletteResult) => void;
		onClosed?: () => void;
	};

	const props: Props = $props();

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
	let pendingResult: BonusRouletteResult | null = null;
	let resultReadyEmitted = false;
	const timers: ReturnType<typeof setTimeout>[] = [];
	const mobile = isMobile();

	const headlineText = $derived(
		props.mode === 'message' ? (props.messageTitle ?? 'CONGRATULATIONS!') : 'CONGRATULATIONS!',
	);
	const rewardText = $derived(
		props.mode === 'message' ? (props.messageValue ?? '') : `YOU WON ${wonFreeBalls} DROPS`,
	);

	const segments = BONUS_ROULETTE_SEGMENTS.map((freeBalls, i) => ({
		label: String(freeBalls),
		freeBalls,
		index: i,
	}));

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

	function resolveWinnerIndex(): number {
		if (props.targetFreeBalls != null) {
			const match = BONUS_ROULETTE_SEGMENTS.indexOf(
				props.targetFreeBalls as (typeof BONUS_ROULETTE_SEGMENTS)[number],
			);
			if (match >= 0) return match;
		}
		if (props.serverAuthoritative) return 0;
		return Math.floor(Math.random() * segments.length);
	}

	function startSpin() {
		const winner = resolveWinnerIndex();
		const extraRounds = 5 + Math.floor(Math.random() * 3);
		const targetDeg = wheelRotationDeg + extraRounds * 360 - winner * 45;
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

	function startAnnouncementSequence() {
		announcementVisible = true;
		if (pendingResult && !resultReadyEmitted) {
			resultReadyEmitted = true;
			props.onResultReady?.(pendingResult);
		}
		requestAnimationFrame(() => (announcementBgVisible = true));
		timers.push(setTimeout(() => (announcementTextVisible = true), 620));
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
			<img
				class="bonus-spin-title"
				class:bonus-spin-title--visible={labelVisible}
				src={staticUrl('img/bonus-roulette-label.png')}
				alt="Free balls"
			/>
			<div class="bonus-spin-wheel-block">
				<img
					class="bonus-spin-marker"
					class:bonus-spin-marker--visible={markerVisible}
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
					src={staticUrl('img/bonus-roulette-center-base.png')}
					alt=""
				/>
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
		min-height: 100%;
		padding: clamp(0.5rem, 3vh, 2rem) clamp(0.75rem, 4vw, 2rem) clamp(1rem, 5vh, 3rem);
	}
	.bonus-spin-title {
		width: min(92vw, 520px);
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
	.bonus-spin-wheel-block {
		--roulette-scale: 0.8;
		position: relative;
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
	}
	.bonus-spin-marker {
		--marker-y-offset: calc(-1 * min(36vw, min(30vh, 260px)));
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%) translateY(-150vh);
		width: min(5vw, 96px);
		opacity: 0;
		transition:
			transform 0.68s cubic-bezier(0.22, 1, 0.36, 1),
			opacity 0.34s ease;
		z-index: 2;
	}
	.bonus-spin-marker--visible {
		transform: translate(-50%, -50%) translateY(var(--marker-y-offset));
		opacity: 1;
	}
	.bonus-spin-wheel {
		width: min(88vw, min(72vh, 640px));
		height: min(88vw, min(72vh, 640px));
		transform-origin: 50% 50%;
		--wheel-rotation-deg: 0deg;
		transform: translateY(125vh) scale(var(--roulette-scale)) rotate(var(--wheel-rotation-deg));
		opacity: 0;
	}
	.bonus-spin-wheel--visible {
		transform: translateY(0) scale(var(--roulette-scale)) rotate(var(--wheel-rotation-deg));
		opacity: 1;
		transition:
			transform 0.68s cubic-bezier(0.22, 1, 0.36, 1),
			opacity 0.34s ease;
	}
	.bonus-spin-wheel--animating {
		transition: transform 4.1s cubic-bezier(0.12, 0.72, 0.12, 1);
	}
	.bonus-spin-center-base {
		position: absolute;
		left: 50%;
		top: 50%;
		width: min(46vw, min(38vh, 340px));
		transform: translate(-50%, -50%) translateY(125vh) scale(var(--roulette-scale));
		opacity: 0;
		z-index: 3;
		transition:
			transform 0.68s cubic-bezier(0.22, 1, 0.36, 1),
			opacity 0.34s ease;
	}
	.bonus-spin-center-base--visible {
		transform: translate(-50%, -50%) translateY(0) scale(var(--roulette-scale));
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
