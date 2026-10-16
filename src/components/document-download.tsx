'use client';
import { useEffect, useId, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist';

export function DocumentDownload({ orderId, orderNo, disabled = false }: { orderId: string; orderNo?: string | null; disabled?: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [checked, setChecked] = useState(false);
  const [zoom, setZoom] = useState(false);
  const titleId = useId(), descriptionId = useId(), checkboxId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const requestId = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const loading = useRef<PDFDocumentLoadingTask | null>(null);
  const rendering = useRef<RenderTask | null>(null);
  const objectUrl = useRef<string | null>(null);

  function release(update = true) {
    requestId.current++;
    abort.current?.abort(); abort.current = null;
    rendering.current?.cancel(); rendering.current = null;
    if (loading.current) void loading.current.destroy().catch(() => {});
    loading.current = null;
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
    if (canvas.current) { canvas.current.width = 1; canvas.current.height = 1; }
    if (update) { setPending(false); setReady(false); setChecked(false); setZoom(false); }
  }
  useEffect(() => () => release(false), []);
  function close() { release(); dialog.current?.close(); }

  async function preview() {
    release(); setPending(true); setError('');
    const current = requestId.current;
    const controller = new AbortController(); abort.current = controller;
    dialog.current?.showModal();
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/delivery-order`, { cache: 'no-store', signal: controller.signal });
      if (!response.ok || !response.headers.get('content-type')?.includes('application/pdf')) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error || 'PDF belum dapat diunduh. Periksa koneksi dan kelengkapan order.');
      }
      const blob = await response.blob();
      if (requestId.current !== current) return;
      const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
      if (requestId.current !== current) return;
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      const data = new Uint8Array(await blob.arrayBuffer());
      if (requestId.current !== current) return;
      const task = pdfjs.getDocument({ data, useSystemFonts: true, stopAtErrors: true });
      loading.current = task;
      const document = await task.promise;
      if (requestId.current !== current) { void task.destroy().catch(() => {}); return; }
      if (document.numPages !== 1) throw new Error('Dokumen harus satu halaman sesuai template Delivery Order.');
      const page = await document.getPage(1);
      if (requestId.current !== current) return;
      const viewport = page.getViewport({ scale: 200 / 72 });
      const target = canvas.current;
      if (!target) throw new Error('Pratinjau belum tersedia. Tutup lalu coba lagi.');
      target.width = Math.ceil(viewport.width); target.height = Math.ceil(viewport.height);
      const render = page.render({ canvas: target, viewport, background: 'rgb(255,255,255)', annotationMode: pdfjs.AnnotationMode.DISABLE });
      rendering.current = render;
      await render.promise;
      if (requestId.current !== current) return;
      rendering.current = null; objectUrl.current = URL.createObjectURL(blob);
      setReady(true);
    } catch (cause) {
      if (requestId.current === current) {
        release(); setError(cause instanceof Error ? cause.message : 'Pratinjau PDF belum dapat dibuat. Dokumen belum diunduh.');
      }
    } finally { if (requestId.current === current) setPending(false); }
  }

  function downloadApproved() {
    if (!ready || !checked || !objectUrl.current) return;
    const url = objectUrl.current;
    // Detach from close cleanup until the browser has started consuming the blob.
    objectUrl.current = null;
    const link = document.createElement('a'); link.href = url;
      link.download = `Delivery_Order_${orderNo || 'Laiora'}.pdf`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    close();
  }
  return <div className="document-download" style={{display:'inline-block',maxWidth:'100%'}}>
    <button type="button" className="btn secondary" disabled={pending || disabled} onClick={preview}>{pending ? 'Membuat pratinjau…' : 'Unduh Delivery Order'}</button>
    <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={event => { event.preventDefault(); close(); }}
      style={{width:'min(920px, 94vw)',maxHeight:'92dvh',padding:24,border:'1px solid var(--line)',borderRadius:12,color:'var(--ink)',background:'var(--cream)',overflow:'auto'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:16}}>
        <h2 id={titleId} style={{margin:'0 0 12px'}}>Periksa Delivery Order</h2>
        <button type="button" className="btn secondary" onClick={close} aria-label="Tutup pratinjau">Tutup</button>
      </div>
      <p id={descriptionId}>Periksa hasil cetak 100 × 150 mm sebelum mengunduh. Pratinjau dirender 200 dpi dari PDF yang sama.</p>
      {pending && <p role="status">Menyiapkan pratinjau 200 dpi…</p>}
      {error && <p role="alert" className="message error">{error}</p>}
      {ready && <div className="actions" style={{marginBottom:12}}><span role="status">Pratinjau 200 dpi siap diperiksa.</span><button type="button" className="btn secondary" onClick={()=>setZoom(value=>!value)}>{zoom?'Sesuaikan lebar':'Perbesar pratinjau'}</button></div>}
      <div style={{display:ready?'block':'none',overflow:'auto',maxHeight:'55dvh',padding:12,background:'#e5e8e8',borderRadius:8}} aria-busy={pending}>
        <canvas ref={canvas} role="img" aria-label={`Pratinjau Delivery Order ${orderNo||''} pada 200 dpi`} style={{display:'block',height:'auto',maxWidth:zoom?'none':'100%',margin:'0 auto',background:'white'}} />
      </div>
      <ul style={{paddingLeft:20}}>
        <li>Logo utuh, proporsi benar, dan berada di dalam outline.</li>
        <li>Jarak tinta logo dari outline atas dan judul masing-masing 3 mm.</li>
        <li>Alamat, produk, dan catatan terbaca, terbungkus rapi, dan tidak terpotong.</li>
        <li>Tidak ada nama pemesan, harga, ongkir nominal, atau isi kartu.</li>
      </ul>
      <label htmlFor={checkboxId} style={{display:'flex',alignItems:'flex-start',gap:10}}>
        <input id={checkboxId} type="checkbox" checked={checked} disabled={!ready} onChange={event=>setChecked(event.target.checked)} style={{width:'auto',marginTop:5}} />
        <span>Saya sudah memeriksa logo, jarak, outline, dan isi dokumen.</span>
      </label>
      <div className="actions" style={{marginTop:16}}>
        <button type="button" className="btn primary" disabled={!ready||!checked} onClick={downloadApproved}>Unduh PDF setelah diperiksa</button>
        <button type="button" className="btn secondary" onClick={close}>Tutup tanpa unduh</button>
      </div>
    </dialog>
  </div>;
}
