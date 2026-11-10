import Link from 'next/link';
import type { Conversation, Opportunity, Product } from '@/lib/types';
import { pipelineStage, pipelineStages } from '@/lib/chat-pipeline';
import { PipelineStageForm } from './pipeline-stage-form';

export function ChatPipeline({ opportunities, conversations, products }: { opportunities: Opportunity[]; conversations: Conversation[]; products: Product[] }) {
  return <section aria-label="Pipeline pelanggan">
    <p className="muted">Satu kartu untuk setiap peluang pemesanan. Pelanggan yang sama dapat memiliki beberapa peluang. Sudah PO mengikuti order terkonfirmasi; tahap lain diatur manual.</p>
    <div className="pipeline-board">{pipelineStages.map(stage => {
      const cards = opportunities.filter(opportunity => pipelineStage(opportunity) === stage.id);
      return <section className="pipeline-column" key={stage.id} aria-label={stage.label}>
        <h2>{stage.label} <span className="badge neutral">{cards.length}</span></h2>
        {cards.map(opportunity => {
          const contact = conversations.find(conversation => conversation.id === opportunity.conversation_id)?.contacts;
          return <article className="pipeline-card" key={opportunity.id}>
            <h3>{opportunity.title || 'Peluang order'}</h3>
            <p>{contact?.display_name || 'Pelanggan'}<small className="cell-note">{contact?.phone || 'Nomor belum tersedia'}</small></p>
            <span className={`badge ${stage.id === 'confirmed' ? '' : 'warning'}`}>{stage.id === 'confirmed' ? 'Sudah PO' : 'Belum PO'}</span>
            <div className="tags">{opportunity.opportunity_product_labels.map(label => <span className="badge neutral" key={label.product_id}>{products.find(product => product.id === label.product_id)?.name || 'Produk'}</span>)}</div>
            <p><Link href={`/tracking-chat?conversation=${opportunity.conversation_id}`}>Buka percakapan →</Link></p>
            {opportunity.opportunity_order_links.map(link => <p key={link.order_id}><Link href={`/pesanan/${link.order_id}`}>{link.orders?.order_no || 'Lihat draft order'}</Link></p>)}
            {stage.id !== 'confirmed' ? <><Link className="secondary" href={`/pesanan/baru?opportunity_id=${opportunity.id}`}>Buat draft PO</Link><details><summary>Ubah tahap</summary><PipelineStageForm opportunity={opportunity}/></details></> : <p className="muted">Tahap ini otomatis mengikuti PO aktif.</p>}
          </article>;
        })}
        {!cards.length && <p className="muted">Belum ada peluang pada tahap ini.</p>}
      </section>;
    })}</div>
    {!opportunities.length && <p className="message">Belum ada peluang yang cocok. Buka Percakapan untuk menambahkan peluang dan label produk.</p>}
  </section>;
}
