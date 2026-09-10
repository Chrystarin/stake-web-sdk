/**
 * What kind of pointer is on this device, as one answer the whole game shares.
 *
 * An instruction is not the same sentence on a mouse and on a finger — a mouse hovers and fires on
 * a click, a finger has to be held down before it is aiming at anything — so every room that tells
 * the player what to do has to ask this. Asked of pointer CAPABILITY rather than of screen width,
 * because that is the thing that actually differs: a narrow desktop window still has a cursor, and
 * a large tablet still has none.
 *
 * The query is opened when this module is first imported rather than on the first read: reading
 * happens inside a `$derived` — the rooms pick their words from it — and a lazy setup would be
 * writing state from inside a derivation, which Svelte refuses outright (`state_unsafe_mutation`).
 * It is then kept live for the life of the page, because a device can change its mind: a tablet
 * with a keyboard folded on and off is a coarse pointer that became a fine one.
 */
const query =
	typeof window === 'undefined' ? null : window.matchMedia('(hover: hover) and (pointer: fine)');

let fine = $state(query?.matches ?? true);
query?.addEventListener('change', () => (fine = query.matches));

/** True on a mouse or a trackpad, false on a touchscreen. */
export const finePointer = (): boolean => fine;
