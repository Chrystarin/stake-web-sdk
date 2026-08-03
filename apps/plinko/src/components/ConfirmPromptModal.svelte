<script lang="ts">
	import {
		answerConfirmPrompt,
		CONFIRM_PROMPT_TITLES,
		confirmPrompt,
	} from '../game/confirmPrompt.svelte';
	import { getContext } from '../game/context';
	import { staticUrl } from '../lib/staticUrl';

	const context = getContext();

	const title = $derived(confirmPrompt.kind ? CONFIRM_PROMPT_TITLES[confirmPrompt.kind] : '');

	function answer(confirmed: boolean) {
		// Same click SFX as the bet-panel steppers / buy-bonus modal.
		context.eventEmitter.broadcast({ type: 'soundOnce', name: 'clickUIButton' });
		answerConfirmPrompt(confirmed);
	}

	/** Escape is a cancel, matching the backdrop click. Guarded so it only fires while open. */
	function onKeydown(event: KeyboardEvent) {
		if (confirmPrompt.kind === null) return;
		if (event.key !== 'Escape') return;
		event.preventDefault();
		answer(false);
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#if confirmPrompt.kind}
	<!-- Clicking the backdrop is a cancel — same outcome as "No", never a silent commit. -->
	<div class="cf-backdrop" role="presentation" onclick={() => answer(false)}>
		<div
			class="cf-panel"
			role="dialog"
			aria-modal="true"
			aria-label={title}
			onclick={(event) => event.stopPropagation()}
		>
			<img
				class="cf-frame"
				src={staticUrl('img/announcement-message-background.webp')}
				alt=""
				aria-hidden="true"
			/>

			<div class="cf-inner">
				<h2 class="cf-title">{title}</h2>

				<div class="cf-choices">
					<button
						type="button"
						class="cf-choice cf-choice--yes"
						onclick={() => answer(true)}
					>
						<img
							class="cf-choice-frame"
							src={staticUrl('img/betting-component-frame-mobile.webp')}
							alt=""
							aria-hidden="true"
						/>
						<span class="cf-choice-text">Yes</span>
					</button>

					<button type="button" class="cf-choice cf-choice--no" onclick={() => answer(false)}>
						<img
							class="cf-choice-frame"
							src={staticUrl('img/betting-component-frame-mobile.webp')}
							alt=""
							aria-hidden="true"
						/>
						<span class="cf-choice-text">No</span>
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.cf-backdrop {
		position: fixed;
		inset: 0;
		/* Above the buy-bonus modal (60) and the info modal (18000) — the buy-bonus prompt is raised
		   FROM that modal, which stays open behind it — but below Toast (19000), MsgBox (20000) and the
		   offline overlay (21000), which must always be able to speak over a prompt. */
		z-index: 18500;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.72);
		padding: 4vh 4vw;
	}

	.cf-panel {
		position: relative;
		/* Both the frame art and every type size below are proportional to THIS width, so the panel
		   scales as one piece: `min(720px, 86vw)` capped, and each `clamp(px, vw, px)` pair below is the
		   same percentage expressed against each of those two terms.
		   The px term is in --ui-px so it shrinks with the viewport below the 1024×576 reference. Without
		   it the 86vw term takes over on a 400×225 popout and the prompt covers 86% of the frame instead
		   of the 70% (720/1024) it occupies at the reference. */
		width: min(calc(720 * var(--ui-px)), 86vw);
		/* announcement-message-background.png is 1919×1080 — draw it at its true ratio, never stretched. */
		aspect-ratio: 1919 / 1080;
		display: flex;
		animation: cf-pop 0.16s ease-out;
	}

	@keyframes cf-pop {
		from {
			opacity: 0;
			transform: scale(0.94);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}

	.cf-frame {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: fill;
		pointer-events: none;
		user-select: none;
	}

	.cf-inner {
		position: relative;
		z-index: 1;
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		/* Headline sits in the upper third, choices ride the bottom — matching the reference layout. */
		justify-content: space-between;
		/* Insets keep the content clear of the frame art's carved wooden border.
		   ⚠️ Percentage padding resolves against the panel's WIDTH on every side, vertical included — so
		   at the panel's 1919:1080 ratio these top/bottom values are ~1.78× what they read as. */
		padding: 10% 9% 12%;
		box-sizing: border-box;
	}

	.cf-title {
		margin: 0;
		font-family: 'PiecesOfEight', serif;
		font-weight: 400;
		/* 11% of the panel width, written against both terms of the panel's own `min()` (720px / 86vw)
		   so the headline keeps its proportion at every size instead of drifting once the panel caps.
		   Both px bounds are in --ui-px, matching the panel — otherwise the 22px floor binds on a
		   400×225 popout and the headline outgrows the plaque it sits on. */
		font-size: clamp(calc(22 * var(--ui-px)), 9.4vw, calc(79 * var(--ui-px)));
		line-height: 1;
		text-align: center;
		letter-spacing: 0.02em;
		/* PiecesOfEight ships a very wide space glyph, so "Start Autobet?" reads as a double space at
		   this size. Pull the word gap back to a single-space rhythm. */
		word-spacing: -0.14em;
		/* Gold gradient clipped to the glyphs, matching the bonus congratulations headline. */
		background-image: linear-gradient(180deg, #fad04a 0%, #f0b82e 56.7%, #de951a 100%);
		background-clip: text;
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		color: transparent;
		/* drop-shadow, NOT text-shadow: with background-clip:text the gradient paints in the background
		   layer, so a text-shadow would land ON TOP of it. */
		filter: drop-shadow(0 calc(2 * var(--ui-px)) calc(2 * var(--ui-px)) rgba(0, 0, 0, 0.8))
			drop-shadow(0 0 calc(14 * var(--ui-px)) rgba(246, 168, 32, 0.5));
	}

	.cf-choices {
		display: flex;
		justify-content: center;
		gap: 9%;
		width: 100%;
	}

	.cf-choice {
		position: relative;
		width: 40%;
		/* Native ratio of betting-component-frame-mobile.png (252×68) — no distortion. */
		aspect-ratio: 252 / 68;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: none;
		padding: 0;
		cursor: pointer;
		transition:
			transform 0.1s ease,
			filter 0.1s ease;
	}

	.cf-choice-frame {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: fill;
		pointer-events: none;
		user-select: none;
	}

	.cf-choice-text {
		position: relative;
		z-index: 1;
		font-family: 'PotatoSans', sans-serif;
		/* 4.9% of the panel width — same two-term treatment as .cf-title. */
		font-size: clamp(calc(13 * var(--ui-px)), 4.2vw, calc(35 * var(--ui-px)));
		line-height: 1;
		letter-spacing: 0.02em;
		/* White fill with a black edge — legible over the plate's dark centre at any size. The outline
		   rides --ui-px too: a real 1px edge on 13px type (the popout size) reads as a blob, where at
		   the reference it's a hairline on 35px type. */
		color: #ffffff;
		-webkit-text-stroke: var(--ui-px) #000000;
		paint-order: stroke fill;
		text-shadow:
			var(--ui-px) var(--ui-px) 0 #000000,
			calc(-1 * var(--ui-px)) var(--ui-px) 0 #000000,
			var(--ui-px) calc(-1 * var(--ui-px)) 0 #000000,
			calc(-1 * var(--ui-px)) calc(-1 * var(--ui-px)) 0 #000000,
			0 calc(2 * var(--ui-px)) calc(3 * var(--ui-px)) rgba(0, 0, 0, 0.7);
		white-space: nowrap;
	}

	.cf-choice--yes .cf-choice-text {
		color: #56e874;
	}
	.cf-choice--no .cf-choice-text {
		color: #ff6056;
	}

	.cf-choice:hover {
		filter: brightness(1.08);
		transform: translateY(-1px);
	}
	.cf-choice:active {
		transform: translateY(1px);
	}
</style>
