import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, signIn } from './harness.js'
import type { Harness } from './harness.js'

let h: Harness
let sales: string

beforeEach(async () => {
  h = await createHarness()
  sales = await signIn(h, 'sales')
})
afterEach(async () => {
  await h.close()
})

const create = (payload: Record<string, unknown>) =>
  h.app.inject({
    method: 'POST',
    url: '/api/clients',
    headers: { authorization: sales },
    payload: { name: 'Grace Njeri', phone: '0733 111 222', ...payload },
  })

describe('client register', () => {
  it('lists every buyer with their account position', async () => {
    const response = await h.app.inject({ method: 'GET', url: '/api/clients', headers: { authorization: sales } })
    expect(response.statusCode).toBe(200)

    const clients = response.json().clients
    expect(clients.length).toBeGreaterThan(0)

    const dennis = clients.find((c: { name: string }) => c.name === 'Dennis Ngari')
    expect(dennis.totalPaidCents).toBe(37_500_000)
    expect(dennis.totalOutstandingCents).toBe(0)
    expect(dennis.openCases).toBe(1)
    expect(dennis.plots).toHaveLength(1)
  })

  it('searches by name and by phone', async () => {
    const byName = await h.app.inject({
      method: 'GET',
      url: '/api/clients?search=Faith',
      headers: { authorization: sales },
    })
    expect(byName.json().clients).toHaveLength(1)

    const byPhone = await h.app.inject({
      method: 'GET',
      url: '/api/clients?search=0712680941',
      headers: { authorization: sales },
    })
    expect(byPhone.json().clients[0].name).toBe('Faith Wanjiku')
  })

  it('creates a client and normalises the phone number', async () => {
    const response = await create({ phone: '+254733111222' })
    expect(response.statusCode).toBe(201)
    expect(response.json().client.phone).toBe('0733111222')
  })

  it('refuses a duplicate phone number in any format', async () => {
    expect((await create({})).statusCode).toBe(201)
    const duplicate = await create({ name: 'Someone Else', phone: '+254733111222' })
    expect(duplicate.statusCode).toBe(409)
  })

  it('validates the payload', async () => {
    const response = await create({ name: 'G', phone: '1' })
    expect(response.statusCode).toBe(400)
  })

  it('updates a client without disturbing their plots', async () => {
    const created = (await create({})).json().client
    const response = await h.app.inject({
      method: 'PATCH',
      url: `/api/clients/${created.id}`,
      headers: { authorization: sales },
      payload: { email: 'grace@example.com', kraPin: 'A001234567X' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().client.email).toBe('grace@example.com')
  })

  it('404s for an unknown client', async () => {
    const response = await h.app.inject({
      method: 'GET',
      url: '/api/clients/nobody',
      headers: { authorization: sales },
    })
    expect(response.statusCode).toBe(404)
  })
})
