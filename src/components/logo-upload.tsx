'use client';
import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export function LogoUpload({ currentPath }: { currentPath?: string | null }) {
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setNotice(null);
    try {
      const form = new FormData(event.currentTarget);
      const file = form.get('logo');
      if (!(file instanceof File) || !file.size) throw new Error('Pilih file PNG asli terlebih dahulu.');
      if (file.size > 2 * 1024 * 1024) throw new Error('Logo maksimum 2 MiB. Gunakan file PNG asli.');
      const response = await fetch('/api/branding/logo', { method: 'POST', body: form });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || 'Unggahan gagal. Periksa koneksi lalu coba lagi.');
      setNotice({ text: result?.message || 'Logo berhasil disimpan.', error: false });
      formRef.current?.reset(); router.refresh();
    } catch (error) { setNotice({ text: error instanceof Error ? error.message : 'Unggahan logo gagal.', error: true }); }
    finally { setPending(false); }
  }
  return <form ref={formRef} onSubmit={submit} className="stack">
    <p>Unggah file asli <strong>Vintage Blue Boulangerie Emblem(2).png</strong>: canvas 1536 × 1024 px, latar transparan, maksimum 2 MiB. File disimpan tanpa perubahan; PDF memakai tinta hitam sesuai template SOP.</p>
    <p className="muted">{currentPath ? 'Logo sudah tersimpan. Unggahan baru akan mengganti logo aktif untuk PDF berikutnya.' : 'Logo resmi belum tersedia. Delivery Order baru bisa diunduh setelah logo asli diunggah.'}</p>
    <label htmlFor="official-logo">File logo resmi</label>
    <input id="official-logo" type="file" name="logo" accept="image/png,.png" required disabled={pending} />
    <button type="submit" className="btn secondary" disabled={pending}>{pending ? 'Menyimpan logo…' : 'Simpan logo asli'}</button>
    {notice && <p role={notice.error ? 'alert' : 'status'} className={notice.error ? 'message error' : 'message'}>{notice.text}</p>}
  </form>;
}
