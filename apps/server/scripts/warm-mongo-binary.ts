// CI tool: downloads/extracts the mongod binary once, serially, before the e2e suite's ~40
// spec files spin up in parallel and each call MongoMemoryServer.create(). On a cold cache,
// mongodb-memory-server-core's cross-process download lock (util/lockfile.ts) has a real race
// under heavy concurrent contention — multiple processes can all observe the lock as "available"
// in the same poll window and overwrite each other's lockfile, so a later unlock() sees a
// different pid and throws "not locked by this process". Once the binary is already extracted
// on disk, MongoBinary.getPath() resolves it via a plain existence check and never touches the
// lock at all, so no test process needs to download or lock anything.
//
//   yarn workspace @trm/server warm-mongo
import { MongoMemoryServer } from 'mongodb-memory-server';

const server = await MongoMemoryServer.create();
console.log(`Warmed mongod binary (uri: ${server.getUri()})`);
await server.stop();
