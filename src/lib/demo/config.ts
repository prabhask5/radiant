/**
 * @fileoverview Demo config — Radiant Finance demo-mode wiring.
 *
 * Exports a single `demoConfig` object that satisfies the `DemoConfig`
 * contract from `stellar-drive`. This config is passed into
 * `initEngine({ demo: demoConfig })` in the root `+layout.ts` loader.
 *
 * When the user navigates to `/demo`, the engine activates demo mode:
 * 1. Creates a fake offline auth session using {@link demoConfig.mockProfile}.
 * 2. Calls {@link seedDemoData} to populate IndexedDB with realistic
 *    financial data (enrollments, accounts, categories, transactions).
 * 3. The app runs fully offline — no Supabase calls, no sync.
 *
 * Demo mode persists until the user explicitly signs out or clears storage.
 */

// =============================================================================
//                                  IMPORTS
// =============================================================================

import type { DemoConfig } from 'stellar-drive/demo';
import { seedDemoData } from './mockData';

// =============================================================================
//                              DEMO CONFIGURATION
// =============================================================================

/**
 * Demo-mode configuration for Radiant Finance.
 *
 * @property seedData - Async function that populates the Dexie database with
 *   mock financial records (enrollments, accounts, categories, transactions).
 * @property mockProfile - The fake user profile displayed in demo mode.
 *   Uses a themed email and generic name so the demo feels branded.
 */
export const demoConfig: DemoConfig = {
  seedData: seedDemoData,
  mockProfile: {
    email: 'gemologist@radiant.demo',
    firstName: 'Radiant',
    lastName: 'Explorer'
  }
};
