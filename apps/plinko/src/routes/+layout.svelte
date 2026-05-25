<script lang="ts">

	import { type Snippet } from 'svelte';

	import { GlobalStyle } from 'components-ui-html';

	import { LoaderStakeEngine, LoaderExample, LoadI18n } from 'components-shared';

	import Game from '../components/Game.svelte';
	import PlinkoAuthenticate from '../components/PlinkoAuthenticate.svelte';

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

@font-face{font-family:'Instrument Sans';src:url(${JSON.stringify(staticUrl('fonts/Instrument_Sans/static/InstrumentSans-Regular.ttf'))}) format('truetype');font-weight:400;}

@font-face{font-family:'Instrument Sans';src:url(${JSON.stringify(staticUrl('fonts/Instrument_Sans/static/InstrumentSans-SemiBold.ttf'))}) format('truetype');font-weight:600;}

@font-face{font-family:'Instrument Sans';src:url(${JSON.stringify(staticUrl('fonts/Instrument_Sans/static/InstrumentSans-Bold.ttf'))}) format('truetype');font-weight:700;}

@font-face{font-family:'Poppins';src:url(${JSON.stringify(staticUrl('fonts/Poppins/Poppins-Regular.ttf'))}) format('truetype');font-weight:400;font-style:normal;}

@font-face{font-family:'Poppins';src:url(${JSON.stringify(staticUrl('fonts/Poppins/Poppins-SemiBold.ttf'))}) format('truetype');font-weight:600;font-style:normal;}

@font-face{font-family:'Poppins';src:url(${JSON.stringify(staticUrl('fonts/Poppins/Poppins-Bold.ttf'))}) format('truetype');font-weight:700;font-style:normal;}

</style>`}

</svelte:head>



<div class="plinko-app-shell">
	<div class="plinko-app-shell-content">

		<GlobalStyle>

			<PlinkoAuthenticate>

				<LoadI18n {messagesMap}>

					<Game />

				</LoadI18n>

			</PlinkoAuthenticate>

		</GlobalStyle>



		<LoaderStakeEngine src={loaderUrlStakeEngine} oncomplete={() => (showYourLoader = true)} />



		{#if showYourLoader}

			<LoaderExample src={loaderUrl} />

		{/if}



		{@render props.children()}

	</div>

</div>



<style>

	.plinko-app-shell {

		position: relative;

		min-height: 100vh;

		min-height: 100dvh;

		overflow: hidden;

		isolation: isolate;

	}



	.plinko-app-shell-content {

		position: relative;

		z-index: 1;

		min-height: 100vh;

		min-height: 100dvh;

	}



	/* Let the Spine background show through while stake-engine / example loaders run. */

	.plinko-app-shell-content :global(.wrap),

	.plinko-app-shell-content :global(.gif-loader-wrap) {

		background-color: transparent !important;

	}

</style>

