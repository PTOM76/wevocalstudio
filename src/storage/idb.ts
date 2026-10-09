// IndexedDB の小さな読み書き（キーと値だけ）。画面と Worker の両方から使う
const DB = 'wevocalstudio'
const STORE = 'kv'

let dbPromise: Promise<IDBDatabase> | null = null
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const store = (await db()).transaction(STORE, mode).objectStore(STORE)
  const req = fn(store)
  return new Promise((resolve, reject) => {
    store.transaction.oncomplete = () => resolve(req ? req.result : undefined)
    store.transaction.onerror = () => reject(store.transaction.error)
  })
}

export const idbGet = <T>(key: string) => run<T>('readonly', (s) => s.get(key) as IDBRequest<T>)
export const idbPut = (key: string, value: unknown) => run('readwrite', (s) => void s.put(value, key))
export const idbDelete = (keys: string[]) => run('readwrite', (s) => keys.forEach((k) => s.delete(k)))
export const idbClear = () => run('readwrite', (s) => void s.clear())
