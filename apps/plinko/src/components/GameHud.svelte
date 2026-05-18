<script lang="ts">
	import { stateBet } from 'state-shared';

	import {
		AUTO_BET_OPTIONS,
		BALL_PER_DROP_TIERS,
		BET_PER_BALL_PRESETS,
		DIFFICULTY_LABELS,
		ROW_COUNT_OPTIONS,
	} from '../game-logic/constants';
	import { isBetControlsLocked, isBonusPlayButtonDisabled } from '../game/gameOrchestrator';
	import { stateGame } from '../game/stateGame.svelte';
	import { getContext } from '../game/context';
	import { FreeSpinMeter } from '../features/meters';
	import { staticUrl } from '../lib/staticUrl';

	type Props = {
		betAmount: number;
		winAmount: number;
		totalBetAmount: number;
		onBetAmountChange: (value: number) => void;
		onPlay: () => void;
		onToggleAuto: () => void;
		autoMode: boolean;
		autoPlayStarted: boolean;
		autoRoundsLeft: number;
		spinMeterProgress?: number;
		hasPendingBonusBalls?: boolean;
		bonusBallsRemaining?: number;
		playDisabled?: boolean;
		bonusPlayDisabled?: boolean;
		mobile?: boolean;
	};

	const props: Props = $props();
	const context = getContext();

	let autoPanelOpen = $state(false);
	let betPresetOpen = $state(false);

	const difficultyLabel = $derived(DIFFICULTY_LABELS[stateGame.difficultyLevelId] ?? 'Easy');
	const controlsLocked = $derived(isBetControlsLocked());
	const bonusPlayDisabled = $derived(isBonusPlayButtonDisabled() || props.bonusPlayDisabled);

	function cycleDifficulty() {
		stateGame.difficultyLevelId = (stateGame.difficultyLevelId + 1) % DIFFICULTY_LABELS.length;
		context.eventEmitter.broadcast({ type: 'soundOnce', name: 'clickUIButton' });
	}

	function cycleRowCount() {
		const idx = ROW_COUNT_OPTIONS.indexOf(stateGame.rowCount as (typeof ROW_COUNT_OPTIONS)[number]);
		stateGame.rowCount = ROW_COUNT_OPTIONS[(idx + 1) % ROW_COUNT_OPTIONS.length];
	}

	function cycleBallPerDrop() {
		const idx = BALL_PER_DROP_TIERS.indexOf(stateGame.ballPerDrop as (typeof BALL_PER_DROP_TIERS)[number]);
		stateGame.ballPerDrop = BALL_PER_DROP_TIERS[(idx + 1) % BALL_PER_DROP_TIERS.length];
	}

	function setBetPreset(amount: number) {
		props.onBetAmountChange(amount);
		betPresetOpen = false;
	}

	function selectAutoRounds(n: number) {
		stateGame.autoRoundsLeft = n;
		autoPanelOpen = false;
	}
</script>

<section
	class="bet-panel"
	class:bet-panel--mobile={props.mobile}
	style:background-image="url({staticUrl('img/betting-component-frame.png')})"
>
	<div class="free-spin-meter-wrap">
		<FreeSpinMeter progress={props.spinMeterProgress ?? 0} />
	</div>

	<div class="stats-row">
		<div class="stat">
			<span class="stat-label">{context.i18nDerived.t('Balance')}</span>
			<strong>{stateBet.balanceAmount.toFixed(2)}</strong>
		</div>
		<div class="stat">
			<span class="stat-label">{context.i18nDerived.t('Bet')}</span>
			<strong>{props.totalBetAmount.toFixed(2)}</strong>
		</div>
		<div class="stat">
			<span class="stat-label">{context.i18nDerived.t('Win')}</span>
			<strong class="win-val">{props.winAmount.toFixed(2)}</strong>
		</div>
	</div>

	<div class="bet-row">
		<span class="row-label">{context.i18nDerived.t('Difficulty')}</span>
		<button class="chip" type="button" disabled={controlsLocked} onclick={cycleDifficulty}>
			{difficultyLabel}
		</button>
	</div>
	<div class="bet-row">
		<span class="row-label">Rows</span>
		<button class="chip" type="button" disabled={controlsLocked} onclick={cycleRowCount}>
			{stateGame.rowCount}
		</button>
	</div>
	<div class="bet-row">
		<span class="row-label">{context.i18nDerived.t('Ball per drop')}</span>
		<button class="chip" type="button" disabled={controlsLocked} onclick={cycleBallPerDrop}>
			{stateGame.ballPerDrop}
		</button>
	</div>
	<div class="bet-row bet-amount-row">
		<span class="row-label">{context.i18nDerived.t('Bet per ball')}</span>
		<div class="amount-wrap">
			<button
				class="step"
				type="button"
				disabled={controlsLocked}
				onclick={() => props.onBetAmountChange(Math.max(0.01, props.betAmount / 2))}
			>
				<img src={staticUrl('img/betting-component-input-decrease.png')} alt="-" />
			</button>
			<span class="amount">{props.betAmount.toFixed(2)}</span>
			<button
				class="step"
				type="button"
				disabled={controlsLocked}
				onclick={() => props.onBetAmountChange(props.betAmount * 2)}
			>
				<img src={staticUrl('img/betting-component-input-increase.png')} alt="+" />
			</button>
			<button
				class="preset-toggle"
				type="button"
				disabled={controlsLocked}
				onclick={() => (betPresetOpen = !betPresetOpen)}>▼</button
			>
		</div>
		{#if betPresetOpen}
			<div class="preset-panel">
				{#each BET_PER_BALL_PRESETS as preset}
					<button type="button" onclick={() => setBetPreset(preset)}>{preset}</button>
				{/each}
			</div>
		{/if}
	</div>

	<div class="actions">
		<button
			class="play-btn"
			type="button"
			class:play-btn--bonus={props.hasPendingBonusBalls}
			disabled={props.hasPendingBonusBalls ? bonusPlayDisabled : props.playDisabled}
			onclick={props.onPlay}
		>
			<img
				src={props.hasPendingBonusBalls
					? staticUrl('img/play-btn.png')
					: props.mobile
						? staticUrl('img/play-btn-mobile.png')
						: staticUrl('img/play-btn.png')}
				alt=""
			/>
			{#if props.hasPendingBonusBalls}
				<span class="bonus-badge">{props.bonusBallsRemaining}</span>
			{/if}
		</button>
		<button
			class="auto-btn"
			type="button"
			class:auto-btn--on={props.autoMode}
			class:auto-btn--running={props.autoPlayStarted}
			disabled={controlsLocked}
			onclick={() => (autoPanelOpen = !autoPanelOpen)}
		>
			<img
				src={props.mobile ? staticUrl('img/auto-bet-btn-mobile.png') : staticUrl('img/auto-bet-btn.png')}
				alt=""
			/>
			{#if props.autoMode}<span class="auto-count">{props.autoRoundsLeft}</span>{/if}
		</button>
		<button
			class="fast-btn"
			type="button"
			class:fast-btn--on={stateGame.fastGameEnabled}
			disabled={controlsLocked}
			onclick={() => (stateGame.fastGameEnabled = !stateGame.fastGameEnabled)}
		>
			<img src={props.mobile ? staticUrl('img/fast-game-btn-mobile.png') : staticUrl('img/fast-game-btn.png')} alt="" />
		</button>
		{#if autoPanelOpen}
			<div class="auto-panel">
				{#each AUTO_BET_OPTIONS as n}
					<button type="button" onclick={() => selectAutoRounds(n)}>{n}</button>
				{/each}
				<button type="button" class="start-auto" onclick={props.onToggleAuto}>
					{props.autoPlayStarted
						? context.i18nDerived.t('Stop autobet')
						: context.i18nDerived.t('Start autobet')}
				</button>
			</div>
		{/if}
	</div>

	{#if stateGame.history.length}
		<div class="history-strip">
			{#each stateGame.history as item}
				<span class="hist-pill" style:background={item.color}>{item.result}×</span>
			{/each}
		</div>
	{/if}
</section>

<style>
	.bet-panel {
		margin: 0 12px 12px;
		padding: 16px;
		background: center/100% 100% no-repeat;
		color: #d6e8f7;
		font-family: 'Instrument Sans', system-ui, sans-serif;
		position: relative;
		z-index: 5;
	}
	.free-spin-meter-wrap {
		width: min(100%, 420px);
		height: clamp(28px, 4vh, 40px);
		margin: 0 auto 12px;
	}
	.stats-row {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
		margin-bottom: 12px;
	}
	.stat {
		text-align: center;
		font-size: 12px;
	}
	.stat strong {
		display: block;
		color: #fff;
		font-size: 15px;
	}
	.win-val {
		color: #fee663;
	}
	.bet-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 10px;
	}
	.chip {
		background: rgba(0, 0, 0, 0.35);
		border: 1px solid rgba(126, 200, 255, 0.35);
		border-radius: 999px;
		color: #fff;
		padding: 6px 14px;
		cursor: pointer;
		min-width: 88px;
	}
	.chip:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.amount-wrap {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.step,
	.preset-toggle {
		width: 32px;
		height: 32px;
		border: none;
		background: transparent;
		cursor: pointer;
		padding: 0;
	}
	.step img {
		width: 100%;
		height: 100%;
	}
	.amount {
		min-width: 72px;
		text-align: center;
		font-weight: 700;
		color: #fff;
	}
	.preset-panel,
	.auto-panel {
		position: absolute;
		right: 24px;
		bottom: 100%;
		background: rgba(8, 14, 22, 0.96);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 8px;
		padding: 8px;
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 6px;
		z-index: 10;
	}
	.preset-panel button,
	.auto-panel button {
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.12);
		color: #fff;
		border-radius: 6px;
		padding: 8px;
		cursor: pointer;
	}
	.actions {
		display: flex;
		gap: 12px;
		margin-top: 12px;
		position: relative;
		align-items: center;
		justify-content: center;
	}
	.play-btn,
	.auto-btn,
	.fast-btn {
		position: relative;
		border: none;
		background: transparent;
		cursor: pointer;
		padding: 0;
	}
	.play-btn img,
	.auto-btn img,
	.fast-btn img {
		height: 52px;
	}
	.play-btn:disabled,
	.auto-btn:disabled,
	.fast-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.bonus-badge {
		position: absolute;
		top: 4px;
		right: 4px;
		background: #e63b2e;
		color: #fff;
		border-radius: 999px;
		min-width: 22px;
		height: 22px;
		display: grid;
		place-items: center;
		font-size: 11px;
		font-weight: 800;
	}
	.auto-count {
		position: absolute;
		bottom: 2px;
		right: 2px;
		background: rgba(0, 0, 0, 0.65);
		color: #fff;
		border-radius: 999px;
		padding: 2px 6px;
		font-size: 10px;
	}
	.auto-btn--on {
		filter: drop-shadow(0 0 8px rgba(58, 168, 232, 0.5));
	}
	.fast-btn--on {
		filter: drop-shadow(0 0 8px rgba(255, 214, 96, 0.45));
	}
	.start-auto {
		grid-column: 1 / -1;
		background: linear-gradient(180deg, #2a8fd4, #1a5f9c) !important;
	}
	.history-strip {
		display: flex;
		gap: 6px;
		margin-top: 12px;
		flex-wrap: wrap;
	}
	.hist-pill {
		padding: 4px 10px;
		border-radius: 999px;
		font-size: 12px;
		font-weight: 700;
		color: #0a1018;
	}
	.bet-amount-row {
		position: relative;
	}
	.bet-panel--mobile .play-btn img,
	.bet-panel--mobile .auto-btn img,
	.bet-panel--mobile .fast-btn img {
		height: 44px;
	}
</style>
