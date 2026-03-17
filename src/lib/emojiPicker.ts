/**
 * @fileoverview Curated finance-relevant emoji set for category creation.
 *
 * ~80 emojis organized by group for the category emoji picker grid.
 */

export interface EmojiGroup {
  label: string;
  emojis: string[];
}

export const EMOJI_GROUPS: EmojiGroup[] = [
  {
    label: 'Food & Drink',
    emojis: ['🛒', '🍽️', '☕', '🍔', '🍕', '🍺', '🍷', '🧁', '🥗', '🍣']
  },
  {
    label: 'Housing',
    emojis: ['🏠', '🏦', '💡', '⚡', '💧', '🔨', '🛋️', '🌐', '📱', '🔑']
  },
  {
    label: 'Transport',
    emojis: ['⛽', '🚗', '🚌', '🚕', '✈️', '🅿️', '🚲', '🛵', '🚇', '🛡️']
  },
  {
    label: 'Health',
    emojis: ['🏥', '💊', '🦷', '🏋️', '🧘', '👨‍⚕️', '❤️‍🩹', '🩺']
  },
  {
    label: 'Shopping',
    emojis: ['🛍️', '👕', '💻', '📱', '👟', '💄', '🎒', '🕶️']
  },
  {
    label: 'Entertainment',
    emojis: ['🎬', '📺', '🎮', '🎵', '📚', '🎨', '🎭', '🎳']
  },
  {
    label: 'Finance',
    emojis: ['💰', '💼', '📈', '💳', '💵', '📊', '🏛️', '🐖']
  },
  {
    label: 'Personal',
    emojis: ['💇', '🎁', '❤️', '👶', '🐾', '📋', '🎓', '👕']
  },
  {
    label: 'General',
    emojis: ['🔄', '🤷', '🔥', '⭐', '📌', '🏷️', '↩️', '🌐']
  }
];

/** Flat array of all curated emojis. */
export const ALL_EMOJIS = EMOJI_GROUPS.flatMap((g) => g.emojis);

/** Default color palette for categories. */
export const CATEGORY_COLORS = [
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
  '#6366f1',
  '#0ea5e9',
  '#22c55e',
  '#a855f7',
  '#64748b',
  '#dc2626',
  '#0d9488',
  '#d97706',
  '#7c3aed',
  '#059669',
  '#e11d48',
  '#0284c7'
];
