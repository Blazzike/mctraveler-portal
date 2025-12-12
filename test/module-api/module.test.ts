import { afterEach, describe, expect, test } from 'bun:test';
import { defineModule, enableModule, getEnabledModules, isModuleEnabled, resetModules } from '@/module-api/module';

describe('module API', () => {
  afterEach(() => {
    resetModules();
  });

  describe('defineModule', () => {
    test('returns the module definition with api', () => {
      const api = { greet: () => 'hello' };
      const module = defineModule({
        name: 'TestModule',
        api,
        onEnable: () => {},
      });

      expect(module.name).toBe('TestModule');
      expect(module.api).toBe(api);
      expect(typeof module.onEnable).toBe('function');
    });
  });

  describe('enableModule', () => {
    test('enables a module', () => {
      const module = defineModule({
        name: 'EnableTestModule',
        api: {},
        onEnable: () => {},
      });

      enableModule(module);

      expect(isModuleEnabled('EnableTestModule')).toBe(true);
    });

    test('calls onEnable when module is enabled', () => {
      let called = false;
      const module = defineModule({
        name: 'OnEnableTestModule',
        api: {},
        onEnable: () => {
          called = true;
        },
      });

      enableModule(module);

      expect(called).toBe(true);
    });

    test('does not enable the same module twice', () => {
      let callCount = 0;
      const module = defineModule({
        name: 'DoubleEnableModule',
        api: {},
        onEnable: () => {
          callCount++;
        },
      });

      enableModule(module);
      enableModule(module);

      expect(callCount).toBe(1);
    });
  });

  describe('isModuleEnabled', () => {
    test('returns false for non-enabled module', () => {
      expect(isModuleEnabled('NonExistentModule')).toBe(false);
    });

    test('returns true for enabled module', () => {
      const module = defineModule({
        name: 'CheckEnabledModule',
        api: {},
        onEnable: () => {},
      });

      enableModule(module);

      expect(isModuleEnabled('CheckEnabledModule')).toBe(true);
    });
  });

  describe('getEnabledModules', () => {
    test('returns empty array when no modules enabled', () => {
      expect(getEnabledModules()).toEqual([]);
    });

    test('returns all enabled modules', () => {
      const module1 = defineModule({ name: 'Module1', api: {}, onEnable: () => {} });
      const module2 = defineModule({ name: 'Module2', api: {}, onEnable: () => {} });

      enableModule(module1);
      enableModule(module2);

      const modules = getEnabledModules();
      expect(modules).toHaveLength(2);
      expect(modules.map((m) => m.name)).toContain('Module1');
      expect(modules.map((m) => m.name)).toContain('Module2');
    });
  });

  describe('resetModules', () => {
    test('clears all enabled modules', () => {
      const module = defineModule({ name: 'ResetTestModule', api: {}, onEnable: () => {} });
      enableModule(module);

      resetModules();

      expect(isModuleEnabled('ResetTestModule')).toBe(false);
      expect(getEnabledModules()).toEqual([]);
    });
  });
});
