import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { enableFeatureForTesting, executeHook, FeatureHook, reset } from '@/feature-api/manager';
import TabListFeature from '@/features/TabListFeature';

describe('TabListFeature', () => {
  beforeAll(() => {
    reset();
    enableFeatureForTesting(TabListFeature);
  });

  afterAll(() => {
    reset();
  });

  test('returns header with MCTraveler', () => {
    const results = executeHook(FeatureHook.TabListHeaderRequest);

    expect(results).toHaveLength(1);
    const header = results[0];
    expect(header).toBeDefined();
    expect(header.toLegacyString()).toContain('MCTraveler');
  });

  test('returns footer with play.mctraveler.eu', () => {
    const results = executeHook(FeatureHook.TabListFooterRequest);

    expect(results).toHaveLength(1);
    const footer = results[0];
    expect(footer).toBeDefined();
    expect(footer.toLegacyString()).toContain('play.mctraveler.eu');
  });

  test('header has correct formatting', () => {
    const results = executeHook(FeatureHook.TabListHeaderRequest);
    const header = results[0];

    expect(header.toLegacyString()).toContain('§a');
  });

  test('footer has gray formatting', () => {
    const results = executeHook(FeatureHook.TabListFooterRequest);
    const footer = results[0];

    expect(footer.toLegacyString()).toContain('§7');
  });
});
