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

/** Maps each FeatureHook to its expected data type and return type. */
export interface HookMap {
  [FeatureHook.MotdRequest]: { data: void; return: [Paint, Paint] };
  [FeatureHook.PlayerJoin]: { data: PlayerEvent; return: void };
  [FeatureHook.PlayerLeave]: { data: PlayerEvent; return: void };
  [FeatureHook.PlayerJoinedMessage]: { data: { username: string }; return: Paint | undefined };
  [FeatureHook.PlayerLeftMessage]: { data: { username: string }; return: Paint | undefined };
  [FeatureHook.SystemChat]: { data: { nbt: Buffer; isActionBar: boolean }; return: Paint | false | null | undefined };
  [FeatureHook.PlayerChat]: { data: PlayerEvent & { message: string }; return: Paint | void };
  [FeatureHook.PlayerMove]: { data: PlayerMoveEvent; return: void };
  [FeatureHook.PlayerCommand]: { data: PlayerEvent & { command: string }; return: void };
  [FeatureHook.PlayerInteract]: { data: PlayerEvent & { packetData: Buffer }; return: void };
  [FeatureHook.PlayerBlockPlace]: { data: PlayerEvent & { packetData: Buffer }; return: void };
  [FeatureHook.PlayerBlockBreak]: { data: PlayerEvent & { packetData: Buffer }; return: void };
  [FeatureHook.PlayerUseItem]: { data: PlayerEvent & { packetData: Buffer }; return: void };
  [FeatureHook.TabListHeaderRequest]: { data: void; return: Paint | undefined };
  [FeatureHook.TabListFooterRequest]: { data: void; return: Paint | undefined };
  [FeatureHook.EditBook]: { data: PlayerEvent & { packetData: Buffer }; return: boolean | undefined };
  [FeatureHook.HeldItemChange]: { data: PlayerEvent & { packetData: Buffer }; return: void };
  [FeatureHook.InventoryClick]: { data: PlayerEvent & { packetData: Buffer }; return: void };
  [FeatureHook.CheckBlockDigProtection]: {
    data: PlayerEvent & { position: { x: number; y: number; z: number }; world: string };
    return: boolean | undefined;
  };
  [FeatureHook.CheckBlockPlaceProtection]: {
    data: PlayerEvent & { position: { x: number; y: number; z: number }; world: string };
    return: boolean | undefined;
  };
  [FeatureHook.CheckContainerClickProtection]: { data: PlayerEvent; return: boolean | undefined };
  [FeatureHook.CheckSignEditProtection]: {
    data: PlayerEvent & { position: { x: number; y: number; z: number }; world: string };
    return: boolean | undefined;
  };
  [FeatureHook.CheckItemUseProtection]: { data: PlayerEvent; return: boolean | undefined };
  [FeatureHook.CheckEntityInteractProtection]: {
    data: PlayerEvent & { action: 'attack' | 'interact' | 'interact_at'; isHoldingItem: boolean };
    return: boolean | undefined;
  };
  [FeatureHook.ContainerOpen]: { data: PlayerEvent; return: void };
  [FeatureHook.ContainerClose]: { data: PlayerEvent; return: void };
  [FeatureHook.PlayerGameModeChange]: { data: PlayerEvent & { gameMode: number }; return: void };
  [FeatureHook.ClearPlayerProtection]: { data: PlayerEvent; return: void };
  [FeatureHook.GetRemappedProfile]: { data: { username: string }; return: { newUsername: string; newUuid: string } | null | undefined };
  [FeatureHook.BuildPlayerInfoPacket]: { data: { uuid: string; username: string; props: any[] }; return: Buffer | undefined };
  [FeatureHook.BuildPlayerRemovePacket]: { data: { uuid: string }; return: Buffer | undefined };
  [FeatureHook.BuildTabListHeaderFooterPacket]: { data: void; return: Buffer | null | undefined };
  [FeatureHook.RemovePlayerFromTabList]: { data: { uuid: string }; return: void };
  [FeatureHook.SetProfileProperties]: { data: { uuid: string; props: any[] }; return: void };
  [FeatureHook.GetProfileProperties]: { data: { uuid: string }; return: any[] | undefined };
  [FeatureHook.GetOnlinePlayers]: { data: void; return: OnlinePlayer[] | undefined };
  [FeatureHook.TrackPlayerLogin]: {
    data: { uuid: string; username: string; socket: any; serverPort: number; isPremium: boolean; offlineUuid: string };
    return: OnlinePlayer | undefined;
  };
  [FeatureHook.TrackPlayerLogout]: { data: { uuid: string }; return: void };
  [FeatureHook.SetServerSwitcher]: { data: { uuid: string; switcher: (port: number) => Promise<void> }; return: void };
  [FeatureHook.ClearServerSwitcher]: { data: { uuid: string }; return: void };
}

type HookCallback<H extends FeatureHook> = (data: HookMap[H]['data']) => HookMap[H]['return'];

const registeredHooks = new Map<FeatureHook, Set<(data?: any) => any>>();
let isInitialized = false;

export function registerHook<H extends FeatureHook>(hook: H, callback: HookCallback<H>): void {
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

export function enableFeatureForTesting<TModules extends ModuleMap>(feature: DefinedFeature<TModules>) {
  enableFeature(feature as DefinedFeature);
}

// Overloads: typed when hook is a literal FeatureHook enum member
export function executeHook<H extends FeatureHook>(hook: H, data: HookMap[H]['data']): HookMap[H]['return'][];
// Fallback: untyped for dynamic hook values
export function executeHook(hook: FeatureHook, data?: any): any[];
// Implementation
export function executeHook(hook: FeatureHook, data?: any): any[] {
  return (
    registeredHooks
      .get(hook)
      ?.values()
      .map((hookFn) => hookFn(data))
      .toArray() ?? []
  );
}

// Overloads: typed return when hook is a literal FeatureHook enum member
export function executeHookFirst<H extends FeatureHook>(hook: H, data: HookMap[H]['data']): HookMap[H]['return'] | undefined;
// Fallback: explicit generic for when caller knows the return type
export function executeHookFirst<T>(hook: FeatureHook, data?: any): T | undefined;
// Implementation
export function executeHookFirst<T>(hook: FeatureHook, data?: any): T | undefined {
  const results = executeHook(hook, data);
  return results.find((r) => r !== undefined && r !== null) as T | undefined;
}
