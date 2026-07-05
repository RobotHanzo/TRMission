import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, type Db } from 'mongodb';
import { MongoGameStore, ensureIndexes } from '../src/persistence/game-store';

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let store: MongoGameStore;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = new MongoClient(mongod.getUri());
  await client.connect();
  db = client.db('trm-test');
  await ensureIndexes(db);
  store = new MongoGameStore(db);
});

afterAll(async () => {
  await client.close();
  await mongod.stop();
});

describe('chat persistence', () => {
  it('appends and loads chat entries in order', async () => {
    await store.appendChat('cg', 0, 'p1', { case: 'text', value: 'first' });
    await store.appendChat('cg', 1, 'p2', { case: 'text', value: 'second' });
    const out = await store.loadChat('cg');
    expect(out.map((c) => c.content)).toEqual([
      { case: 'text', value: 'first' },
      { case: 'text', value: 'second' },
    ]);
    expect(out[0]?.playerId).toBe('p1');
    expect(typeof out[0]?.ts).toBe('number');
  });

  it('keeps games isolated and rejects duplicate (gameId, seq)', async () => {
    await store.appendChat('cg2', 0, 'p1', { case: 'text', value: 'x' });
    expect(await store.loadChat('cg2')).toHaveLength(1);
    await expect(
      store.appendChat('cg2', 0, 'p1', { case: 'text', value: 'dup' }),
    ).rejects.toBeTruthy();
  });

  it('persists a preset chat entry distinctly from free text', async () => {
    await store.appendChat('cg3', 0, 'p1', { case: 'text', value: 'hi' });
    await store.appendChat('cg3', 1, 'p2', { case: 'presetId', value: 'GOOD_LUCK' });
    const out = await store.loadChat('cg3');
    expect(out[0]?.content).toEqual({ case: 'text', value: 'hi' });
    expect(out[1]?.content).toEqual({ case: 'presetId', value: 'GOOD_LUCK' });
  });
});
