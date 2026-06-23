<script lang="ts">

	import { type Snippet } from 'svelte';

	import { GlobalStyle } from 'components-ui-html';

	import { LoadI18n } from 'components-shared';

	import Game from '../components/Game.svelte';
	import LoaderCasinoTvLogo from '../components/LoaderCasinoTvLogo.svelte';
	import PlinkoAuthenticate from '../components/PlinkoAuthenticate.svelte';

	import { setContext } from '../game/context';

	import '../game/plinkoPlayDebug';

	import { staticUrl } from '../lib/staticUrl';



	import messagesMap from '../i18n/messagesMap';



	type Props = { children: Snippet };



	const props: Props = $props();



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

@font-face{font-family:'PiecesOfEight';src:url(${JSON.stringify(staticUrl('fonts/PiecesOfEight/Pieces of Eight.ttf'))}) format('truetype');font-style:normal;}

@font-face{font-family:'PotatoSans';src:url(${JSON.stringify(staticUrl('fonts/PotatoSans/Potato_sans-Black.otf'))}) format('opentype');font-style:normal;}

@font-face{font-family:'Perpetua';src:url(${JSON.stringify(staticUrl('fonts/Perpetua/Perpetua-Regular.otf'))}) format('opentype');font-style:normal;}

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



		<LoaderCasinoTvLogo />



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

</style>

