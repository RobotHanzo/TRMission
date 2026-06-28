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
    await store.appendChat('cg', 0, 'p1', 'first');
    await store.appendChat('cg', 1, 'p2', 'second');
    const out = await store.loadChat('cg');
    expect(out.map((c) => c.text)).toEqual(['first', 'second']);
    expect(out[0]?.playerId).toBe('p1');
    expect(typeof out[0]?.ts).toBe('number');
  });

  it('keeps games isolated and rejects duplicate (gameId, seq)', async () => {
    await store.appendChat('cg2', 0, 'p1', 'x');
    expect(await store.loadChat('cg2')).toHaveLength(1);
    await expect(store.appendChat('cg2', 0, 'p1', 'dup')).rejects.toBeTruthy();
  });
});
