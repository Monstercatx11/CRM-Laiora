'use client';

import { useActionState } from 'react';
import { setOpportunityStage } from '@/app/actions';
import { pipelineStages } from '@/lib/chat-pipeline';
import type { Opportunity } from '@/lib/types';

export function PipelineStageForm({ opportunity }: { opportunity: Opportunity }) {
  const [state, action, pending] = useActionState(setOpportunityStage, { error: '' });
  return <form action={action} className="stack pipeline-stage-form">
    <input type="hidden" name="opportunity_id" value={opportunity.id}/>
    <label>Tahap tindak lanjut<select name="follow_up" aria-label="Tahap tindak lanjut" defaultValue={opportunity.follow_up}>
      {pipelineStages.filter(stage => stage.id !== 'confirmed').map(stage => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
    </select></label>
    <button className="secondary" disabled={pending}>{pending ? 'Menyimpan…' : 'Pindahkan tahap'}</button>
    {state.error && <p className="message error" role="alert">{state.error}</p>}
    {state.success && <p className="message success" role="status">{state.success}</p>}
  </form>;
}
