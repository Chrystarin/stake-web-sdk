<script lang="ts">
	import { type Snippet } from 'svelte';
	import { GlobalStyle } from 'components-ui-html';
	import { Authenticate, LoadI18n } from 'components-shared';
	import { stateUrlDerived } from 'state-shared';

	import Game from '../components/Game.svelte';
	import { setContext } from '../game/context';

	import messagesMap from '../i18n/messagesMap';

	type Props = { children: Snippet };

	const props: Props = $props();

	setContext();

	// With an RGS session, authenticate normally. Without one (dev / preview), skip auth and
	// let the dev harness play sample books locally.
	const online = $derived(Boolean(stateUrlDerived.rgsUrl()));
</script>

<GlobalStyle>
	{#if online}
		<Authenticate>
			<LoadI18n {messagesMap}>
				<Game />
			</LoadI18n>
		</Authenticate>
	{:else}
		<LoadI18n {messagesMap}>
			<Game />
		</LoadI18n>
	{/if}
</GlobalStyle>

{@render props.children()}
