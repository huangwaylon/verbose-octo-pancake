/**
 * The GitHub Pages base path, in one place.
 *
 * Project Pages sites serve from `/<repo>/`, so the bundle, its asset URLs and the
 * service worker's precache list must all agree on the prefix. Both the Vite config
 * and `scripts/build-sw.js` read it from here: a worker built against a different
 * base 404s every asset, `install` rejects, no worker ever activates, and offline
 * launch dies with nothing on screen looking wrong.
 *
 * Override with VITE_BASE=/ for a custom domain. Renaming the repository means
 * changing this one line.
 */
export const DEFAULT_BASE = '/verbose-octo-pancake/'

/** The base a build should use: the environment's if set, otherwise the default. */
export function resolveBase(env = process.env) {
  return env.VITE_BASE ?? DEFAULT_BASE
}
