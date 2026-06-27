// MongoDB connection factory. Kept tiny and separate so tests can inject their own
// Db (mongodb-memory-server) without going through this.
import { MongoClient, type Db } from 'mongodb';

let client: MongoClient | null = null;

export async function connectMongo(url: string, dbName: string): Promise<Db> {
  client = new MongoClient(url, { serverSelectionTimeoutMS: 3000 });
  await client.connect();
  return client.db(dbName);
}

export async function closeMongo(): Promise<void> {
  await client?.close();
  client = null;
}
