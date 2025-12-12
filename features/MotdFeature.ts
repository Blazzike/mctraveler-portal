import { defineFeature, FeatureHook, registerHook } from '@/feature-api/manager';
import p from '@/feature-api/paint';

export default defineFeature({
  name: 'MotdFeature',
  onEnable() {
    registerHook(FeatureHook.MotdRequest, () => [
      p.green`                  play.${p.bold`MCTraveler`}.eu`,
      p.gray`       Celebrating 13 years of vanilla survival`,
    ]);
  },
});
