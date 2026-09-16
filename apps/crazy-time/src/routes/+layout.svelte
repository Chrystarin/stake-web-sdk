<script lang="ts">
	import { type Snippet } from 'svelte';
	import { GlobalStyle } from 'components-ui-html';
	import { Authenticate, LoadI18n } from 'components-shared';
	import { stateUrlDerived } from 'state-shared';

	import Game from '../components/Game.svelte';
	import LoaderCasinoTvLogo from '../components/LoaderCasinoTvLogo.svelte';
	import { setContext } from '../game/context';
	import { stateGame } from '../game/stateGame.svelte';

	import messagesMap from '../i18n/messagesMap';

	type Props = { children: Snippet };

	const props: Props = $props();

	setContext();

	// With an RGS session, authenticate normally. Without one (dev / preview), skip auth and
	// let the dev harness play sample books locally.
	const online = $derived(Boolean(stateUrlDerived.rgsUrl()));
</script>

<!--
	<Game> mounts only once the intro preload has every asset resident (`assetsReady`, flipped by
	lib/preloadAssets.ts behind the splash). Online, authentication runs in parallel with the preload
	under the same splash, so the game stands on the far side of both — and the splash's last step
	waits for it (see `markGameBooted` in Game.svelte). Mounting the game BEHIND the splash instead,
	the way the Plinko does, would have every image on the first screen fetched twice: once by the
	component, cold, and once by the preload.
-->
<GlobalStyle>
	{#if online}
		<Authenticate>
			<LoadI18n {messagesMap}>
				{#if stateGame.assetsReady}
					<Game />
				{/if}
			</LoadI18n>
		</Authenticate>
	{:else}
		<LoadI18n {messagesMap}>
			{#if stateGame.assetsReady}
				<Game />
			{/if}
		</LoadI18n>
	{/if}
</GlobalStyle>

<LoaderCasinoTvLogo />

{@render props.children()}
