import { defineFeature } from '@/feature-api/manager';
import CommandsInjectionModule from '@/modules/CommandsInjectionModule';
import HeldItemModule from '@/modules/HeldItemModule';
import MessageModule from '@/modules/MessageModule';
import OnlinePlayersModule from '@/modules/OnlinePlayersModule';
import PersistenceModule from '@/modules/PersistenceModule';
import PlayerInfoBitflagsModule from '@/modules/PlayerInfoBitflagsModule';
import ProtectionHooksModule from '@/modules/ProtectionHooksModule';
import TabListModule from '@/modules/TabListModule';

export default defineFeature({
  name: 'Core',
  modules: {
    onlinePlayers: OnlinePlayersModule,
    persistence: PersistenceModule,
    message: MessageModule,
    tabList: TabListModule,
    commands: CommandsInjectionModule,
    heldItem: HeldItemModule,
    playerInfo: PlayerInfoBitflagsModule,
    protection: ProtectionHooksModule,
  },
  onEnable: () => {},
});
