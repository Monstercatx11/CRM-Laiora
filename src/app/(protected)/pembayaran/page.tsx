import Link from 'next/link';
import { requireAccount } from '@/lib/auth';
import { getOperationalOrders, getSettings } from '@/lib/data';
import { dateLabel, money, paymentSummary, stateLabel } from '@/lib/format';
import { PaymentForm } from '@/components/status-controls';
import { DataError, EmptyOrders, matchesOrder, OperationalFilters, OrderIdentity, queryDate, queryText, type OperationalSearch } from '@/components/operational-tables';

const statuses = [{ value: 'active', label: 'Semua PO terkonfirmasi' }, { value: 'unpaid', label: 'Belum ada pembayaran terkonfirmasi' }, { value: 'partial', label: 'DP / belum lunas' }, { value: 'paid', label: 'Lunas' }, { value: 'unknown', label: 'Total belum final' }, { value: 'pending', label: 'Ada pembayaran belum diperiksa' }, { value: 'cancelled', label: 'Order dibatalkan' }, { value: 'all', label: 'Semua order termasuk draft' }];
export default async function PaymentsPage({ searchParams }: { searchParams: OperationalSearch }) {
  await requireAccount('/pembayaran');
  const params = await searchParams;
  const date = queryDate(params.date), query = queryText(params.q);
  const requestedStatus = queryText(params.status);
  const status = statuses.some(item => item.value === requestedStatus) ? requestedStatus : 'active';
  const [result, settings] = await Promise.all([getOperationalOrders({ date: date || undefined }), getSettings()]);
  const orders = result.data.filter(order => {
    if (!matchesOrder(order, query)) return false;
    if (status === 'all') return true;
    if (status === 'cancelled') return order.state === 'cancelled';
    if (order.state !== 'confirmed') return false;
    const summary = paymentSummary(order);
    if (status === 'unpaid') return summary.paid === 0;
    if (status === 'partial') return summary.status === 'DP';
    if (status === 'paid') return summary.status === 'Lunas';
    if (status === 'unknown') return order.grand_total === null;
    if (status === 'pending') return order.payments.some(payment => payment.verification_status === 'pending');
    return true;
  });
  const paid = orders.reduce((sum, order) => sum + paymentSummary(order).paid, 0);
  const knownBalance = orders.filter(order => order.state !== 'cancelled').reduce((sum, order) => sum + (paymentSummary(order).balance ?? 0), 0);
  const unknown = orders.filter(order => order.grand_total === null).length;
  return <main className="page-content"><div className="page-head"><div><span className="eyebrow">Laiora / Pembayaran</span><h1>Tagihan &amp; pembayaran</h1><p className="subtitle">Catat transfer dan periksa pembayaran. Hanya nominal terkonfirmasi yang mengurangi sisa tagihan.</p></div><Link className="secondary" href="/pesanan">Lihat pesanan</Link></div><OperationalFilters path="/pembayaran" date={date} query={query} status={status} statuses={statuses} /><DataError error={settings.error} /><DataError error={result.error} />{!result.error && <>{orders.length ? <>
    <div className="stats"><section className="stat"><span className="eyebrow">Pembayaran terkonfirmasi</span><strong>{money(paid)}</strong><span className="muted">Dari order sesuai filter</span></section><section className="stat"><span className="eyebrow">Sisa tagihan final</span><strong>{money(knownBalance)}</strong><span className="muted">Mengecualikan total belum final dan order batal</span></section><section className="stat"><span className="eyebrow">Total belum final</span><strong>{unknown}</strong><span className="muted">Ongkir yang belum diisi tidak dianggap Rp0</span></section></div>
    <section className="panel"><span className="eyebrow">Pencatatan keuangan</span><h2>Daftar tagihan</h2><div className="table-wrap"><table className="table"><thead><tr><th>Order</th><th>Perincian tagihan</th><th>Pembayaran &amp; sisa</th><th>Catat / verifikasi</th></tr></thead><tbody>{orders.map(order => {
      const summary = paymentSummary(order);
      const pending = order.payments.filter(payment => payment.verification_status === 'pending').length;
      const overpaid = order.grand_total === null ? 0 : Math.max(0, summary.paid - Number(order.grand_total));
      return <tr key={order.id}><td><OrderIdentity order={order} /><span className="cell-note">{dateLabel(order.delivery_date)}</span><span className="badge">{stateLabel(order.state)}</span></td><td><span className="cell-note">Produk: {money(order.product_total)}</span><span className="cell-note">Kartu: {money(order.card_total)}</span><span className="cell-note">Subtotal: {money(order.subtotal)}</span><span className="cell-note">Ongkir: {order.shipping_fee === null ? 'Belum diisi' : money(order.shipping_fee)}</span><strong>Total: {money(order.grand_total)}</strong>{order.grand_total === null && <span className="cell-note">Tagihan belum final</span>}</td><td><span className="badge">{summary.status}</span><span className="cell-note">Terkonfirmasi: {money(summary.paid)}</span><strong>Sisa: {money(summary.balance)}</strong>{pending > 0 && <span className="cell-note">{pending} pembayaran menunggu pemeriksaan</span>}{overpaid > 0 && <span className="cell-note">Lebih bayar {money(overpaid)} — periksa manual.</span>}{order.state === 'cancelled' && summary.paid > 0 && <p className="message">Order batal memiliki pembayaran. Penanganan pengembalian perlu diperiksa manual.</p>}</td><td><details><summary className="link-button">Pembayaran &amp; histori ({order.payments.length})</summary><PaymentForm order={order} />{order.payments.length > 0 && <ul className="compact-list payment-history">{[...order.payments].sort((a, b) => b.created_at.localeCompare(a.created_at)).map(payment => <li key={payment.id}><strong>{money(payment.amount)}</strong> · {({ pending: 'Menunggu pemeriksaan', confirmed: 'Terkonfirmasi', rejected: 'Ditolak' })[payment.verification_status]}<span className="cell-note">{dateLabel(payment.paid_at ?? payment.created_at, settings.data.timezone)}{payment.reference ? ` · ${payment.reference}` : ''}</span>{!payment.paid_at && <span className="cell-note">Tanggal bayar belum diisi; yang ditampilkan tanggal pencatatan.</span>}</li>)}</ul>}</details><Link className="link-button" href={`/pesanan/${order.id}`}>Buka detail order →</Link></td></tr>;
    })}</tbody></table></div></section>
  </> : <EmptyOrders>Belum ada tagihan pada filter ini. Konfirmasi order untuk mulai mencatat pembayaran PO.</EmptyOrders>}</>}</main>;
}
