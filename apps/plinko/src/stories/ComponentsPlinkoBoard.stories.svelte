<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';

	const { Story } = defineMeta({
		title: 'COMPONENTS/<PlinkoBoard>',
	});
</script>

<script lang="ts">
	import { StoryLocale } from 'components-storybook';

	import PlinkoBoard from '../components/PlinkoBoard.svelte';
	import { setContext } from '../game/context';
	import config from '../game/config';

	setContext();

	const coefficients = (config.defaultCoefficientSets[0]?.[6] ?? []) as number[];
</script>

<Story name="board">
	<StoryLocale lang="en">
		<div
			style="width: 100vw; height: 70vh; display: flex; flex-direction: column; padding: 3vw 0.75vw 0; box-sizing: border-box; background: #0a0f14 url('./img/game_area_background.png') top center / contain no-repeat"
		>
			<PlinkoBoard {coefficients} rows={14} animationEnabled={true} animationSpeed={0.7} />
		</div>
	</StoryLocale>
</Story>
