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
/* \`svh\`, not \`vh\`, wherever the browser has it. On a mobile browser \`vh\` is the chrome-HIDDEN
   height, so with a toolbar on screen this unit scales the landscape UI against space the player
   cannot see — measured on an iPhone 15 / iOS 26 as vh 735 against svh 695 in portrait, and the gap
   is far wider in landscape (~393 against ~320), which is what pushed the Buy Bonus column's title
   off the top of the screen and clipped its balance line.
   It also puts this token back in step with the two things it is supposed to mirror: \`.game-root\`
   (Game.svelte) and the shell below both size themselves in \`svh\`, and \`uiScale()\`
   (lib/uiScale.ts) reads \`window.innerHeight\`, which on iOS IS the small viewport — so the CSS was
   the only piece still measuring against the large one.
   Stated as a SEPARATE rule behind @supports rather than edited into the line above, because a
   custom property holds any valid token stream: a browser without \`svh\` would accept the value and
   only fail when it was substituted, leaving every \`var(--ui-px)\` in the app invalid at computed
   -value time. Guarded, such a browser simply keeps the \`vh\` line. */
@supports (height: 100svh){
@media (min-aspect-ratio: 1/1){:root{--ui-px:min(1px, calc(100vw / 1024), calc(100svh / 576));}}
}

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

/* ── NO iOS TEXT AUTOSIZING ──────────────────────────────────────────────────────────────────────
   iOS Safari alone may inflate text it judges too small after an orientation change (WebKit's
   text autosizing, which Android Chrome does not do for a device-width viewport). Every size in this
   game is a deliberate fraction of the viewport, so the standard opt-out pins them. Harmless where the
   property is unknown. */
:root{-webkit-text-size-adjust:100%;text-size-adjust:100%;}

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

/* Noto Sans (quick guide). Google's own woff2 subsets, and a VARIABLE face — the 400 and 600 cuts are
   the same file — so one @font-face per subset covers the whole 100..900 axis and nothing is faux-bold.
   Only the two Latin subsets are installed: the guide's copy is hardcoded English. */
@font-face{font-family:'Noto Sans';src:url(${JSON.stringify(staticUrl('fonts/NotoSans/NotoSans-latin.woff2'))}) format('woff2');font-weight:100 900;font-style:normal;unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;}

@font-face{font-family:'Noto Sans';src:url(${JSON.stringify(staticUrl('fonts/NotoSans/NotoSans-latin-ext.woff2'))}) format('woff2');font-weight:100 900;font-style:normal;unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF;}

@font-face{font-family:'Righteous';src:url(${JSON.stringify(staticUrl('fonts/Righteous/Righteous-Regular.ttf'))}) format('truetype');font-weight:400;font-style:normal;}

@font-face{font-family:'AustereBlackCapsSSK';src:url(${JSON.stringify(staticUrl('fonts/AustereBlackCapsSSK-Regular.ttf'))}) format('truetype');font-weight:400;font-style:normal;}

/* Prompt (the "YOU WON N DROPS" / "YOU HAVE WON" row on both congratulations screens). Google's own
   woff2 subsets, same treatment as Noto Sans above — and for the same reason: Prompt is a Thai family,
   so the full face carries a Thai block this game never renders. Only the SEMIBOLD cut is installed —
   the weight the Figma source specifies for that row — so anything styling it must ask for 600 exactly;
   any other weight and the browser synthesises a fake bold off this one.
   ⚠️ No backticks in this comment, or anywhere else in this block: the whole stylesheet is a JS template
   literal, so one would close it and the file stops parsing.
   Both Latin subsets, since the copy is hardcoded English + digits and latin-ext is what covers a
   currency symbol if that row ever carries one. */
@font-face{font-family:'Prompt';src:url(${JSON.stringify(staticUrl('fonts/Prompt/Prompt-600-latin.woff2'))}) format('woff2');font-weight:600;font-style:normal;unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;}

@font-face{font-family:'Prompt';src:url(${JSON.stringify(staticUrl('fonts/Prompt/Prompt-600-latin-ext.woff2'))}) format('woff2');font-weight:600;font-style:normal;unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF;}

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
