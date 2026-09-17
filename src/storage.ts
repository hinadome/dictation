import type { TranscriptSession } from './types'

const DB_NAME = 'dictation'
const DB_VERSION = 1
const STORE = 'sessions'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('updatedAt', 'updatedAt')
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'))
  })
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const store = tx.objectStore(STORE)
        const request = work(store)

        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
        tx.oncomplete = () => db.close()
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
      }),
  )
}

export async function listSessions(): Promise<TranscriptSession[]> {
  const sessions = await runTransaction('readonly', (store) => store.getAll())
  return (sessions as TranscriptSession[]).sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getSession(id: string): Promise<TranscriptSession | undefined> {
  return runTransaction('readonly', (store) => store.get(id)) as Promise<
    TranscriptSession | undefined
  >
}

export async function saveSession(session: TranscriptSession): Promise<void> {
  await runTransaction('readwrite', (store) => store.put(session))
}

export async function deleteSession(id: string): Promise<void> {
  await runTransaction('readwrite', (store) => store.delete(id))
}

export function createSession(text = ''): TranscriptSession {
  const now = Date.now()
  const preview = text.trim().slice(0, 48) || 'Untitled session'
  return {
    id: crypto.randomUUID(),
    title: preview,
    text,
    createdAt: now,
    updatedAt: now,
  }
}

export function exportSessionAsText(session: TranscriptSession): void {
  const blob = new Blob([session.text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  const stamp = new Date(session.createdAt).toISOString().slice(0, 19).replace(/[:T]/g, '-')
  anchor.href = url
  anchor.download = `dictation-${stamp}.txt`
  anchor.click()
  URL.revokeObjectURL(url)
}
