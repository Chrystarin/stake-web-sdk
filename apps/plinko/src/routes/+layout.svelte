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

/* ── UI SCALE UNIT ───────────────────────────────────────────────────────────────────────────────
   \`--ui-px\` is "one pixel of the reference landscape layout". The desktop/landscape UI was tuned
   against Stake's 1024×576 frame, and everything sized in vw/vh/% already rides the viewport — but
   anything stated in absolute px (and every px floor/ceiling inside a clamp()/min()) does NOT, so on
   Stake's 400×225 "Popout S" those pieces stay full size and read 2–3× oversized against the board.

   Substituting \`calc(N * var(--ui-px))\` for a literal \`Npx\` makes that value shrink with the
   viewport instead, so the whole component becomes a uniform scale of its 1024×576 self:
     • 1024×576 → 1px  (identical to before — nothing at or above the reference changes)
     •  400×225 → 0.390625px  (the exact 400/1024 downscale)
   Both terms are needed: width alone would let a short-but-wide window overflow vertically.

   PORTRAIT IS EXCLUDED on purpose. The portrait layout has its own 992×1761 reference and its own
   px sizing, so it must keep \`--ui-px: 1px\`. \`min-aspect-ratio: 1/1\` is width ≥ height, exactly
   the test \`isPortraitGameLayout()\` uses (lib/format.ts) to pick the landscape layout.
   TypeScript mirror for px computed in JS: \`uiScale()\` in lib/uiScale.ts — keep the two in step. */
:root{--ui-px:1px;}
@media (min-aspect-ratio: 1/1){:root{--ui-px:min(1px, calc(100vw / 1024), calc(100vh / 576));}}

/* ── NO NATIVE TAP HIGHLIGHT ─────────────────────────────────────────────────────────────────────
   Mobile browsers paint a translucent box over whatever element a touch lands on — blue in most
   Android WebViews, grey on iOS. On the round Play/Bet plaque that reads as a square highlight
   flashing around a circular button, which is what QA raised against the Bet button: the press was
   showing the browser's rectangle instead of the button's own brightness ramp. Desktop looked right
   only because a MOUSE press produces no tap highlight at all — the styling was never platform-
   specific, the native box simply had nothing to overdraw there.

   Declared on the root rather than per-button because -webkit-tap-highlight-color is INHERITED: one
   declaration covers the HUD, the modals, the menu and anything added later, so the same complaint
   can't resurface on the next control someone adds. Every control keeps supplying its own press
   feedback via :active (GameHud.scss — brightness on the Play buttons, scale on the smaller ones). */
:root{-webkit-tap-highlight-color:transparent;}

@font-face{font-family:'Instrument Sans';src:url(${JSON.stringify(staticUrl('fonts/Instrument_Sans/static/InstrumentSans-Regular.ttf'))}) format('truetype');font-weight:400;}

@font-face{font-family:'Instrument Sans';src:url(${JSON.stringify(staticUrl('fonts/Instrument_Sans/static/InstrumentSans-SemiBold.ttf'))}) format('truetype');font-weight:600;}

@font-face{font-family:'Instrument Sans';src:url(${JSON.stringify(staticUrl('fonts/Instrument_Sans/static/InstrumentSans-Bold.ttf'))}) format('truetype');font-weight:700;}

@font-face{font-family:'Poppins';src:url(${JSON.stringify(staticUrl('fonts/Poppins/Poppins-ExtraLight.ttf'))}) format('truetype');font-weight:200;font-style:normal;}

@font-face{font-family:'Poppins';src:url(${JSON.stringify(staticUrl('fonts/Poppins/Poppins-Light.ttf'))}) format('truetype');font-weight:300;font-style:normal;}

@font-face{font-family:'Poppins';src:url(${JSON.stringify(staticUrl('fonts/Poppins/Poppins-Regular.ttf'))}) format('truetype');font-weight:400;font-style:normal;}

@font-face{font-family:'Poppins';src:url(${JSON.stringify(staticUrl('fonts/Poppins/Poppins-Medium.ttf'))}) format('truetype');font-weight:500;font-style:normal;}

@font-face{font-family:'Poppins';src:url(${JSON.stringify(staticUrl('fonts/Poppins/Poppins-SemiBold.ttf'))}) format('truetype');font-weight:600;font-style:normal;}

@font-face{font-family:'Poppins';src:url(${JSON.stringify(staticUrl('fonts/Poppins/Poppins-Bold.ttf'))}) format('truetype');font-weight:700;font-style:normal;}

@font-face{font-family:'Poppins';src:url(${JSON.stringify(staticUrl('fonts/Poppins/Poppins-ExtraBold.ttf'))}) format('truetype');font-weight:800;font-style:normal;}

@font-face{font-family:'Poppins';src:url(${JSON.stringify(staticUrl('fonts/Poppins/Poppins-Black.ttf'))}) format('truetype');font-weight:900;font-style:normal;}

@font-face{font-family:'PiecesOfEight';src:url(${JSON.stringify(staticUrl('fonts/PiecesOfEight/Pieces of Eight.ttf'))}) format('truetype');font-style:normal;}

@font-face{font-family:'PotatoSans';src:url(${JSON.stringify(staticUrl('fonts/PotatoSans/Potato_sans-Black.otf'))}) format('opentype');font-style:normal;}

@font-face{font-family:'Perpetua';src:url(${JSON.stringify(staticUrl('fonts/Perpetua/Perpetua-Regular.otf'))}) format('opentype');font-style:normal;}

@font-face{font-family:'Righteous';src:url(${JSON.stringify(staticUrl('fonts/Righteous/Righteous-Regular.ttf'))}) format('truetype');font-weight:400;font-style:normal;}

@font-face{font-family:'AustereBlackCapsSSK';src:url(${JSON.stringify(staticUrl('fonts/AustereBlackCapsSSK-Regular.ttf'))}) format('truetype');font-weight:400;font-style:normal;}

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

		/* Match `.game-root`'s `svh` switch (Game.svelte) — keeps this shell's min-height from tracking
		   the mobile browser chrome (which `dvh` does), so it can't drift out of sync with the inner
		   game root during an address-bar show/hide triggered mid-touch. */
		min-height: 100svh;

		overflow: hidden;

		isolation: isolate;
	}

	.plinko-app-shell-content {
		position: relative;

		z-index: 1;

		min-height: 100vh;

		min-height: 100svh;
	}
</style>
