<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';

	const { Story } = defineMeta({
		title: 'MODE_BASE/book',
	});
</script>

<script lang="ts">
	import {
		StoryGameTemplate,
		StoryLocale,
		type TemplateArgs,
		templateArgs,
	} from 'components-storybook';
	import { randomInteger } from 'utils-shared/random';

	import Game from '../components/Game.svelte';
	import { setContext } from '../game/context';
	import { playBet } from '../game/utils';
	import books from './data/base_books';

	setContext();
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

<Story
	name="random"
	args={templateArgs({
		skipLoadingScreen: true,
		data: {},
		action: async () => {
			if (!books.length) {
				console.warn('No books in base_books.ts — run stake-math-sdk and import-math-books.mjs');
				return;
			}
			const index = randomInteger({ min: 0, max: books.length - 1 });
			const data = books[index];
			console.log('Running book at index', index, 'payout', data.payoutMultiplier);
			await playBet({ ...data, state: data.events });
		},
	})}
	{template}
/>
