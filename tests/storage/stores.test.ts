import { MemoryStore } from "../../src/storage/memory";
import { SqliteStore } from "../../src/storage/sqlite";
import { betterSqliteDriver } from "./better-sqlite-driver";
import { storeContract } from "./contract";

storeContract("MemoryStore", () => new MemoryStore());
storeContract("SqliteStore", () => new SqliteStore(betterSqliteDriver()));
