import { expect, test } from 'bun:test';
import { defineFeature, executeHook, FeatureHook, registerHook } from '@/feature-api/manager';

test('defineFeature > returns the same feature', () => {
  const feature = {
    name: 'TestFeature',
    onEnable: () => {},
  };

  const result = defineFeature(feature);
  expect(result).toBe(feature);
  expect(result.name).toBe('TestFeature');
});

test('registerHook > single hook', () => {
  const hook = FeatureHook.PlayerJoin;
  let called = false;

  registerHook(hook, () => {
    called = true;
    return 'result';
  });

  const results = executeHook(hook);
  expect(called).toBe(true);
  expect(results).toContain('result');
});

test('registerHook > multiple hooks on same event', () => {
  const hook = FeatureHook.PlayerLeave;
  const calls: string[] = [];

  registerHook(hook, () => {
    calls.push('first');
    return 'first';
  });

  registerHook(hook, () => {
    calls.push('second');
    return 'second';
  });

  const results = executeHook(hook);
  expect(calls).toEqual(['first', 'second']);
  expect(results).toEqual(['first', 'second']);
});

test('executeHook > with data parameter', () => {
  const hook = FeatureHook.PlayerChat;
  let receivedData: any = null;

  registerHook(hook, (data) => {
    receivedData = data;
    return data?.message;
  });

  const testData = { message: 'Hello World' };
  const results = executeHook(hook, testData);

  expect(receivedData).toEqual(testData);
  expect(results).toContain('Hello World');
});

test('executeHook > returns empty array for unregistered hook', () => {
  const results = executeHook(FeatureHook.PlayerInteract);
  expect(Array.isArray(results)).toBe(true);
});
