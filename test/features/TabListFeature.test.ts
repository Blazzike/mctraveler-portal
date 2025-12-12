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

  test('returns header with MCTraveler Portal', () => {
    const results = executeHook(FeatureHook.TabListHeaderRequest);

    expect(results).toHaveLength(1);
    const header = results[0];
    expect(header).toBeDefined();
    expect(header.toLegacyString()).toContain('MCTraveler Portal');
  });

  test('returns footer with mctraveler.dev', () => {
    const results = executeHook(FeatureHook.TabListFooterRequest);

    expect(results).toHaveLength(1);
    const footer = results[0];
    expect(footer).toBeDefined();
    expect(footer.toLegacyString()).toContain('mctraveler.dev');
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
