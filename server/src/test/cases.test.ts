import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, plotByNumber, signIn } from './harness.js'
import type { Harness } from './harness.js'

let h: Harness
let registry: string
let sales: string

beforeEach(async () => {
  h = await createHarness()
  registry = await signIn(h, 'registry')
  sales = await signIn(h, 'sales')
})
afterEach(async () => {
  await h.close()
})

const firstClientId = async (): Promise<string> => {
  const response = await h.app.inject({ method: 'GET', url: '/api/clients', headers: { authorization: registry } })
  return response.json().clients[0].id
}

const openCase = (payload: Record<string, unknown>) =>
  h.app.inject({
    method: 'POST',
    url: '/api/cases',
    headers: { authorization: registry },
    payload: { service: 'succession', officer: 'Lucy M.', nextAction: 'Collect documents', ...payload },
  })

describe('opening a case', () => {
  it('starts at the first stage with a generated reference', async () => {
    const response = await openCase({ clientId: await firstClientId() })
    expect(response.statusCode).toBe(201)

    const record = response.json().case
    expect(record.reference).toMatch(/^SUC\/2026\/\d{4}$/)
    expect(record.stage).toBe('Documents collection')
    expect(record.status).toBe('on_track')
    expect(record.progress).toBe(20)
  })

  it('numbers references sequentially within a service and year', async () => {
    const clientId = await firstClientId()
    const first = await openCase({ clientId })
    const second = await openCase({ clientId })

    const sequence = (ref: string) => Number(ref.split('/')[2])
    expect(sequence(second.json().case.reference)).toBe(sequence(first.json().case.reference) + 1)
  })

  it('rejects an unknown client', async () => {
    const response = await openCase({ clientId: 'nobody' })
    expect(response.statusCode).toBe(404)
  })

  it('rejects an unknown service line', async () => {
    const response = await openCase({ clientId: await firstClientId(), service: 'astrology' })
    expect(response.statusCode).toBe(400)
  })

  it('publishes the stage catalogue so clients need not hardcode it', async () => {
    const response = await h.app.inject({
      method: 'GET',
      url: '/api/cases/stages',
      headers: { authorization: registry },
    })
    expect(response.json().stages.title_transfer[0]).toBe('Instructions received')
  })
})

describe('advancing a case', () => {
  const advance = (id: string, payload: Record<string, unknown>) =>
    h.app.inject({
      method: 'PATCH',
      url: `/api/cases/${id}`,
      headers: { authorization: registry },
      payload,
    })

  it('moves forward and recomputes progress from the stage', async () => {
    const record = (await openCase({ clientId: await firstClientId() })).json().case
    const response = await advance(record.id, { stage: 'Gazette notice', nextAction: 'Await gazette' })

    expect(response.statusCode).toBe(200)
    expect(response.json().case).toMatchObject({ stage: 'Gazette notice', progress: 40 })
  })

  it('refuses to move a case backwards', async () => {
    const record = (await openCase({ clientId: await firstClientId() })).json().case
    await advance(record.id, { stage: 'Court hearing' })

    const response = await advance(record.id, { stage: 'Gazette notice' })
    expect(response.statusCode).toBe(409)
  })

  it('rejects a stage that does not belong to the service', async () => {
    const record = (await openCase({ clientId: await firstClientId() })).json().case
    const response = await advance(record.id, { stage: 'Stamp duty paid' })
    expect(response.statusCode).toBe(400)
  })

  it('closes the case automatically at the final stage', async () => {
    const record = (await openCase({ clientId: await firstClientId() })).json().case
    const response = await advance(record.id, { stage: 'Confirmation of grant' })

    expect(response.json().case).toMatchObject({ status: 'closed', progress: 100 })
    expect(response.json().case.closedAt).not.toBeNull()
  })

  it('refuses to touch a closed case', async () => {
    const record = (await openCase({ clientId: await firstClientId() })).json().case
    await advance(record.id, { stage: 'Confirmation of grant' })

    const response = await advance(record.id, { stage: 'Confirmation of grant' })
    expect(response.statusCode).toBe(409)
  })

  it('keeps a timeline of every stage change', async () => {
    const record = (await openCase({ clientId: await firstClientId() })).json().case
    await advance(record.id, { stage: 'Gazette notice', note: 'Notice placed' })

    const response = await h.app.inject({
      method: 'GET',
      url: `/api/cases/${record.id}`,
      headers: { authorization: registry },
    })
    const timeline = response.json().timeline
    expect(timeline).toHaveLength(2)
    expect(timeline[1]).toMatchObject({ from_stage: 'Documents collection', to_stage: 'Gazette notice' })
  })
})

describe('title transfers and plot state', () => {
  it('moves a plot into title processing and releases it when the title issues', async () => {
    const plot = await plotByNumber(h, sales, 33)
    expect(plot.status).toBe('title_processing')

    const cases = await h.app.inject({
      method: 'GET',
      url: '/api/cases?service=title_transfer',
      headers: { authorization: registry },
    })
    const record = cases.json().cases.find((c: { plotId: string }) => c.plotId === plot.id)
    expect(record).toBeDefined()

    for (const stage of ['Consent to transfer', 'Valuation for stamp duty', 'Stamp duty paid', 'Lodged for registration', 'Title issued']) {
      await h.app.inject({
        method: 'PATCH',
        url: `/api/cases/${record.id}`,
        headers: { authorization: registry },
        payload: { stage },
      })
    }

    // With the title issued the plot is simply a fully paid plot again.
    expect((await plotByNumber(h, sales, 33)).status).toBe('fully_paid')
  })
})

describe('searching cases', () => {
  it('finds a case by client name — the walk-in test', async () => {
    const response = await h.app.inject({
      method: 'GET',
      url: '/api/cases?search=Dennis',
      headers: { authorization: registry },
    })
    expect(response.json().cases.length).toBeGreaterThan(0)
    expect(response.json().cases[0].client.name).toContain('Dennis')
  })

  it('filters by status', async () => {
    const response = await h.app.inject({
      method: 'GET',
      url: '/api/cases?status=on_track',
      headers: { authorization: registry },
    })
    expect(response.json().cases.every((c: { status: string }) => c.status === 'on_track')).toBe(true)
  })
})
