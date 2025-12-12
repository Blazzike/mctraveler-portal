import { clearCommandsForTesting, setCurrentFeature } from '@/feature-api/command';
import type { Paint } from '@/feature-api/paint';
import { enableModule, type ModuleDefinition, resetModules } from '@/module-api/module';
import OnlinePlayersModule, { type OnlinePlayer } from '@/modules/OnlinePlayersModule';

export type PlayerEvent = {
  player: OnlinePlayer;
};

export type PlayerMoveEvent = PlayerEvent & {
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
};

type ModuleMap = Record<string, ModuleDefinition>;

type DefinedFeature<TModules extends ModuleMap = ModuleMap> = {
  name: string;
  modules?: TModules;
  onEnable: (modules: { [K in keyof TModules]: TModules[K]['api'] }) => void;
};

export function defineFeature<TModules extends ModuleMap>(definedFeature: DefinedFeature<TModules>): DefinedFeature<TModules> {
  return definedFeature;
}

let _currentFeatureName: string | null = null;

export enum FeatureHook {
  MotdRequest,
  PlayerJoin,
  PlayerLeave,
  PlayerJoinedMessage,
  PlayerLeftMessage,
  SystemChat,
  PlayerChat,
  PlayerMove,
  PlayerCommand,
  PlayerInteract,
  PlayerBlockPlace,
  PlayerBlockBreak,
  PlayerUseItem,
  TabListHeaderRequest,
  TabListFooterRequest,
  EditBook,
  HeldItemChange,
  InventoryClick,
  CheckBlockDigProtection,
  CheckBlockPlaceProtection,
  CheckContainerClickProtection,
  CheckSignEditProtection,
  CheckItemUseProtection,
  CheckEntityInteractProtection,
  ContainerOpen,
  ContainerClose,
  // Proxy lifecycle hooks
  PlayerGameModeChange,
  ClearPlayerProtection,
  GetRemappedProfile,
  BuildPlayerInfoPacket,
  BuildPlayerRemovePacket,
  BuildTabListHeaderFooterPacket,
  RemovePlayerFromTabList,
  SetProfileProperties,
  GetProfileProperties,
  GetOnlinePlayers,
  TrackPlayerLogin,
  TrackPlayerLogout,
  SetServerSwitcher,
  ClearServerSwitcher,
}

const registeredHooks = new Map<FeatureHook, Set<(data?: any) => any>>();
let isInitialized = false;

export function registerHook(hook: FeatureHook, callback: (data?: any) => any) {
  const existingHooks = registeredHooks.get(hook);
  if (existingHooks == null) {
    registeredHooks.set(hook, new Set([callback]));
  } else {
    existingHooks.add(callback);
  }
}

const loadedFeatures = new Map<string, DefinedFeature>();

function enableFeature(feature: DefinedFeature) {
  const moduleApis: Record<string, unknown> = {};

  if (feature.modules) {
    for (const [key, module] of Object.entries(feature.modules)) {
      enableModule(module as ModuleDefinition);
      moduleApis[key] = (module as ModuleDefinition).api;
    }
  }

  _currentFeatureName = feature.name;
  setCurrentFeature(feature.name);
  feature.onEnable(moduleApis as any);
  _currentFeatureName = null;
  setCurrentFeature(null);
  loadedFeatures.set(feature.name, feature as any);
}

export async function init() {
  if (isInitialized) {
    return;
  }

  isInitialized = true;

  const { default: definedFeatures } = await import('@/features/registry');

  for (const definedFeature of definedFeatures) {
    console.log(`[+ feature] ${definedFeature.name}`);
    enableFeature(definedFeature as DefinedFeature);
  }
}

export function reset() {
  registeredHooks.clear();
  loadedFeatures.clear();
  isInitialized = false;
  resetModules();
  clearCommandsForTesting();
  OnlinePlayersModule.api.clearOnlinePlayersForTesting();
}

export function enableFeatureForTesting(feature: DefinedFeature) {
  enableFeature(feature);
}

export function executeHook(hook: FeatureHook.MotdRequest): [Paint, Paint][];
export function executeHook(hook: FeatureHook, data?: any): any[];
export function executeHook(hook: FeatureHook, data?: any): any[] {
  return (
    registeredHooks
      .get(hook)
      ?.values()
      .map((hookFn) => hookFn(data))
      .toArray() ?? []
  );
}

export function executeHookFirst<T>(hook: FeatureHook, data?: any): T | undefined {
  const results = executeHook(hook, data);
  return results.find((r) => r !== undefined && r !== null) as T | undefined;
}
