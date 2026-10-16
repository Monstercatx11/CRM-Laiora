'use client';
import { useState } from 'react';
import { updateOrderStatus } from '@/app/actions';
import { useActionState } from 'react';
import s from './orders.module.css';
export function CopyText({text,label='Salin teks'}:{text:string;label?:string}) {
  const [message,setMessage]=useState('');
  async function copy(){try{await navigator.clipboard.writeText(text);setMessage('Tersalin.');}catch{setMessage('Salin manual dari teks di bawah; izin clipboard browser tidak tersedia.');}}
  return <div className={s.actions}><button type="button" className={`${s.button} ${s.secondary}`} onClick={copy}>{label}</button>{message&&<span className={s.muted} role="status">{message}</span>}</div>;
}
export function CancelOrder({id,revision}:{id:string;revision:number}) {
  const [armed,setArmed]=useState(false);const [state,action,pending]=useActionState(updateOrderStatus,{error:''});
  if(state.success)return <p className={s.warning} role="status">{state.success}</p>;
  return <div>{!armed?<button className={s.remove} type="button" onClick={()=>setArmed(true)}>Batalkan pesanan</button>:<form action={action}><input type="hidden" name="order_id" value={id}/><input type="hidden" name="expected_revision" value={revision}/><input type="hidden" name="kind" value="state"/><input type="hidden" name="status" value="cancelled"/><p className={s.warning}>Batalkan pesanan ini? Nomor yang sudah dipakai tetap tersimpan. Pembatalan tidak mencatat pengembalian dana.</p><label className={s.checkbox}><input type="checkbox" name="confirm_cancel" value="yes" required/>Saya mengonfirmasi pembatalan pesanan ini.</label><div className={s.spacer}/><div className={s.actions}><button type="button" className={`${s.button} ${s.secondary}`} onClick={()=>setArmed(false)} disabled={pending}>Kembali</button><button type="submit" className={`${s.button} ${s.danger}`} disabled={pending}>{pending?'Membatalkan…':'Ya, batalkan pesanan'}</button></div></form>}{state.error&&<p className={s.error} role="alert">{state.error}</p>}</div>;
}
