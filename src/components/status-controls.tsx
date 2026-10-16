'use client';
import { useActionState,useState,useEffect } from 'react';
import { updateOrderStatus,recordPayment } from '@/app/actions';
import { productionOptions,fulfillmentOptions,paymentSummary,money } from '@/lib/format';
import type { Order } from '@/lib/types';
export function StatusControls({order,scope='all'}:{order:Order;scope?:'production'|'fulfillment'|'all'}){const [state,action,pending]=useActionState(updateOrderStatus,{error:''});const [kind,setKind]=useState(scope==='fulfillment'?'fulfillment':'production');return <form action={action} className="compact-form"><input type="hidden" name="order_id" value={order.id}/><input type="hidden" name="expected_revision" value={order.revision_no}/>{scope==='all'?<select name="kind" value={kind} onChange={e=>setKind(e.target.value)} aria-label="Jenis status"><option value="production">Produksi</option><option value="fulfillment">Pengiriman</option></select>:<input type="hidden" name="kind" value={kind}/>}<select key={`${kind}-${order.revision_no}`} name="status" defaultValue={kind==='production'?order.production_status:order.fulfillment_status} aria-label="Status baru">{(kind==='production'?productionOptions:fulfillmentOptions).map(([v,label])=><option key={v} value={v}>{label}</option>)}</select><button className="secondary" disabled={pending||order.state!=='confirmed'}>{pending?'Menyimpan…':'Simpan status'}</button>{state.error&&<p role="alert" className="message error">{state.error}</p>}{state.success&&<p role="status" className="message success">{state.success}</p>}</form>;}
export function PaymentForm({order}:{order:Order}) {
  const [formVersion,setFormVersion]=useState(0);
  return <PaymentEntry key={`${order.id}:${formVersion}`} order={order} onNext={()=>setFormVersion(v=>v+1)}/>;
}
function PaymentEntry({order,onNext}:{order:Order;onNext:()=>void}) {
  const [state,action,pending]=useActionState(recordPayment,{error:''});
  const [requestId,setRequestId]=useState('');
  const [paidAt,setPaidAt]=useState('');
  useEffect(()=>{setRequestId(crypto.randomUUID());},[]);
  const summary=paymentSummary(order);
  const localTime=paidAt?new Date(paidAt):null;
  const paidAtIso=localTime&&Number.isFinite(localTime.getTime())?localTime.toISOString():'';
  if(state.success)return <div className="stack"><p className="message success" role="status">{state.success}</p><p className="muted">Transaksi ini sudah tersimpan. Mulai form baru hanya untuk pembayaran yang berbeda.</p><button className="secondary" type="button" onClick={onNext} disabled={order.state!=='confirmed'}>Catat pembayaran lain</button></div>;
  return <form action={action} className="stack"><input type="hidden" name="order_id" value={order.id}/><input type="hidden" name="request_id" value={requestId}/><input type="hidden" name="paid_at_iso" value={paidAtIso}/><div className="form-grid"><label>Nominal diterima (Rp)<input name="amount" type="number" min="1" max="1000000000" step="1" required/></label><label>Waktu pembayaran<input type="datetime-local" value={paidAt} onChange={e=>setPaidAt(e.target.value)}/></label></div><label>Referensi / catatan bukti<input name="reference" maxLength={500} placeholder="Nomor transfer atau keterangan pemeriksaan"/></label><label className="check"><input type="checkbox" name="confirmed" value="yes" required/>Saya sudah memeriksa dan mengonfirmasi pembayaran ini.</label><p className="muted">Terbayar {money(summary.paid)} · sisa {money(summary.balance)}. Catat tiap transaksi satu kali.</p><button className="primary" disabled={pending||!requestId||order.state!=='confirmed'}>{pending?'Mencatat…':'Catat pembayaran terkonfirmasi'}</button>{state.error&&<p className="message error" role="alert">{state.error}</p>}</form>;
}
