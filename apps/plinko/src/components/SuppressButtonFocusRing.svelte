<script lang="ts">
	import { onMount } from 'svelte';

	// Game-wide fix for a stray accessibility focus ring on the HUD controls.
	//
	// A left mouse click focuses a native <button>; if the player then presses Space — which the
	// game globally preventDefaults as the "drop / bet" hotkey — the browser flips into keyboard
	// modality and paints a :focus-visible ring over the (still mouse-focused) control. Space on its
	// own never focuses a button, which is why that path stays clean. CSS can't fix this without also
	// killing the ring for genuine keyboard-Tab users, because once mouse-focused + Space the
	// :focus-visible match is legitimate and indistinguishable from a tabbed one.
	//
	// So we stop the LEFT mouse press from focusing button-like controls in the first place. Keyboard
	// Tab focus (and its correct a11y ring) is untouched — that path never goes through mousedown.
	// Scoped strictly to button / [role="button"], so the Pixi board canvas, scroll areas, and any
	// future text inputs are left alone. One document-level listener covers every current and future
	// clickable control in the game.
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
