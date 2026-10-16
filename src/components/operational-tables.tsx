import Link from 'next/link';
import type { Order } from '@/lib/types';

export type OperationalSearch = Promise<Record<string, string | string[] | undefined>>;
export function queryText(value: string | string[] | undefined) {
  return typeof value === 'string' ? value.trim().slice(0, 200) : '';
}
export function queryDate(value: string | string[] | undefined) {
  const date = queryText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : '';
}
export function dateInZone(value: Date | string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function matchesOrder(order: Order, query: string) {
  if (!query) return true;
  const haystack = [order.order_no, order.sender_name, order.sender_phone, order.recipient_name, order.recipient_phone, order.address, ...order.order_items.map(item => `${item.product_name} ${item.size}`)].join(' ').toLocaleLowerCase('id-ID');
  return haystack.includes(query.toLocaleLowerCase('id-ID'));
}
export function DataError({ error }: { error: string | null }) {
  return error ? <div role="alert" className="message error"><strong>Data belum dapat dimuat.</strong> {error}</div> : null;
}
export function OrderIdentity({ order }: { order: Order }) {
  return <><Link className="order-number" href={`/pesanan/${order.id}`}>{order.order_no ?? 'Draft order'}</Link><span className="cell-note">{order.recipient_name ?? order.sender_name ?? 'Nama belum diisi'}</span><span className="cell-note">Revisi {order.revision_no}</span></>;
}
export function OrderItems({ order }: { order: Order }) {
  return <ul className="compact-list">{order.order_items.map(item => <li key={item.id}><strong>{item.quantity}×</strong> {item.product_name} <span className="muted">· {item.size}</span>{item.cutting_note && <span className="cell-note">{item.cutting_note}</span>}{item.item_note && <span className="cell-note">{item.item_note}</span>}</li>)}</ul>;
}
export function OperationalFilters({ path, date, query, status, statuses, dateLabel = 'Tanggal pengiriman' }: {
  path: string; date: string; query: string; status: string;
  statuses: { value: string; label: string }[]; dateLabel?: string;
}) {
  return <form method="get" className="panel filters" aria-label="Filter data operasional"><div className="form-grid"><label className="field"><span>Cari order atau pelanggan</span><input type="search" name="q" placeholder="Nomor PO, nama, HP, atau produk" defaultValue={query} maxLength={200} /></label><label className="field"><span>{dateLabel}</span><input type="date" name="date" defaultValue={date} /></label><label className="field"><span>Status</span><select name="status" defaultValue={status}>{statuses.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><div className="actions filter-actions"><button className="secondary" type="submit">Terapkan</button><Link className="link-button" href={path}>Reset</Link></div></div></form>;
}
export function EmptyOrders({ children }: { children: React.ReactNode }) {
  return <div className="empty-state"><h2>Belum ada order yang sesuai</h2><p>{children}</p><Link className="secondary" href="/pesanan/baru">Buat order baru</Link></div>;
}
