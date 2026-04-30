import { defineFeature, FeatureHook, registerHook } from '@/feature-api/manager';
import p from '@/feature-api/paint';
import TpsModule from '@/modules/TpsModule';

export default defineFeature({
  name: 'TabList',
  onEnable: () => {
    registerHook(FeatureHook.TabListHeaderRequest, () => p`             ${p.green('MCTraveler')}             \n`);
    registerHook(FeatureHook.TabListFooterRequest, () => p`\n${p.gray('          play.mctraveler.eu          ')}\n${p.darkGray('TPS: ')}${p.yellow(TpsModule.api.getTps().toFixed(1))}`);
  },
});
