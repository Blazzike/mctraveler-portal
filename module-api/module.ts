import type { OnlinePlayer } from '@/modules/OnlinePlayersModule';

export type ModuleDefinition<TApi = unknown> = {
  name: string;
  api: TApi;
  onEnable: () => void;
  onPlayerJoin?: (player: OnlinePlayer) => void;
  onPlayerLeave?: (player: OnlinePlayer) => void;
};

export function defineModule<TApi>(module: ModuleDefinition<TApi>): ModuleDefinition<TApi> {
  return module;
}

const enabledModules = new Set<string>();
const loadedModules = new Map<string, ModuleDefinition>();

export function enableModule(module: ModuleDefinition): void {
  if (enabledModules.has(module.name)) {
    return;
  }

  console.log(`[+ module] ${module.name}`);
  enabledModules.add(module.name);
  loadedModules.set(module.name, module);
  module.onEnable();
}

export function isModuleEnabled(moduleName: string): boolean {
  return enabledModules.has(moduleName);
}

export function getEnabledModules(): ModuleDefinition[] {
  return Array.from(loadedModules.values());
}

export function notifyPlayerJoin(player: OnlinePlayer): void {
  for (const module of loadedModules.values()) {
    module.onPlayerJoin?.(player);
  }
}

export function notifyPlayerLeave(player: OnlinePlayer): void {
  for (const module of loadedModules.values()) {
    module.onPlayerLeave?.(player);
  }
}

export function resetModules(): void {
  enabledModules.clear();
  loadedModules.clear();
}
