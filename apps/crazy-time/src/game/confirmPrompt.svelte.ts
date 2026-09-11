/**
 * Yes/No gate for the buy-bonus purchase (ported from apps/plinko's confirmPrompt).
 *
 * A single click that spends a lot of the player's balance at once must be confirmed before it
 * fires. The pending action is a CLOSURE (it captures the buy the player was looking at), and
 * closures must not live in a `$state` proxy, so only the visible kind is reactive.
 *
 * Import this statically: a dynamically imported `*.svelte.ts` is a different module instance.
 */

export type ConfirmPromptKind = 'buyBonus';

/** Headline shown on the prompt panel, per action. */
export const CONFIRM_PROMPT_TITLES: Record<ConfirmPromptKind, string> = {
	buyBonus: 'Start Bonus Buy?',
};

/** Which prompt is on screen (`null` = none). Reactive; read by ConfirmPromptModal. */
export const confirmPrompt = $state({ kind: null as ConfirmPromptKind | null });

let pendingConfirm: (() => void) | null = null;
let pendingCancel: (() => void) | null = null;

export function isConfirmPromptOpen(): boolean {
	return confirmPrompt.kind !== null;
}

/**
 * Show the prompt for `kind`; `onConfirm` runs only if the player picks Yes. The action is not
 * pre-validated here: balance can change while the prompt is open, so `onConfirm` re-checks.
 */
export function requestConfirmPrompt(
	kind: ConfirmPromptKind,
	onConfirm: () => void,
	onCancel?: () => void,
): void {
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
