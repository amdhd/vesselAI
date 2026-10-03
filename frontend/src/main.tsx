/// <reference types="vite/client" />
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { get, set, del } from 'idb-keyval'
import App from './App'
import './index.css'
import {
  queryClient,
  QUERY_CACHE_BUSTER,
  QUERY_CACHE_KEY,
  QUERY_CACHE_MAX_AGE,
} from './lib/queryClient'

// Persist query cache in IndexedDB so it survives page reloads and offline sessions
const persister = createAsyncStoragePersister({
  storage: {
    getItem: (key) => get<string>(key).then((v) => v ?? null),
    setItem: (key, value) => set(key, value),
    removeItem: (key) => del(key),
  },
  key: QUERY_CACHE_KEY,
  throttleTime: 2000,
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ persister, maxAge: QUERY_CACHE_MAX_AGE, buster: QUERY_CACHE_BUSTER }}
      >
        <App />
      </PersistQueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
