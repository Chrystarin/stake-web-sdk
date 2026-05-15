<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';

	const { Story } = defineMeta({
		title: 'COMPONENTS/<Game>',
	});
</script>

<script lang="ts">
	import { StoryLocale, StoryGameTemplate, type TemplateArgs, templateArgs } from 'components-storybook';
	import { stateBet } from 'state-shared';

	import Game from '../components/Game.svelte';
	import { setContext } from '../game/context';
	import { eventEmitter } from '../game/eventEmitter';
	import config from '../game/config';

	setContext();

	stateBet.balanceAmount = 1000;
	stateBet.betAmount = 1;
	stateBet.currency = 'USD';
</script>

{#snippet template(args: TemplateArgs<unknown>)}
	<StoryGameTemplate
		skipLoadingScreen={args.skipLoadingScreen}
		action={async () => {
			await args.action?.(args.data);
		}}
	>
		<StoryLocale lang="en">
			<Game />
		</StoryLocale>
	</StoryGameTemplate>
{/snippet}

<Story name="component">
	<StoryLocale lang="en">
		<Game />
	</StoryLocale>
</Story>

<Story
	name="plinkoDrop (demo)"
	args={templateArgs({
		skipLoadingScreen: true,
		data: {},
		action: async () => {
			const coefficients = config.defaultCoefficientSets[0]?.[6] ?? [];
			const outcomes = coefficients.map((multiplier, rateIndex) => ({
				rateIndex,
				multiplier,
				amount: stateBet.betAmount,
			}));
			await eventEmitter.broadcastAsync({
				type: 'plinkoDrop',
				outcomes: outcomes.slice(0, 3),
				fastMode: false,
			});
		},
	})}
	{template}
/>
