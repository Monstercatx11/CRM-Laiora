import type { Opportunity } from './types';

export const pipelineStages = [
  { id: 'new', label: 'Baru' },
  { id: 'needs_review', label: 'Perlu ditinjau' },
  { id: 'waiting_for_data', label: 'Menunggu data' },
  { id: 'done', label: 'Selesai ditindaklanjuti' },
  { id: 'confirmed', label: 'Sudah PO' },
] as const;

export function pipelineStage(opportunity: Opportunity): string {
  if (opportunity.opportunity_order_links.some(link => link.orders?.state === 'confirmed')) return 'confirmed';
  return pipelineStages.some(stage => stage.id !== 'confirmed' && stage.id === opportunity.follow_up) ? opportunity.follow_up : 'new';
}
