import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, cleanup, act } from '@testing-library/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './AuthContext'
import { SessionDataProvider } from './SessionDataProvider'
import { usePersistentVesselState } from '@/hooks/usePersistentVesselState'
import { clearSessionData, currentSessionScope, queryCacheKey } from '@/lib/sessionData'

const storage = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), del: vi.fn() }))
vi.mock('idb-keyval', () => storage)
vi.mock('@/lib/api', () => ({ authApi: { login: vi.fn() } }))
import { authApi } from '@/lib/api'

function View() {
  const auth = useAuth()
  const client = useQueryClient()
  const [chat, setChat] = usePersistentVesselState('vm_chat_', 'shared-vessel', 'empty')
  const query = useQuery({ queryKey: ['shared-vessel'], queryFn: async () => 'unused', enabled: false })
  return <>
    <div data-testid="account">{auth.user?.id ?? 'signed-out'}</div>
    <div data-testid="chat">{chat}</div>
    <div data-testid="cached">{query.data ?? 'empty'}</div>
    <button onClick={() => void auth.login('A', 'dummy').catch(() => {})}>Login A</button>
    <button onClick={() => void auth.login('B', 'dummy').catch(() => {})}>Login B</button>
    <button onClick={() => { setChat('PRIVATE_A'); client.setQueryData(['shared-vessel'], 'PRIVATE_A') }}>Save</button>
    <button onClick={() => void auth.logout()}>Logout</button>
  </>
}
function mount() {
  return render(<AuthProvider><SessionDataProvider><View /></SessionDataProvider></AuthProvider>)
}

beforeEach(() => {
  cleanup()
  localStorage.clear()
  vi.resetAllMocks()
  storage.get.mockResolvedValue(undefined)
  storage.set.mockResolvedValue(undefined)
  storage.del.mockResolvedValue(undefined)
  vi.stubGlobal('caches', { delete: vi.fn().mockResolvedValue(true) })
  vi.mocked(authApi.login).mockImplementation(async (id) => ({
    token: `dummy-${id}`, user: { id, email: `${id}@example.test`, name: id, company: 'Dummy operator', role: 'fleet_manager', fleetId: 'shared-fleet' },
  }))
})

async function login(id: string) {
  await screen.findByText(`Login ${id}`)
  fireEvent.click(screen.getByText(`Login ${id}`))
  await waitFor(() => expect(screen.getByTestId('account')).toHaveTextContent(id))
}

describe('account data isolation', () => {
  it('does not hydrate A chat or query results when B logs in to the same vessel', async () => {
    mount()
    await login('A')
    const scopeA = currentSessionScope()!
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(screen.getByTestId('chat')).toHaveTextContent('PRIVATE_A'))
    expect(screen.getByTestId('cached')).toHaveTextContent('PRIVATE_A')
    expect(localStorage.getItem(`vm_chat_${scopeA}:shared-vessel`)).toContain('PRIVATE_A')

    await login('B')
    expect(screen.getByTestId('chat')).toHaveTextContent('empty')
    expect(screen.getByTestId('cached')).toHaveTextContent('empty')
    expect(currentSessionScope()).not.toBe(scopeA)
    expect(storage.del).toHaveBeenCalledWith(queryCacheKey(scopeA))
  })

  it('purges credentials, private state and durable caches on session rejection', async () => {
    mount()
    await login('A')
    fireEvent.click(screen.getByText('Save'))
    const scopeA = currentSessionScope()!
    await act(async () => { await clearSessionData() })
    await waitFor(() => expect(screen.getByTestId('account')).toHaveTextContent('signed-out'))
    expect(localStorage.getItem('vm_token')).toBeNull()
    expect(localStorage.getItem('vm_user')).toBeNull()
    expect(localStorage.getItem(`vm_chat_${scopeA}:shared-vessel`)).toBeNull()
    expect(storage.del).toHaveBeenCalledWith('vm-query-cache')
    expect(storage.del).toHaveBeenCalledWith(queryCacheKey(scopeA))
    expect(caches.delete).toHaveBeenCalledWith('vm-api-cache')
    await login('B')
    expect(screen.getByTestId('chat')).toHaveTextContent('empty')
  })

  it('awaits durable cleanup before accepting a replacement login', async () => {
    mount()
    await login('A')
    let finish!: () => void
    storage.del.mockReturnValue(new Promise<void>((resolve) => { finish = resolve }))
    fireEvent.click(screen.getByText('Login B'))
    await waitFor(() => expect(screen.getByTestId('account')).toHaveTextContent('signed-out'))
    expect(authApi.login).toHaveBeenCalledTimes(1)
    finish()
    await waitFor(() => expect(screen.getByTestId('account')).toHaveTextContent('B'))
  })

  it('discards legacy sessions instead of assigning unscoped data to an assumed owner', async () => {
    localStorage.setItem('vm_token', 'old-token')
    localStorage.setItem('vm_user', JSON.stringify({ id: 'A', fleetId: 'shared-fleet' }))
    localStorage.setItem('vm_chat_shared-vessel', 'PRIVATE_LEGACY')
    mount()
    await screen.findByText('Login B')
    expect(screen.getByTestId('account')).toHaveTextContent('signed-out')
    expect(localStorage.getItem('vm_chat_shared-vessel')).toBeNull()
    await login('B')
    expect(screen.getByTestId('chat')).toHaveTextContent('empty')
  })

  it('does not let a late login response replace the newer account', async () => {
    let finishA!: (value: Awaited<ReturnType<typeof authApi.login>>) => void
    vi.mocked(authApi.login).mockImplementation(async (id) => {
      if (id === 'A') return new Promise((resolve) => { finishA = resolve })
      return { token: 'dummy-B', user: { id: 'B', email: 'B@example.test', name: 'B', company: 'Dummy', role: 'fleet_manager', fleetId: 'shared-fleet' } }
    })
    mount()
    await screen.findByText('Login A')
    fireEvent.click(screen.getByText('Login A'))
    await waitFor(() => expect(authApi.login).toHaveBeenCalledWith('A', 'dummy'))
    await login('B')
    await act(async () => {
      finishA({ token: 'dummy-A', user: { id: 'A', email: 'A@example.test', name: 'A', company: 'Dummy', role: 'fleet_manager', fleetId: 'shared-fleet' } })
    })
    expect(screen.getByTestId('account')).toHaveTextContent('B')
    expect(localStorage.getItem('vm_token')).toBe('dummy-B')
  })


  it('does not recreate A persisted query data from a throttled write after replacement login', async () => {
    mount()
    await login('A')
    const keyA = queryCacheKey(currentSessionScope()!)
    await waitFor(() => expect(storage.get).toHaveBeenCalledWith(keyA))
    vi.useFakeTimers()
    try {
      fireEvent.click(screen.getByText('Save'))
      await act(async () => { fireEvent.click(screen.getByText('Login B')) })
      expect(screen.getByTestId('account')).toHaveTextContent('B')
      storage.set.mockClear()
      await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
      expect(storage.set.mock.calls.some(([key]) => key === keyA)).toBe(false)
      expect(screen.getByTestId('cached')).toHaveTextContent('empty')
    } finally {
      vi.useRealTimers()
    }
  })

})
