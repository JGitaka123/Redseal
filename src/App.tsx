import { useMemo, useState } from 'react'
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Download,
  FileCheck2,
  FileText,
  Filter,
  HandCoins,
  Headphones,
  Home,
  Landmark,
  LayoutDashboard,
  Map,
  MapPin,
  Menu,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  ReceiptText,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserRound,
  UsersRound,
  WalletCards,
  X,
} from 'lucide-react'
import { activities, cases, formatMoney, initialPlots, projects, statusLabel } from './data'
import type { Plot, PlotStatus, View } from './types'

const navItems: { id: View; label: string; icon: typeof Home }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'plots', label: 'Projects & plots', icon: Map },
  { id: 'clients', label: 'Clients', icon: UsersRound },
  { id: 'payments', label: 'Payments', icon: WalletCards },
  { id: 'cases', label: 'Cases & titles', icon: FileCheck2 },
  { id: 'reports', label: 'Reports', icon: TrendingUp },
]

const plotStatusOrder: PlotStatus[] = ['available', 'reserved', 'deposit_paid', 'on_instalment', 'fully_paid', 'title_processing']

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? 'brand--compact' : ''}`}>
      <div className="brand-mark" aria-hidden="true"><span>R</span><span>S</span></div>
      {!compact && <div><strong>RED SEAL</strong><span>HOMES</span></div>}
    </div>
  )
}

function Sidebar({ current, onChange, open, onClose }: { current: View; onChange: (view: View) => void; open: boolean; onClose: () => void }) {
  return (
    <>
      {open && <button className="sidebar-scrim" onClick={onClose} aria-label="Close navigation" />}
      <aside className={`sidebar ${open ? 'sidebar--open' : ''}`}>
        <div className="sidebar-head">
          <Brand />
          <button className="icon-btn sidebar-close" onClick={onClose} aria-label="Close navigation"><X size={20} /></button>
        </div>
        <div className="workspace-switcher">
          <div className="workspace-icon"><Building2 size={17} /></div>
          <div><small>Workspace</small><strong>Red Seal Homes</strong></div>
          <ChevronDown size={16} />
        </div>
        <nav aria-label="Main navigation">
          <span className="nav-label">OPERATIONS</span>
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item ${current === id ? 'active' : ''}`} onClick={() => { onChange(id); onClose() }}>
              <Icon size={19} strokeWidth={1.9} /><span>{label}</span>
              {id === 'cases' && <em>4</em>}
            </button>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <div className="compliance-card">
          <div className="compliance-icon"><ShieldCheck size={17} /></div>
          <div><strong>Audit ready</strong><span>All activity is logged</span></div>
          <ChevronRight size={16} />
        </div>
        <button className="support-link"><Headphones size={18} /> Help & support</button>
        <div className="profile-block">
          <div className="avatar">MN</div>
          <div><strong>Mzee Nthiga</strong><span>Director</span></div>
          <MoreHorizontal size={18} />
        </div>
      </aside>
    </>
  )
}

function Topbar({ title, onMenu, onNavigate }: { title: string; onMenu: () => void; onNavigate: (view: View) => void }) {
  return (
    <header className="topbar">
      <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Open navigation"><Menu size={21} /></button>
      <div className="mobile-brand"><Brand compact /></div>
      <div className="page-heading"><span>Operations</span><strong>{title}</strong></div>
      <label className="global-search"><Search size={18} /><input placeholder="Search clients, plots or cases…" aria-label="Search" /><kbd>⌘ K</kbd></label>
      <button className="icon-btn notification-btn" aria-label="Notifications"><Bell size={20} /><span /></button>
      <button className="primary-btn top-action" onClick={() => onNavigate('clients')}><Plus size={18} /> New client</button>
    </header>
  )
}

function MetricCard({ label, value, trend, note, icon: Icon, tone }: { label: string; value: string; trend: string; note: string; icon: typeof Home; tone: string }) {
  const positive = !trend.startsWith('-')
  return (
    <article className="metric-card">
      <div className={`metric-icon ${tone}`}><Icon size={21} /></div>
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      <div className="metric-foot">
        <span className={positive ? 'positive' : 'negative'}>{positive ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{trend}</span>
        <span>{note}</span>
      </div>
    </article>
  )
}

function MiniBarChart() {
  const bars = [28, 41, 35, 58, 49, 71, 64, 83, 75, 92, 78, 86]
  return (
    <div className="bar-chart" aria-label="Collections from January to December">
      <div className="chart-grid"><span>1.2M</span><span>800K</span><span>400K</span><span>0</span></div>
      <div className="bars">
        {bars.map((height, index) => <div key={index} className={index === 9 ? 'active' : ''} style={{ height: `${height}%` }}><span>{index === 9 ? 'KSh 1.1M' : ''}</span></div>)}
      </div>
      <div className="chart-labels"><span>Jan</span><span>Mar</span><span>May</span><span>Jul</span><span>Sep</span><span>Nov</span></div>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const slug = status.toLowerCase().replaceAll(' ', '-').replace('awaiting-client', 'waiting')
  return <span className={`status-pill status-pill--${slug}`}><i />{status}</span>
}

function Overview({ plots, onNavigate, onSelectPlot }: { plots: Plot[]; onNavigate: (view: View) => void; onSelectPlot: (plot: Plot) => void }) {
  const available = plots.filter((p) => p.status === 'available').length
  return (
    <div className="view-shell">
      <section className="welcome-row">
        <div><p className="eyebrow">WEDNESDAY, 19 AUGUST</p><h1>Good afternoon, Mzee.</h1><p>Here’s what’s happening across Red Seal Homes today.</p></div>
        <button className="secondary-btn"><Download size={17} /> Export summary</button>
      </section>
      <section className="metrics-grid">
        <MetricCard label="Collections this month" value="KSh 2.84M" trend="12.4%" note="vs last month" icon={CircleDollarSign} tone="green" />
        <MetricCard label="Active receivables" value="KSh 6.32M" trend="4.1%" note="34 active plans" icon={HandCoins} tone="gold" />
        <MetricCard label="Plots available" value={`${available}`} trend="3 reserved" note="across 3 projects" icon={MapPin} tone="blue" />
        <MetricCard label="Titles in progress" value="18" trend="2 delayed" note="require attention" icon={FileText} tone="red" />
      </section>
      <section className="dashboard-grid">
        <article className="panel collections-panel">
          <div className="panel-head"><div><span className="panel-kicker">COLLECTION PERFORMANCE</span><h2>Monthly collections</h2></div><button className="period-control">Last 12 months <ChevronDown size={15} /></button></div>
          <div className="chart-total"><strong>KSh 10.8M</strong><span><ArrowUpRight size={14} /> 18.2%</span><small>year to date</small></div>
          <MiniBarChart />
        </article>
        <article className="panel attention-panel">
          <div className="panel-head"><div><span className="panel-kicker">NEEDS ATTENTION</span><h2>Action centre</h2></div><span className="count-badge">5</span></div>
          <div className="attention-list">
            <button onClick={() => onNavigate('payments')}><span className="attention-icon amber"><ReceiptText size={18} /></span><span><strong>3 unmatched payments</strong><small>KSh 47,500 awaiting reconciliation</small></span><ChevronRight size={17} /></button>
            <button onClick={() => onNavigate('cases')}><span className="attention-icon red"><Clock3 size={18} /></span><span><strong>2 delayed cases</strong><small>Over expected stage duration</small></span><ChevronRight size={17} /></button>
            <button onClick={() => onNavigate('plots')}><span className="attention-icon blue"><CalendarDays size={18} /></span><span><strong>Reservation expiring</strong><small>Plot 16 · in 3 days</small></span><ChevronRight size={17} /></button>
          </div>
          <button className="text-btn">View all actions <ArrowRight size={15} /></button>
        </article>
      </section>
      <section className="panel project-panel">
        <div className="panel-head"><div><span className="panel-kicker">ACTIVE INVENTORY</span><h2>Project performance</h2></div><button className="text-btn" onClick={() => onNavigate('plots')}>All projects <ArrowRight size={15} /></button></div>
        <div className="project-table">
          <div className="table-row table-head"><span>Project</span><span>Status</span><span>Sales progress</span><span>Revenue collected</span><span /></div>
          {projects.map((project, index) => (
            <div className="table-row" key={project.name}>
              <div className="project-cell"><span className={`project-thumb p${index + 1}`}><Landmark size={19} /></span><span><strong>{project.name}</strong><small>{project.location} · {project.plots}</small></span></div>
              <StatusPill status={project.status} />
              <div className="progress-cell"><div><span style={{ width: `${(project.sold / Number(project.plots.split(' ')[0])) * 100}%` }} /></div><small>{project.sold}/{project.plots.split(' ')[0]} sold</small></div>
              <strong>{formatMoney(project.revenue)}</strong>
              <button className="icon-btn" onClick={() => { onNavigate('plots'); if (index === 0) onSelectPlot(plots[0]) }} aria-label={`Open ${project.name}`}><ChevronRight size={18} /></button>
            </div>
          ))}
        </div>
      </section>
      <section className="lower-grid">
        <article className="panel activity-panel">
          <div className="panel-head"><div><span className="panel-kicker">LIVE OPERATIONS</span><h2>Recent activity</h2></div><button className="icon-btn"><MoreHorizontal size={19} /></button></div>
          {activities.map((item) => {
            const Icon = item.kind === 'payment' ? CircleDollarSign : item.kind === 'plot' ? MapPin : item.kind === 'case' ? FileCheck2 : UserRound
            return <div className="activity-row" key={item.id}><span className={`activity-icon ${item.kind}`}><Icon size={17} /></span><span><strong>{item.title}</strong><small>{item.detail}</small></span><time>{item.time}</time></div>
          })}
        </article>
        <article className="panel arrears-panel">
          <div className="panel-head"><div><span className="panel-kicker">RECEIVABLES HEALTH</span><h2>Arrears ageing</h2></div><button className="icon-btn"><MoreHorizontal size={19} /></button></div>
          <div className="donut-wrap">
            <div className="donut"><div><strong>84%</strong><span>healthy</span></div></div>
            <div className="donut-legend">
              <span><i className="current" /><b>Current</b><strong>KSh 5.31M</strong></span>
              <span><i className="days30" /><b>1–30 days</b><strong>KSh 640K</strong></span>
              <span><i className="days60" /><b>31–60 days</b><strong>KSh 241K</strong></span>
              <span><i className="days90" /><b>90+ days</b><strong>KSh 128K</strong></span>
            </div>
          </div>
        </article>
      </section>
    </div>
  )
}

function PlotMap({ plots, selected, onSelect }: { plots: Plot[]; selected?: Plot; onSelect: (plot: Plot) => void }) {
  const regular = plots.filter((p) => p.id !== 34)
  const mapColumns = [regular.slice(19, 26).reverse(), regular.slice(12, 19).reverse(), regular.slice(5, 12).reverse(), regular.slice(0, 5).reverse()]
  return (
    <div className="site-plan">
      <div className="map-compass"><span>N</span><i /></div>
      <div className="map-landscape"><span>PIONEER ESTATE PHASE 2</span><small>Future development area</small></div>
      <div className="plot-block">
        {mapColumns.map((column, c) => <div className="plot-column" key={c}>{column.map((plot) => <button key={plot.id} onClick={() => onSelect(plot)} className={`plot ${plot.status} ${selected?.id === plot.id ? 'selected' : ''}`} aria-label={`Plot ${plot.id}, ${statusLabel[plot.status]}`}><span>{plot.id}</span></button>)}</div>)}
        <div className="plot-column bottom-plots">{regular.slice(26, 33).map((plot) => <button key={plot.id} onClick={() => onSelect(plot)} className={`plot ${plot.status} ${selected?.id === plot.id ? 'selected' : ''}`} aria-label={`Plot ${plot.id}, ${statusLabel[plot.status]}`}><span>{plot.id}</span></button>)}</div>
      </div>
      <button className={`plot plot-34 ${plots[33].status} ${selected?.id === 34 ? 'selected' : ''}`} onClick={() => onSelect(plots[33])}><span>34</span><small>2.1 acres</small></button>
      <div className="map-road road-bottom"><span>12M ACCESS ROAD</span></div>
      <div className="map-road road-side"><span>ROAD</span></div>
      <div className="direction direction-left">← FROM GOLF COURSE</div>
      <div className="direction direction-right">TO OASIS RESORT →</div>
    </div>
  )
}

function PlotDrawer({ plot, onClose, onReserve }: { plot: Plot; onClose: () => void; onReserve: () => void }) {
  const total = plot.status === 'on_instalment' || plot.status === 'deposit_paid' ? plot.instalmentPrice : plot.cashPrice
  const paidPercent = plot.paid ? Math.min(100, (plot.paid / total) * 100) : 0
  return (
    <aside className="plot-drawer">
      <div className="drawer-head"><div><span className="panel-kicker">PIONEER PHASE 2</span><h2>Plot {plot.id}</h2></div><button className="icon-btn" onClick={onClose}><X size={20} /></button></div>
      <div className="drawer-hero"><div className="plot-miniature"><MapPin size={28} /></div><div><StatusPill status={statusLabel[plot.status]} /><p>{plot.size} · Residential</p></div></div>
      <div className="detail-grid"><div><span>Cash price</span><strong>{formatMoney(plot.cashPrice)}</strong></div><div><span>Instalment price</span><strong>{formatMoney(plot.instalmentPrice)}</strong></div></div>
      {plot.buyer ? (
        <>
          <div className="drawer-section-title"><span>Buyer details</span><button>View profile</button></div>
          <div className="buyer-card"><div className="avatar gold-avatar">{plot.buyer.split(' ').map((n) => n[0]).join('')}</div><div><strong>{plot.buyer}</strong><span>{plot.buyerPhone}</span></div><MessageSquareText size={18} /></div>
          <div className="payment-progress"><div><span>Payment progress</span><strong>{Math.round(paidPercent)}%</strong></div><div className="progress-track"><span style={{ width: `${paidPercent}%` }} /></div><div><small>{formatMoney(plot.paid ?? 0)} paid</small><small>{formatMoney(total - (plot.paid ?? 0))} balance</small></div></div>
          {plot.reservedUntil && <div className="notice-card"><CalendarDays size={18} /><div><strong>Reservation expires {plot.reservedUntil}</strong><span>Confirm the deposit to secure this plot.</span></div></div>}
          <button className="primary-btn full-btn">Open buyer account <ArrowRight size={17} /></button>
        </>
      ) : (
        <>
          <div className="availability-card"><Check size={18} /><div><strong>Ready for sale</strong><span>No active reservations or buyer records.</span></div></div>
          <button className="primary-btn full-btn" onClick={onReserve}><MapPin size={17} /> Reserve this plot</button>
          <button className="secondary-btn full-btn"><FileText size={17} /> Download plot details</button>
        </>
      )}
      <div className="audit-note"><ShieldCheck size={15} /> Every plot status change is audit logged.</div>
    </aside>
  )
}

function ReserveModal({ plot, onCancel, onConfirm }: { plot: Plot; onCancel: () => void; onConfirm: (name: string, phone: string) => void }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const valid = name.trim().length > 3 && phone.trim().length > 8
  return (
    <div className="modal-layer" role="presentation"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="reserve-title">
      <div className="modal-icon"><MapPin size={22} /></div>
      <h2 id="reserve-title">Reserve Plot {plot.id}</h2><p>Hold this plot for 7 days while the buyer completes their deposit.</p>
      <label>Buyer name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mary Wanjiku" /></label>
      <label>Mobile number<input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07XX XXX XXX" /></label>
      <div className="modal-summary"><span>Reservation expires</span><strong>26 Aug 2026</strong></div>
      <div className="modal-actions"><button className="secondary-btn" onClick={onCancel}>Cancel</button><button disabled={!valid} className="primary-btn" onClick={() => onConfirm(name.trim(), phone.trim())}>Confirm reservation</button></div>
    </div></div>
  )
}

function PlotsView({ plots, setPlots, selected, setSelected, notify }: { plots: Plot[]; setPlots: (plots: Plot[]) => void; selected?: Plot; setSelected: (plot?: Plot) => void; notify: (message: string) => void }) {
  const [filter, setFilter] = useState<'all' | PlotStatus>('all')
  const [reserving, setReserving] = useState(false)
  const counts = useMemo(() => Object.fromEntries(plotStatusOrder.map((status) => [status, plots.filter((p) => p.status === status).length])), [plots])
  const filteredPlots = filter === 'all' ? plots : plots.filter((p) => p.status === filter)
  const reserve = (name: string, phone: string) => {
    if (!selected) return
    const updated = plots.map((p) => p.id === selected.id ? { ...p, status: 'reserved' as const, buyer: name, buyerPhone: phone, paid: 0, reservedUntil: '26 Aug 2026' } : p)
    setPlots(updated)
    setSelected(updated.find((p) => p.id === selected.id))
    setReserving(false)
    notify(`Plot ${selected.id} reserved for ${name}`)
  }
  return (
    <div className="view-shell plots-view">
      <section className="view-title-row"><div><span className="breadcrumb">Projects <ChevronRight size={14} /> Pioneer Estate Phase 2</span><h1>Plot inventory</h1><p>Live availability and sales status for all 34 plots.</p></div><div><button className="secondary-btn"><Download size={17} /> Export</button><button className="primary-btn" onClick={() => { const first = plots.find((p) => p.status === 'available'); if (first) setSelected(first) }}><Plus size={17} /> New reservation</button></div></section>
      <section className="project-summary">
        <div className="project-identity"><span className="project-emblem"><Landmark size={22} /></span><div><span>ACTIVE PROJECT</span><strong>Pioneer Estate Phase 2</strong><small><MapPin size={13} /> 14 km from Embu Town · 1.4 km off tarmac</small></div></div>
        <div className="summary-stat"><span>Total plots</span><strong>34</strong></div><div className="summary-stat"><span>Available</span><strong>{counts.available}</strong></div><div className="summary-stat"><span>Committed</span><strong>{34 - counts.available}</strong></div><div className="summary-stat"><span>Collected</span><strong>KSh 3.87M</strong></div>
      </section>
      <section className="map-toolbar">
        <div className="filter-tabs"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All <span>34</span></button>{plotStatusOrder.map((status) => counts[status] > 0 && <button key={status} className={filter === status ? 'active' : ''} onClick={() => setFilter(status)}>{statusLabel[status]} <span>{counts[status]}</span></button>)}</div>
        <button className="secondary-btn compact"><Filter size={16} /> Filters</button>
      </section>
      <section className={`map-layout ${selected ? 'has-drawer' : ''}`}>
        <article className="panel map-panel">
          <div className="map-panel-head"><div><h2>Interactive site plan</h2><p>Select a plot to view its details and status.</p></div><div className="map-legend"><span><i className="available" />Available</span><span><i className="reserved" />Reserved</span><span><i className="on_instalment" />Instalment</span><span><i className="fully_paid" />Fully paid</span><span><i className="title_processing" />Title</span></div></div>
          {filter === 'all' ? <PlotMap plots={plots} selected={selected} onSelect={setSelected} /> : <div className="filtered-grid">{filteredPlots.map((plot) => <button key={plot.id} className={`filtered-plot ${plot.status} ${selected?.id === plot.id ? 'selected' : ''}`} onClick={() => setSelected(plot)}><span>Plot {plot.id}</span><strong>{statusLabel[plot.status]}</strong><small>{plot.size}</small></button>)}</div>}
        </article>
        {selected && <PlotDrawer plot={selected} onClose={() => setSelected(undefined)} onReserve={() => setReserving(true)} />}
      </section>
      {reserving && selected && <ReserveModal plot={selected} onCancel={() => setReserving(false)} onConfirm={reserve} />}
    </div>
  )
}

function ClientsView({ plots, notify }: { plots: Plot[]; notify: (message: string) => void }) {
  const clients = plots.filter((p) => p.buyer)
  return <div className="view-shell"><section className="view-title-row"><div><span className="eyebrow">CUSTOMER RECORDS</span><h1>Clients</h1><p>One trusted profile for every Red Seal relationship.</p></div><button className="primary-btn" onClick={() => notify('New client form is ready for the production build')}><Plus size={17} /> Add client</button></section><section className="panel data-panel"><div className="data-toolbar"><label><Search size={17} /><input placeholder="Search by name, phone or ID…" /></label><button className="secondary-btn compact"><Filter size={16} /> All roles</button></div><div className="client-list"><div className="client-row client-head"><span>Client</span><span>Role</span><span>Property</span><span>Account position</span><span /></div>{clients.map((client) => <div className="client-row" key={client.id}><div className="client-name"><span className="avatar">{client.buyer!.split(' ').map((n) => n[0]).join('')}</span><span><strong>{client.buyer}</strong><small>{client.buyerPhone}</small></span></div><span><StatusPill status="Direct buyer" /></span><span><strong>Pioneer Phase 2</strong><small>Plot {client.id}</small></span><span><strong>{formatMoney(client.paid ?? 0)}</strong><small>{statusLabel[client.status]}</small></span><button className="icon-btn"><ChevronRight size={18} /></button></div>)}</div></section></div>
}

function PaymentsView({ notify }: { notify: (message: string) => void }) {
  const transactions = [
    ['QHI8R4M2L9', 'Samuel Muriuki', 'Plot 7', 25000, 'Matched', 'Today, 13:42'],
    ['QHI7X9K4P2', 'Alice Nyambura', 'Plot 31', 15000, 'Matched', 'Today, 11:18'],
    ['QHI6T2N7B1', 'Unknown sender', 'No reference', 22500, 'Unmatched', 'Today, 09:04'],
    ['QHH9A3C8W5', 'Dennis Ngari', 'Plot 33', 50000, 'Matched', 'Yesterday'],
    ['QHH8D1F6R4', 'Unknown sender', 'PIONEER', 15000, 'Unmatched', 'Yesterday'],
  ]
  return <div className="view-shell"><section className="view-title-row"><div><span className="eyebrow">RECONCILIATION</span><h1>Payments</h1><p>Match every shilling from M-Pesa and bank accounts.</p></div><button className="primary-btn" onClick={() => notify('Statement import will connect to live banking in production')}><Plus size={17} /> Import statement</button></section><section className="metrics-grid three"><MetricCard label="Received today" value="KSh 112.5K" trend="8.2%" note="8 transactions" icon={CircleDollarSign} tone="green" /><MetricCard label="Matched automatically" value="94.7%" trend="2.1%" note="this month" icon={Sparkles} tone="blue" /><MetricCard label="Exception queue" value="KSh 47.5K" trend="3 items" note="need review" icon={ReceiptText} tone="gold" /></section><section className="panel data-panel"><div className="panel-head"><div><span className="panel-kicker">LATEST TRANSACTIONS</span><h2>M-Pesa activity</h2></div><button className="secondary-btn compact"><Download size={16} /> Export</button></div><div className="transaction-list"><div className="transaction-row transaction-head"><span>Receipt</span><span>Customer</span><span>Account</span><span>Amount</span><span>Status</span><span>Received</span></div>{transactions.map((t) => <div className="transaction-row" key={String(t[0])}><code>{t[0]}</code><span>{t[1]}</span><span>{t[2]}</span><strong>{formatMoney(Number(t[3]))}</strong><StatusPill status={String(t[4])} /><small>{t[5]}</small></div>)}</div></section></div>
}

function CasesView() {
  return <div className="view-shell"><section className="view-title-row"><div><span className="eyebrow">SERVICE DELIVERY</span><h1>Cases & titles</h1><p>Every client can see exactly where their service stands.</p></div><button className="primary-btn"><Plus size={17} /> Open case</button></section><section className="case-callout"><div><FileCheck2 size={23} /></div><span><strong>The walk-in test</strong><p>Find any client’s case in under ten seconds, then explain where it stands and what happens next.</p></span><button className="secondary-btn">Open desk lookup</button></section><section className="panel data-panel"><div className="data-toolbar"><label><Search size={17} /><input placeholder="Search client or case number…" /></label><button className="secondary-btn compact"><Filter size={16} /> All services</button></div><div className="case-list">{cases.map((item) => <button className="case-row" key={item.id}><div className="case-main"><span className="case-icon"><FileText size={19} /></span><span><small>{item.id}</small><strong>{item.client}</strong><em>{item.service}</em></span></div><div><small>Current stage</small><strong>{item.stage}</strong><span className="case-progress"><i style={{ width: `${item.progress}%` }} /></span></div><div><small>Next action</small><strong>{item.next}</strong><span>Officer: {item.officer}</span></div><div><StatusPill status={item.status} /><small>{item.updated}</small></div><ChevronRight size={18} /></button>)}</div></section></div>
}

function ReportsView() {
  return <div className="view-shell"><section className="view-title-row"><div><span className="eyebrow">MANAGEMENT INSIGHT</span><h1>Reports</h1><p>Project performance, collections and operational accountability.</p></div><button className="secondary-btn"><CalendarDays size={17} /> 1–19 Aug 2026</button></section><section className="report-grid">{[
    ['Project profitability', 'Revenue, land cost, development spend and margin by project.', TrendingUp, 'Updated today'],
    ['Sales & inventory', 'Availability, reservations, sales velocity and pricing.', Map, 'Updated live'],
    ['Receivables ageing', 'Outstanding balances grouped by ageing period.', HandCoins, 'Updated today'],
    ['Collections & reconciliation', 'M-Pesa, bank and exception queue performance.', ReceiptText, 'Updated live'],
    ['Case turnaround', 'Stage ageing, officer workload and delayed matters.', Clock3, 'Updated hourly'],
    ['Client statements', 'Payment histories and balances for each buyer.', FileText, 'On demand'],
  ].map(([title, description, Icon, updated]) => { const ReportIcon = Icon as typeof Home; return <article className="panel report-card" key={String(title)}><span><ReportIcon size={21} /></span><h2>{String(title)}</h2><p>{String(description)}</p><small>{String(updated)}</small><button className="text-btn">Open report <ArrowRight size={15} /></button></article> })}</section></div>
}

export default function App() {
  const [view, setView] = useState<View>('overview')
  const [plots, setPlots] = useState(initialPlots)
  const [selectedPlot, setSelectedPlot] = useState<Plot | undefined>()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [toast, setToast] = useState<string>()
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(undefined), 3200) }
  const currentTitle = navItems.find((item) => item.id === view)?.label ?? 'Overview'
  const navigate = (next: View) => { setView(next); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  return (
    <div className="app-shell">
      <Sidebar current={view} onChange={navigate} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="main-shell">
        <Topbar title={currentTitle} onMenu={() => setSidebarOpen(true)} onNavigate={navigate} />
        {view === 'overview' && <Overview plots={plots} onNavigate={navigate} onSelectPlot={setSelectedPlot} />}
        {view === 'plots' && <PlotsView plots={plots} setPlots={setPlots} selected={selectedPlot} setSelected={setSelectedPlot} notify={notify} />}
        {view === 'clients' && <ClientsView plots={plots} notify={notify} />}
        {view === 'payments' && <PaymentsView notify={notify} />}
        {view === 'cases' && <CasesView />}
        {view === 'reports' && <ReportsView />}
        <footer><span>Red Seal Homes Operations Platform</span><span>Prototype · Demo data only</span></footer>
      </main>
      {toast && <div className="toast"><span><Check size={16} /></span>{toast}</div>}
    </div>
  )
}
