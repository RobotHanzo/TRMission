// DI tokens for the shared Mongo handle + game store, so repositories can inject the
// database and tests can override it with an in-memory server.
export const MONGO_DB = Symbol('MONGO_DB');
export const GAME_STORE = Symbol('GAME_STORE');
