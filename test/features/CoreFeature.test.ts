import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { enableFeatureForTesting, reset } from '@/feature-api/manager';
import { isModuleEnabled } from '@/module-api/module';
import CoreFeature from '@/features/CoreFeature';

describe('CoreFeature', () => {
  beforeAll(() => {
    reset();
    enableFeatureForTesting(CoreFeature);
  });

  afterAll(() => {
    reset();
  });

  test('enables OnlinePlayers module', () => {
    expect(isModuleEnabled('OnlinePlayers')).toBe(true);
  });

  test('enables Persistence module', () => {
    expect(isModuleEnabled('Persistence')).toBe(true);
  });

  test('enables Message module', () => {
    expect(isModuleEnabled('Message')).toBe(true);
  });

  test('enables TabList module', () => {
    expect(isModuleEnabled('TabList')).toBe(true);
  });

  test('enables CommandsInjection module', () => {
    expect(isModuleEnabled('CommandsInjection')).toBe(true);
  });

  test('enables HeldItem module', () => {
    expect(isModuleEnabled('HeldItem')).toBe(true);
  });

  test('enables PlayerInfoBitflags module', () => {
    expect(isModuleEnabled('PlayerInfoBitflags')).toBe(true);
  });

  test('enables ProtectionHooks module', () => {
    expect(isModuleEnabled('ProtectionHooks')).toBe(true);
  });

  test('enables XpOrbMerge module', () => {
    expect(isModuleEnabled('XpOrbMerge')).toBe(true);
  });

  test('does not enable unrelated modules', () => {
    expect(isModuleEnabled('NonExistentModule')).toBe(false);
  });
});
