-- Durable, serialized Google Sheets projection. Apply after migration 005.
-- No Google credentials, spreadsheet content, or raw messages are stored here.
begin;
alter table public.outbox_jobs add column if not exists lease_owner uuid;
create table laiora_private.sheets_worker (
  singleton boolean primary key default true check(singleton),
  spreadsheet_id text not null,
  owner uuid not null,
  leased_until timestamptz not null,
  last_heartbeat timestamptz not null default now(),
  last_backfill_date date,
  last_completed timestamptz,
  last_error_code text
);
revoke all on laiora_private.sheets_worker from public,anon,authenticated;

create function public.laiora_sync_lease(p_owner uuid,p_spreadsheet_id text) returns boolean
language plpgsql security definer set search_path='' as $$
declare acquired boolean;
begin
  if p_owner is null or p_spreadsheet_id !~ '^[A-Za-z0-9_-]{10,150}$' then raise exception 'Invalid worker identity'; end if;
  insert into laiora_private.sheets_worker(singleton,spreadsheet_id,owner,leased_until)
    values(true,p_spreadsheet_id,p_owner,clock_timestamp()+interval '90 seconds')
  on conflict(singleton) do update set
    owner=excluded.owner,spreadsheet_id=excluded.spreadsheet_id,
    leased_until=excluded.leased_until,last_heartbeat=clock_timestamp(),
    last_backfill_date=case when laiora_private.sheets_worker.spreadsheet_id=excluded.spreadsheet_id then laiora_private.sheets_worker.last_backfill_date else null end,
    last_completed=case when laiora_private.sheets_worker.spreadsheet_id=excluded.spreadsheet_id then laiora_private.sheets_worker.last_completed else null end,
    last_error_code=case when laiora_private.sheets_worker.spreadsheet_id=excluded.spreadsheet_id then laiora_private.sheets_worker.last_error_code else null end
  where laiora_private.sheets_worker.leased_until < clock_timestamp()
     or (laiora_private.sheets_worker.owner=p_owner and laiora_private.sheets_worker.spreadsheet_id=p_spreadsheet_id)
  returning true into acquired;
  if coalesce(acquired,false) then
    update public.outbox_jobs set leased_until=clock_timestamp()+interval '90 seconds'
      where state='processing' and lease_owner=p_owner;
  end if;
  return coalesce(acquired,false);
end $$;

create function laiora_private.assert_sheets_lease(p_owner uuid,p_spreadsheet_id text) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from laiora_private.sheets_worker where singleton
    and owner=p_owner and spreadsheet_id=p_spreadsheet_id and leased_until>clock_timestamp() for update;
  if not found then raise exception 'LEASE_LOST'; end if;
end $$;

create function laiora_private.sheets_snapshot(p_type text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare data jsonb; version bigint;
begin
  if p_type='orders' then
    select o.revision_no,jsonb_build_object('order',to_jsonb(o)-'raw_form','items',
      (select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb) from public.order_items i where i.order_id=o.id),
      'revisions',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'order_id',r.order_id,'revision_no',r.revision_no,
        'actor_id',r.actor_id,'changed_at',r.changed_at,'changed_fields',
        (select coalesce(jsonb_agg(e.key order by e.key),'[]'::jsonb) from jsonb_each(r.after_data) e
         where e.key<>'raw_form' and (r.before_data is null or r.before_data->e.key is distinct from e.value))) order by r.revision_no),'[]'::jsonb)
        from public.order_revisions r where r.order_id=o.id))
      into version,data from public.orders o where o.id=p_id;
  else
    select v.version into version from laiora_private.entity_versions v where v.entity_type=p_type and v.entity_id=p_id;
    if p_type='payments' then
      select to_jsonb(p)-'request_id' into data from public.payments p where p.id=p_id;
    elsif p_type='products' then
      select jsonb_build_object('product',to_jsonb(p),'prices',
        (select coalesce(jsonb_agg(to_jsonb(pp) order by pp.effective_from),'[]'::jsonb) from public.product_prices pp where pp.product_id=p.id))
        into data from public.products p where p.id=p_id;
    elsif p_type='chat_opportunities' then
      select jsonb_build_object('contact_name',c.display_name,'contact_phone',c.phone,
        'follow_up',t.follow_up,'po_status',t.po_status,'last_message_at',t.last_message_at,
        'product_labels',(select coalesce(jsonb_agg(p.name||' ('||p.size||')' order by p.sku),'[]'::jsonb)
          from public.opportunity_product_labels l join public.products p on p.id=l.product_id where l.opportunity_id=t.opportunity_id),
        'order_ids',(select coalesce(jsonb_agg(l.order_id::text order by l.order_id),'[]'::jsonb)
          from public.opportunity_order_links l where l.opportunity_id=t.opportunity_id))
        into data from public.chat_tracking t join public.contacts c on c.id=t.contact_id where t.opportunity_id=p_id;
    elsif p_type='app_settings' then
      select jsonb_build_object('business_name',business_name,'timezone',timezone,
        'greeting_card_price',greeting_card_price,'updated_at',updated_at) into data from public.app_settings where singleton;
    else raise exception 'UNSUPPORTED_ENTITY';
    end if;
  end if;
  if data is null or version is null then raise exception 'MISSING_PROJECTION'; end if;
  return jsonb_build_object('entity_type',p_type,'entity_id',p_id,'version',version::text,
    'today',laiora_private.business_today()::text,'projected_at',clock_timestamp(),'data',data);
end $$;

create function public.laiora_claim_sync(p_owner uuid,p_spreadsheet_id text,p_limit integer default 1) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb:='[]'::jsonb; job public.outbox_jobs; snapshot jsonb;
begin
  perform laiora_private.assert_sheets_lease(p_owner,p_spreadsheet_id);
  -- A crash cannot lose a job; only expired claims return to the queue.
  update public.outbox_jobs set state='pending',lease_owner=null,leased_until=null
    where state='processing' and leased_until<clock_timestamp();
  for job in select j.* from public.outbox_jobs j
    where j.state in ('pending','failed') and j.available_at<=clock_timestamp() and j.attempts<12
    order by j.available_at,j.id limit least(greatest(p_limit,1),10) for update skip locked
  loop
    begin
      snapshot:=laiora_private.sheets_snapshot(job.entity_type,job.entity_id);
    exception when others then
      if sqlerrm not in ('MISSING_PROJECTION','UNSUPPORTED_ENTITY') then raise; end if;
      update public.outbox_jobs set state='failed',attempts=12,last_error_code='MISSING_PROJECTION',leased_until=null,lease_owner=null where id=job.id;
      continue;
    end;
    -- Snapshot uses current committed state, never the stale payload of an
    -- earlier version. JSON strings avoid JS bigint precision loss.
    update public.outbox_jobs set state='processing',attempts=attempts+1,
      lease_owner=p_owner,leased_until=clock_timestamp()+interval '90 seconds' where id=job.id;
    result:=result||jsonb_build_array(jsonb_build_object('job_id',job.id::text,'attempts',job.attempts+1,'snapshot',snapshot));
  end loop;
  return result;
end $$;

create function public.laiora_complete_sync(p_owner uuid,p_spreadsheet_id text,p_job_id bigint) returns boolean
language plpgsql security definer set search_path='' as $$
declare updated integer;
begin
  perform laiora_private.assert_sheets_lease(p_owner,p_spreadsheet_id);
  update public.outbox_jobs set state='done',lease_owner=null,leased_until=null,last_error_code=null
    where id=p_job_id and lease_owner=p_owner and state='processing';
  get diagnostics updated=row_count;
  if updated>0 then update laiora_private.sheets_worker set last_completed=clock_timestamp(),last_error_code=null where singleton; end if;
  return updated>0;
end $$;

create function public.laiora_fail_sync(p_owner uuid,p_spreadsheet_id text,p_job_id bigint,p_error_code text,p_retry_seconds integer default 5) returns boolean
language plpgsql security definer set search_path='' as $$
declare updated integer; safe_code text;
begin
  perform laiora_private.assert_sheets_lease(p_owner,p_spreadsheet_id);
  safe_code:=case when p_error_code in ('NETWORK_ERROR','RATE_LIMITED','AUTH_EXPIRED','PERMISSION_DENIED','REMOTE_UNAVAILABLE','REMOTE_REQUEST_REJECTED','INVALID_REMOTE_RESPONSE','INVALID_GOOGLE_CREDENTIALS','INVALID_GOOGLE_TOKEN','SHEET_HEADER_CONFLICT','DUPLICATE_SHEET_ID','INVALID_VERSION','MISSING_PROJECTION','UNSUPPORTED_ENTITY','SHEET_MISSING','LEASE_LOST','INVALID_CELL') then p_error_code else 'SYNC_ERROR' end;
  update public.outbox_jobs set state='failed',lease_owner=null,leased_until=null,last_error_code=safe_code,
    available_at=clock_timestamp()+make_interval(secs=>least(greatest(p_retry_seconds,1),3600))
    where id=p_job_id and lease_owner=p_owner and state='processing';
  get diagnostics updated=row_count;
  if updated>0 then update laiora_private.sheets_worker set last_error_code=safe_code where singleton; end if;
  return updated>0;
end $$;

create function public.laiora_backfill_sync(p_owner uuid,p_spreadsheet_id text) returns integer
language plpgsql security definer set search_path='' as $$
declare item record; count integer:=0;
begin
  perform laiora_private.assert_sheets_lease(p_owner,p_spreadsheet_id);
  for item in select id,revision_no from public.orders loop
    -- Requeue an already completed order for reconciliation without changing its
    -- immutable business revision. Do not steal a currently processing claim.
    perform laiora_private.queue_entity('orders',item.id,item.revision_no);
    update public.outbox_jobs set state='pending',attempts=0,available_at=now(),last_error_code=null
      where entity_type='orders' and entity_id=item.id and entity_version=item.revision_no and state<>'processing';
    count:=count+1;
  end loop;
  for item in select 'products'::text entity_type,id from public.products
    union all select 'payments',id from public.payments
    union all select 'chat_opportunities',id from public.chat_opportunities
    union all select 'app_settings','00000000-0000-0000-0000-000000000001'::uuid from public.app_settings where singleton
  loop
    perform laiora_private.queue_entity(item.entity_type,item.id);
    count:=count+1;
  end loop;
  update laiora_private.sheets_worker set last_backfill_date=laiora_private.business_today() where singleton;
  return count;
end $$;

create function public.laiora_ensure_sync_backfill(p_owner uuid,p_spreadsheet_id text) returns integer
language plpgsql security definer set search_path='' as $$
begin
  perform laiora_private.assert_sheets_lease(p_owner,p_spreadsheet_id);
  if exists(select 1 from laiora_private.sheets_worker where singleton and last_backfill_date=laiora_private.business_today()) then return 0; end if;
  return public.laiora_backfill_sync(p_owner,p_spreadsheet_id);
end $$;

create function public.laiora_release_sync(p_owner uuid,p_spreadsheet_id text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from laiora_private.sheets_worker where singleton and owner=p_owner and spreadsheet_id=p_spreadsheet_id for update;
  if not found then return false; end if;
  -- A bounded request may stop between tab writes; retry the exact same job
  -- without touching any newer pending version. Partial Sheets writes are safe
  -- because all projections are idempotent and compare monotonic versions.
  update public.outbox_jobs set state='pending',lease_owner=null,leased_until=null,
    available_at=clock_timestamp() where state='processing' and lease_owner=p_owner;
  update laiora_private.sheets_worker set leased_until=clock_timestamp()-interval '1 second' where singleton;
  return true;
end $$;

create function public.laiora_sync_status() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; worker laiora_private.sheets_worker;
begin
  if not public.laiora_has_access() then raise exception 'Unauthorized'; end if;
  select * into worker from laiora_private.sheets_worker where singleton;
  select jsonb_build_object('pending',count(*) filter(where state in ('pending','processing')),
    'failed',count(*) filter(where state='failed'),'lastCompleted',worker.last_completed,
    'configured',coalesce(worker.last_heartbeat>now()-interval '120 seconds',false),
    'error',worker.last_error_code) into result from public.outbox_jobs;
  return result;
end $$;

create function public.laiora_retry_sync() returns integer
language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
  if not public.laiora_has_access() then raise exception 'Unauthorized'; end if;
  update public.outbox_jobs set state='pending',attempts=0,available_at=clock_timestamp(),last_error_code=null,
    lease_owner=null,leased_until=null
    where id in(select id from public.outbox_jobs where state='failed' order by id limit 1000 for update skip locked);
  get diagnostics changed=row_count;
  return changed;
end $$;

revoke all on function public.laiora_sync_lease(uuid,text),public.laiora_claim_sync(uuid,text,integer),
  public.laiora_complete_sync(uuid,text,bigint),public.laiora_fail_sync(uuid,text,bigint,text,integer),
  public.laiora_backfill_sync(uuid,text),public.laiora_ensure_sync_backfill(uuid,text),public.laiora_release_sync(uuid,text) from public,anon,authenticated;
grant execute on function public.laiora_sync_lease(uuid,text),public.laiora_claim_sync(uuid,text,integer),
  public.laiora_complete_sync(uuid,text,bigint),public.laiora_fail_sync(uuid,text,bigint,text,integer),
  public.laiora_backfill_sync(uuid,text),public.laiora_ensure_sync_backfill(uuid,text),public.laiora_release_sync(uuid,text) to service_role;
revoke all on function public.laiora_sync_status(),public.laiora_retry_sync() from public,anon;
grant execute on function public.laiora_sync_status(),public.laiora_retry_sync() to authenticated;
revoke all on all functions in schema laiora_private from public,anon,authenticated;
commit;
