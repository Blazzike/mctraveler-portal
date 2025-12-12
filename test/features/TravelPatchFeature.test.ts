import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { enableFeatureForTesting, reset } from '@/feature-api/manager';
import TravelPatchFeature, { getRemappedProfile } from '@/features/TravelPatchFeature';

describe('TravelPatchFeature', () => {
  beforeAll(() => {
    reset();
    enableFeatureForTesting(TravelPatchFeature);
  });

  afterAll(() => {
    reset();
  });

  describe('getRemappedProfile', () => {
    test('returns remap for DemonicNoodle', () => {
      const remap = getRemappedProfile('DemonicNoodle');

      expect(remap).not.toBeNull();
      expect(remap!.newUsername).toBe('travelcraft2012');
      expect(remap!.newUuid).toBe('461789c5-4501-48a0-b47d-7574c9a7b9ec');
    });

    test('returns remap for AlsoJames', () => {
      const remap = getRemappedProfile('AlsoJames');

      expect(remap).not.toBeNull();
      expect(remap!.newUsername).toBe('iElmo');
      expect(remap!.newUuid).toBe('be9482bb-6bcd-4df3-9cf4-9f1fb61c5e93');
    });

    test('returns null for unknown username', () => {
      const remap = getRemappedProfile('SomeRandomPlayer');

      expect(remap).toBeNull();
    });

    test('is case-sensitive', () => {
      const remap = getRemappedProfile('demonicnoodle');

      expect(remap).toBeNull();
    });
  });
});
