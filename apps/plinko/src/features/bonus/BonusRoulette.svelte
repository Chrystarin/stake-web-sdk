<script lang="ts">
	import { onMount } from 'svelte';

	import { BONUS_ROULETTE_SEGMENTS } from '../../game-logic/constants';
	import { isMobile } from '../../lib/format';

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

	function startSpin() {
		let winner = Math.floor(Math.random() * segments.length);
		if (props.targetFreeBalls != null) {
			const match = BONUS_ROULETTE_SEGMENTS.indexOf(
				props.targetFreeBalls as (typeof BONUS_ROULETTE_SEGMENTS)[number],
			);
			if (match >= 0) winner = match;
		}
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
		timers.push(
			setTimeout(() => {
				labelVisible = false;
				wheelVisible = false;
				markerVisible = false;
				pendingResult = {
					segmentIndex: winner,
					segmentLabel: landed.label,
					freeBallCount: landed.freeBalls,
				};
				wonFreeBalls = landed.freeBalls;
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
			style:background-image="url({mobile ? '/img/bonus-roulette-background-mobile.png' : '/img/bonus-roulette-background.png'})"
		></div>
		<div class="bonus-spin-content">
			<img
				class="bonus-spin-title"
				class:bonus-spin-title--visible={labelVisible}
				src="/img/bonus-roulette-label.png"
				alt="Free balls"
			/>
			<div class="bonus-spin-wheel-block">
				<img
					class="bonus-spin-marker"
					class:bonus-spin-marker--visible={markerVisible}
					src="/img/free-spin-marker.png"
					alt=""
				/>
				<img
					bind:this={wheelEl}
					class="bonus-spin-wheel"
					class:bonus-spin-wheel--animating={wheelSpinClass}
					class:bonus-spin-wheel--visible={wheelVisible}
					style:--wheel-rotation-deg="{wheelRotationDeg}deg"
					src="/img/bonus-roulette-wheel.png"
					alt="Bonus roulette wheel"
				/>
				<img
					class="bonus-spin-center-base"
					class:bonus-spin-center-base--visible={wheelVisible}
					src="/img/bonus-roulette-center-base.png"
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
			style:background-image="url({mobile ? '/img/announcement-message-background-mobile.png' : '/img/announcement-message-background.png'})"
			onclick={onAnnouncementClick}
		>
			<div class="bonus-announcement-headline">
				{props.mode === 'message' ? (props.messageTitle ?? 'CONGRATULATIONS!') : 'CONGRATULATIONS!'}
			</div>
			<div class="bonus-announcement-reward">
				{props.mode === 'message'
					? (props.messageValue ?? '')
					: `YOU WON ${wonFreeBalls} DROPS`}
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
		gap: clamp(10px, 2vh, 18px);
		color: #f4d36d;
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
	.bonus-announcement-headline {
		font-size: clamp(48px, 8.2vw, 116px);
		font-weight: 800;
		text-shadow: 0 0 16px rgba(255, 191, 0, 0.45);
	}
	.bonus-announcement-reward {
		font-size: clamp(30px, 5.2vw, 76px);
		font-weight: 700;
	}
	.bonus-announcement-hint {
		margin-top: clamp(18px, 5vh, 80px);
		font-size: clamp(16px, 1.6vw, 26px);
		color: #f0ddaa;
	}
</style>
