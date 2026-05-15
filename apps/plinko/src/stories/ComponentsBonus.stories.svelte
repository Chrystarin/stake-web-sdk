<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';

	const { Story } = defineMeta({
		title: 'COMPONENTS/BonusMeters',
	});
</script>

<script lang="ts">
	import { StoryLocale } from 'components-storybook';

	import { BonusLevel, BonusRoulette, FreeSpinRoulette } from '../features/bonus';
	import { BonusMeter, FreeSpinMeter } from '../features/meters';
</script>

<Story name="Bonus meter">
	<StoryLocale lang="en">
		<div style="width: 640px; height: 48px; margin: 24px auto;">
			<BonusMeter progress={0.65} />
		</div>
	</StoryLocale>
</Story>

<Story name="Free spin meter">
	<StoryLocale lang="en">
		<div style="width: 420px; height: 40px; margin: 24px auto;">
			<FreeSpinMeter progress={0.4} />
		</div>
	</StoryLocale>
</Story>

<Story name="Bonus level ladder">
	<StoryLocale lang="en">
		<div style="position: relative; width: 720px; height: 200px; margin: 24px auto;">
			<BonusLevel activeLevels={3} pendingLevelHighlight={5} />
		</div>
	</StoryLocale>
</Story>

<Story name="Bonus roulette">
	<StoryLocale lang="en">
		<div style="position: relative; width: 100vw; height: 100vh; max-width: 900px; max-height: 700px; margin: 0 auto;">
			<BonusRoulette targetFreeBalls={50} />
		</div>
	</StoryLocale>
</Story>

<Story name="Free spin roulette">
	<StoryLocale lang="en">
		<div style="position: relative; width: 100vw; height: 100vh; max-width: 900px; max-height: 700px; margin: 0 auto;">
			<FreeSpinRoulette targetSegmentIndex={5} />
		</div>
	</StoryLocale>
</Story>
