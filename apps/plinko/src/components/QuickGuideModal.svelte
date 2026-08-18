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
		/** Parenthetical caveat under the copy. Omitted on the pages that carry no restriction. */
		note?: string;
		/** Index into QUICK_GUIDE_VIDEO_PATHS — the loop that plays in the frame above the copy. */
		video: number;
	};

	const PAGES: readonly QuickGuidePage[] = [
		{
			title: 'DROP & WIN',
			content:
				'Choose how many balls to drop and set your bet, then press Play. Each ball pays the multiplier of the pocket it lands in.',
			note: '(Note: Spin pockets and Golden pegs are only available with 10, 20 or 50 balls per drop.)',
			video: 0,
		},
		{
			title: 'FREE SPIN MULTIPLIER',
			content:
				'Balls that land in the center SPIN (0×) slot fill the Free Spin meter. When it fills, a wheel gives you an extra multiplier on your bet per ball amount.',
			note: '(Note: Only available with 10, 20 or 50 balls per drop.)',
			video: 1,
		},
		{
			title: 'BONUS PLAY FEATURE',
			content:
				'Balls that hit the 3 gold pegs fill the Bonus meter. When it fills, a wheel awards free balls and a chance to trigger multiple bonus levels.',
			note: '(Note: Only available with 10, 20 or 50 balls per drop.)',
			video: 2,
		},
		{
			title: 'LEVEL BONUSES',
			content:
				'During Free Play, hitting the golden coin pegs fills the bonus meter. Each time it fills, a new bonus level unlocks and gives more free balls.',
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
	 * hanging a `stopPropagation` handler on it. The panel is not an interactive element, and the one
	 * thing that legitimately sits on the backdrop (the logo above) is outside it, so it closes the
	 * guide like the empty space around it does.
	 *
	 * Hit-testing is also why the logo has to be `pointer-events: none`: it hangs down over the top of
	 * the panel, and without that the part lying on the frame would be a piece of backdrop sitting
	 * inside the panel's outline — a click there would close the guide while looking like a click on
	 * the panel. Transparent to the mouse, the event lands on whatever is actually underneath.
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
	<!-- The backdrop IS the dismiss target: a click anywhere off the panel closes the guide. It is
	     unlabelled — the "Click to Continue" line that used to name the gesture was removed — so the
	     X in the frame's corner is the only visible way out, and this is the discoverable one. -->
	<div class="qg-backdrop" role="presentation" onclick={onBackdropClick}>
		<!-- The game's logo art, in flow above the panel and then pulled back down over it (see
		     `.qg-title-art`). Ahead of the panel in the DOM, painted above it, and transparent to the
		     mouse so the overlapping part doesn't take clicks off the frame it is lying on. -->
		<img
			class="qg-title-art"
			src={staticUrl('img/quick_guide/quick_guide_title.webp')}
			alt="One-Eyed Willy Plinko"
		/>

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

				{#if page.note}
					<p class="qg-note">{page.note}</p>
				{/if}

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
		padding: 2vh 2vw;
		box-sizing: border-box;
		background: rgba(0, 0, 0, 0.82);

		/*
		 * The panel's width, hoisted to the backdrop because the logo above is sized AND positioned
		 * from it: the two are one design, and `cqw` cannot be used outside the panel it measures.
		 *
		 * Three caps, all binding somewhere: the vw term holds it inside a narrow portrait screen, the
		 * --ui-px term keeps it from ballooning on a wide desktop, and the vh term is what saves
		 * Stake's 400x225 popout — at that frame the height, not the width, is what runs out.
		 *
		 * The vh term reads 68 and not the 72 it was before the logo: that budget has to cover the
		 * panel AND the ~14.5% of a panel-width the logo stands proud of it, or a viewport the vh term
		 * binds on centres a block taller than itself and crops the top off the logo. It costs the
		 * panel ~6% of its width at those frames, which the interior absorbs by being sized in cqw.
		 *
		 * 68 was set while a "Click to Continue" line still sat under the panel and had to be paid for
		 * out of the same budget. That line is gone, so the block now leaves 19.5% of the height spare
		 * at every vh-bound frame alike — 70px top and bottom at 1280x720, 22px at the popout. The cap
		 * is deliberately NOT wound back up to spend it: the slack is doing no harm, and raising it
		 * would grow the panel and every piece of type inside it.
		 */
		--qg-panel-w: min(90vw, calc(760 * var(--ui-px)), calc(68vh * 943 / 740));
	}

	/*
	 * The game's name, as delivered logo art rather than as type — it sits above the panel and hangs
	 * down over it, which is the whole reason it is a sibling of the panel and not a child: a child
	 * would be laid out inside the frame, and the art is meant to break that outline.
	 *
	 * Sized off `--qg-panel-w` rather than off the viewport, so the logo and the panel stay one design
	 * at every frame. Both numbers below are fractions of the panel's WIDTH:
	 *
	 *   • 54% wide — 337px against a 624px panel at 1280x720, a shade narrower than the ~450px the
	 *     type it replaces ran to (against the 660px panel that frame allowed before the vh cap came
	 *     down to make room for the logo). Its own 615x273 gives the height, and it is never scaled
	 *     up: 54% of the 760px ceiling is 410px against a 615px asset.
	 *   • 9.5% of overlap, as a negative bottom margin, which is what puts it ON the video rather than
	 *     merely against the frame. The video's top edge is `.qg-inner`'s 6.6% top padding below the
	 *     panel's, so the last ~2.9% reaches past it — about 7% of the video's height, which is the
	 *     "just a little" the design asks for. The backdrop's flex `gap` was removed for this: gap is
	 *     added between margin boxes, so it would have to be subtracted back out here and the overlap
	 *     would read as a viewport unit minus a panel fraction.
	 *
	 * `z-index` because paint order alone would lose: the panel comes after the logo in the DOM and
	 * builds a stacking context of its own (it has a `filter`), so an unpositioned logo would be
	 * painted under the frame it is supposed to overlap.
	 */
	.qg-title-art {
		position: relative;
		z-index: 1;
		display: block;
		width: calc(var(--qg-panel-w) * 0.54);
		height: auto;
		margin-bottom: calc(var(--qg-panel-w) * -0.095);
		/* Lies over the panel — see the note on onBackdropClick for why it must not take the click. */
		pointer-events: none;
		/* The shadow the panel casts, so the logo reads as sitting above it rather than printed on it. */
		filter: drop-shadow(0 calc(6 * var(--ui-px)) calc(14 * var(--ui-px)) rgba(0, 0, 0, 0.7));
	}

	.qg-modal {
		position: relative;
		/* The two knobs the portrait override below turns (see the note there). `--qg-type` multiplies
		   every interior size so the whole block of type scales together, and `--qg-video-width` trades
		   width in the video well for the vertical room that pays for it.

		   The well is under 100% even in landscape: the copy is two lines plus a note line rather than
		   the single line this page used to carry, and the frame has no slack of its own — at 100% the
		   nav row is pushed ~37px through the bottom band. The well is 16:9, so width IS height; 82%
		   both clears that and leaves ~22px spare, which is the one extra line of note the longest
		   caveat would take if it ever wrapped. Everything inside the panel is sized in cqw or in %, so
		   this ratio holds identically at every landscape size, from a 1280x720 desktop down to the
		   400x225 popout. */
		--qg-type: 1;
		--qg-video-width: 82%;
		/* Set on the backdrop, which sizes the logo above from it too — see the note there. */
		width: var(--qg-panel-w);
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
	 * order matters. Noto Sans is installed here as Google's two LATIN subsets only, and the face
	 * carries no arrow glyphs in any case (verified against Google's subsetter: it returns nothing for
	 * → ← ↑ ↓). Whatever the subsets do not cover falls through to the next face in the stack, so that
	 * face has to be a deliberate one: Instrument Sans is the game's own UI grotesque and does carry
	 * them, which keeps a stray glyph a sibling of the words around it instead of whatever the device's
	 * default sans happens to be. The copy on this page is plain Latin as it stands — the × in
	 * "SPIN (0×)" is U+00D7, inside the latin subset's own U+0000-00FF range — so the fallback is
	 * insurance here rather than load-bearing. It was load-bearing when these pages were arrow-led, and
	 * would be again the moment a page reaches past Latin.
	 */
	.qg-inner {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 6.6% 6% 5.2%;
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
		margin: calc(2.6cqw * var(--qg-type)) 0 0;
		font-family: 'Noto Sans', 'Instrument Sans', sans-serif;
		font-weight: 600;
		font-size: calc(3.6cqw * var(--qg-type));
		line-height: 1.1;
		letter-spacing: 0.02em;
		text-align: center;
		text-transform: uppercase;
		color: #d4d0c4;
		text-shadow: 0 0.2cqw 0.5cqw rgba(0, 0, 0, 0.85);
	}

	/* Same face and colour as the title, a step down in size — the panel reads as one block of type,
	   not as a heading over a differently-styled paragraph.

	   Sentence case, where the title is still uppercased: these are sentences now rather than the
	   two-beat labels this page carried before. Caps are ~15% wider per character, which on a
	   150-character line is a whole extra row inside a frame that has none to give, and they shout a
	   parenthetical caveat as loudly as the instruction it qualifies. */
	.qg-content {
		margin: calc(1.4cqw * var(--qg-type)) 0 0;
		font-family: 'Noto Sans', 'Instrument Sans', sans-serif;
		font-weight: 400;
		font-size: calc(2.5cqw * var(--qg-type));
		line-height: 1.35;
		letter-spacing: 0.01em;
		text-align: center;
		color: #d4d0c4;
		text-shadow: 0 0.2cqw 0.5cqw rgba(0, 0, 0, 0.85);
	}

	/* The "(Note: … only available with 10, 20 or 50 balls per drop)" line. Smaller and dimmer than
	   the copy above it, because it qualifies that copy rather than continuing it — a player who is
	   dropping 10+ balls never needs to read it. */
	.qg-note {
		margin: calc(1.2cqw * var(--qg-type)) 0 0;
		font-family: 'Noto Sans', 'Instrument Sans', sans-serif;
		font-weight: 400;
		font-size: calc(2cqw * var(--qg-type));
		line-height: 1.3;
		letter-spacing: 0.01em;
		text-align: center;
		color: #a8a293;
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
		padding: 0.8cqw 2cqw;
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
	 * 1.3 puts the body copy at 11.0 px, which is the floor exactly — and it is now a floor the height
	 * has to be argued down to rather than a ceiling the width imposes. At a 338 px panel the copy
	 * wraps to three lines and the longest caveat to two whatever this is set to, so the type cannot be
	 * paid for out of the measure; the well pays, and 54% is what leaves the nav row clear with about
	 * one spare note line in hand. That is a 160 px-wide clip, deliberately: text that overflows the
	 * frame is broken, where a small clip is only small.
	 *
	 * `max-aspect-ratio: 1/1` is height >= width, the same test `isPortraitGameLayout()` uses and the
	 * exact complement of the landscape query `--ui-px` is defined under (routes/+layout.svelte).
	 */
	@media (max-aspect-ratio: 1/1) {
		.qg-modal {
			--qg-type: 1.3;
			--qg-video-width: 54%;
		}
	}
</style>
