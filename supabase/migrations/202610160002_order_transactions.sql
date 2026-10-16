begin;
-- Serialize item writes against confirmation to avoid confirming stale totals.
create function laiora_private.lock_item_parent() returns trigger
language plpgsql set search_path='' as $$
declare parent_id uuid;
begin
  if tg_op='UPDATE' and new.order_id<>old.order_id then
    raise exception 'Moving items between orders is not supported';
  end if;
  parent_id := case when tg_op='DELETE' then old.order_id else new.order_id end;
  perform 1 from public.orders where id=parent_id for update;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger lock_item_parent before insert or update or delete on public.order_items
for each row execute function laiora_private.lock_item_parent();

create function laiora_private.audit_order() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if old.order_no is not null and new.order_no is distinct from old.order_no then
      raise exception 'Order number is immutable';
    end if;
    new.revision_no := old.revision_no+1;
    new.created_at := old.created_at;
  else
    new.revision_no := 0;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger prepare_order before insert or update on public.orders
for each row execute function laiora_private.audit_order();

create function laiora_private.record_order_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.order_revisions(order_id,revision_no,before_data,after_data,actor_id)
    values(new.id,new.revision_no,case when tg_op='UPDATE' then (select after_data from public.order_revisions where order_id=new.id order by revision_no desc limit 1) else null end,
      to_jsonb(new)||jsonb_build_object('items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb) from public.order_items i where i.order_id=new.id)),auth.uid());
  insert into public.outbox_jobs(entity_type,entity_id,entity_version)
    values('orders',new.id,new.revision_no);
  return new;
end $$;
create trigger record_order after insert or update on public.orders
for each row execute function laiora_private.record_order_change();

-- Every item edit refreshes aggregates, version, revision snapshot and outbox
-- in the same transaction. Item snapshots are additionally carried in revisions.
create function laiora_private.refresh_item_totals() returns trigger
language plpgsql security definer set search_path='' as $$
declare parent_id uuid;
begin
  parent_id := case when tg_op='DELETE' then old.order_id else new.order_id end;
  update public.orders set
    product_quantity=(select coalesce(sum(quantity),0)::integer from public.order_items where order_id=parent_id),
    product_total=(select coalesce(sum(line_total),0)::bigint from public.order_items where order_id=parent_id)
  where id=parent_id;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger refresh_item_totals after insert or update or delete on public.order_items
for each row execute function laiora_private.refresh_item_totals();

-- Explicit year and verified initial sequence are prerequisites. No historical
-- snapshot is silently turned into the live counter. Repeat confirm is idempotent.
create function public.confirm_laiora_order(p_order_id uuid,p_year integer) returns text
language plpgsql security definer set search_path='' as $$
declare o public.orders; n integer; result text;
begin
  if p_year not between 2000 and 2099 then raise exception 'Unsupported sequence year'; end if;
  select * into o from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.state='confirmed' then return o.order_no; end if;
  if o.state<>'draft' then raise exception 'Only draft orders can be confirmed'; end if;
  if o.delivery_date is null then raise exception 'Delivery date is required'; end if;
  if o.product_quantity<=0 then raise exception 'At least one product is required'; end if;
  update laiora_private.order_sequences set last_value=last_value+1
    where year=p_year and last_value<9999 returning last_value into n;
  if not found then raise exception 'Sequence not initialized or exhausted'; end if;
  result := right(p_year::text,2)||'-'||lpad(n::text,4,'0');
  update public.orders set state='confirmed',order_no=result where id=p_order_id;
  return result;
end $$;
revoke all on function public.confirm_laiora_order(uuid,integer) from public,anon,authenticated;
grant execute on function public.confirm_laiora_order(uuid,integer) to service_role;
-- Private trigger functions are not callable through the Data API.
revoke all on all functions in schema laiora_private from public,anon,authenticated;
commit;
