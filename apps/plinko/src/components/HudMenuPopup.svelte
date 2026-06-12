<script lang="ts">
	import { getContext } from '../game/context';
	import { staticUrl } from '../lib/staticUrl';

	type Props = {
		mobile?: boolean;
		fullscreenAllowed?: boolean;
		onFullscreen?: () => void;
		onOpenFair?: () => void;
		onOpenRules?: () => void;
		onOpenHistory?: () => void;
		onOpenHowToPlay?: () => void;
	};

	const props: Props = $props();
	const context = getContext();
	const t = (key: string) => context.i18nDerived.t(key);

	const menuIcons = {
		fullscreen: staticUrl('img/hamburg_menu_ico_fullscreen.png'),
		fair: staticUrl('img/hamburg_menu_ico_fair_settings.png'),
		rules: staticUrl('img/hamburg_menu_ico_game_rules.png'),
		history: staticUrl('img/hamburg_menu_ico_history.png'),
		howToPlay: staticUrl('img/hamburg_menu_ico_how_to_play.png'),
	} as const;
</script>

<div class="hud-menu-popup" class:hud-menu-popup--mobile={props.mobile} role="menu">
	<!-- TODO: restore player profile row when avatar/name is wired up
	<header class="hud-menu-profile">
		<span class="hud-menu-avatar" aria-hidden="true"></span>
		<p class="hud-menu-player-name">{t('Player name')}</p>
		<button type="button" class="hud-menu-change-avatar">{t('Change avatar')}</button>
	</header>
	-->

	<nav class="hud-menu-list">
		<button
			type="button"
			class="hud-menu-item"
			disabled={!props.fullscreenAllowed}
			onclick={() => props.fullscreenAllowed && props.onFullscreen?.()}
		>
			<img class="hud-menu-item-icon" src={menuIcons.fullscreen} alt="" aria-hidden="true" />
			<span class="hud-menu-item-label">{t('Play in Fullscreen')}</span>
		</button>

		<div class="hud-menu-divider" aria-hidden="true"></div>

		<button type="button" class="hud-menu-item" onclick={() => props.onOpenFair?.()}>
			<img class="hud-menu-item-icon" src={menuIcons.fair} alt="" aria-hidden="true" />
			<span class="hud-menu-item-label">{t('Provably fair settings')}</span>
		</button>

		<button type="button" class="hud-menu-item" onclick={() => props.onOpenRules?.()}>
			<img class="hud-menu-item-icon" src={menuIcons.rules} alt="" aria-hidden="true" />
			<span class="hud-menu-item-label">{t('Game Rules')}</span>
		</button>

		<button type="button" class="hud-menu-item" onclick={() => props.onOpenHistory?.()}>
			<img class="hud-menu-item-icon" src={menuIcons.history} alt="" aria-hidden="true" />
			<span class="hud-menu-item-label">{t('My bet History')}</span>
		</button>

		<button type="button" class="hud-menu-item" onclick={() => props.onOpenHowToPlay?.()}>
			<img class="hud-menu-item-icon" src={menuIcons.howToPlay} alt="" aria-hidden="true" />
			<span class="hud-menu-item-label">{t('How to Play?')}</span>
		</button>
	</nav>
</div>

<style>
	.hud-menu-popup {
		position: absolute;
		top: calc(100% + 0.55vw);
		right: 0;
		width: max-content;
		max-width: min(322px, 18.4vw);
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
		right: clamp(10px, 3vw, 18px);
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
		font-size: clamp(13px, 0.95vw, 16px);
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
		font-size: clamp(11px, 0.72vw, 13px);
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

	.hud-menu-item:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.hud-menu-item:hover:not(:disabled) {
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
		font-size: clamp(12px, 0.82vw, 14px);
		font-weight: 400;
		line-height: 1.25;
		white-space: nowrap;
	}
</style>
