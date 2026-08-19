import type { Activity, CaseRecord, Plot } from './types'

const sold: Record<number, Partial<Plot>> = {
  2: { status: 'fully_paid', buyer: 'Faith Wanjiku', buyerPhone: '0712 680 941', paid: 375000 },
  7: { status: 'on_instalment', buyer: 'Samuel Muriuki', buyerPhone: '0721 441 208', paid: 275000 },
  16: { status: 'reserved', buyer: 'Lilian Muthoni', buyerPhone: '0704 227 913', paid: 0, reservedUntil: '22 Aug 2026' },
  17: { status: 'fully_paid', buyer: 'Daniel Mwangi', buyerPhone: '0719 082 614', paid: 375000 },
  18: { status: 'fully_paid', buyer: 'Mercy Wambui', buyerPhone: '0708 561 302', paid: 375000 },
  19: { status: 'fully_paid', buyer: 'Peter Kariuki', buyerPhone: '0722 104 637', paid: 375000 },
  20: { status: 'fully_paid', buyer: 'Jane Wairimu', buyerPhone: '0711 935 480', paid: 375000 },
  29: { status: 'fully_paid', buyer: 'George Njiru', buyerPhone: '0701 842 529', paid: 375000 },
  31: { status: 'deposit_paid', buyer: 'Alice Nyambura', buyerPhone: '0798 331 204', paid: 120000 },
  32: { status: 'fully_paid', buyer: 'John Njeru', buyerPhone: '0716 490 117', paid: 375000 },
  33: { status: 'title_processing', buyer: 'Dennis Ngari', buyerPhone: '0720 513 896', paid: 375000 },
}

export const initialPlots: Plot[] = Array.from({ length: 34 }, (_, index) => {
  const id = index + 1
  return {
    id,
    status: 'available',
    size: id === 34 ? '2.1 acres' : '50 × 100 ft',
    cashPrice: id === 34 ? 5200000 : 375000,
    instalmentPrice: id === 34 ? 5850000 : 450000,
    ...sold[id],
  }
})

export const activities: Activity[] = [
  { id: 1, kind: 'payment', title: 'Payment received', detail: 'KSh 25,000 · Samuel Muriuki · Plot 7', time: '12 min ago' },
  { id: 2, kind: 'case', title: 'Title moved to valuation', detail: 'TTL/2026/0033 · Dennis Ngari', time: '48 min ago' },
  { id: 3, kind: 'plot', title: 'Plot 16 reserved', detail: 'Lilian Muthoni · Expires 22 Aug', time: '2 hrs ago' },
  { id: 4, kind: 'client', title: 'New buyer registered', detail: 'Alice Nyambura · Direct buyer', time: 'Yesterday' },
]

export const cases: CaseRecord[] = [
  { id: 'TTL/2026/0033', client: 'Dennis Ngari', service: 'Title transfer', stage: 'Valuation for stamp duty', status: 'On track', officer: 'Grace W.', updated: 'Today, 10:24', progress: 56, next: 'Receive valuation report' },
  { id: 'TTL/2026/0029', client: 'George Njiru', service: 'Title transfer', stage: 'Consent to transfer', status: 'Awaiting client', officer: 'Grace W.', updated: 'Yesterday', progress: 32, next: 'Client to provide KRA PIN' },
  { id: 'SUR/2026/0018', client: 'Pioneer Phase 2', service: 'Beaconing', stage: 'Field work scheduled', status: 'On track', officer: 'James N.', updated: '18 Aug 2026', progress: 45, next: 'Field visit · 24 Aug' },
  { id: 'SUC/2026/0007', client: 'Margaret Muthoni', service: 'Succession', stage: 'Documents collection', status: 'Delayed', officer: 'Lucy M.', updated: '12 Aug 2026', progress: 14, next: "Awaiting Chief's letter" },
]

export const projects = [
  { name: 'Pioneer Estate Phase 2', location: 'Embu · 14 km from town', status: 'Selling', plots: '34 plots', sold: 10, revenue: 3_870_000 },
  { name: 'Fadhili Gardens', location: 'Embu County', status: 'Completed', plots: '28 plots', sold: 28, revenue: 9_660_000 },
  { name: 'Pinnacle Estate Phase 2', location: 'Embu County', status: 'Closing', plots: '42 plots', sold: 39, revenue: 14_250_000 },
]

export const formatMoney = (value: number) => `KSh ${new Intl.NumberFormat('en-KE').format(value)}`

export const statusLabel: Record<Plot['status'], string> = {
  available: 'Available',
  reserved: 'Reserved',
  deposit_paid: 'Deposit paid',
  on_instalment: 'On instalment',
  fully_paid: 'Fully paid',
  title_processing: 'Title processing',
}
