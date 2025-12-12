import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { enableFeatureForTesting, executeHook, FeatureHook, reset } from '@/feature-api/manager';
import p from '@/feature-api/paint';
import MotdFeature from '@/features/MotdFeature';

describe('MotdFeature', () => {
  beforeAll(() => {
    reset();
    enableFeatureForTesting(MotdFeature);
  });

  afterAll(() => {
    reset();
  });

  test('returns formatted MOTD with server name and tagline', () => {
    const results = executeHook(FeatureHook.MotdRequest);

    expect(results).toHaveLength(1);
    const motd = results[0] as [any, any];
    expect(motd).toHaveLength(2);

    const [line1, line2] = motd;

    // First line: server name with bold "MCTraveler"
    const expectedLine1 = p.green`                  play.${p.bold`MCTraveler`}.eu`;
    expect(line1.toLegacyString()).toBe(expectedLine1.toLegacyString());

    // Second line: tagline in gray
    const expectedLine2 = p.gray`       Celebrating 13 years of vanilla survival`;
    expect(line2.toLegacyString()).toBe(expectedLine2.toLegacyString());
  });

  test('MOTD lines have correct formatting codes', () => {
    const results = executeHook(FeatureHook.MotdRequest);
    const motd = results[0] as [any, any];
    const [line1, line2] = motd;

    // Verify the actual Minecraft color codes
    expect(line1.toLegacyString()).toContain('§a'); // green
    expect(line1.toLegacyString()).toContain('§l'); // bold
    expect(line2.toLegacyString()).toContain('§7'); // gray
  });
});
