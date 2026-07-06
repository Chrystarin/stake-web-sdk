<script lang="ts">
	import { onMount } from 'svelte';

	// Game-wide fix for a stray accessibility focus ring on the HUD controls. Two complementary
	// parts, both scoped to button-like controls so the Pixi board canvas, scroll areas, and any
	// future text inputs are left completely alone:
	//
	//   1. JS (below): a left mouse press no longer focuses a button. A click focuses a native
	//      <button>; if the player then presses Space — which the game globally preventDefaults as
	//      the "drop / bet" hotkey — the browser flips into keyboard modality and paints a ring over
	//      the still-mouse-focused control. Preventing the mousedown default stops the focus (the
	//      click still fires), so that path can never show a ring. Keyboard Tab focus is untouched.
	//
	//   2. CSS (:global below): removes the outline for genuine keyboard/Tab focus too. Tabbing into
	//      the game from outside (e.g. the host page) lands focus on the first control and, by design,
	//      these round button assets must not show the white circular focus ring. This is a
	//      deliberate product choice for the game HUD — betting is still fully keyboard-driveable via
	//      the global Space hotkey, so no interaction is lost.
	onMount(() => {
		const onMouseDown = (event: MouseEvent) => {
			// Only the primary (left) button drives focus-on-click; leave middle/right alone so we
			// never interfere with context menus or auxiliary-click behaviour.
			if (event.button !== 0) return;
			const target = event.target as Element | null;
			if (!target?.closest('button, [role="button"]')) return;
			// Prevent the mousedown default (focus) — the click still fires, so every button keeps
			// working exactly as before, just without retaining focus after a mouse press.
			event.preventDefault();
		};
		// Capture phase so a child's stopPropagation can't defeat it; preventDefault cancels the
		// default focus regardless of which phase it's called in.
		document.addEventListener('mousedown', onMouseDown, true);
		return () => document.removeEventListener('mousedown', onMouseDown, true);
	});
</script>

<style>
	/* Suppress the browser's focus ring on every game control, including keyboard/Tab focus.
	   Scoped to button-like elements only — no other focusable element types exist in the app. */
	:global(button:focus),
	:global(button:focus-visible),
	:global([role='button']:focus),
	:global([role='button']:focus-visible) {
		outline: none;
	}
</style>
