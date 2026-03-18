/**
 * @fileoverview Centralized gem-themed toast notification store for Radiant Finance.
 *
 * Provides a single, app-wide toast queue that any component or store
 * can push messages into. Toasts auto-dismiss after a configurable duration
 * and are displayed by the root layout component.
 *
 * Gem theme mapping:
 *   - Ruby      — deletions, errors, blocked operations
 *   - Emerald   — success confirmations
 *   - Sapphire  — informational / neutral messages
 *   - Amethyst  — warnings
 */

import { writable } from 'svelte/store';

/** Visual gem type that drives colour/icon in the toast UI. */
export type ToastGem = 'ruby' | 'emerald' | 'sapphire' | 'amethyst';

export interface Toast {
  id: number;
  message: string;
  gem: ToastGem;
  duration: number;
  /** Timestamp when the toast was created (for fade timing). */
  createdAt: number;
}

let nextId = 0;

const { subscribe, update } = writable<Toast[]>([]);

/**
 * Add a toast notification to the queue.
 *
 * @param message  - The text content of the toast.
 * @param gem      - Gem colour theme. Default: 'sapphire'.
 * @param duration - Auto-dismiss delay in ms. Default: 3000.
 */
export function addToast(message: string, gem: ToastGem = 'sapphire', duration = 3000): void {
  const id = nextId++;
  update((toasts) => [...toasts, { id, message, gem, duration, createdAt: Date.now() }]);

  setTimeout(() => {
    dismissToast(id);
  }, duration);
}

/**
 * Remove a specific toast by ID.
 */
export function dismissToast(id: number): void {
  update((toasts) => toasts.filter((t) => t.id !== id));
}

/** The reactive toast store — subscribe to get the current toast queue. */
export const toastStore = { subscribe };
