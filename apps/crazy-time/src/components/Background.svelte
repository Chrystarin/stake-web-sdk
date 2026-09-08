<script lang="ts">
	/**
	 * The backdrop: a looping video filling the viewport. It covers the whole viewport rather than
	 * the 16:9 frame, so the bands a differently shaped viewport letterboxes still show the scene.
	 *
	 * `muted` and `playsinline` are what let it start on its own: every browser blocks autoplay of a
	 * video that could make noise, and iOS Safari otherwise takes it fullscreen. Nothing here depends
	 * on playback actually starting — if a browser refuses, the first frame stays up over the flat
	 * colour and the game is unaffected.
	 */
	import { staticUrl } from '../lib/staticUrl';

	const src = staticUrl('videos/animated_background.mp4');
</script>

<div class="background">
	<!-- svelte-ignore a11y_media_has_caption -- decor: the file carries no audio track at all -->
	<video class="background__video" {src} autoplay muted loop playsinline preload="auto"></video>
</div>

<style>
	/* z-index 0 keeps the whole block under the stage (1) and the panel (2). */
	.background {
		position: absolute;
		inset: 0;
		z-index: 0;
		isolation: isolate;
		overflow: hidden;
		pointer-events: none;
		background-color: #0b1420;
	}

	.background__video {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: center;
	}
</style>
