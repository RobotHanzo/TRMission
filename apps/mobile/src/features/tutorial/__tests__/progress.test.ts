jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getTutorialCompletion, markTutorialCompleted } from '../progress';

beforeEach(() => AsyncStorage.clear());

describe('tutorial completion persistence', () => {
  it('is null before any completion', async () => {
    expect(await getTutorialCompletion()).toBeNull();
  });

  it('round-trips a completion', async () => {
    await markTutorialCompleted('core');
    const c = await getTutorialCompletion();
    expect(c?.scope).toBe('core');
    expect(typeof c?.completedAt).toBe('string');
  });

  it('treats corrupt or foreign payloads as absent', async () => {
    await AsyncStorage.setItem('trm.tutorial.completed.v1', '{not json');
    expect(await getTutorialCompletion()).toBeNull();
    await AsyncStorage.setItem('trm.tutorial.completed.v1', JSON.stringify({ scope: 'huge' }));
    expect(await getTutorialCompletion()).toBeNull();
  });
});
