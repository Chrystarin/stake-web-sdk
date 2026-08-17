<script lang="ts">
	import { stateUrlDerived } from 'state-shared';

	import { getContext } from '../game/context';
	import { stateGame } from '../game/stateGame.svelte';
	import { QUICK_GUIDE_VIDEO_PATHS } from '../lib/preloadAssets';
	import { staticUrl } from '../lib/staticUrl';

	const context = getContext();

	type QuickGuidePage = {
		title: string;
		content: string;
		/** Index into QUICK_GUIDE_VIDEO_PATHS — the loop that plays in the frame above the copy. */
		video: number;
	};

	const PAGES: readonly QuickGuidePage[] = [
		{
			title: 'DROP & WIN',
			content: 'Ball drops → multiplier pocket → win reacts',
			video: 0,
		},
		{
			title: 'FREE SPIN',
			content: 'SPIN pocket → meter → wheel',
			video: 1,
		},
		{
			title: 'UNLOCK BONUS',
			content: 'Gold Coin Pegs → Bonus meter → Free Balls',
			video: 2,
		},
		{
			title: 'LEVEL UP BONUS',
			content: 'During Free Balls → meter refills → level up',
			video: 3,
		},
	];

	/** Replay is passive playback with no player to dismiss anything — never put a modal in its way. */
	const isReplay = $derived(stateUrlDerived.replay());

	let pageIndex = $state(0);
	let modalEl = $state<HTMLElement | undefined>(undefined);

	const page = $derived(PAGES[pageIndex]);
	const isFirstPage = $derived(pageIndex === 0);
	const isLastPage = $derived(pageIndex === PAGES.length - 1);

	/**
	 * How long to hold after the splash reports itself finished before the guide slides in.
	 *
	 * `introLoaderComplete` flips at the START of the splash's fade-out, not at the end of it — the
	 * loader sets the flag and clears `loading` in the same tick, then the overlay spends
	 * `FADE_OUT_MS` dissolving. Opening on the raw flag therefore paints this modal's 82%-black
	 * backdrop over a splash that is still on screen, and the logo ghosts through it for the whole
	 * fade. Mirrors `FADE_OUT_MS` in LoaderCasinoTvLogo.svelte — keep the two in step.
	 *
	 * A timer, deliberately, and not a CSS fade on this overlay: in a backgrounded or non-compositing
	 * tab rAF and CSS animations stall (which is exactly why the loader drives its own spine off a
	 * timer — see `startHiddenDriver` there), and a stalled `from { opacity: 0 }` is an invisible
	 * modal. Timers still fire, throttled at worst.
	 */
	const SPLASH_HANDOVER_MS = 400;

	/**
	 * The guide opens ONCE per session, after the intro splash clears — not on mount. Mounting happens
	 * behind the splash (the whole game tree is built while it plays), so opening there would put the
	 * modal on screen underneath it and it would already be half-dismissed by the time the player saw
	 * anything.
	 *
	 * Guarded by its own flag rather than by `introLoaderComplete` alone: that flag stays true for the
	 * rest of the session, so without this the effect would re-open the guide every time anything else
	 * it reads changes.
	 */
	let autoOpened = false;
	$effect(() => {
		if (!stateGame.introLoaderComplete || autoOpened || isReplay) return;
		autoOpened = true;
		const timer = setTimeout(() => {
			stateGame.quickGuideOpen = true;
		}, SPLASH_HANDOVER_MS);
		return () => clearTimeout(timer);
	});

	/** Every open starts at page 1 — reopening from the menu shouldn't resume mid-walkthrough. */
	$effect(() => {
		if (stateGame.quickGuideOpen) return;
		pageIndex = 0;
	});

	function click() {
		context.eventEmitter.broadcast({ type: 'soundOnce', name: 'clickUIButton' });
	}

	function close() {
		if (!stateGame.quickGuideOpen) return;
		stateGame.quickGuideOpen = false;
		click();
	}

	/**
	 * "Click anywhere outside the modal to close" — decided by hit-testing the panel rather than by
	 * hanging a `stopPropagation` handler on it. The panel is not an interactive element, and the two
	 * things that legitimately sit on the backdrop (the game title above, the Click to Continue prompt
	 * below) are outside it, so they close the guide like the empty space around them does.
	 */
	function onBackdropClick(event: MouseEvent) {
		const target = event.target as Node | null;
		if (target && modalEl?.contains(target)) return;
		close();
	}

	function goBack() {
		if (isFirstPage) return;
		pageIndex -= 1;
		click();
	}

	function goNext() {
		if (isLastPage) return;
		pageIndex += 1;
		click();
	}

	/** Arrow keys page the guide; Escape closes it, like every other modal in the game. */
	function onKeydown(event: KeyboardEvent) {
		if (!stateGame.quickGuideOpen) return;
		if (event.key === 'Escape') {
			close();
		} else if (event.key === 'ArrowLeft') {
			goBack();
		} else if (event.key === 'ArrowRight') {
			goNext();
		} else {
			return;
		}
		event.preventDefault();
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#if stateGame.quickGuideOpen}
	<!-- The backdrop IS the dismiss target ("click anywhere outside the modal to close"), so the
	     "Click to Continue" line below is a label on that gesture rather than a control of its own. -->
	<div class="qg-backdrop" role="presentation" onclick={onBackdropClick}>
		<h2 class="qg-game-title">One Eyed Willy</h2>

		<!-- `container-type: size` + an explicit width/aspect make this the coordinate space for
		     everything inside: the interior is sized entirely in `cqw`, so the frame art, its type and
		     its controls stay one fixed design at every viewport instead of drifting apart. -->
		<div
			class="qg-modal"
			role="dialog"
			aria-modal="true"
			aria-label="Quick guide"
			style:background-image="url({staticUrl('img/quick_guide/quick_guide_container.webp')})"
			bind:this={modalEl}
		>
			<button type="button" class="qg-close" aria-label="Close" onclick={close}>X</button>

			<div class="qg-inner">
				<div class="qg-video">
					<!-- Keyed on the page so only the CURRENT loop is ever in the DOM. These are four 1080p
					     clips totalling ~78 MB; rendering all four (even paused) would have the browser
					     fetch every one of them the moment the guide opens. Deliberately absent from the
					     preload manifest for the same reason — see QUICK_GUIDE_VIDEO_PATHS. -->
					{#key pageIndex}
						<video
							class="qg-video-el"
							src={staticUrl(QUICK_GUIDE_VIDEO_PATHS[page.video])}
							autoplay
							loop
							muted
							playsinline
							preload="auto"
							disablepictureinpicture
							tabindex="-1"
						></video>
					{/key}
				</div>

				<h3 class="qg-title">{page.title}</h3>

				<p class="qg-content">{page.content}</p>

				<div class="qg-nav">
					<button
						type="button"
						class="qg-nav-btn qg-nav-btn--back"
						disabled={isFirstPage}
						onclick={goBack}
					>
						&lt;BACK
					</button>

					<span class="qg-nav-count">{pageIndex + 1}/{PAGES.length}</span>

					<button
						type="button"
						class="qg-nav-btn qg-nav-btn--next"
						disabled={isLastPage}
						onclick={goNext}
					>
						NEXT&gt;
					</button>
				</div>
			</div>
		</div>

		<p class="qg-continue">Click to Continue</p>
	</div>
{/if}

<style>
	.qg-backdrop {
		position: fixed;
		inset: 0;
		/* Above every other modal (InfoModal is 18000) — the guide is the first thing the player sees. */
		z-index: 18500;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2vh;
		padding: 2vh 2vw;
		box-sizing: border-box;
		background: rgba(0, 0, 0, 0.82);
	}

	/* Same face + gold as the Buy Plinko Bonus headline (BuyBonusModal `.bb-title`), one step larger:
	   this is the game's name, sitting above the panel rather than inside one. */
	.qg-game-title {
		margin: 0;
		font-family: 'PiecesOfEight', serif;
		font-weight: 400;
		font-size: clamp(calc(30 * var(--ui-px)), 6vw, calc(72 * var(--ui-px)));
		line-height: 1.1;
		letter-spacing: 0.02em;
		text-align: center;
		color: #f6c54a;
		text-shadow:
			0 0 calc(12 * var(--ui-px)) rgba(246, 168, 32, 0.65),
			0 calc(2 * var(--ui-px)) calc(2 * var(--ui-px)) rgba(0, 0, 0, 0.8);
	}

	.qg-modal {
		position: relative;
		/* The two knobs the portrait override below turns (see the note there). `--qg-type` multiplies
		   every interior size so the whole block of type scales together, and `--qg-video-width` trades
		   width in the video well for the vertical room that pays for it. */
		--qg-type: 1;
		--qg-video-width: 100%;
		/* Three caps, all binding somewhere: the vw term holds it inside a narrow portrait screen, the
		   --ui-px term keeps it from ballooning on a wide desktop, and the vh term is what saves Stake's
		   400x225 popout — at that frame the height, not the width, is what runs out. */
		width: min(90vw, calc(760 * var(--ui-px)), calc(72vh * 943 / 740));
		/* The frame art's own 943x740, so the corner ornaments and the riveted band never stretch. */
		aspect-ratio: 943 / 740;
		background-repeat: no-repeat;
		background-position: center;
		background-size: 100% 100%;
		/* Explicit size above, so size containment is safe — and it makes `cqw` inside resolve against
		   this panel's width (see `.qg-inner`). */
		container-type: size;
		container-name: quick-guide;
		filter: drop-shadow(0 calc(8 * var(--ui-px)) calc(24 * var(--ui-px)) rgba(0, 0, 0, 0.6));
	}

	/* Interior insets, as a fraction of the art: the frame band eats ~3% on each edge, and the copy
	   sits a little inside that again. */
	/*
	 * ⚠️ 'Instrument Sans' is a REQUIRED second step in every stack below, not decoration — and the
	 * order matters. Noto Sans contains no arrow glyphs (verified against Google's subsetter: it
	 * returns nothing for → ← ↑ ↓), and every page of copy in this guide is arrow-led
	 * ("Ball drops → multiplier pocket → win reacts"). Those characters therefore always come from the
	 * next face in the stack, so it has to be a deliberate one: Instrument Sans is the game's own UI
	 * grotesque and has them, which keeps the arrows a sibling of the words instead of whatever the
	 * device's default sans happens to be.
	 */
	.qg-inner {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 7.5% 6.4% 5.5%;
		box-sizing: border-box;
	}

	.qg-close {
		position: absolute;
		/* Inside the frame's top-right corner ornament, matching the reference. */
		top: 3.4%;
		right: 4.2%;
		z-index: 2;
		padding: 0 0.8cqw;
		border: none;
		background: none;
		cursor: pointer;
		font-family: 'Noto Sans', 'Instrument Sans', sans-serif;
		font-weight: 600;
		font-size: calc(3.4cqw * var(--qg-type));
		line-height: 1;
		color: #ffffff;
		text-shadow: 0 0.2cqw 0.4cqw rgba(0, 0, 0, 0.9);
		transition:
			transform 0.12s ease,
			color 0.12s ease;
	}

	.qg-close:hover {
		transform: scale(1.12);
		color: #f6c54a;
	}

	/* The looping-video well. Black, and sized to the clips' own 16:9 so nothing is cropped — the
	   reference's placeholder rectangle is flatter than the delivered footage. */
	.qg-video {
		width: var(--qg-video-width);
		aspect-ratio: 16 / 9;
		flex: 0 0 auto;
		overflow: hidden;
		background: #000000;
		box-shadow: inset 0 0 0 0.2cqw rgba(0, 0, 0, 0.9);
	}

	.qg-video-el {
		display: block;
		width: 100%;
		height: 100%;
		/* `cover` rather than `contain`: the well already matches the source aspect, so this only
		   guards against a re-delivered clip at a different ratio leaving bars inside the frame. */
		object-fit: cover;
	}

	.qg-title {
		margin: calc(3.2cqw * var(--qg-type)) 0 0;
		font-family: 'Noto Sans', 'Instrument Sans', sans-serif;
		font-weight: 600;
		font-size: calc(4.2cqw * var(--qg-type));
		line-height: 1.15;
		letter-spacing: 0.02em;
		text-align: center;
		text-transform: uppercase;
		color: #d4d0c4;
		text-shadow: 0 0.2cqw 0.5cqw rgba(0, 0, 0, 0.85);
	}

	/* Same face and colour as the title, a step down in size — the reference reads as one block of
	   type, not as a heading over a differently-styled paragraph. */
	.qg-content {
		margin: calc(1.6cqw * var(--qg-type)) 0 0;
		font-family: 'Noto Sans', 'Instrument Sans', sans-serif;
		font-weight: 400;
		font-size: calc(2.5cqw * var(--qg-type));
		line-height: 1.4;
		letter-spacing: 0.02em;
		text-align: center;
		text-transform: uppercase;
		color: #d4d0c4;
		text-shadow: 0 0.2cqw 0.5cqw rgba(0, 0, 0, 0.85);
	}

	.qg-nav {
		/* Pinned to the foot of the frame whatever the copy above runs to, so the row doesn't shift
		   between pages. */
		margin-top: auto;
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.qg-nav-btn,
	.qg-nav-count {
		font-family: 'Noto Sans', 'Instrument Sans', sans-serif;
		font-weight: 600;
		font-size: calc(2.6cqw * var(--qg-type));
		line-height: 1;
		letter-spacing: 0.04em;
		color: #d4d0c4;
		text-shadow: 0 0.2cqw 0.5cqw rgba(0, 0, 0, 0.85);
		white-space: nowrap;
	}

	.qg-nav-btn {
		padding: 1cqw 2cqw;
		border: none;
		background: none;
		cursor: pointer;
		transition:
			color 0.12s ease,
			opacity 0.12s ease;
	}

	.qg-nav-btn:hover:not(:disabled) {
		color: #ffffff;
	}

	/* Page 1 has no Back and page 4 no Next. Kept in the layout at low opacity rather than hidden, so
	   the counter stays centred and the row doesn't jump on the first and last pages. */
	.qg-nav-btn:disabled {
		cursor: default;
		opacity: 0.32;
	}

	/*
	 * PORTRAIT. The panel is width-bound here (90vw at 375 wide is a 338 px frame, against 528 px at the
	 * 1024x576 landscape reference), and a pure scale of the landscape design puts the body copy at
	 * ~8.4 px — well under the ~11 px the rest of the portrait UI treats as its readable floor (see the
	 * portrait note on `.bb-bet-row` in BuyBonusModal). Type is scaled up to clear that.
	 *
	 * The room is bought, not found: the landscape layout packs the frame to zero slack, so scaling the
	 * type alone would push the nav row through the bottom band. Narrowing the video well shortens it
	 * (it is 16:9, so width IS height) and hands the difference to the type below it. Portrait has
	 * width to spare and height to spare — it is the FRAME that has neither, which is why the trade
	 * happens inside it rather than by growing the panel.
	 *
	 * 1.3 is also the CEILING on the type: it puts the body copy at 11.0 px, and the longest line
	 * ("Ball drops → multiplier pocket → win reacts") then measures 274 px in a 294 px box. Much past
	 * this and it wraps.
	 *
	 * `max-aspect-ratio: 1/1` is height >= width, the same test `isPortraitGameLayout()` uses and the
	 * exact complement of the landscape query `--ui-px` is defined under (routes/+layout.svelte).
	 */
	@media (max-aspect-ratio: 1/1) {
		.qg-modal {
			--qg-type: 1.3;
			--qg-video-width: 84%;
		}
	}

	/* Same treatment as the bonus congratulations screen's "PRESS ANYWHERE…" line (BonusRoulette
	   `.bonus-announcement-hint`) — this is the same gesture prompt, so it reads the same. */
	.qg-continue {
		margin: 0;
		font-family: 'Perpetua', serif;
		font-size: clamp(calc(16 * var(--ui-px)), 3.2vw, calc(34 * var(--ui-px)));
		line-height: 1.1;
		letter-spacing: 0.03em;
		text-align: center;
		text-transform: uppercase;
		color: #f0ddaa;
		text-shadow: 0 calc(2 * var(--ui-px)) calc(7 * var(--ui-px)) rgba(0, 0, 0, 0.7);
	}
</style>
