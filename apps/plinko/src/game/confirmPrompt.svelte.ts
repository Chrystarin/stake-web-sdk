/**
 * Yes/No confirmation gate for the "big commitment" actions: starting an Autobet run (at an ordinary
 * or a high-bet stake), buying a bonus, and placing a HIGH BET (see `isPlinkoHighBet`). Each of those
 * is a single click that spends a lot of the player's balance at once, so it must be confirmed before
 * it fires.
 *
 * The prompt is intentionally a tiny standalone module rather than another `stateGame` flag: the
 * pending action is a CLOSURE (it captures the tier / round-count / bet the player was looking at when
 * they clicked), and closures must not live in a `$state` proxy. Only the visible kind is reactive.
 *
 * ⚠️ Import this statically. A dynamically imported `*.svelte.ts` is a different module instance, so a
 * dynamic import here would answer a prompt that no component is rendering (same trap as stateGame).
 */

export type ConfirmPromptKind = 'highBet' | 'autobet' | 'highAutobet' | 'buyBonus';

/** Headline shown on the prompt panel, per action. */
export const CONFIRM_PROMPT_TITLES: Record<ConfirmPromptKind, string> = {
	highBet: 'Start High Bet?',
	autobet: 'Start Autobet?',
	highAutobet: 'Start High Autobet?',
	buyBonus: 'Start Bonus Buy?',
};

/**
 * Optional line of plain copy under the headline. Only the high-bet Autobet prompt carries one: it is
 * the one prompt whose headline alone doesn't say WHY it is being asked, so it spells out that the run
 * is about to be armed at a high-bet stake. The newline is deliberate — it is the designed line break,
 * rendered as-is rather than left to wrap wherever the panel width happens to land.
 */
export const CONFIRM_PROMPT_CAPTIONS: Partial<Record<ConfirmPromptKind, string>> = {
	highAutobet: 'You are about to start Auto Bet\nwith a highbet amount.',
};

/** Which prompt is on screen (`null` = none). Reactive; read by ConfirmPromptModal. */
export const confirmPrompt = $state({ kind: null as ConfirmPromptKind | null });

/** The action to run on "Yes". Held outside `$state` — see the module note above. */
let pendingConfirm: (() => void) | null = null;
/** Optional cleanup to run on "No" / dismiss (most callers simply do nothing on cancel). */
let pendingCancel: (() => void) | null = null;

/** True while a prompt is on screen — callers use this to keep global hotkeys from firing behind it. */
export function isConfirmPromptOpen(): boolean {
	return confirmPrompt.kind !== null;
}

/**
 * Show the prompt for `kind`; `onConfirm` runs only if the player picks Yes.
 *
 * The action is deliberately NOT pre-validated here — the board and balance can both change while the
 * prompt is open, so every `onConfirm` re-checks its own preconditions before committing.
 */
export function requestConfirmPrompt(
	kind: ConfirmPromptKind,
	onConfirm: () => void,
	onCancel?: () => void,
): void {
	// A second request while one is open supersedes it: cancel the older action rather than silently
	// dropping it, so nothing is left half-armed.
	if (confirmPrompt.kind !== null) pendingCancel?.();
	pendingConfirm = onConfirm;
	pendingCancel = onCancel ?? null;
	confirmPrompt.kind = kind;
}

/** Resolve the open prompt. `confirmed` false covers No, backdrop click and Escape alike. */
export function answerConfirmPrompt(confirmed: boolean): void {
	const onConfirm = pendingConfirm;
	const onCancel = pendingCancel;
	pendingConfirm = null;
	pendingCancel = null;
	confirmPrompt.kind = null;
	if (confirmed) onConfirm?.();
	else onCancel?.();
}
