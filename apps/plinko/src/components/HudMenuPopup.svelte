<script lang="ts">
	import { getContext } from '../game/context';
	import { staticUrl } from '../lib/staticUrl';

	type Props = {
		mobile?: boolean;
		soundEnabled?: boolean;
		onToggleSound?: () => void;
		musicEnabled?: boolean;
		onToggleMusic?: () => void;
		onOpenRules?: () => void;
		onOpenHistory?: () => void;
		onOpenHowToPlay?: () => void;
		onClose?: () => void;
	};

	const props: Props = $props();
	const context = getContext();
	const t = (key: string) => context.i18nDerived.t(key);

	let menuEl: HTMLDivElement;

	// Close the menu when the player clicks/taps anywhere outside of it. The menu
	// toggle buttons are excluded so their own click handler can toggle cleanly
	// (otherwise an outside-close would fire before the toggle, reopening it).
	$effect(() => {
		function handlePointerDown(event: PointerEvent) {
			const target = event.target as Element | null;
			if (!target) return;
			if (menuEl?.contains(target)) return;
			if (target.closest('.top-hud-btn--menu, .mobile-menu-trigger')) return;
			props.onClose?.();
		}

		document.addEventListener('pointerdown', handlePointerDown, true);
		return () => document.removeEventListener('pointerdown', handlePointerDown, true);
	});

	const menuIcons = {
		rules: staticUrl('img/hamburg_menu_ico_game_rules.webp'),
		history: staticUrl('img/hamburg_menu_ico_history.webp'),
		howToPlay: staticUrl('img/hamburg_menu_ico_how_to_play.webp'),
	} as const;
</script>

<div
	class="hud-menu-popup"
	class:hud-menu-popup--mobile={props.mobile}
	role="menu"
	bind:this={menuEl}
>
	<!-- TODO: restore player profile row when avatar/name is wired up
	<header class="hud-menu-profile">
		<span class="hud-menu-avatar" aria-hidden="true"></span>
		<p class="hud-menu-player-name">{t('Player name')}</p>
		<button type="button" class="hud-menu-change-avatar">{t('Change avatar')}</button>
	</header>
	-->

	<nav class="hud-menu-list">
		<button type="button" class="hud-menu-item" onclick={() => props.onOpenRules?.()}>
			<img class="hud-menu-item-icon" src={menuIcons.rules} alt="" aria-hidden="true" />
			<span class="hud-menu-item-label">{t('Game Rules')}</span>
		</button>

		<button type="button" class="hud-menu-item" onclick={() => props.onOpenHistory?.()}>
			<img class="hud-menu-item-icon" src={menuIcons.history} alt="" aria-hidden="true" />
			<span class="hud-menu-item-label">{t('My Bet History')}</span>
		</button>

		<button type="button" class="hud-menu-item" onclick={() => props.onOpenHowToPlay?.()}>
			<img class="hud-menu-item-icon" src={menuIcons.howToPlay} alt="" aria-hidden="true" />
			<span class="hud-menu-item-label">{t('How to Play?')}</span>
		</button>

		<div class="hud-menu-divider" aria-hidden="true"></div>

		<div class="hud-menu-item hud-menu-item--switch">
			<svg
				class="hud-menu-item-icon"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<path d="M11 5 6 9H2v6h4l5 4V5z" />
				{#if props.soundEnabled ?? true}
					<path d="M15.5 8.5a5 5 0 0 1 0 7" />
					<path d="M18.5 5.5a9 9 0 0 1 0 13" />
				{:else}
					<line x1="22" y1="9" x2="16" y2="15" />
					<line x1="16" y1="9" x2="22" y2="15" />
				{/if}
			</svg>
			<span class="hud-menu-item-label">{t('Sound')}</span>
			<button
				type="button"
				class="hud-menu-switch"
				class:hud-menu-switch--on={props.soundEnabled ?? true}
				role="switch"
				aria-checked={props.soundEnabled ?? true}
				aria-label={t('Sound')}
				onclick={() => props.onToggleSound?.()}
			>
				<span class="hud-menu-switch-knob"></span>
			</button>
		</div>

		<div class="hud-menu-item hud-menu-item--switch">
			<svg
				class="hud-menu-item-icon"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<path d="M9 18V5l12-2v13" />
				<circle cx="6" cy="18" r="3" />
				<circle cx="18" cy="16" r="3" />
				{#if !(props.musicEnabled ?? false)}
					<line x1="3" y1="3" x2="21" y2="21" />
				{/if}
			</svg>
			<span class="hud-menu-item-label">{t('Music')}</span>
			<button
				type="button"
				class="hud-menu-switch"
				class:hud-menu-switch--on={props.musicEnabled ?? false}
				role="switch"
				aria-checked={props.musicEnabled ?? false}
				aria-label={t('Music')}
				onclick={() => props.onToggleMusic?.()}
			>
				<span class="hud-menu-switch-knob"></span>
			</button>
		</div>
	</nav>
</div>

<style>
	/* Desktop/landscape popup. Sizing is vw-driven and already scales, EXCEPT the px terms inside the
	   min()/clamp()s below — those bind on a small viewport and stop tracking it, which is why the menu
	   labels read ~2.5× oversized on Stake's 400×225 popout (0.82vw = 3.3px there, so the 12px floor
	   wins). Stating them in --ui-px keeps each bound at its reference PROPORTION. The `--mobile` rules
	   further down are untouched: --ui-px is 1px in portrait, where that block's px sizes belong to the
	   separate 992×1761 reference. */
	.hud-menu-popup {
		position: absolute;
		top: calc(100% + 0.55vw);
		right: 0;
		width: max-content;
		max-width: min(calc(322 * var(--ui-px)), 18.4vw);
		border-radius: 0.65vw;
		background: #1a1b1f;
		box-shadow: 0 0.45vw 1.2vw rgba(0, 0, 0, 0.45);
		padding: 0.75vw 0.85vw 0.85vw;
		display: flex;
		flex-direction: column;
		gap: 0.55vw;
		z-index: 30;
		font-family: 'Instrument Sans', system-ui, sans-serif;
	}

	.hud-menu-popup--mobile {
		position: fixed;
		top: clamp(72px, 18vw, 112px);
		/* Anchored left so it drops from the top-left menu button (mobile menu moved there). */
		left: clamp(10px, 3vw, 18px);
		width: max-content;
		max-width: min(calc(100vw - 24px), 322px);
		border-radius: 12px;
		padding: 12px 16px 14px;
		gap: 10px;
	}

	.hud-menu-profile {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 0.55vw 0.65vw;
		padding-bottom: 0.35vw;
	}

	.hud-menu-popup--mobile .hud-menu-profile {
		gap: 10px 12px;
		padding-bottom: 6px;
	}

	.hud-menu-avatar {
		width: 2.1vw;
		height: 2.1vw;
		min-width: 2.1vw;
		border-radius: 50%;
		background: #9ca3af;
	}

	.hud-menu-popup--mobile .hud-menu-avatar {
		width: 40px;
		height: 40px;
		min-width: 40px;
	}

	.hud-menu-player-name {
		margin: 0;
		color: #fff;
		font-size: clamp(calc(13 * var(--ui-px)), 0.95vw, calc(16 * var(--ui-px)));
		font-weight: 700;
		line-height: 1.2;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.hud-menu-change-avatar {
		border: none;
		background: transparent;
		color: rgba(255, 255, 255, 0.45);
		font-size: clamp(calc(11 * var(--ui-px)), 0.72vw, calc(13 * var(--ui-px)));
		font-weight: 400;
		line-height: 1.2;
		padding: 0;
		cursor: pointer;
		white-space: nowrap;
	}

	.hud-menu-change-avatar:hover {
		color: rgba(255, 255, 255, 0.65);
	}

	.hud-menu-list {
		display: flex;
		flex-direction: column;
		gap: 0;
	}

	.hud-menu-popup--mobile .hud-menu-list {
		gap: 0;
	}

	.hud-menu-divider {
		display: block;
		width: 100%;
		height: 1px;
		min-height: 1px;
		flex-shrink: 0;
		margin: 0.55vw 0 0.35vw;
		padding: 0;
		border: 0;
		background: #fff;
		opacity: 0.5;
		box-sizing: border-box;
	}

	.hud-menu-popup--mobile .hud-menu-divider {
		height: 2px;
		min-height: 2px;
		margin: 10px 0 6px;
	}

	.hud-menu-item {
		display: flex;
		align-items: center;
		gap: 0.55vw;
		width: 100%;
		border: none;
		background: transparent;
		color: #fff;
		text-align: left;
		padding: 0.42vw 0.15vw;
		cursor: pointer;
		border-radius: 0.25vw;
		transition: background-color 0.12s ease;
	}

	.hud-menu-popup--mobile .hud-menu-item {
		gap: 10px;
		padding: 10px 2px;
		border-radius: 6px;
	}

	.hud-menu-item:hover {
		background: rgba(255, 255, 255, 0.05);
	}

	.hud-menu-item-icon {
		width: 1.15vw;
		height: 1.15vw;
		min-width: 1.15vw;
		object-fit: contain;
		display: block;
		flex-shrink: 0;
	}

	.hud-menu-popup--mobile .hud-menu-item-icon {
		width: 22px;
		height: 22px;
		min-width: 22px;
	}

	.hud-menu-item-label {
		font-size: clamp(calc(12 * var(--ui-px)), 0.82vw, calc(14 * var(--ui-px)));
		font-weight: 400;
		line-height: 1.25;
		white-space: nowrap;
	}

	/* Switch rows are static containers; only the toggle itself is interactive,
	   so the row must not show a pointer cursor or hover highlight. */
	.hud-menu-item--switch {
		cursor: default;
	}

	.hud-menu-item--switch:hover {
		background: transparent;
	}

	.hud-menu-item--switch .hud-menu-item-label {
		flex: 1 1 auto;
	}

	.hud-menu-switch {
		position: relative;
		flex-shrink: 0;
		display: inline-block;
		width: 2.4vw;
		height: 1.3vw;
		min-width: 2.4vw;
		padding: 0;
		border: none;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.2);
		transition: background-color 0.15s ease;
		cursor: pointer;
	}

	.hud-menu-switch--on {
		background: #54f917;
	}

	.hud-menu-switch-knob {
		position: absolute;
		top: 50%;
		left: 0.12vw;
		width: 1.06vw;
		height: 1.06vw;
		border-radius: 50%;
		background: #fff;
		transform: translate(0, -50%);
		transition: transform 0.15s ease;
	}

	.hud-menu-switch--on .hud-menu-switch-knob {
		transform: translate(1.1vw, -50%);
	}

	.hud-menu-popup--mobile .hud-menu-switch {
		width: 44px;
		height: 24px;
		min-width: 44px;
	}

	.hud-menu-popup--mobile .hud-menu-switch-knob {
		left: 2px;
		width: 20px;
		height: 20px;
	}

	.hud-menu-popup--mobile .hud-menu-switch--on .hud-menu-switch-knob {
		transform: translate(20px, -50%);
	}
</style>
