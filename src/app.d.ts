/**
 * @fileoverview Ambient type declarations for the Radiant SvelteKit application.
 *
 * This file extends the global `App` namespace used by SvelteKit to provide
 * type safety for framework-level hooks (`locals`, `pageData`, `error`, etc.).
 *
 * Currently, no custom interfaces are needed — the defaults provided by
 * `@sveltejs/kit` are sufficient. Uncomment and populate the stubs below
 * when server-side locals or shared page data types are introduced.
 *
 * @see https://kit.svelte.dev/docs/types#app — SvelteKit `App` namespace docs
 */

// =============================================================================
//                         SVELTEKIT TYPE REFERENCES
// =============================================================================

/// <reference types="@sveltejs/kit" />

// =============================================================================
//                        GLOBAL APP TYPE DECLARATIONS
// =============================================================================

declare global {
  namespace App {
    /**
     * Extend `App.Locals` to type data attached to `event.locals` inside
     * SvelteKit hooks (e.g., authenticated user objects, request metadata).
     */
    // interface Locals {}
    /**
     * Extend `App.PageData` to type shared data returned from all
     * `+layout.server.ts` / `+page.server.ts` load functions.
     */
    // interface PageData {}
  }
}

/**
 * Ensures this file is treated as an **ES module** (required for ambient
 * `declare global` blocks to work correctly in TypeScript).
 */
export {};
