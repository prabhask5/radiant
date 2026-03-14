/**
 * @fileoverview SvelteKit project configuration for Radiant.
 *
 * Keeps things minimal:
 *   - **Adapter** — `adapter-auto` automatically selects the right deployment
 *     adapter (Vercel, Netlify, Cloudflare, Node, etc.) based on the detected
 *     environment, so the config stays portable across hosting providers.
 *   - **Preprocessor** — `vitePreprocess` handles `<style lang="...">` and
 *     `<script lang="ts">` blocks using the Vite pipeline, keeping tooling
 *     consistent between Svelte components and the rest of the build.
 */

// =============================================================================
//                                  IMPORTS
// =============================================================================

import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// =============================================================================
//                           SVELTEKIT CONFIGURATION
// =============================================================================

/** @type {import('@sveltejs/kit').Config} */
const config = {
  /** Use Vite's built-in transform pipeline for TypeScript, PostCSS, etc. */
  preprocess: vitePreprocess(),

  kit: {
    /**
     * `adapter-auto` inspects the deploy target at build time and picks
     * the appropriate adapter automatically — no manual switching needed
     * when moving between local dev, Vercel, or other platforms.
     */
    adapter: adapter()
  }
};

export default config;
