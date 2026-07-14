import AsyncStorage from '@react-native-async-storage/async-storage';
import { hasRatedGame, markGameRated } from './ratedGames';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('ratedGames', () => {
  it('is unrated by default, rated after marking, and per-game', async () => {
    expect(await hasRatedGame('g1')).toBe(false);
    await markGameRated('g1');
    expect(await hasRatedGame('g1')).toBe(true);
    expect(await hasRatedGame('g2')).toBe(false);
  });

  it('accumulates ids instead of overwriting (the web key contract)', async () => {
    await markGameRated('g1');
    await markGameRated('g2');
    expect(JSON.parse((await AsyncStorage.getItem('trm.ratedGameIds')) ?? '[]')).toEqual(
      expect.arrayContaining(['g1', 'g2']),
    );
  });

  it('treats corrupt storage as unrated rather than throwing', async () => {
    await AsyncStorage.setItem('trm.ratedGameIds', 'not json');
    expect(await hasRatedGame('g1')).toBe(false);
    // marking still recovers into a valid list
    await markGameRated('g1');
    expect(await hasRatedGame('g1')).toBe(true);
  });
});
