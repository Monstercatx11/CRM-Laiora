import Link from 'next/link';
import { requireAccount } from '@/lib/auth';
import { getOperationalOrders } from '@/lib/data';
import { dateLabel, productionLabel, productionOptions } from '@/lib/format';
import type { Order } from '@/lib/types';
import { StatusControls } from '@/components/status-controls';
import { DataError, EmptyOrders, matchesOrder, OperationalFilters, OrderIdentity, OrderItems, queryDate, queryText, type OperationalSearch } from '@/components/operational-tables';

type ProductionGroup = { date: string | null; product: string; size: string; quantity: number; instructions: { order: Order; cutting: string | null; note: string | null; quantity: number }[] };
const statuses = [{ value: 'active', label: 'Produksi aktif' }, { value: 'all', label: 'Semua progres' }, ...productionOptions.map(([value, label]) => ({ value, label }))];
export default async function ProductionPage({ searchParams }: { searchParams: OperationalSearch }) {
  await requireAccount('/produksi');
  const params = await searchParams;
  const date = queryDate(params.date), query = queryText(params.q);
  const requestedStatus = queryText(params.status);
  const status = statuses.some(item => item.value === requestedStatus) ? requestedStatus : 'active';
  const result = await getOperationalOrders({ date: date || undefined, state: 'confirmed' });
  const orders = result.data.filter(order => matchesOrder(order, query) && (status === 'all' || (status === 'active' ? !['completed', 'picked_up'].includes(order.fulfillment_status) : order.production_status === status))).sort((a, b) => (a.delivery_date ?? '9999').localeCompare(b.delivery_date ?? '9999') || (a.order_no ?? '').localeCompare(b.order_no ?? ''));
  const groups = new Map<string, ProductionGroup>();
  for (const order of orders) for (const item of order.order_items) {
    const key = JSON.stringify([order.delivery_date, item.product_name, item.size]);
    const group = groups.get(key) ?? { date: order.delivery_date, product: item.product_name, size: item.size, quantity: 0, instructions: [] };
    group.quantity += item.quantity;
    group.instructions.push({ order, cutting: item.cutting_note, note: item.item_note, quantity: item.quantity });
    groups.set(key, group);
  }
  const cards = orders.filter(order => order.greeting_card_choice === 'yes' && order.greeting_card_qty > 0);
  return <main className="page-content"><div className="page-head"><div><span className="eyebrow">Laiora / Produksi</span><h1>Rencana dapur</h1><p className="subtitle">Rekap versi terbaru PO terkonfirmasi berdasarkan tanggal, produk, dan ukuran.</p></div><Link className="secondary" href="/pesanan">Kelola order</Link></div><OperationalFilters path="/produksi" date={date} query={query} status={status} statuses={statuses} /><DataError error={result.error} />{!result.error && <>{orders.length ? <>
    <div className="stats"><section className="stat"><span className="eyebrow">Order sesuai filter</span><strong>{orders.length}</strong></section><section className="stat"><span className="eyebrow">Unit produk fisik</span><strong>{orders.reduce((sum, order) => sum + order.product_quantity, 0)}</strong><span className="muted">Potong tidak menambah jumlah cake</span></section><section className="stat"><span className="eyebrow">Kartu ucapan</span><strong>{cards.reduce((sum, order) => sum + order.greeting_card_qty, 0)}</strong><span className="muted">Dihitung terpisah dari produk</span></section></div>
    <section className="panel"><span className="eyebrow">Kebutuhan produksi</span><h2>Produk &amp; instruksi potong</h2><p>Order batal dan draft tidak masuk rekap. Filter “Produksi aktif” mengecualikan order yang sudah diserahkan atau selesai.</p><div className="table-wrap"><table className="table"><thead><tr><th>Tanggal kirim</th><th>Produk / ukuran</th><th>Unit</th><th>Rincian potong dan catatan</th></tr></thead><tbody>{Array.from(groups.entries()).map(([key, group]) => <tr key={key}><td>{dateLabel(group.date)}</td><td><strong>{group.product}</strong><span className="cell-note">{group.size}</span></td><td><strong>{group.quantity}</strong></td><td><ul className="compact-list">{group.instructions.map((instruction, index) => <li key={`${instruction.order.id}-${index}`}><Link className="order-number" href={`/pesanan/${instruction.order.id}`}>{instruction.order.order_no}</Link> · {instruction.quantity} unit<span className="cell-note">{instruction.cutting || 'Instruksi potong belum diisi'}{instruction.note ? ` · ${instruction.note}` : ''}</span></li>)}</ul></td></tr>)}</tbody></table></div></section>
    <section className="panel"><span className="eyebrow">Pekerjaan per order</span><h2>Progres produksi &amp; packing</h2><div className="table-wrap"><table className="table"><thead><tr><th>Order</th><th>Jadwal</th><th>Produk &amp; packing</th><th>Progres</th></tr></thead><tbody>{orders.map(order => <tr key={order.id}><td><OrderIdentity order={order} /></td><td>{dateLabel(order.delivery_date)}<span className="cell-note">{order.delivery_time_note}</span></td><td><OrderItems order={order} />{order.operational_notes && <p className="pre-wrap">{order.operational_notes}</p>}{order.greeting_card_choice === 'yes' && <span className="badge">Sertakan {order.greeting_card_qty} kartu ucapan</span>}{order.greeting_card_choice === 'undecided' && <span className="badge warning">Kartu belum diputuskan</span>}</td><td><span className="badge">{productionLabel(order.production_status)}</span><StatusControls order={order} scope="production" /></td></tr>)}</tbody></table></div></section>
    {cards.length > 0 && <section className="panel"><span className="eyebrow">Kartu ucapan</span><h2>Daftar kartu terkonfirmasi</h2><div className="table-wrap"><table className="table"><thead><tr><th>Order</th><th>Jumlah kartu</th><th>Dari / untuk</th><th>Pesan</th></tr></thead><tbody>{cards.map(order => <tr key={order.id}><td><OrderIdentity order={order} /></td><td>{order.greeting_card_qty}</td><td>{order.card_from || 'Belum diisi'}<span className="cell-note">Untuk: {order.card_to || 'Belum diisi'}</span></td><td className="pre-wrap">{order.card_message || 'Pesan kartu belum diisi'}</td></tr>)}</tbody></table></div></section>}
  </> : <EmptyOrders>Ubah filter atau konfirmasi draft di halaman Pesanan untuk memasukkannya ke rekap produksi.</EmptyOrders>}</>}</main>;
}
