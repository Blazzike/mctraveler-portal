# Module Investigation Report

## Summary

This document investigates whether modules modify gameplay directly (instead of via hooks) and if modules are used outside of features.

---

## 1. Modules Used Outside of Features

### Direct Module Imports in Non-Feature Code

| Location | Module Imported | Usage |
|----------|----------------|-------|
| `feature-api/manager.ts` | `OnlinePlayersModule` | `api.clearOnlinePlayersForTesting()` n `reset()` function | | `module-api/module.ts` | `OnlinePlayersModule` | Type import only (`OnlinePlayer`) |esodl ### Modules Importing Other Modules Directly

| Module | Imports | Direct API Calls | 
|--------|---------|------------------|
| `MessageModule` | `OnlinePlayersModule` | `OnlinePlayersModule.api.getOnlinePlayers()` |
| `TabListModule` | `OnlinePlayersModule` | `OnlinePlayersModule.api.getPlayerByOfflineUuid()` |
| `PlayerInfoBitflagsModule` | `OnlinePlayersModule`, `TabListModule` | `OnlinePlayersModule.api.getPlayerByOfflineUuid()`, `TabListModule.api.getProfileProperties()` |
| `ProtectionHooksModule` | `HeldItemModule`, `OnlinePlayersModule` | `HeldItemModule.api.isHoldingItem()`, `OnlinePlayersModule.api.getOnlinePlayer()` |
| `CommandsInjectionModule` | `OnlinePlayersModule` | `OnlinePlayersModule.api.getOnlinePlayer()`, `api.getPlayerByOfflineUuid()` |

---

## 2. Features Using Module APIs Directly

| Feature | Module | Direct API Calls |
|---------|--------|------------------|
| `AwayFeature` | `MessageModule` | `MessageModule.api.broadcast()` |
| `AwayFeature` | `OnlinePlayersModule` | `OnlinePlayersModule.api.getOnlinePlayers()` |
| `AdminFeature` | `PersistenceModule` | `api.isPlayerAdmin()`, `api.setPlayerAdmin()` |
| `RegionFeature` | `PersistenceModule` | `api.getUsernameFromUuid()`, `api.isPlayerAdmin()` |
| `NotepadFeature` | `PersistenceModule` | `api.readNotepadData()`, `api.writeNotepadData()` |

---

## 3. Modules That Directly Modify Gameplay

### ✅ Correctly Using Hooks

| Module | Mechanism | Notes |
|--------|-----------|-------|
| `ProtectionHooksModule` | Uses `executeHook()` | Calls hooks like `CheckBlockDigProtection` before blocking actions |
| `TabListModule` | Uses `registerHook()` | Registers hooks for `BuildPlayerInfoPacket`, `SetProfileProperties`, etc. |
| `OnlinePlayersModule` | Uses `registerHook()` | Registers hooks for `TrackPlayerLogin`, `TrackPlayerLogout`, etc. |

### ⚠️ Directly Modifying Packets (No Hook)

| Module | Mechanism | Concern |
|--------|-----------|---------|
| `TabListModule` | `onServerToClientTransform()` | Transforms tab list packets directly |
| `PlayerInfoBitflagsModule` | `onServerToClientTransform()` | Rewrites player info packets directly |
| `CommandsInjectionModule` | `onServerToClientTransform()` | Injects custom commands into command tree |
| `HeldItemModule` | `onClientToServerPacket()`, `onServerToClientPacket()` | Tracks held item changes |
| `ProtectionHooksModule` | `onClientToServerPacket()`, `onServerToClientPacket()` | Intercepts packets but uses hooks for decisions |

### Modules With No Gameplay Impact (Pure Data/Utility)

| Module | Purpose |
|--------|---------|
| `PersistenceModule` | File I/O for player data |
| `SyncModule` | Syncs NBT data between servers |
| `ChatModule` | Provides chat parsing API only |
| `CommandModule` | Provides command parsing API only |
| `PlayerPositionModule` | Tracks player positions |
| `PlayerInteractionModule` | Provides interaction handler API |

---

## 4. Recommendations

### High Priority

1. ~~**`OnlinePlayersModule` in `manager.ts`**~~ - ✅ Acceptable: Testing reset function needs direct access for cleanup.

### Medium Priority

2. **Cross-module dependencies** - ✅ Acceptable: Infrastructure modules like `PlayerInfoBitflagsModule` legitimately depend on `TabListModule` and `OnlinePlayersModule` for packet transformation. These are tightly coupled by design.

3. **Features calling module APIs directly** - ✅ Acceptable: Features like `AwayFeature`, `AdminFeature`, `RegionFeature`, `NotepadFeature` calling module APIs is the intended pattern. Modules are now properly enabled.

### Low Priority

4. **Packet transform modules** - ✅ Acceptable: `TabListModule`, `PlayerInfoBitflagsModule`, `CommandsInjectionModule` transform packets directly as infrastructure-level modules.

---

## 5. Module Enablement Status

| Module | Enabled Via Feature | Status |
|--------|---------------------|--------|
| `OnlinePlayersModule` | `CoreFeature` | ✅ Fixed |
| `CommandsInjectionModule` | `CoreFeature` | ✅ |
| `HeldItemModule` | `CoreFeature` | ✅ |
| `PlayerInfoBitflagsModule` | `CoreFeature` | ✅ |
| `ProtectionHooksModule` | `CoreFeature` | ✅ |
| `MessageModule` | `CoreFeature` | ✅ Fixed |
| `PersistenceModule` | `CoreFeature` | ✅ Fixed |
| `TabListModule` | `CoreFeature` | ✅ Fixed |
| `SyncModule` | ❌ None | ℹ️ Empty onEnable, API-only usage |
| `ChatModule` | ❌ None | ℹ️ Empty onEnable, not actively used |
| `CommandModule` | ❌ None | ℹ️ Empty onEnable, not actively used |
| `PlayerPositionModule` | ❌ None | ℹ️ Empty onEnable, not actively used |
| `PlayerInteractionModule` | ❌ None | ℹ️ Empty onEnable, not actively used |

**Note:** Modules with empty `onEnable` functions and no `onPlayerJoin`/`onPlayerLeave` hooks don't need to be explicitly enabled unless their registration matters for lifecycle events.
