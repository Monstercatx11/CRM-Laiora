import Link from 'next/link';
import { requireAccount } from '@/lib/auth';
import { getCatalog,getSettings,getOpportunityDraft } from '@/lib/data';
import { OrderForm } from '@/components/order-form';
import s from '@/components/orders.module.css';
export default async function NewOrderPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const params=await searchParams;
  const opportunityId=typeof params.opportunity_id==='string'?params.opportunity_id:undefined;
  const next=opportunityId?`/pesanan/baru?${new URLSearchParams({opportunity_id:opportunityId})}`:'/pesanan/baru';
  await requireAccount(next);
  const [result,settings,opportunity]=await Promise.all([getCatalog(),getSettings(),opportunityId?getOpportunityDraft(opportunityId):Promise.resolve(null)]);
  const initial:Record<string,string>=opportunity?.data?{...opportunity.data,channel:'whatsapp'}:{channel:'manual'};
  const error=result.error||settings.error||opportunity?.error;
  return <main className="page-content"><div className={s.heading}><div><Link href="/pesanan" className={s.muted}>← Semua pesanan</Link><h1>Pesanan baru</h1><p>Siapkan detail pesanan. Periksa data sebelum mengonfirmasi PO.</p></div><span className={`${s.badge} ${s.draft}`}>Draft → Konfirmasi PO</span></div>{error?<div className={s.error} role="alert">{error}<p>Katalog atau sumber chat belum dapat dimuat. Periksa koneksi dan migrasi Supabase sebelum membuat order.</p><Link href="/integrasi">Buka integrasi</Link></div>:<OrderForm products={result.data} initial={initial} opportunityId={opportunityId} cardUnitPrice={settings.data.greeting_card_price}/>}</main>;
}
