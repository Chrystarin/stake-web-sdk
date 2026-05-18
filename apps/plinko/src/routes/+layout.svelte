<script lang="ts">
	import { type Snippet } from 'svelte';
	import { GlobalStyle } from 'components-ui-html';
	import { Authenticate, LoaderStakeEngine, LoaderExample, LoadI18n } from 'components-shared';
	import Game from '../components/Game.svelte';
	import { setContext } from '../game/context';
	import { staticUrl } from '../lib/staticUrl';

	import messagesMap from '../i18n/messagesMap';

	type Props = { children: Snippet };

	const props: Props = $props();

	let showYourLoader = $state(false);

	const loaderUrlStakeEngine = staticUrl('stake-engine-loader.gif');
	const loaderUrl = staticUrl('loader.gif');

	setContext();
</script>

<svelte:head>
	{@html `<style>
@font-face{font-family:'Instrument Sans';src:url(${JSON.stringify(staticUrl('fonts/Instrument_Sans/InstrumentSans-Regular.ttf'))}) format('truetype');font-weight:400;}
@font-face{font-family:'Instrument Sans';src:url(${JSON.stringify(staticUrl('fonts/Instrument_Sans/InstrumentSans-Bold.ttf'))}) format('truetype');font-weight:700;}
</style>`}
</svelte:head>

<GlobalStyle>
	<Authenticate>
		<LoadI18n {messagesMap}>
			<Game />
		</LoadI18n>
	</Authenticate>
</GlobalStyle>

<LoaderStakeEngine src={loaderUrlStakeEngine} oncomplete={() => (showYourLoader = true)} />

{#if showYourLoader}
	<LoaderExample src={loaderUrl} />
{/if}

{@render props.children()}
