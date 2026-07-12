import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSettings } from './settings';

describe('settings store', () => {
  it('defaults: haptics on, notifications off, prompt unseen', () => {
    const s = useSettings.getState();
    expect(s.haptics).toBe(true);
    expect(s.notifications).toBe(false);
    expect(s.pushPromptSeen).toBe(false);
  });

  it('setters flip and persist', async () => {
    useSettings.getState().setHaptics(false);
    useSettings.getState().setNotifications(true);
    useSettings.getState().markPushPromptSeen();
    expect(useSettings.getState().haptics).toBe(false);
    expect(useSettings.getState().notifications).toBe(true);
    expect(useSettings.getState().pushPromptSeen).toBe(true);
    // persist middleware writes asynchronously; flush microtasks then check storage.
    await new Promise((r) => setTimeout(r, 0));
    const raw = await AsyncStorage.getItem('trm-settings');
    expect(raw).toContain('"haptics":false');
  });
});
