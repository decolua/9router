// Minimal ambient declarations for native/untyped database modules.
// Declares ONLY the surface each adapter in src/lib/db/adapters/ actually uses.

declare module "better-sqlite3" {
  interface RunResult {
    changes: number;
    lastInsertRowid: number;
  }
  interface Statement {
    run(params?: unknown[]): RunResult;
    get(params?: unknown[]): unknown;
    all(params?: unknown[]): unknown[];
  }
  interface Database {
    exec(sql: string): void;
    prepare(sql: string): Statement;
    pragma(sql: string): unknown;
    transaction(fn: () => void): () => void;
    close(): void;
  }
  interface DatabaseConstructor {
    new (path: string): Database;
  }
  const Database: DatabaseConstructor;
  export default Database;
}

declare module "sql.js" {
  interface QueryExecResult {
    columns: string[];
    values: unknown[][];
  }
  interface Statement {
    bind(params?: unknown): void;
    step(): boolean;
    free(): void;
    getAsObject(): Record<string, unknown>;
  }
  interface Database {
    exec(sql: string): QueryExecResult[];
    prepare(sql: string): Statement;
    getRowsModified(): number;
    export(): Uint8Array;
    close(): void;
  }
  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | null) => Database;
  }
  export default function initSqlJs(): Promise<SqlJsStatic>;
}

declare module "bun:sqlite" {
  interface RunResult {
    changes?: number;
    lastInsertRowid?: number;
  }
  interface Statement {
    run(...params: unknown[]): RunResult;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  }
  interface DatabaseOptions {
    create?: boolean;
  }
  export class Database {
    constructor(path: string, opts?: DatabaseOptions);
    exec(sql: string): void;
    prepare(sql: string): Statement;
    transaction<T>(fn: () => T): () => T;
    close(): void;
  }
}
