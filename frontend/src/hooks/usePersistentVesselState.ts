import { Dispatch, SetStateAction, useEffect, useRef, useState } from 'react'

/**
 * A `useState` whose value is persisted to localStorage, namespaced per vessel.
 *
 * Why this exists: several AI surfaces (Knowledge chat, Compliance chat, the
 * Voyage agent) render conditionally inside tabbed pages, so switching tabs or
 * modules unmounts them and would otherwise discard their state. Persisting per
 * vessel lets each conversation/result survive tab & module switches and full
 * page reloads, while keeping a separate thread per vessel — the AI answers with
 * that vessel's context loaded, so threads shouldn't bleed across vessels.
 *
 * Drop-in for `useState`, plus it:
 *   - hydrates from localStorage on mount (lazy initializer),
 *   - reloads the stored value when `vesselId` changes,
 *   - writes back on every change.
 *
 * `fallback` is only used when nothing is stored; it's captured on first render
 * (via a ref) so passing an inline literal/object won't trigger reloads.
 */
export function usePersistentVesselState<T>(
  keyPrefix: string,
  vesselId: string | undefined,
  fallback: T,
): [T, Dispatch<SetStateAction<T>>] {
  const storageKey = `${keyPrefix}${vesselId || 'default'}`
  const fallbackRef = useRef(fallback)

  const [value, setValue] = useState<T>(() => readJSON(storageKey, fallbackRef.current))

  // When the storage key changes (vessel switched), load that vessel's stored
  // value. `skipNextSave` stops the save effect below from writing the *previous*
  // value under the *new* key on the same render, before this setValue applies.
  const skipNextSave = useRef(false)
  useEffect(() => {
    skipNextSave.current = true
    setValue(readJSON(storageKey, fallbackRef.current))
  }, [storageKey])

  useEffect(() => {
    if (skipNextSave.current) {
      skipNextSave.current = false
      return
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify(value))
    } catch {
      /* localStorage full/unavailable — non-fatal, state still works in-session */
    }
  }, [value, storageKey])

  return [value, setValue]
}

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw !== null ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
