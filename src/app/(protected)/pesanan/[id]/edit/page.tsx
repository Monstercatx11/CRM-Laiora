import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAccount } from '@/lib/auth';
import { getCatalog,getOrder } from '@/lib/data';
import { OrderForm } from '@/components/order-form';
import s from '@/components/orders.module.css';
export default async function EditOrderPage({params}:{params:Promise<{id:string}>}) {
  const {id}=await params;await requireAccount(`/pesanan/${id}/edit`);
  if(!/^[0-9a-f-]{36}$/i.test(id))notFound();
  const [catalog,result]=await Promise.all([getCatalog(),getOrder(id)]);
  if(result.error||catalog.error)return <main className="page-content"><h1>Revisi pesanan</h1><div className={s.error} role="alert">{result.error||catalog.error}<p>Data belum dapat dimuat. Muat ulang setelah koneksi Supabase tersedia.</p></div></main>;
  if(!result.data)notFound();const order=result.data;
  return <main className="page-content"><div className={s.heading}><div><Link href={`/pesanan/${id}`} className={s.muted}>← Detail pesanan</Link><h1>{order.order_no?`Revisi ${order.order_no}`:'Ubah draft pesanan'}</h1><p>{order.order_no?'Nomor PO tetap sama. Setiap perubahan tersimpan di riwayat.':'Lengkapi draft sebelum konfirmasi dan pemberian nomor PO.'}</p></div><span className={s.badge}>Versi {order.revision_no}</span></div>{order.state==='cancelled'?<div className={s.warning}>Pesanan sudah dibatalkan dan tidak dapat direvisi. Buat pesanan baru jika pelanggan kembali memesan.</div>:<OrderForm products={catalog.data} order={order}/>}</main>;
}
