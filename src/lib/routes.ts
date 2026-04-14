/**
 * @fileoverview Application route path constants.
 *
 * Centralises every hardcoded route string used in `goto()` and `redirect()`
 * calls so that paths are defined once and can be refactored without grep.
 */

export const ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  CONFIRM: '/confirm',
  SETUP: '/setup',
  PROFILE: '/profile',
  DEMO: '/demo',
  POLICY: '/policy',
  BUDGET: '/budget',
  TRANSACTIONS: '/transactions',
  ACCOUNTS: '/accounts'
} as const;
