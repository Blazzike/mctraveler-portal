import { defineFeature, FeatureHook, registerHook } from '@/feature-api/manager';
import p from '@/feature-api/paint';

export default defineFeature({
  name: 'TabList',
  onEnable: () => {
    registerHook(FeatureHook.TabListHeaderRequest, () => p`             ${p.green('MCTraveler Portal')}             \n`);
    registerHook(FeatureHook.TabListFooterRequest, () => p`\n${p.gray('           mctraveler.dev           ')}`);
  },
});
