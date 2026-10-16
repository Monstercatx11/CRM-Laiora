'use client';
import { useId, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export function PaymentProof({ paymentId, hasProof }: { paymentId: string; hasProof: boolean }) {
  const fieldId = useId(); const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [pending,setPending] = useState(false);
  const [notice,setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const endpoint = `/api/payments/${encodeURIComponent(paymentId)}/proof`;
  async function jsonPost(input: Record<string,unknown>) {
    const response = await fetch(endpoint,{ method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input) });
    const result = await response.json().catch(()=>null);
    if (!response.ok) throw new Error(result?.error || 'Bukti pembayaran belum dapat diproses. Periksa koneksi lalu coba lagi.');
    return result;
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setNotice(null);
    try {
      const file = new FormData(event.currentTarget).get('proof');
      if (!(file instanceof File) || !file.size) throw new Error('Pilih file PNG, JPEG, atau PDF terlebih dahulu.');
      if (file.size > 10*1024*1024) throw new Error('Bukti pembayaran maksimum 10 MiB.');
      if (!['image/png','image/jpeg','application/pdf'].includes(file.type)) throw new Error('Pilih bukti pembayaran dalam format PNG, JPEG, atau PDF.');
      const target = await jsonPost({ action:'prepare',size:file.size,contentType:file.type });
      if (typeof target?.signedUrl !== 'string' || typeof target?.path !== 'string') throw new Error('Izin unggah belum tersedia. Coba lagi.');
      const response = await fetch(target.signedUrl,{ method:'PUT',headers:{'Content-Type':file.type,'Cache-Control':'max-age=0','x-upsert':'false'},body:file });
      if (!response.ok) throw new Error('File belum berhasil diunggah ke penyimpanan privat. Periksa koneksi lalu pilih ulang file.');
      const result = await jsonPost({ action:'complete',path:target.path });
      setNotice({ text:result?.message || 'Bukti pembayaran tersimpan.',error:false });
      formRef.current?.reset(); router.refresh();
    } catch (error) { setNotice({ text:error instanceof Error?error.message:'Unggahan bukti pembayaran gagal.',error:true }); }
    finally { setPending(false); }
  }
  async function download() {
    setPending(true); setNotice(null);
    try {
      const ticket=await fetch(`${endpoint}?direct=1`,{cache:'no-store'});
      const target=await ticket.json().catch(()=>null);
      if(!ticket.ok||typeof target?.signedUrl!=='string') throw new Error(target?.error||'Izin unduh bukti belum tersedia.');
      const response = await fetch(target.signedUrl,{cache:'no-store'});
      if (!response.ok) throw new Error('Bukti pembayaran belum dapat diunduh. Coba lagi.');
      const type=response.headers.get('content-type')||'';
      if (!['image/png','image/jpeg','application/pdf'].some(value=>type.startsWith(value))) throw new Error('Format bukti pembayaran tidak dikenali.');
      const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');
      const extension=type.startsWith('image/png')?'png':type.startsWith('image/jpeg')?'jpg':'pdf';
      link.href=url;link.download=`Bukti_Pembayaran_${paymentId}.${extension}`;document.body.appendChild(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch (error) { setNotice({text:error instanceof Error?error.message:'Bukti pembayaran belum dapat diunduh.',error:true}); }
    finally { setPending(false); }
  }
  return <div className="payment-proof">
    {hasProof && <button type="button" className="btn secondary" disabled={pending} onClick={download}>Unduh bukti</button>}
    <form ref={formRef} onSubmit={upload} className="stack" style={{marginTop:8}}>
      <label htmlFor={fieldId}>{hasProof?'Ganti bukti pembayaran':'Bukti pembayaran'} <small>(PNG, JPEG, PDF · maks. 10 MiB)</small></label>
      <input id={fieldId} name="proof" type="file" accept="image/png,image/jpeg,application/pdf,.png,.jpg,.jpeg,.pdf" required disabled={pending}/>
      <button type="submit" className="btn secondary" disabled={pending}>{pending?'Memproses…':hasProof?'Simpan bukti baru':'Unggah bukti'}</button>
    </form>
    {notice && <p role={notice.error?'alert':'status'} className={notice.error?'message error':'message'}>{notice.text}</p>}
  </div>;
}
