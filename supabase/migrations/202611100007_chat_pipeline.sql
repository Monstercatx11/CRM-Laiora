-- Run once after migrations 001–006. Safe to repeat; no customer rows are reset.
begin;
create or replace function public.laiora_set_opportunity_stage(p_opportunity_id uuid,p_follow_up text)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform laiora_private.require_access();
  if p_follow_up is null or p_follow_up not in ('new','needs_review','waiting_for_data','done') then
    raise exception 'Tahap pipeline tidak valid';
  end if;
  update public.chat_opportunities set follow_up=p_follow_up where id=p_opportunity_id;
  if not found then raise exception 'Peluang tidak ditemukan'; end if;
  insert into public.app_audit_log(action,entity_id,actor_id,metadata)
    values('opportunity.stage_changed',p_opportunity_id,auth.uid(),jsonb_build_object('follow_up',p_follow_up));
end $$;
revoke all on function public.laiora_set_opportunity_stage(uuid,text) from public,anon;
grant execute on function public.laiora_set_opportunity_stage(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
