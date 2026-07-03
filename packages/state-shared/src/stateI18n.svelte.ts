import { i18n, type Messages } from '@lingui/core';
import { type Language } from './stateUrl.svelte';

// Lingui v5's default `i18n` ships WITHOUT a message compiler (kept out of the core bundle), so
// loading our RAW (uncompiled) catalogs makes `i18n._()` log "Uncompiled message detected!" for every
// label. Our catalogs are plain static strings (no ICU interpolation/plurals), so an identity compiler
// silences the warning while producing identical output. If ICU messages are ever added, swap this for
// `compileMessage` from `@lingui/message-utils` (add it as a dependency first).
i18n.setMessagesCompiler((message) => message);

export const stateI18n = $state({
	i18n
});

export const stateI18nDerived = {
	init: (lang: Language, messages: Messages) => {
		stateI18n.i18n.load(lang, messages as Messages);
		stateI18n.i18n.activate(lang);
	},
	translate: (value: string) => stateI18n.i18n._(stateI18n.i18n.t(value)),
};