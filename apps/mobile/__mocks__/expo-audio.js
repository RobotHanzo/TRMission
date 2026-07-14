// expo-audio's native module isn't present under jest-expo, and its module evaluation throws
// before any code can guard it (same class as the Skia/lucide mocks beside this file). The sound
// player already tolerates a null per-cue player, so an inert factory is a faithful double.
module.exports = {
  createAudioPlayer: () => null,
  setAudioModeAsync: async () => undefined,
};
