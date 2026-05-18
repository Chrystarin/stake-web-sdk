/**
 * Resolve paths to files in /static (build output root).
 * Uses Vite BASE_URL so assets work when the game is hosted on a subpath (Stake Engine CDN).
 */
const base = (import.meta.env.BASE_URL ?? '/').replace(/\/?$/, '/');

export const staticUrl = (path: string): string => `${base}${path.replace(/^\//, '')}`;
