import { defineFeature, FeatureHook, registerHook } from '@/feature-api/manager';

interface ProfileRemap {
  newUsername: string;
  newUuid: string;
}

const profileRemaps = new Map<string, ProfileRemap>([
  ['DemonicNoodle', { newUsername: 'travelcraft2012', newUuid: '461789c5-4501-48a0-b47d-7574c9a7b9ec' }],
  ['AlsoJames', { newUsername: 'iElmo', newUuid: 'be9482bb-6bcd-4df3-9cf4-9f1fb61c5e93' }],
]);

export function getRemappedProfile(username: string): ProfileRemap | null {
  return profileRemaps.get(username) ?? null;
}

export default defineFeature({
  name: 'TravelPatch',
  onEnable: () => {
    console.log(`[TravelPatch] Loaded ${profileRemaps.size} profile remaps`);

    registerHook(FeatureHook.GetRemappedProfile, ({ username }) => {
      return getRemappedProfile(username);
    });
  },
});
