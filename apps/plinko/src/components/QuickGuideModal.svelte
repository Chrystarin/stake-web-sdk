<script lang="ts">
	import { stateUrlDerived } from 'state-shared';

	import { innerHeight, innerWidth } from 'svelte/reactivity/window';

	import { getContext } from '../game/context';
	import { stateGame } from '../game/stateGame.svelte';
	import {
		fillQuickGuideVideoBuffer,
		getQuickGuideVideo,
		isPortraitQuickGuide,
		releaseQuickGuideVideos,
	} from '../lib/preloadAssets';
	import { staticUrl } from '../lib/staticUrl';

	const context = getContext();

	type QuickGuidePage = {
		title: string;
		/**
		 * The body copy, ONE ENTRY PER LINE ON SCREEN. The breaks are the copy's own — each line is a
		 * beat, and they are set as written rather than left to reflow into a block (see `.qg-content`
		 * for how they are rendered, and `--qg-copy-w` for the measure that keeps each one unwrapped).
		 */
		content: readonly string[];
		/** Italic caveat under the copy. Omitted on the pages that carry no restriction. */
		note?: string;
		/** Index into QUICK_GUIDE_VIDEO_PATHS — the loop that plays in the frame above the copy. */
		video: number;
	};

	const PAGES: readonly QuickGuidePage[] = [
		{
			title: 'DROP & WIN',
			content: [
				'Choose your balls. Set your bet. Hit Play!',
				'Watch them drop! Each ball wins the multiplier it lands on.',
			],
			note: 'Drop 10, 20, or 50 balls to activate Spin Pockets and Gold Coins',
			video: 0,
		},
		{
			title: 'FREE SPIN MULTIPLIER',
			content: [
				'Land balls in the center SPIN (0) pocket to fill the Free Spin meter.',
				'Fill the meter to spin the Free Spin Wheel for an extra multiplier or a chance to trigger the Bonus Round!',
			],
			note: 'Available with 10, 20, or 50-ball drops only',
			video: 1,
		},
		{
			title: 'BONUS PLAY FEATURE',
			content: [
				'Hit a Gold Coin to fill the Bonus Meter.',
				'Fill it to spin the Bonus Wheel for Free Balls and the chance to unlock more bonus levels!',
			],
			note: 'Available with 10, 20, or 50-ball drops only',
			video: 2,
		},
		{
			title: 'LEVEL BONUSES',
			content: [
				'Hit Gold Coins during the Bonus Round to fill the Bonus Meter.',
				'Fill it to unlock the next bonus level and win more Free Balls!',
			],
			video: 3,
		},
	];

	/** Replay is passive playback with no player to dismiss anything — never put a modal in its way. */
	const isReplay = $derived(stateUrlDerived.replay());

	/**
	 * Which frame the stylesheet is showing, read reactively so the WELL can follow it.
	 *
	 * The two frames run different cuts of the same four clips — 16:9 in landscape, 586x960 in the
	 * mobile frame (see QUICK_GUIDE_VIDEO_PATHS_PORTRAIT) — so a rotation has to swap the whole set,
	 * not just the art behind it. `isPortraitQuickGuide` is the media query the `@media` block at the
	 * foot of this stylesheet uses, restated in JS; the window dimensions are read purely to make this
	 * re-evaluate, the way Background.svelte tracks the layout it shares with Game.svelte.
	 *
	 * Deliberately NOT `isPortraitGameLayout`: that predicate gates on touch and a 820px width cap as
	 * well as the aspect, so a 900x1000 desktop window is portrait to the frame and landscape to it —
	 * which would put a 16:9 clip in the mobile frame's 0.61 well. See the note on isPortraitQuickGuide.
	 */
	const isPortrait = $derived.by(() => {
		innerWidth.current;
		innerHeight.current;
		return isPortraitQuickGuide();
	});

	let pageIndex = $state(0);
	let modalEl = $state<HTMLElement | undefined>(undefined);
	let videoWell = $state<HTMLElement | undefined>(undefined);

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

	/**
	 * Every open starts at page 1 — reopening from the menu shouldn't resume mid-walkthrough. The clips
	 * are not touched here: the well's own effect parks them when the markup goes (see below), and this
	 * running first is what lets that effect open on page 1 without having to read `pageIndex`.
	 */
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

	/**
	 * ── THE VIDEO WELL ───────────────────────────────────────────────────────────────────────────
	 * The four clips are NOT created here, and the well is empty in the markup. They are created and
	 * warmed behind the intro splash (`getQuickGuideVideo` in preloadAssets.ts) and this well ADOPTS
	 * them: `appendChild` MOVES a node, and a moved `<video>` keeps everything it had — its buffer, its
	 * `readyState`, its decoded frame.
	 *
	 * That is aimed at a DECODE hole rather than a download one, which is the part worth remembering.
	 * Standing up a `<video>` and handing it a `src` leaves a gap of one to several frames in which it
	 * has nothing to paint, and this well is `#000` behind it — so the guide opened on a black
	 * rectangle and every page turn flashed one, however warm the bytes were. (It used to run two
	 * elements and wait on `loadeddata` before starting each dissolve, which hid the flash on page
	 * turns but could do nothing about the one on open, since there was no earlier element to hold.) An
	 * element that already holds a frame has no gap to hide, in either case — so the wait, its timeout
	 * and the slot bookkeeping are all gone with it.
	 *
	 * All four live here at once, one visible at a time, and only the visible one is PLAYING. Four idle
	 * decode pipelines is what mounting all four would otherwise cost; pausing is what buys it back,
	 * and a paused element keeps showing its current frame, so nothing goes black to save the work.
	 */

	/**
	 * Marks the clip in front. Added here rather than baked into the element by the preload: this is
	 * the modal's styling contract and preloadAssets.ts owns only the media. Same reason `qg-video-el`
	 * is applied on adoption — and why both are `:global` in the stylesheet, since an element built in
	 * JS never gets Svelte's scoping attribute.
	 */
	const ON_CLASS = 'qg-video-el--on';

	/**
	 * How long the dissolve takes, in ms. Mirrors `--qg-video-fade` in the stylesheet — keep the two in
	 * step. JS reads it for exactly one reason: the outgoing clip is held at full opacity for the
	 * length of the fade (see the note on `.qg-video-el`), so it cannot be paused until that is over
	 * without visibly freezing underneath the incoming one.
	 */
	const VIDEO_FADE_MS = 260;

	/** The clip in front, or undefined before the first one is shown. Plain `let` — nothing renders
	    off it, and an effect that tracked it would re-run itself every page turn. */
	let shownVideo: number | undefined;
	let pauseTimer: ReturnType<typeof setTimeout> | undefined;

	/** Bring `video` to the front, dissolving off whatever is already there. */
	function showVideo(video: number) {
		const incoming = getQuickGuideVideo(video);
		if (!incoming) return;
		clearTimeout(pauseTimer);
		pauseTimer = undefined;

		const previous = shownVideo;
		shownVideo = video;
		incoming.classList.add(ON_CLASS);
		/* Muted and playsinline, so no gesture is required; a rejection here is a browser refusing
		   anyway, and there is nothing useful left to do about it. */
		void incoming.play().catch(() => undefined);
		/* This clip's body and the next page's — one page ahead of the player, so the clip on screen
		   never shares the connection with three it is not showing. See fillQuickGuideVideoBuffer. */
		fillQuickGuideVideoBuffer(video);
		fillQuickGuideVideoBuffer(video + 1);

		if (previous === undefined || previous === video) return;
		const outgoing = getQuickGuideVideo(previous);
		if (!outgoing) return;
		outgoing.classList.remove(ON_CLASS);
		pauseTimer = setTimeout(() => {
			outgoing.pause();
			outgoing.currentTime = 0;
		}, VIDEO_FADE_MS);
	}

	/**
	 * Adopt the warmed clips for as long as the guide is open, and hand them back when it closes so
	 * they keep their buffers for a reopen from the menu instead of going down with the markup.
	 *
	 * Keyed on the well and on the ORIENTATION. Page turns call {@link showVideo} directly (as the old
	 * cross-fade did) rather than being driven from here, because an effect that read `pageIndex` would
	 * re-run this whole adoption on every turn. Opening on page 1 needs no read either — the reset
	 * effect above has already put `pageIndex` back to 0 by the time the markup exists.
	 *
	 * The orientation IS read, because it changes which four elements exist: rotating swaps the frame
	 * and with it the cut of the clips, so the set on screen has to be handed back and the other one
	 * adopted. Re-running lands on page 1, which is the one thing a rotation costs — acceptable against
	 * a well showing 16:9 footage inside a portrait frame, and rotating mid-guide is rare.
	 */
	$effect(() => {
		const well = videoWell;
		// Read, not used: this is what makes a rotation re-run the adoption below. `getQuickGuideVideo`
		// resolves the cut itself, off the same media query.
		isPortrait;
		if (!well) return;
		// The elements are REMEMBERED rather than looked up again in the cleanup. On a rotation the
		// cleanup runs after the media query has already flipped, so `getQuickGuideVideo` would hand
		// back the INCOMING cut and this would strip the on-class off the clip about to be shown while
		// leaving it on the one being handed back. The list adopted is the list to undo.
		const adopted: HTMLVideoElement[] = [];
		for (const { video } of PAGES) {
			const el = getQuickGuideVideo(video);
			if (!el) continue;
			el.classList.add('qg-video-el');
			well.appendChild(el);
			adopted.push(el);
		}
		showVideo(PAGES[0].video);
		return () => {
			clearTimeout(pauseTimer);
			pauseTimer = undefined;
			shownVideo = undefined;
			for (const el of adopted) el.classList.remove(ON_CLASS);
			releaseQuickGuideVideos();
		};
	});

	function goBack() {
		if (isFirstPage) return;
		pageIndex -= 1;
		showVideo(PAGES[pageIndex].video);
		click();
	}

	function goNext() {
		if (isLastPage) return;
		pageIndex += 1;
		showVideo(PAGES[pageIndex].video);
		click();
	}

	/**
	 * Arrow keys page the guide; Escape closes it, like every other modal in the game.
	 *
	 * ArrowRight follows the right-hand button rather than merely paging: on the last page that button
	 * is DONE, so the key that has been pressing it all the way through closes the guide too.
	 */
	function onKeydown(event: KeyboardEvent) {
		if (!stateGame.quickGuideOpen) return;
		if (event.key === 'Escape') {
			close();
		} else if (event.key === 'ArrowLeft') {
			goBack();
		} else if (event.key === 'ArrowRight') {
			if (isLastPage) close();
			else goNext();
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
		     its controls stay one fixed design at every viewport instead of drifting apart.

		     BOTH frames are handed over as custom properties and the stylesheet picks between them,
		     rather than JS choosing one: orientation is a media query, and a value computed here would
		     have to be re-computed on every resize and rotate to keep up with the rest of the layout
		     (which is all media-query driven). The URLs have to come from JS either way — `staticUrl`
		     is what resolves them to the preloaded `blob:` handles. -->
		<div
			class="qg-modal"
			role="dialog"
			aria-modal="true"
			aria-label="Quick guide"
			style:--qg-frame-wide="url({staticUrl('img/quick_guide/quick_guide_container_wide.webp')})"
			style:--qg-frame-mobile="url({staticUrl(
				'img/quick_guide/quick_guide_container_mobile.webp',
			)})"
			bind:this={modalEl}
		>
			<button type="button" class="qg-close" aria-label="Close" onclick={close}>X</button>

			<div class="qg-inner">
				<!-- Deliberately empty. The four clips are created and warmed behind the intro splash and
				     MOVED in here when the guide opens — see the video-well note in the script for why the
				     element has to be the same one, and QUICK_GUIDE_VIDEO_PATHS for why the bytes cannot
				     simply be preloaded and handed to a fresh `<video>` under Stake's CSP. -->
				<div class="qg-video" bind:this={videoWell}></div>

				<h3 class="qg-title">{page.title}</h3>

				<!-- One <span> a line, not one <p> a line: the lines are one paragraph that happens to
				     carry its own breaks, so they share a line-height and nothing sits between them. -->
				<p class="qg-content">
					{#each page.content as line}
						<span class="qg-content-line">{line}</span>
					{/each}
				</p>

				{#if page.note}
					<p class="qg-note">{page.note}</p>
				{/if}

				<div class="qg-nav">
					<!-- The wooden plate is a background rather than an <img> behind the label: it is
					     decoration on a control, so it should never be a hit target or a node of its own. -->
					<button
						type="button"
						class="qg-nav-btn qg-nav-btn--back"
						style:background-image="url({staticUrl(
							'img/quick_guide/quick_guide_button_container.webp',
						)})"
						disabled={isFirstPage}
						onclick={goBack}
					>
						<span class="qg-nav-label">BACK</span>
					</button>

					<span class="qg-nav-count">{pageIndex + 1}/{PAGES.length}</span>

					<button
						type="button"
						class="qg-nav-btn qg-nav-btn--next"
						style:background-image="url({staticUrl(
							'img/quick_guide/quick_guide_button_container.webp',
						)})"
						onclick={isLastPage ? close : goNext}
					>
						<span class="qg-nav-label">{isLastPage ? 'DONE' : 'NEXT'}</span>
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
		 * Three caps, all binding somewhere: the vw term holds it inside a narrow screen, the --ui-px
		 * term keeps it from ballooning on a wide desktop, and the vh term is what saves Stake's
		 * 400x225 popout — at that frame the height, not the width, is what runs out.
		 *
		 * ⚠️ The vh term carries the FRAME'S ASPECT, so it has to be restated wherever the frame
		 * changes: it is really "panel height <= N vh", written as a width. Landscape runs the 1311x735
		 * wide frame, portrait the 1641x2794 mobile one, and the portrait override below restates both
		 * this and the aspect together — in its own form, because at that frame's 0.587 the logo is too
		 * tall a share of the block to leave out of the budget. Change one without the other and the
		 * panel silently stops obeying the height cap.
		 *
		 * 68vh, not the 100 an unobstructed panel could take: the budget has to cover the panel AND the
		 * part of the logo that stands proud of it, or a viewport the vh term binds on centres a block
		 * taller than itself and crops the top off the logo. At 1280x720 the whole block — logo through
		 * panel — measures 564px of the 720, clearing 78px above and below.
		 *
		 * The vw and --ui-px terms moved out with the frame: 94vw because the wide frame is short
		 * enough that a wide-but-short window has width to give, and 1000px because that is where the
		 * 1311px asset would start being upscaled if the vh term ever stopped binding.
		 */
		--qg-panel-w: calc(
			min(94vw, calc(1000 * var(--ui-px)), calc(68vh * 1311 / 735)) * var(--qg-panel-scale)
		);

		/* On the BACKDROP, not on the panel, even though they describe the logo's relationship to the
		   panel: the logo is the panel's sibling, and a custom property set on the panel would not
		   reach it. See `.qg-title-art` for what the two numbers mean. */
		--qg-logo-w: 0.35;
		--qg-logo-overlap: 0.07;

		/* The logo's share of the tuning layer — see the block on `.qg-modal`. Here because the logo
		   cannot read the panel's properties, and in the panel's own unit: the offsets are a % of the
		   PANEL's width, not of the logo's, so nudging the logo and nudging the copy mean the same
		   thing. (`cqw` would not work here — outside the panel there is no container to measure.) */
		/* 0.99, not the 1.1 the old logo ran at: the art delivered with the hat is 1.88:1 where the
		   one before it was 2.25:1, so at an unchanged width it stands ~20% taller and the block it
		   makes with the panel grew past what the 68vh budget leaves. See the note on `--qg-panel-w`
		   for what runs out first — the logo's own top edge, at 1280x720 and in the 400x225 popout. */
		--qg-logo-scale: 1.15;
		--qg-logo-x: 0;
		--qg-logo-y: -3.5;

		/*
		 * ── THE MODAL AS A WHOLE ─────────────────────────────────────────────────────────────────
		 * The panel and the logo over it, sized and moved as one thing. Also here rather than on the
		 * panel, for the same reason as the logo's: they are siblings.
		 *
		 * `--qg-panel-scale` multiplies `--qg-panel-w`, which is the width EVERYTHING derives from —
		 * the panel's own width, the logo's, the logo's overlap, and every `cqw` inside the frame. So
		 * it scales the whole design coherently, type included, exactly as if the viewport had handed
		 * the panel more room. What it does NOT do is respect the vh budget: the caps in
		 * `--qg-panel-w` are computed first and this multiplies the result, so somewhere past ~1.2 the
		 * block starts to outgrow the viewport those caps fitted it to (see the note there).
		 *
		 * `--qg-modal-x` / `--qg-modal-y` translate the panel and the logo together, in the same
		 * percent-of-panel-width unit as every other offset. The logo's own `--qg-logo-x` / `-y` ADD
		 * to these rather than replacing them, so the pair stays together when the modal moves.
		 */
		--qg-panel-scale: 1;
		--qg-modal-x: 0;
		--qg-modal-y: -2;
	}

	/*
	 * The game's name, as delivered logo art rather than as type — it sits above the panel and hangs
	 * down over it, which is the whole reason it is a sibling of the panel and not a child: a child
	 * would be laid out inside the frame, and the art is meant to break that outline.
	 *
	 * Sized off `--qg-panel-w` rather than off the viewport, so the logo and the panel stay one design
	 * at every frame. Both knobs are fractions of the panel's WIDTH, and both are restated in the
	 * portrait block — the two frames are different enough shapes that one pair cannot serve both:
	 *
	 *   • `--qg-logo-w`. 35% against the wide frame, 65.85% against the mobile one — the same logo at
	 *     roughly the same size on screen either way. It is the PANEL that changes width between them,
	 *     not the artwork's proper size. Never upscaled: 35% of the 1000px panel ceiling is 350px
	 *     against a 1000px asset.
	 *   • `--qg-logo-overlap`, as a negative bottom margin, which is what puts the logo ON the video
	 *     rather than merely against the frame. It has to clear `.qg-inner`'s top padding to reach the
	 *     video at all, so read it as that inset plus the bite: 7% over a 4.5% inset lands 22px onto a
	 *     216px clip in landscape. In portrait the mobile comp draws the two only just touching —
	 *     6.63% over a 7.86% inset, so the logo stops a hair SHORT of the well and lands on the frame's
	 *     top band instead of on the footage. The
	 *     backdrop's flex `gap` was removed for this: gap is added between margin boxes, so it would
	 *     have to be subtracted back out here and the overlap would read as a viewport unit minus a
	 *     panel fraction.
	 *
	 * `z-index` because paint order alone would lose: the panel comes after the logo in the DOM and
	 * builds a stacking context of its own (it has a `filter`), so an unpositioned logo would be
	 * painted under the frame it is supposed to overlap.
	 */
	.qg-title-art {
		position: relative;
		z-index: 1;
		display: block;
		flex: 0 0 auto;
		width: calc(var(--qg-panel-w) * var(--qg-logo-w) * var(--qg-logo-scale));
		height: auto;
		margin-bottom: calc(var(--qg-panel-w) * var(--qg-logo-overlap) * -1);
		/* The modal's offset plus the logo's own, so moving the modal takes the logo with it. */
		transform: translate(
			calc(var(--qg-panel-w) * (var(--qg-modal-x) + var(--qg-logo-x)) / 100),
			calc(var(--qg-panel-w) * (var(--qg-modal-y) + var(--qg-logo-y)) / 100)
		);
		/* Lies over the panel — see the note on onBackdropClick for why it must not take the click. */
		pointer-events: none;
		/* The shadow the panel casts, so the logo reads as sitting above it rather than printed on it. */
		filter: drop-shadow(0 calc(6 * var(--ui-px)) calc(14 * var(--ui-px)) rgba(0, 0, 0, 0.7));
	}

	.qg-modal {
		position: relative;
		/*
		 * ── THE KNOBS ────────────────────────────────────────────────────────────────────────────
		 * Everything inside the panel is sized in `cqw` (1% of the panel's own width) or in %, so the
		 * interior is one fixed design that holds at every size the frame is allowed to take — from a
		 * 1280x720 desktop down to Stake's 400x225 popout. These are the values that design is written
		 * in, and the portrait block at the foot of this stylesheet restates the ones that have to
		 * change for the taller frame.
		 *
		 * `--qg-type` multiplies every piece of type at once, so the block scales together rather than
		 * drifting apart. It is 1 here by definition: the landscape sizes below ARE the design.
		 *
		 * `--qg-video-width` is the frame's shock absorber, and the only knob that gives. The well is
		 * 16:9, so width IS height, and everything else in the column is either type (which has a
		 * readable floor) or the plates (which are art). When the copy runs long or the row grows, the
		 * well is what pays. At 44% it is 354px against an 873px panel at 1280x720, and it leaves 23px
		 * under the longest page — a spare line (21.8px), so copy that wraps one further than today's
		 * still clears the strip the nav row sits in.
		 *
		 * It was 48% while the copy was set in sentence case. Uppercasing it took the longest page from
		 * two lines to three, and this is where that line was paid for.
		 */
		--qg-type: 1;
		--qg-video-width: 44%;
		--qg-video-aspect: 16 / 9;
		--qg-plate-w: calc(10.8cqw * var(--qg-type));
		/*
		 * The FLOW spacing down the column — well → title → copy → note. Knobs rather than literals in
		 * the rules because the two orientations set them independently: landscape's are a multiple of
		 * `--qg-type` (the design was drawn that way), the mobile frame's are measured straight off the
		 * comp, where the type grew more than the gaps between it did.
		 *
		 * These MOVE the column; the `-y` knobs in the tuning layer below only move the painted box. Use
		 * these to change what follows an element, and those to nudge one element alone.
		 */
		--qg-gap-title: calc(3cqw * var(--qg-type));
		--qg-gap-copy: calc(1.2cqw * var(--qg-type));
		--qg-gap-note: calc(1cqw * var(--qg-type));
		/*
		 * The interior inset, as three values rather than a shorthand, and in `cqw` rather than %:
		 * the nav row positions itself off the same numbers (see `.qg-nav`), and for an absolutely
		 * positioned box `bottom: 4%` would mean 4% of the container's HEIGHT where `padding: 4%`
		 * means 4% of its WIDTH. 1cqw is 1% of the panel's width whichever property reads it, so the
		 * inset stays one number in one unit.
		 */
		--qg-pad-top: 4.5cqw;
		--qg-pad-x: 4cqw;
		--qg-pad-bottom: 4cqw;
		/*
		 * How wide the copy is allowed to run, which is NOT how wide the frame is. Left to fill the
		 * wide frame the body copy sets ~100 characters to the line — past twice the measure prose is
		 * comfortable at, and the reason this is a knob rather than the default: the frame got wider to
		 * hold a wider VIDEO, and the copy under it should not be dragged along.
		 *
		 * It is NOT a measure chosen for prose — the copy carries its own line breaks now (see
		 * `content` in the script), so what this number has to do is fit the longest authored LINE,
		 * and that is page 2's "Fill the meter to spin the Free Spin Wheel for an extra multiplier or
		 * a chance to trigger the Bonus Round!" at ~92.2cqw measured against the real Noto Sans font —
		 * past even the 92cqw ceiling (the interior, less `--qg-pad-x` at each side), so the ceiling
		 * alone cannot fit it; `--qg-copy-scale` below is what closes the last ~6px. Below that this
		 * line wraps and the page runs three rows deep; there is no slack under the copy for a third
		 * row — see the clearance arithmetic on `--qg-note-y`.
		 *
		 * 92cqw IS the ceiling, so there is no spare left under it any more — a line longer than
		 * today's will need `--qg-copy-scale` taken down further, or the frame's `--qg-pad-x` eaten
		 * into, since this knob is already maxed.
		 *
		 * Every page is two rows here, and every note one, which is what the vertical design assumes.
		 *
		 * Portrait restates it at 100%: at a 352px panel the frame is already narrower than the longest
		 * line is, so the lines there wrap inside their authored breaks and capping it would only
		 * starve them further.
		 */
		--qg-copy-w: 92cqw;

		/*
		 * ── THE TUNING LAYER ─────────────────────────────────────────────────────────────────────
		 * A scale and an offset per element, on top of the design above. Every one of them is neutral
		 * as it stands (1 and 0), so the layout is exactly what the knobs above describe; these are
		 * here to be turned, one element at a time, without touching the design's own numbers.
		 *
		 * ⚠️ Restated in full in the portrait block, deliberately — the two orientations run different
		 * frames and a nudge that helps one is meaningless in the other. Set them per orientation.
		 *
		 * • `-scale` multiplies that element's OWN size: the video's width, the type's font-size, the
		 *   plate for a nav button. It is a real size change, so the column reflows around it — which
		 *   is the point, the frame stays coherent, but it does mean scaling the video up eats the
		 *   slack under the copy that the `gap` numbers quoted through this file are measuring.
		 *
		 *   The nav row is the exception, deliberately: it is positioned against the frame rather than
		 *   laid out in the column (see `.qg-nav`), so nothing the copy or the note does can move it.
		 *   Scaling the PLATES does change the strip the copy stops at, because that strip is sized
		 *   from them; scaling the COUNTER changes nothing but the counter.
		 *
		 * • `-x` / `-y` offset it, in PERCENT OF THE PANEL'S WIDTH, positive right and down. These are
		 *   transforms: purely visual, no reflow, nothing else moves. Which makes them the right tool
		 *   for a nudge and the wrong one for anything large — push far enough and elements overlap,
		 *   because nothing is being told to make room.
		 *
		 * One unit for the offsets, both axes, both orientations: 1 = 1% of the panel's width (8.7px
		 * at 1280x720, 3.5px at 375x812). Not of each element's own size, and not of the height for
		 * `-y` — so a given number is the same distance on screen whichever knob it is turning.
		 *
		 * The nav row has three sets, and they stack: `--qg-nav-*` moves the whole row, `--qg-btn-*`
		 * and `--qg-count-*` move the plates and the counter within it. Place the row with the first,
		 * adjust one part against the other with the other two.
		 *
		 * ⚠️ `--qg-panel-scale` and `--qg-modal-*` are NOT here. They sit on `.qg-backdrop` with the
		 * logo's knobs, because they size and move the panel and the logo TOGETHER, and the logo
		 * cannot read anything set on the panel.
		 */
		--qg-video-scale: 1.4;
		--qg-video-x: 0;
		--qg-video-y: -2.5;
		--qg-title-scale: 1;
		--qg-title-x: 0;
		--qg-title-y: -4;
		/* 0.98, not the neutral 1: `--qg-copy-w` above is already at its 92cqw ceiling and page 2's
		   longest line still measures ~6px past it at full size (against the real Noto Sans font, at
		   1280x720) — a 2% reduction is what buys back that last sliver, invisibly, without eating into
		   `--qg-pad-x` and the frame-band clearance it protects. Applies to every page's body copy, not
		   just page 2's, since this is the shared knob — harmless, the other lines all have slack. */
		--qg-copy-scale: 0.98;
		--qg-copy-x: 0;
		--qg-copy-y: -4;
		--qg-note-scale: 1;
		--qg-note-x: 0;
		/*
		 * ⚠️ Load-bearing, and there is no slack under it: the note's last line lands ~0.04cqw under
		 * the page counter's line box, so the two boxes touch and only the note's half-leading keeps
		 * the glyphs apart. Anything that makes the note taller — a larger size, a looser line-height,
		 * a second line — has to be lifted back out of here by exactly what it gained, or it lands in
		 * the counter. (It ran at the copy's 1.85cqw/1.35 for a stretch, which cost 0.5475cqw a line
		 * and needed -3.55 here to stay clear of it.)
		 */
		--qg-note-y: -3;
		--qg-nav-x: 0;
		--qg-nav-y: -3;
		--qg-btn-scale: 1;
		--qg-btn-x: 0;
		--qg-btn-y: 8;
		--qg-count-scale: 1;
		--qg-count-x: 0;
		--qg-count-y: 6;
		--qg-close-scale: 1;
		--qg-close-x: 2.5;
		--qg-close-y: 0;

		/* Set on the backdrop, which sizes the logo above from it too — see the note there. */
		width: var(--qg-panel-w);
		/* Never shrunk to fit: the frame's aspect is the art's, and `--qg-panel-w`'s vh term is what
		   keeps the block inside the viewport. Flex squashing it instead would stretch the ornaments. */
		flex: 0 0 auto;
		/* The same offset the logo carries, so the two move as one modal. */
		transform: translate(
			calc(var(--qg-panel-w) * var(--qg-modal-x) / 100),
			calc(var(--qg-panel-w) * var(--qg-modal-y) / 100)
		);
		/* The wide frame's own 1311x735, so the corner ornaments and the riveted band never stretch.
		   ⚠️ Restated in the portrait block together with the art and the vh term of --qg-panel-w —
		   those three describe one frame and cannot be changed apart. */
		aspect-ratio: 1311 / 735;
		background-image: var(--qg-frame-wide);
		background-repeat: no-repeat;
		background-position: center;
		background-size: 100% 100%;
		/* Explicit size above, so size containment is safe — and it makes `cqw` inside resolve against
		   this panel's width (see `.qg-inner`). */
		container-type: size;
		container-name: quick-guide;
		filter: drop-shadow(0 calc(8 * var(--ui-px)) calc(24 * var(--ui-px)) rgba(0, 0, 0, 0.6));
	}

	/* Interior insets, from the `--qg-pad-*` trio. They are `cqw` — 1% of the panel's WIDTH — on every
	   side, top and bottom included, so the inset is a fixed fraction of the design rather than
	   something that moves with the frame's aspect, and so the nav row can position itself off the same
	   numbers (see `.qg-nav`). The wide frame's band is ~2.3% of its width; the rest is breathing room
	   between the wood and the copy. */
	/*
	 * ⚠️ 'Instrument Sans' is a REQUIRED second step in every stack below, not decoration — and the
	 * order matters. Noto Sans is installed here as Google's two LATIN subsets only, and the face
	 * carries no arrow glyphs in any case (verified against Google's subsetter: it returns nothing for
	 * → ← ↑ ↓). Whatever the subsets do not cover falls through to the next face in the stack, so that
	 * face has to be a deliberate one: Instrument Sans is the game's own UI grotesque and does carry
	 * them, which keeps a stray glyph a sibling of the words around it instead of whatever the device's
	 * default sans happens to be. The copy on these pages is plain ASCII as it stands, so the fallback
	 * is insurance here rather than load-bearing. It was load-bearing when these pages were arrow-led,
	 * and would be again the moment a page reaches past Latin.
	 */
	.qg-inner {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		/*
		 * The bottom inset reserves the nav row's band as well as the frame's own margin. The row is
		 * NOT in this column any more (see `.qg-nav`), so nothing else would keep the copy off it:
		 * this padding is what the column stops at, and the row lives in the strip below.
		 *
		 * `--qg-nav-h` is the plate's height, which is its width at the art's own 170x84. The counter
		 * cannot set the height of the band — it is type, it is shorter than the plates, and letting
		 * it in would make the band jump when the counter is scaled.
		 */
		--qg-nav-h: calc(var(--qg-plate-w) * var(--qg-btn-scale) * 84 / 170);
		padding: var(--qg-pad-top) var(--qg-pad-x) calc(var(--qg-pad-bottom) + var(--qg-nav-h));
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
		font-size: calc(2.5cqw * var(--qg-type) * var(--qg-close-scale));
		line-height: 1;
		color: #ffffff;
		text-shadow: 0 0.2cqw 0.4cqw rgba(0, 0, 0, 0.9);
		transform: translate(calc(var(--qg-close-x) * 1cqw), calc(var(--qg-close-y) * 1cqw));
		transition:
			transform 0.12s ease,
			color 0.12s ease;
	}

	/* The offset is repeated here, not replaced: `transform` is one property, so a bare `scale()` on
	   hover would snap the button back to its untuned position for as long as the pointer is on it. */
	.qg-close:hover {
		transform: translate(calc(var(--qg-close-x) * 1cqw), calc(var(--qg-close-y) * 1cqw)) scale(1.12);
		color: #f6c54a;
	}

	/* The looping-video well. Black, and sized to the clips' own 16:9 so nothing is cropped — the
	   reference's placeholder rectangle is flatter than the delivered footage. */
	.qg-video {
		/*
		 * How long one clip takes to dissolve into the next. Nothing in JS reads it: the script
		 * decides WHEN a swap starts — once the incoming clip has a frame to show — and this decides
		 * how long it then takes to look. Long enough to read as a dissolve rather than a cut, short
		 * enough that paging through all four pages never feels like waiting on it.
		 */
		--qg-video-fade: 260ms;
		/* The containing block for the two stacked clips. The transform below already establishes one,
		   but positioning that depends on a tuning knob staying non-neutral is positioning by luck. */
		position: relative;
		width: calc(var(--qg-video-width) * var(--qg-video-scale));
		transform: translate(calc(var(--qg-video-x) * 1cqw), calc(var(--qg-video-y) * 1cqw));
		/* The CLIPS' own aspect, per orientation — 16:9 landscape, 586x960 in the mobile frame (see
		   QUICK_GUIDE_VIDEO_PATHS_PORTRAIT). A knob rather than a constant because the two cuts are
		   different shapes and the well has to be the shape of whatever is playing in it: this is what
		   keeps `object-fit: cover` below a no-op instead of a crop. ⚠️ Restated in the portrait block
		   alongside `--qg-video-width` — the pair is one media box. */
		aspect-ratio: var(--qg-video-aspect);
		flex: 0 0 auto;
		overflow: hidden;
		background: #000000;
		box-shadow: inset 0 0 0 0.2cqw rgba(0, 0, 0, 0.9);
	}

	/*
	 * All four clips sit here, stacked, one visible at a time (and only that one playing).
	 *
	 * The incoming clip fades UP over the outgoing one, which is held at full opacity for exactly as
	 * long as the fade lasts and only then dropped. Fading both at once — the obvious way — does not
	 * work: two opacities crossing at 0.5 leave the composite a quarter short, so the well's black
	 * shows through the middle of every transition. That is a softer version of the very flash this
	 * exists to remove. Holding the outgoing clip instead means it is covered by a fully opaque one at
	 * the instant it goes, so there is no frame in which anything behind either of them is visible.
	 *
	 * `z-index` is what makes "over" true in both directions: DOM order alone would always paint the
	 * later clip above the earlier one, and the dissolve has to work whichever way the player is paging.
	 *
	 * `:global` because these elements are built in JS by the preload and adopted here (see the
	 * video-well note in the script), so they never carry Svelte's scoping attribute. Both rules are
	 * still nested under `.qg-video`, which is scoped — nothing outside this well can match them.
	 */
	.qg-video :global(.qg-video-el) {
		position: absolute;
		inset: 0;
		z-index: 0;
		display: block;
		width: 100%;
		height: 100%;
		/* `cover` rather than `contain`: the well already matches the source aspect, so this only
		   guards against a re-delivered clip at a different ratio leaving bars inside the frame. */
		object-fit: cover;
		opacity: 0;
		/* Leaving: hold, then cut. The delay IS the fade's length — see above for why it waits. */
		transition: opacity 0s linear var(--qg-video-fade);
	}

	.qg-video :global(.qg-video-el--on) {
		z-index: 1;
		opacity: 1;
		transition: opacity var(--qg-video-fade) ease;
	}

	/* Margin-top is the video/title gap — .qg-video carries no margin-bottom, so this is the only
	   flow spacing between them. ⚠️ Landscape's `--qg-title-y: -4` nudges the title back up toward the
	   video afterward (transforms move the painted box, not the flow), so the gap actually on screen
	   there is smaller than this number reads — widen `--qg-title-y` instead of this if it still needs
	   to open up further; the margin controls flow spacing, that knob controls the visual result. */
	.qg-title {
		margin: var(--qg-gap-title) 0 0;
		font-family: 'Noto Sans', 'Instrument Sans', sans-serif;
		font-weight: 600;
		font-size: calc(2.9cqw * var(--qg-type) * var(--qg-title-scale));
		line-height: 1.1;
		transform: translate(calc(var(--qg-title-x) * 1cqw), calc(var(--qg-title-y) * 1cqw));
		letter-spacing: 0.02em;
		text-align: center;
		text-transform: uppercase;
		color: #d4d0c4;
		text-shadow: 0 0.2cqw 0.5cqw rgba(0, 0, 0, 0.85);
	}

	/* Same face and colour as the title, a step down in size — the panel reads as one block of type,
	   not as a heading over a differently-styled paragraph.

	   Sentence case, where the title is still uppercased: the copy is set as written in the script
	   above, not shouted at the player. It was uppercased for a stretch — `--qg-copy-w` and the video
	   well were both narrowed to pay for the extra ~15%-per-character width that cost most pages a
	   line — so reverting to sentence case only leaves slack under those numbers, it does not risk a
	   new wrap. Left as-is rather than re-widening the well to reclaim that slack. */
	.qg-content {
		max-width: var(--qg-copy-w);
		margin: var(--qg-gap-copy) 0 0;
		font-family: 'Noto Sans', 'Instrument Sans', sans-serif;
		font-weight: 400;
		font-size: calc(1.85cqw * var(--qg-type) * var(--qg-copy-scale));
		line-height: 1.35;
		transform: translate(calc(var(--qg-copy-x) * 1cqw), calc(var(--qg-copy-y) * 1cqw));
		letter-spacing: 0.01em;
		text-align: center;
		color: #d4d0c4;
		text-shadow: 0 0.2cqw 0.5cqw rgba(0, 0, 0, 0.85);
	}

	/*
	 * One line of the copy, broken where the copy breaks it rather than where the box runs out.
	 *
	 * A block rather than a `<br>` between inline runs, because a break has to be able to STOP being
	 * one: in landscape every line is set inside `--qg-copy-w` and the breaks are the only ones there
	 * are, but portrait sets the same lines at a third of the measure, where the longer ones wrap
	 * again. A block wraps into as many rows as it needs and the authored break still lands after the
	 * last of them; a `<br>` would only add a break to whatever the reflow already did.
	 *
	 * Nothing else here: no margin, no line-height of its own. The lines share `.qg-content`'s
	 * leading, so a two-line page reads as one paragraph with a break in it and not as two.
	 */
	.qg-content-line {
		display: block;
	}

	/* The "only available with 10, 20, or 50 balls" caveat. It qualifies the copy above it rather than
	   continuing it — a player who is dropping 10+ balls never needs to read it — so it is set a step
	   down in size, a shade down in colour, and in italic. Weight and face stay the copy's: it reads
	   as the same voice speaking as an aside, not as a different one.

	   #bfbbb0 is the copy's own #d4d0c4 at 90% — a deliberate 10%, dark enough to place the line below
	   the copy in the reading order and light enough that it never reads as disabled text. It was
	   #a8a293 for a stretch, which was far enough down to look like a footnote the eye could skip, and
	   these lines carry a real restriction on the feature above them.

	   ⚠️ The italic is SYNTHESISED: `+layout.svelte` installs Noto Sans as Google's variable latin
	   subsets, which carry the 100..900 weight axis and no italic cut, so the browser obliques the
	   upright face. That is fine for one short line and would not be for a paragraph — if this ever
	   spreads, install the italic subsets rather than letting the synthesis spread with it. */
	.qg-note {
		max-width: var(--qg-copy-w);
		margin: var(--qg-gap-note) 0 0;
		font-family: 'Noto Sans', 'Instrument Sans', sans-serif;
		font-weight: 400;
		font-style: italic;
		font-size: calc(1.5cqw * var(--qg-type) * var(--qg-note-scale));
		line-height: 1.3;
		transform: translate(calc(var(--qg-note-x) * 1cqw), calc(var(--qg-note-y) * 1cqw));
		letter-spacing: 0.01em;
		text-align: center;
		color: #bfbbb0;
		text-shadow: 0 0.2cqw 0.5cqw rgba(0, 0, 0, 0.85);
	}

	/*
	 * Absolutely positioned against the frame, NOT laid out in the column above it.
	 *
	 * It used to sit in that column with `margin-top: auto`, which pinned it to the bottom only for as
	 * long as there was slack to absorb: a page whose copy ran one line longer than the design allows
	 * would push the row down and through the bottom band. Out of the flow it cannot move at all —
	 * BACK, the counter and NEXT hold their place whatever the copy and the note do, on every page and
	 * at every viewport. `.qg-inner` reserves the strip it sits in, so the copy still cannot reach it.
	 *
	 * Positioned off the same `--qg-pad-*` the interior is inset by, so the row lines up with the copy
	 * above it rather than being placed by eye.
	 */
	.qg-nav {
		position: absolute;
		left: var(--qg-pad-x);
		right: var(--qg-pad-x);
		bottom: var(--qg-pad-bottom);
		display: flex;
		align-items: center;
		justify-content: space-between;
		/* The row as a whole — plates and counter together. Each of the three has its own knobs on top
		   of this one; see the tuning layer. */
		transform: translate(calc(var(--qg-nav-x) * 1cqw), calc(var(--qg-nav-y) * 1cqw));
	}

	.qg-nav-btn,
	.qg-nav-count {
		font-family: 'Noto Sans', 'Instrument Sans', sans-serif;
		font-weight: 600;
		line-height: 1;
		letter-spacing: 0.04em;
		color: #d4d0c4;
		text-shadow: 0 0.2cqw 0.5cqw rgba(0, 0, 0, 0.85);
		white-space: nowrap;
	}

	/* The label on the plates. Sized with the plates rather than with the counter — it is part of the
	   button, and type that grew while its plate did not would run into the moulded rim. */
	.qg-nav-btn {
		font-size: calc(1.9cqw * var(--qg-type) * var(--qg-btn-scale));
	}

	/*
	 * The counter is NOT a third button and does not follow them: it is a page indicator that happens
	 * to sit between two controls, so it carries its own size and its own offset. Scaling the plates
	 * leaves it alone, and scaling it leaves the plates — and the height of the band they sit in —
	 * alone.
	 */
	.qg-nav-count {
		font-size: calc(1.9cqw * var(--qg-type) * var(--qg-count-scale));
		transform: translate(calc(var(--qg-count-x) * 1cqw), calc(var(--qg-count-y) * 1cqw));
	}

	/*
	 * Both controls sit on the same wooden plate (`quick_guide_button_container.webp`), which is a
	 * background image rather than a border treatment: it is delivered art with a moulded rim and a
	 * grain, and none of that survives being rebuilt in CSS.
	 *
	 * Sized, not padded. The label decides nothing here: the plate is an explicit fraction of the
	 * panel width at the art's own 170x84, and the text is centred on it. BACK and NEXT happen to set
	 * to nearly the same width, but padding would still tie the plate to whatever the words are — a
	 * translation, or the chevrons these labels carried until recently, and the two ends of the row
	 * stop matching. The art is a fixed object; it should be sized like one. Never upscaled: the
	 * widest it gets is 118px, against a 170px asset.
	 *
	 * `--qg-plate-w` is the third knob the portrait override turns, alongside the type and the video
	 * well. It is 15.5% of the panel width in landscape, and the type factor is folded in there so the
	 * plate grows with its label rather than the label growing into the rim.
	 */
	.qg-nav-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: calc(var(--qg-plate-w) * var(--qg-btn-scale));
		aspect-ratio: 170 / 84;
		transform: translate(calc(var(--qg-btn-x) * 1cqw), calc(var(--qg-btn-y) * 1cqw));
		flex: 0 0 auto;
		padding: 0;
		border: none;
		background-color: transparent;
		background-repeat: no-repeat;
		background-position: center;
		/* Stretched to the box rather than `contain`: the box already carries the art's aspect, and this
		   way a redelivery at a different ratio fills the plate instead of leaving a gap inside it. */
		background-size: 100% 100%;
		cursor: pointer;
		transition:
			color 0.12s ease,
			filter 0.12s ease;
	}

	.qg-nav-btn:hover:not(:disabled) {
		color: #ffffff;
		/* The plate lifts with the label — a colour change alone reads as the text hovering off it. */
		filter: brightness(1.15);
	}

	/*
	 * Page 1 has no Back. Only the left end is ever dead: the right-hand button turns into DONE on the
	 * last page and closes the guide, so it stays live all the way through. The dead end stays in the
	 * layout rather than being hidden, so the counter stays centred and the row does not jump.
	 *
	 * Only the LABEL fades. The plate is the frame's own woodwork — it reads as part of the panel, and
	 * dimming it punches a translucent hole in the bottom band where the button was. Fading the words
	 * off a plate that stays put says "nothing to press here" without taking the furniture with it.
	 *
	 * Which is why the label is wrapped in a span at all: it is a text node otherwise, and CSS cannot
	 * address one. `opacity` on the span rather than a dimmer `color`, so the text-shadow under it
	 * fades with the glyphs instead of outliving them as a smudge.
	 */
	.qg-nav-btn:disabled {
		cursor: default;
	}

	.qg-nav-label {
		transition: opacity 0.12s ease;
	}

	.qg-nav-btn:disabled .qg-nav-label {
		opacity: 0.32;
	}

	/*
	 * ── PORTRAIT / MOBILE ─────────────────────────────────────────────────────────────────────────
	 * A different frame, not a squeezed one: the 1641x2794 `container_mobile` art in place of the
	 * 1311x735 wide one. Three things describe that frame and MUST be changed together — the art, the
	 * `aspect-ratio`, and the vh term of `--qg-panel-w` — or the panel stops obeying its height cap
	 * and the ornaments stretch.
	 *
	 * ⚠️ EVERY NUMBER IN THIS BLOCK IS MEASURED OFF THE COMP, not derived from the landscape design.
	 * The comp is drawn at 922x1761 with the panel at 55,302 sized 814x1386, so a design pixel is
	 * 1/8.14 cqw and each knob below carries the measurement it came from. Re-tune freely — that is
	 * what the tuning layer is for — but if the comp is re-issued, re-measure rather than nudging.
	 *
	 * ── WHAT THE TALLER FRAME COSTS ──────────────────────────────────────────────────────────────
	 * At 0.587 the frame is a third narrower for its height than the 0.785 one it replaces, so the
	 * block it makes with the logo stands 1.99 panel-WIDTHS tall. On a viewport at the comp's own
	 * 1:1.91 that is free — 88vw of panel fills 92vh. On the aspect a real phone actually gives this
	 * game (h/w ~1.3; see the portrait note in Game.svelte's fit code) the height term binds hard and
	 * the panel comes out ~60vw instead, which takes the body copy from ~10.4px to ~8.7px at 390x500.
	 * The type is tied to the panel on purpose — that is what keeps the frame one coherent design —
	 * so the lever if that reads too small is `--qg-panel-scale`, or a shorter frame. It is NOT a
	 * per-element floor: a floor that overrides these knobs makes them look broken when tuned.
	 */
	@media (max-aspect-ratio: 1/1) {
		.qg-backdrop {
			/*
			 * The width, and with it everything else. Three caps, as in landscape, but the vh term is
			 * written differently here and the difference matters: landscape states a budget for the
			 * PANEL, and at 0.785 the logo standing proud of it is a rounding error. At 0.587 it is not
			 * — the panel alone is 1.70 panel-widths tall and the logo adds another 0.28 clear of it, so
			 * a panel-only budget silently crops the logo's top edge on any viewport the term binds on.
			 *
			 * So this term is the WHOLE BLOCK's budget, logo included, resolved back into a width:
			 *   block height = logo (0.6585 / 1.8797) - overlap (0.0663) + panel (1 / 0.58733)
			 *                = 0.3503 - 0.0663 + 1.7026 = 1.9866 panel widths
			 *   92vh / 1.9866 = 46.3vh
			 * ⚠️ Those three fractions are `--qg-logo-w`, `--qg-logo-overlap` and the frame's aspect,
			 * all set below. Change any of them and 46.3 is stale — re-derive it.
			 *
			 * 92vh and not 100: the comp leaves 72px above the logo and 73px under the panel out of
			 * 1761, i.e. 4vh of air at each end, and a modal pinned edge to edge reads as broken even
			 * when nothing is clipped.
			 *
			 * 88.3vw is the comp's own 814/922. It binds only above ~1:1.91 — anything squatter is
			 * height-bound, which is the regime a real phone is in.
			 */
			--qg-panel-w: calc(min(88.3vw, calc(1000 * var(--ui-px)), 46.3vh) * var(--qg-panel-scale));
			/* 536/814 of the panel, centred on it, hanging 54/814 over the top edge — comp 194,72
			   sized 536x284. `--qg-logo-scale` is folded out to 1 so `--qg-logo-w` reads as the
			   measurement it is; scale that, not the width, when nudging. */
			--qg-logo-w: 0.6585;
			--qg-logo-overlap: 0.0663;
			--qg-logo-scale: 1;
			--qg-logo-x: 0;
			--qg-logo-y: 0;
			--qg-panel-scale: 1;
			--qg-modal-x: 0;
			--qg-modal-y: 0;
		}

		.qg-modal {
			/*
			 * `--qg-type` is the master multiplier and 2.1 is kept from the old tall frame, so the
			 * per-element `-scale` knobs below carry the difference between that and what the comp
			 * actually sets. Each one is the comp's size over the landscape design's, and the working
			 * is written out beside it so a re-measure is arithmetic rather than eyeballing.
			 */
			--qg-type: 2.1;
			/* 491/814 of the panel, top-left at 214,366 in the comp. In `cqw` and not `%` because a
			   percentage here resolves against `.qg-inner`'s CONTENT box, so it would move every time
			   `--qg-pad-x` did; the comp measures the well against the FRAME. */
			--qg-video-width: 60.32cqw;
			/* The portrait cut's own 586x960 (0.6104) rather than the comp's 491x805 (0.6099) — the
			   two agree to half a pixel, and matching the footage is what keeps `cover` from cropping. */
			--qg-video-aspect: 586 / 960;
			/* 691/814 — the comp's copy measure, narrower than the frame's interior. Both the copy and
			   the note are set to it. */
			--qg-copy-w: 84.89cqw;
			/* Unchanged from the old portrait frame: 11.5 x 2.1 = 24.15cqw, and `--qg-btn-scale` below
			   takes it to the comp's 170/814 = 20.88cqw. */
			--qg-plate-w: calc(11.5cqw * var(--qg-type));
			/* 64/814 — panel top 302 to well top 366. The well is first in the column, so this inset IS
			   the well's position and `--qg-video-y` can stay neutral. */
			--qg-pad-top: 7.86cqw;
			/* 46/814. The comp's own nav insets are asymmetric (57 left, 35 right, which reads as
			   drawing slack rather than intent), so the row is set symmetric on their mean and the
			   counter lands on the panel's centre line instead of 4px off it. */
			--qg-pad-x: 5.65cqw;
			/*
			 * NEGATIVE, which landscape's never is, and the sign is the whole point.
			 *
			 * In this comp the nav plates HANG OFF the frame — 1616..1700 against a panel that ends at
			 * 1688 — sitting on the riveted bottom band rather than inside it. -12/814 puts `.qg-nav`'s
			 * box exactly there, and everything else follows from that one number: `--qg-btn-y` stays
			 * neutral, and `.qg-inner`'s reserve (this plus the plate's height, 8.85cqw = 72px) stops
			 * the copy column at 1616 — the plates' own top edge.
			 *
			 * Carrying the overhang in `--qg-btn-y` instead was the obvious way and is subtly wrong:
			 * the transform moves the plates without moving the reserve, so the column would stop 45px
			 * higher than the furniture actually is and page 2's note would sit 20px inside a strip the
			 * padding had already called spoken for. It still cleared, because the reserve was 45px
			 * pessimistic — but a knob left at its tuned value is not a layout guarantee, and zeroing
			 * `--qg-btn-y` would have dropped the note onto the plates. Reserve and position now come
			 * off the same declaration and cannot disagree.
			 *
			 * Clearance under the binding page (2, five lines of copy plus a one-line note): its last
			 * row ends at 1591.6, so 24.5 comp px of air under it.
			 */
			--qg-pad-bottom: -1.47cqw;
			/*
			 * Flow spacing, measured between the comp's boxes rather than multiplied out of
			 * `--qg-type`: the mobile type is ~2.1x the landscape design's but the air between it is
			 * not, so deriving these from the type factor overshoots every gap.
			 *   title  well bottom 1171 -> title line box ~1202 = 31px = 3.8cqw
			 *   copy   title line box bottom ~1257 -> copy box 1306 = 49px = 6.0cqw
			 *   note   copy box bottom 1429 -> note line box ~1471 = 42px = 5.2cqw
			 */
			--qg-gap-title: 3.8cqw;
			--qg-gap-copy: 6cqw;
			--qg-gap-note: 5.2cqw;

			/*
			 * The tuning layer, portrait's own copy — see the block on `.qg-modal`. NOT neutral here,
			 * unlike landscape's: these are what carry the comp's type sizes onto the landscape
			 * design's `cqw` coefficients. Each is `comp size / (coefficient x --qg-type)`.
			 *
			 * The offsets stay a % of the panel's width, so a given number is the same nudge relative
			 * to the frame it is nudging in whatever the viewport is doing.
			 */
			--qg-video-scale: 1;
			--qg-video-x: 0;
			--qg-video-y: 0;
			/* 50px -> 6.143cqw; 6.143 / (2.9 x 2.1) */
			--qg-title-scale: 1.009;
			--qg-title-x: 0;
			--qg-title-y: 0;
			/*
			 * ── THE COPY AND THE NOTE FOLLOW LANDSCAPE, NOT THE COMP ─────────────────────────────
			 * Both neutral, deliberately: the two knobs that carry the comp's type onto this frame are
			 * turned OFF, so the body copy and the caveat under it are the landscape design's own
			 * coefficients (1.85cqw and 1.5cqw) taken through `--qg-type`. Every other size in this
			 * block is still the comp's — this pair is the exception, and it is the only one.
			 *
			 * The comp sets the copy at 30px and the note at 36px, i.e. the note a step LARGER than the
			 * copy, which is the reverse of landscape's relationship. It can do that because it sets
			 * the note in Noto Sans Display ExtraCondensed Italic (`wdth` 62.5) — narrow enough at 36px
			 * to still take less width per character than 30px upright. This game installs Google's
			 * latin/latin-ext subsets of Noto Sans, which carry the 100..900 WEIGHT axis and nothing
			 * else (measured: `font-stretch: 62.5%` and `font-variation-settings: 'wdth' 62.5` both
			 * leave a string exactly as wide, and there is no italic cut — the slant is synthesised).
			 * Set at 36px in the face we have, page 1's note runs 1085 comp px against a 691 measure —
			 * 1.57x, the missing 62.5% almost to the digit.
			 *
			 * So the comp's note size is not reachable without shipping a second family, and a note
			 * that merely LOOKS bigger than the copy without being narrower is not what it draws. The
			 * relationship the game already has — note a step down in size, a shade down in colour,
			 * italic, same face and weight — is the one both orientations now share.
			 *
			 * `--qg-copy-scale` is 1 rather than landscape's 0.98: that 0.98 is not part of the design,
			 * it is a fitting hack for landscape's own measure (see the note on it there), and the
			 * lines here wrap inside their authored breaks anyway.
			 */
			--qg-copy-scale: 1;
			--qg-copy-x: 0;
			--qg-copy-y: 0;
			--qg-note-scale: 1;
			--qg-note-x: 0;
			--qg-note-y: 0;
			--qg-nav-x: 0;
			--qg-nav-y: 0;
			/* 28px label -> 3.440cqw; 3.44 / (1.9 x 2.1) = 0.862, and the same factor takes the plate
			   to 24.15 x 0.865 = 20.89cqw against the comp's 170/814 = 20.88. One knob, both sizes —
			   which is why it is 0.865 and not 0.862: the plate is the half worth landing exactly. */
			--qg-btn-scale: 0.865;
			--qg-btn-x: 0;
			/* Neutral: the plates' overhang past the frame's bottom edge is `--qg-pad-bottom`'s job
			   here, so that the copy column's reserve moves with them. See the note there. */
			--qg-btn-y: 0;
			/* 31px -> 3.808cqw; 3.808 / (1.9 x 2.1) */
			--qg-count-scale: 0.954;
			--qg-count-x: 0;
			/* The counter stays INSIDE the frame where the plates straddle its edge — comp 1620 against
			   a row box that centres it at 1642.5, so 22.5px up. This is the one part of the row that
			   does not follow the overhang, which is why the row's three knob sets are separate. */
			--qg-count-y: -2.77;
			/* 35px -> 4.300cqw; 4.3 / (2.5 x 2.1). Placement is the frame's own corner ornament rather
			   than the comp's, which has the X stranded behind the panel art at 816,479 — clearly a
			   stale layer and not a position to read a decision off. */
			--qg-close-scale: 0.82;
			--qg-close-x: 1;
			--qg-close-y: -1;

			aspect-ratio: 1641 / 2794;
			background-image: var(--qg-frame-mobile);
		}
	}
</style>
