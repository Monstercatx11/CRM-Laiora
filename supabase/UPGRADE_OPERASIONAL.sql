-- CRM Laiora operational upgrade.
-- Run ONCE on a project that already applied SETUP_LAIORA.sql (migrations001-004).
-- Preserves existing orders, account binding, bucket files, and counters.
-- No credentials or sample customers. Do not replay initial setup.
begin;

-- Source: 202610160005_operations.sql
-- Application mutations: the browser has read-only table access and calls these
-- narrowly scoped, single-account RPCs. No service key is needed in the browser.
create table public.app_settings (
  singleton boolean primary key default true check (singleton),
  business_name text not null default 'Laiora Boulangerie' check (length(business_name) between 1 and 160),
  timezone text not null default 'Asia/Jakarta',
  whatsapp_phone text not null default '',
  bank_name text not null default 'BCA',
  bank_account text not null default '5390823845',
  bank_holder text not null default 'Yohanes',
  greeting_card_price bigint not null default 5000 check (greeting_card_price between 0 and 100000000),
  logo_path text,
  updated_at timestamptz not null default now()
);
insert into public.app_settings default values;
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon,authenticated;
grant select on public.app_settings to authenticated;
grant all on public.app_settings to service_role;
create policy laiora_read on public.app_settings for select to authenticated
  using ((select public.laiora_has_access()));

create table public.app_audit_log (
  id bigint generated always as identity primary key,
  action text not null,
  entity_id uuid,
  actor_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.app_audit_log enable row level security;
revoke all on public.app_audit_log from anon,authenticated;
grant select on public.app_audit_log to authenticated;
grant all on public.app_audit_log to service_role;
grant usage,select on sequence public.app_audit_log_id_seq to service_role;
create policy laiora_read on public.app_audit_log for select to authenticated
  using ((select public.laiora_has_access()));

alter table public.payments add column request_id uuid unique;
alter table public.orders add column client_request_id uuid unique;

-- The context is private and transaction-bound, rather than a client-settable
-- setting. It suppresses only intermediate aggregate/audit updates during an
-- atomic full-item replacement; the final row still passes every CHECK.
create table laiora_private.order_mutations (
  order_id uuid primary key,
  transaction_id bigint not null,
  is_new boolean not null
);
create table laiora_private.entity_versions (
  entity_type text not null,
  entity_id uuid not null,
  version bigint not null default 0,
  primary key(entity_type,entity_id)
);
create table laiora_private.order_requests (
  request_id uuid primary key,
  order_id uuid unique,
  payload_hash text not null
);
create table laiora_private.ingest_locks (
  account_ref text not null,
  chat_id text not null,
  primary key(account_ref,chat_id)
);

create function laiora_private.require_access() returns void
language plpgsql security definer set search_path='' as $$
begin
  if not coalesce(public.laiora_has_access(),false) then
    raise exception 'Akun ini tidak memiliki akses Laiora' using errcode='42501';
  end if;
end $$;

create function laiora_private.business_today() returns date
language sql stable security definer set search_path='' as $$
  select (now() at time zone timezone)::date from public.app_settings where singleton;
$$;

-- Versions never decrease, and a processing job is never repurposed while a
-- worker holds its lease. The newest pending row remains available after retry.
create function laiora_private.queue_entity(p_entity_type text,p_entity_id uuid,p_version bigint default null)
returns void language plpgsql security definer set search_path='' as $$
declare v bigint;
begin
  insert into laiora_private.entity_versions(entity_type,entity_id)
    values(p_entity_type,p_entity_id) on conflict do nothing;
  select version into v from laiora_private.entity_versions
    where entity_type=p_entity_type and entity_id=p_entity_id for update;
  v := case when p_version is null then v+1 else greatest(v,p_version) end;
  update laiora_private.entity_versions set version=v
    where entity_type=p_entity_type and entity_id=p_entity_id;
  update public.outbox_jobs set state='done',last_error_code='superseded',leased_until=null
    where entity_type=p_entity_type and entity_id=p_entity_id
      and entity_version<v and state in ('pending','failed');
  insert into public.outbox_jobs(entity_type,entity_id,entity_version)
    values(p_entity_type,p_entity_id,v) on conflict do nothing;
end $$;

create or replace function laiora_private.audit_order() returns trigger
language plpgsql security definer set search_path='' as $$
declare context_new boolean;
begin
  if tg_op='UPDATE' then
    if old.order_no is not null and new.order_no is distinct from old.order_no then
      raise exception 'Order number is immutable';
    end if;
    select is_new into context_new from laiora_private.order_mutations
      where order_id=new.id and transaction_id=txid_current();
    new.revision_no := case when coalesce(context_new,false) then 0 else old.revision_no+1 end;
    new.created_at := old.created_at;
  else
    new.revision_no := 0;
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function laiora_private.record_order_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from laiora_private.order_mutations where order_id=new.id and transaction_id=txid_current()) then
    return new;
  end if;
  insert into public.order_revisions(order_id,revision_no,before_data,after_data,actor_id)
    values(new.id,new.revision_no,
      case when tg_op='UPDATE' then (select after_data from public.order_revisions where order_id=new.id order by revision_no desc limit 1) else null end,
      to_jsonb(new)||jsonb_build_object('items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb) from public.order_items i where i.order_id=new.id)),auth.uid());
  perform laiora_private.queue_entity('orders',new.id,new.revision_no);
  return new;
end $$;

create or replace function laiora_private.refresh_item_totals() returns trigger
language plpgsql security definer set search_path='' as $$
declare parent_id uuid;
begin
  parent_id := case when tg_op='DELETE' then old.order_id else new.order_id end;
  if not exists(select 1 from laiora_private.order_mutations where order_id=parent_id and transaction_id=txid_current()) then
    update public.orders set
      product_quantity=(select coalesce(sum(quantity),0)::integer from public.order_items where order_id=parent_id),
      product_total=(select coalesce(sum(line_total),0)::bigint from public.order_items where order_id=parent_id)
    where id=parent_id;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

create function public.laiora_get_sequence() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform laiora_private.require_access();
  select coalesce(jsonb_agg(jsonb_build_object('year',year,'last_value',last_value) order by year),'[]'::jsonb)
    into result from laiora_private.order_sequences;
  return result;
end $$;

create function public.laiora_initialize_sequence(p_year integer,p_last_value integer) returns void
language plpgsql security definer set search_path='' as $$
declare existing integer; historical integer;
begin
  perform laiora_private.require_access();
  if p_year is null or p_year not between 2000 and 2099 or p_last_value is null or p_last_value not between 0 and 9999 then
    raise exception 'Tahun atau nomor terakhir tidak valid';
  end if;
  -- Serializes initialization with another initialization/confirmation.
  lock table laiora_private.order_sequences in share row exclusive mode;
  select last_value into existing from laiora_private.order_sequences where year=p_year;
  if found then
    if existing=p_last_value then return; end if;
    raise exception 'Sequence sudah diinisialisasi; nomor tidak boleh direset';
  end if;
  select max(right(order_no,4)::integer) into historical from public.orders
    where left(order_no,2)=right(p_year::text,2);
  if p_last_value<coalesce(historical,0) then raise exception 'Nomor terakhir lebih kecil dari order yang sudah ada'; end if;
  insert into laiora_private.order_sequences(year,last_value) values(p_year,p_last_value);
  insert into public.app_audit_log(action,actor_id,metadata)
    values('sequence.initialized',auth.uid(),jsonb_build_object('year',p_year,'last_value',p_last_value));
end $$;

create function public.laiora_update_settings(p_settings jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare s public.app_settings; j jsonb;
begin
  perform laiora_private.require_access();
  if p_settings is null or jsonb_typeof(p_settings)<>'object' then raise exception 'Pengaturan harus berupa object'; end if;
  if exists(select 1 from jsonb_object_keys(p_settings) k where k not in
    ('business_name','timezone','whatsapp_phone','bank_name','bank_account','bank_holder','greeting_card_price','logo_path')) then
    raise exception 'Field pengaturan tidak didukung';
  end if;
  select * into s from public.app_settings where singleton for update;
  j := to_jsonb(s)||p_settings;
  s := jsonb_populate_record(null::public.app_settings,j);
  if not exists(select 1 from pg_timezone_names where name=s.timezone) then raise exception 'Zona waktu tidak valid'; end if;
  if s.logo_path is not null and s.logo_path !~ '^logos/[A-Za-z0-9._-]+[.]png$' then raise exception 'Path logo PNG tidak valid'; end if;
  if s.whatsapp_phone !~ '^[+0-9 ()-]{0,30}$' then raise exception 'Nomor WhatsApp tidak valid'; end if;
  if length(s.bank_account)>80 or length(s.bank_holder)>160 or length(s.bank_name)>80 then raise exception 'Detail bank terlalu panjang'; end if;
  update public.app_settings set business_name=btrim(s.business_name),timezone=s.timezone,
    whatsapp_phone=btrim(s.whatsapp_phone),bank_name=btrim(s.bank_name),bank_account=btrim(s.bank_account),
    bank_holder=btrim(s.bank_holder),greeting_card_price=s.greeting_card_price,logo_path=s.logo_path,updated_at=now()
    where singleton;
  perform laiora_private.queue_entity('app_settings','00000000-0000-0000-0000-000000000001');
  insert into public.app_audit_log(action,actor_id,metadata)
    values('settings.updated',auth.uid(),jsonb_build_object('fields',(select jsonb_agg(k) from jsonb_object_keys(p_settings) k)));
end $$;

create function public.laiora_save_order(
  p_order jsonb,p_items jsonb,p_order_id uuid default null,p_expected_revision integer default null,
  p_confirm boolean default false,p_opportunity_id uuid default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  oid uuid := coalesce(p_order_id,gen_random_uuid());
  o public.orders; old_order public.orders; item jsonb; previous public.order_items;
  product public.products; price bigint; staged jsonb := '[]'::jsonb; before_snapshot jsonb;
  settings public.app_settings; business_date date; yr integer; next_no integer;
  order_number text; target_state text; is_new boolean := p_order_id is null;
  total_quantity integer := 0; total_price bigint := 0; iid uuid;
  v_request_id uuid; request_hash text; existing_request laiora_private.order_requests;
begin
  perform laiora_private.require_access();
  if p_confirm is null then raise exception 'Pilihan konfirmasi tidak valid'; end if;
  if p_order is null or jsonb_typeof(p_order)<>'object' then raise exception 'Data order harus berupa object'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>100 then
    raise exception 'Daftar produk harus array, maksimal 100 baris';
  end if;
  if exists(select 1 from jsonb_object_keys(p_order) k where k not in
    ('client_request_id','raw_form','channel','sender_name','sender_phone','recipient_name','recipient_phone','delivery_date','delivery_time_note',
     'address','shipping_method','shipping_fee','operational_notes','greeting_card_choice','greeting_card_qty','card_from','card_to','card_message')) then
    raise exception 'Field order tidak didukung';
  end if;
  -- Opportunity -> request -> order is the same lock order used by chat edits.
  if p_opportunity_id is not null then
    perform 1 from public.chat_opportunities where id=p_opportunity_id for update;
    if not found then raise exception 'Peluang chat tidak ditemukan'; end if;
  end if;
  v_request_id := nullif(p_order->>'client_request_id','')::uuid;
  if not is_new and v_request_id is not null then
    perform 1 from laiora_private.order_requests where request_id=v_request_id for update;
  end if;
  if is_new and v_request_id is not null then
    request_hash := md5((p_order-'client_request_id')::text||p_items::text||coalesce(p_opportunity_id::text,''));
    insert into laiora_private.order_requests(request_id,payload_hash) values(v_request_id,request_hash) on conflict do nothing;
    select * into existing_request from laiora_private.order_requests where order_requests.request_id=v_request_id for update;
    if existing_request.payload_hash<>request_hash then raise exception 'Request order sudah digunakan dengan data berbeda'; end if;
    if existing_request.order_id is not null then
      select * into old_order from public.orders where id=existing_request.order_id for update;
      if not p_confirm or old_order.state='confirmed' then return old_order.id; end if;
      if old_order.state<>'draft' then raise exception 'Order request ini sudah dibatalkan'; end if;
      if old_order.revision_no<>0 then raise exception 'Draft sudah direvisi. Buka order terbaru untuk konfirmasi' using errcode='40001'; end if;
      yr := extract(year from laiora_private.business_today())::integer;
      perform public.confirm_laiora_order(old_order.id,yr);
      insert into public.app_audit_log(action,entity_id,actor_id) values('order.confirmed',old_order.id,auth.uid());
      return old_order.id;
    end if;
  end if;
  if is_new then
    select * into old_order from jsonb_populate_record(null::public.orders,
      jsonb_build_object('channel','manual','greeting_card_choice','undecided','greeting_card_qty',0));
  else
    select * into old_order from public.orders where id=oid for update;
    if not found then raise exception 'Order tidak ditemukan'; end if;
    if old_order.state='cancelled' then raise exception 'Order dibatalkan tidak dapat diubah'; end if;
    if v_request_id is not null and v_request_id is distinct from old_order.client_request_id then raise exception 'Request ID order tidak dapat diubah'; end if;
    if p_expected_revision is null or p_expected_revision<>old_order.revision_no then
      raise exception 'Order berubah di sesi lain. Muat ulang sebelum menyimpan' using errcode='40001';
    end if;
    before_snapshot := to_jsonb(old_order)||jsonb_build_object('items',
      (select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb) from public.order_items i where i.order_id=oid));
  end if;
  select * into settings from public.app_settings where singleton;
  business_date := (now() at time zone settings.timezone)::date;
  o := jsonb_populate_record(null::public.orders,to_jsonb(old_order)||p_order);
  o.card_unit_price := case when is_new then settings.greeting_card_price else old_order.card_unit_price end;
  o.greeting_card_qty := coalesce(o.greeting_card_qty,0);
  if o.greeting_card_choice<>'yes' and o.greeting_card_qty<>0 then raise exception 'Kartu belum dipilih/tidak: jumlah kartu harus nol'; end if;
  if o.greeting_card_choice='yes' and o.greeting_card_qty not between 1 and 10000 then
    raise exception 'Jumlah kartu harus 1–10000 saat pilihan Ya';
  end if;
  if length(coalesce(o.raw_form,''))>50000 or length(coalesce(o.operational_notes,''))>5000
    or length(coalesce(o.address,''))>3000 or length(coalesce(o.card_message,''))>3000
    or length(coalesce(o.sender_name,''))>200 or length(coalesce(o.recipient_name,''))>200
    or length(coalesce(o.sender_phone,''))>40 or length(coalesce(o.recipient_phone,''))>40
    or length(coalesce(o.delivery_time_note,''))>300 or length(coalesce(o.shipping_method,''))>200
    or length(coalesce(o.card_from,''))>300 or length(coalesce(o.card_to,''))>300
    or length(coalesce(o.channel,''))>50 then raise exception 'Teks order terlalu panjang'; end if;
  -- SOP: pickup/drop-off or a recipient-booked courier defaults to zero; explicit fee wins.
  if o.shipping_fee is null and lower(btrim(coalesce(o.shipping_method,''))) in ('pick up','drop off','penerima yang memesan grab','penerima memesan kurir') then o.shipping_fee := 0; end if;
  if exists(select 1 from jsonb_array_elements(p_items) x group by nullif(x->>'id','') having nullif(x->>'id','') is not null and count(*)>1) then
    raise exception 'ID item duplikat';
  end if;
  for item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item)<>'object' or exists(select 1 from jsonb_object_keys(item) k where k not in
      ('id','product_id','quantity','cutting_note','item_note')) then raise exception 'Field item tidak didukung'; end if;
    if item->>'product_id' is null or item->>'quantity' is null or (item->>'quantity') !~ '^[0-9]+$'
      or (item->>'quantity')::numeric not between 1 and 10000 then raise exception 'Produk/jumlah item tidak valid'; end if;
    if length(coalesce(item->>'cutting_note',''))>1000 or length(coalesce(item->>'item_note',''))>1000 then
      raise exception 'Catatan produk terlalu panjang';
    end if;
    previous := null;
    iid := nullif(item->>'id','')::uuid;
    if iid is not null then
      select * into previous from public.order_items where id=iid and order_id=oid;
      if not found then raise exception 'Item tidak dimiliki order ini'; end if;
    end if;
    if previous.id is not null and previous.product_id=(item->>'product_id')::uuid then
      price := previous.unit_price;
      product.id := previous.product_id; product.name := previous.product_name; product.size := previous.size;
    else
      select * into product from public.products where id=(item->>'product_id')::uuid and active;
      if not found then raise exception 'Produk tidak ditemukan atau nonaktif'; end if;
      select unit_price into price from public.product_prices where product_id=product.id and effective_from<=business_date
        order by effective_from desc limit 1;
      if price is null then raise exception 'Produk belum memiliki harga aktif'; end if;
    end if;
    total_quantity := total_quantity+(item->>'quantity')::integer;
    total_price := total_price+price*(item->>'quantity')::integer;
    staged := staged||jsonb_build_array(jsonb_build_object('id',coalesce(iid,gen_random_uuid()),'product_id',product.id,
      'product_name',product.name,'size',product.size,'quantity',(item->>'quantity')::integer,'unit_price',price,
      'cutting_note',nullif(btrim(item->>'cutting_note'),''),'item_note',nullif(btrim(item->>'item_note'),'')));
  end loop;
  target_state := case when not is_new and old_order.state='confirmed' then 'confirmed' when p_confirm then 'confirmed' else 'draft' end;
  order_number := old_order.order_no;
  if target_state='confirmed' then
    if o.delivery_date is null then raise exception 'Tanggal kirim wajib diisi sebelum konfirmasi'; end if;
    if total_quantity=0 then raise exception 'Minimal satu produk sebelum konfirmasi'; end if;
    if order_number is null then
      yr := extract(year from business_date)::integer;
      update laiora_private.order_sequences set last_value=last_value+1 where year=yr and last_value<9999 returning last_value into next_no;
      if not found then raise exception 'Nomor order tahun ini belum diinisialisasi atau sudah habis. Buka Pengaturan'; end if;
      order_number := right(yr::text,2)||'-'||lpad(next_no::text,4,'0');
    end if;
  end if;
  insert into laiora_private.order_mutations(order_id,transaction_id,is_new) values(oid,txid_current(),is_new);
  if is_new then insert into public.orders(id,client_request_id) values(oid,v_request_id); end if;
  delete from public.order_items where order_id=oid;
  insert into public.order_items(id,order_id,product_id,product_name,size,quantity,unit_price,cutting_note,item_note)
    select (x->>'id')::uuid,oid,(x->>'product_id')::uuid,x->>'product_name',x->>'size',(x->>'quantity')::integer,
      (x->>'unit_price')::bigint,x->>'cutting_note',x->>'item_note' from jsonb_array_elements(staged) x;
  update public.orders set raw_form=o.raw_form,channel=o.channel,sender_name=o.sender_name,sender_phone=o.sender_phone,
    recipient_name=o.recipient_name,recipient_phone=o.recipient_phone,delivery_date=o.delivery_date,delivery_time_note=o.delivery_time_note,
    address=o.address,shipping_method=o.shipping_method,shipping_fee=o.shipping_fee,operational_notes=o.operational_notes,
    greeting_card_choice=o.greeting_card_choice,greeting_card_qty=o.greeting_card_qty,card_unit_price=o.card_unit_price,
    card_from=o.card_from,card_to=o.card_to,card_message=o.card_message,product_quantity=total_quantity,product_total=total_price,
    state=target_state,order_no=order_number,
    completeness=case when nullif(btrim(o.sender_name),'') is not null and nullif(btrim(o.sender_phone),'') is not null
      and nullif(btrim(o.recipient_name),'') is not null and nullif(btrim(o.recipient_phone),'') is not null
      and o.delivery_date is not null and total_quantity>0 and o.shipping_fee is not null
      and o.greeting_card_choice<>'undecided' and nullif(btrim(o.shipping_method),'') is not null
      and (nullif(btrim(o.address),'') is not null or o.shipping_method in ('Pick Up','Drop Off')) then 'complete' else 'incomplete' end
    where id=oid returning * into o;
  delete from laiora_private.order_mutations where order_id=oid;
  insert into public.order_revisions(order_id,revision_no,before_data,after_data,actor_id)
    values(oid,o.revision_no,before_snapshot,to_jsonb(o)||jsonb_build_object('items',
      (select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb) from public.order_items i where i.order_id=oid)),auth.uid());
  perform laiora_private.queue_entity('orders',oid,o.revision_no);
  if v_request_id is not null then update laiora_private.order_requests set order_id=oid where order_requests.request_id=v_request_id; end if;
  if p_opportunity_id is not null then
    insert into public.opportunity_order_links(opportunity_id,order_id) values(p_opportunity_id,oid) on conflict do nothing;
  end if;
  insert into public.app_audit_log(action,entity_id,actor_id,metadata)
    values(case when is_new then 'order.created' else 'order.updated' end,oid,auth.uid(),jsonb_build_object('revision_no',o.revision_no,'state',o.state));
  return oid;
end $$;

create function public.laiora_set_status(p_order_id uuid,p_expected_revision integer,p_production text default null,
  p_fulfillment text default null,p_cancel boolean default false) returns void
language plpgsql security definer set search_path='' as $$
declare o public.orders;
begin
  perform laiora_private.require_access();
  select * into o from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order tidak ditemukan'; end if;
  if o.state='cancelled' then raise exception 'Order dibatalkan tidak dapat diubah'; end if;
  if p_expected_revision is null or p_expected_revision<>o.revision_no then raise exception 'Order berubah di sesi lain. Muat ulang' using errcode='40001'; end if;
  if p_cancel is null then raise exception 'Pilihan pembatalan tidak valid'; end if;
  if not p_cancel and o.state<>'confirmed' then raise exception 'Konfirmasikan order sebelum mengubah status operasional'; end if;
  if p_production is not null and p_production not in ('unscheduled','scheduled','in_progress','ready_to_pack','ready_to_handover') then raise exception 'Status produksi tidak valid'; end if;
  if p_fulfillment is not null and p_fulfillment not in ('waiting','in_transit','picked_up','completed') then raise exception 'Status pengiriman tidak valid'; end if;
  if p_cancel and (p_production is not null or p_fulfillment is not null) then raise exception 'Pembatalan tidak boleh sekaligus mengubah progres'; end if;
  if not p_cancel and coalesce(p_production,o.production_status)=o.production_status and coalesce(p_fulfillment,o.fulfillment_status)=o.fulfillment_status then return; end if;
  update public.orders set state=case when p_cancel then 'cancelled' else state end,
    production_status=coalesce(p_production,production_status),fulfillment_status=coalesce(p_fulfillment,fulfillment_status)
    where id=p_order_id;
  insert into public.app_audit_log(action,entity_id,actor_id,metadata)
    values(case when p_cancel then 'order.cancelled' else 'order.status_updated' end,p_order_id,auth.uid(),jsonb_build_object('production',p_production,'fulfillment',p_fulfillment));
end $$;

create function public.laiora_record_payment(p_order_id uuid,p_amount bigint,p_reference text,p_paid_at timestamptz,p_request_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare o public.orders; existing public.payments; pid uuid;
begin
  perform laiora_private.require_access();
  if p_request_id is null or p_amount is null or p_amount<=0 or p_amount>10000000000000 then raise exception 'Nominal dan request pembayaran tidak valid'; end if;
  if length(coalesce(p_reference,''))>500 then raise exception 'Referensi pembayaran terlalu panjang'; end if;
  select * into o from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order tidak ditemukan'; end if;
  select * into existing from public.payments where request_id=p_request_id;
  if found then
    if existing.order_id<>p_order_id or existing.amount<>p_amount or existing.reference is distinct from nullif(btrim(p_reference),'')
      or (p_paid_at is not null and existing.paid_at is distinct from p_paid_at) then
      raise exception 'Request pembayaran sudah digunakan dengan data berbeda';
    end if;
    return existing.id;
  end if;
  if o.state<>'confirmed' then raise exception 'Pembayaran hanya untuk order terkonfirmasi yang aktif'; end if;
  insert into public.payments(order_id,amount,reference,paid_at,verification_status,verified_at,verified_by,request_id)
    values(p_order_id,p_amount,nullif(btrim(p_reference),''),coalesce(p_paid_at,now()),'confirmed',now(),auth.uid(),p_request_id) returning id into pid;
  insert into public.app_audit_log(action,entity_id,actor_id,metadata)
    values('payment.recorded',pid,auth.uid(),jsonb_build_object('order_id',p_order_id,'amount',p_amount));
  return pid;
end $$;

create function public.laiora_attach_payment_proof(p_payment_id uuid,p_path text) returns void
language plpgsql security definer set search_path='' as $$
declare payment public.payments;
begin
  perform laiora_private.require_access();
  select * into payment from public.payments where id=p_payment_id for update;
  if not found then raise exception 'Pembayaran tidak ditemukan'; end if;
  if p_path is null or p_path !~ ('^payments/'||p_payment_id::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](png|jpg|jpeg|pdf)$') then
    raise exception 'Path bukti pembayaran tidak valid';
  end if;
  if not exists(select 1 from storage.objects where bucket_id='payment-proofs' and name=p_path) then
    raise exception 'File bukti pembayaran belum diunggah';
  end if;
  if payment.proof_path=p_path then return; end if;
  update public.payments set proof_path=p_path where id=p_payment_id;
  insert into public.app_audit_log(action,entity_id,actor_id) values('payment.proof_attached',p_payment_id,auth.uid());
end $$;

create function public.laiora_save_product(p_product_id uuid,p_sku text,p_name text,p_size text,p_price bigint,p_effective_from date,p_active boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare pid uuid := coalesce(p_product_id,gen_random_uuid());
begin
  perform laiora_private.require_access();
  if nullif(btrim(p_sku),'') is null or length(p_sku)>80 or nullif(btrim(p_name),'') is null or length(p_name)>200
    or p_size is null or p_size not in ('Personal','Regular') or p_price is null or p_price not between 0 and 100000000
    or p_effective_from is null or p_active is null then raise exception 'Data produk/harga tidak valid'; end if;
  if p_product_id is not null then
    perform 1 from public.products where id=pid for update;
    if not found then raise exception 'Produk tidak ditemukan'; end if;
    insert into public.app_audit_log(action,entity_id,actor_id,metadata)
      select 'product.updated',pid,auth.uid(),jsonb_build_object('before',to_jsonb(p), 'price_before',
        (select unit_price from public.product_prices where product_id=pid and effective_from=p_effective_from),
        'price_after',p_price,'effective_from',p_effective_from) from public.products p where id=pid;
    update public.products set sku=btrim(p_sku),name=btrim(p_name),size=p_size,active=p_active where id=pid;
  else
    insert into public.products(id,sku,name,size,active) values(pid,btrim(p_sku),btrim(p_name),p_size,p_active);
    insert into public.app_audit_log(action,entity_id,actor_id) values('product.created',pid,auth.uid());
  end if;
  insert into public.product_prices(product_id,unit_price,effective_from) values(pid,p_price,p_effective_from)
    on conflict(product_id,effective_from) do update set unit_price=excluded.unit_price;
  return pid;
end $$;

create function public.laiora_manage_opportunity(p_conversation_id uuid,p_title text,p_opportunity_id uuid default null,
  p_follow_up text default 'new',p_product_ids uuid[] default '{}',p_order_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare oid uuid := coalesce(p_opportunity_id,gen_random_uuid()); item uuid;
begin
  perform laiora_private.require_access();
  if p_follow_up is null or p_follow_up not in ('new','needs_review','waiting_for_data','done') or length(coalesce(p_title,''))>300 then raise exception 'Data peluang tidak valid'; end if;
  if cardinality(p_product_ids)>50 then raise exception 'Label produk terlalu banyak'; end if;
  perform 1 from public.conversations where id=p_conversation_id for update;
  if not found then raise exception 'Percakapan tidak ditemukan'; end if;
  if p_opportunity_id is null then
    insert into public.chat_opportunities(id,conversation_id,title,follow_up) values(oid,p_conversation_id,nullif(btrim(p_title),''),p_follow_up);
  else
    perform 1 from public.chat_opportunities where id=oid and conversation_id=p_conversation_id for update;
    if not found then raise exception 'Peluang bukan milik percakapan ini'; end if;
    update public.chat_opportunities set title=nullif(btrim(p_title),''),follow_up=p_follow_up where id=oid;
  end if;
  foreach item in array coalesce(p_product_ids,'{}'::uuid[]) loop
    perform 1 from public.products where id=item;
    if not found then raise exception 'Label produk tidak ditemukan'; end if;
  end loop;
  delete from public.opportunity_product_labels where opportunity_id=oid;
  insert into public.opportunity_product_labels(opportunity_id,product_id,source)
    select oid,x,'manual' from (select distinct unnest(coalesce(p_product_ids,'{}'::uuid[])) x) labels;
  -- Linking is always explicit. A null order leaves prior links untouched;
  -- another contact's history is never chosen implicitly.
  if p_order_id is not null then
    perform 1 from public.orders where id=p_order_id and state<>'cancelled';
    if not found then raise exception 'Order terkait tidak ditemukan atau dibatalkan'; end if;
    insert into public.opportunity_order_links(opportunity_id,order_id) values(oid,p_order_id) on conflict do nothing;
  end if;
  insert into public.app_audit_log(action,entity_id,actor_id,metadata)
    values('opportunity.saved',oid,auth.uid(),jsonb_build_object('conversation_id',p_conversation_id,'order_id',p_order_id));
  return oid;
end $$;

-- Outbox writes are tied to committed data changes, including service ingestion.
create function laiora_private.enqueue_related() returns trigger
language plpgsql security definer set search_path='' as $$
declare eid uuid; cid uuid; rec record;
begin
  if tg_table_name='payments' then
    eid := case when tg_op='DELETE' then old.id else new.id end;
    perform laiora_private.queue_entity('payments',eid);
  elsif tg_table_name='products' then
    eid := case when tg_op='DELETE' then old.id else new.id end;
    perform laiora_private.queue_entity('products',eid);
  elsif tg_table_name='product_prices' then
    eid := case when tg_op='DELETE' then old.product_id else new.product_id end;
    perform laiora_private.queue_entity('products',eid);
  elsif tg_table_name='chat_opportunities' then
    eid := case when tg_op='DELETE' then old.id else new.id end;
    perform laiora_private.queue_entity('chat_opportunities',eid);
  elsif tg_table_name in ('opportunity_product_labels','opportunity_order_links') then
    eid := case when tg_op='DELETE' then old.opportunity_id else new.opportunity_id end;
    perform laiora_private.queue_entity('chat_opportunities',eid);
  elsif tg_table_name='conversations' then
    cid := case when tg_op='DELETE' then old.id else new.id end;
    for rec in select id from public.chat_opportunities where conversation_id=cid loop
      perform laiora_private.queue_entity('chat_opportunities',rec.id);
    end loop;
  elsif tg_table_name='contacts' then
    eid := case when tg_op='DELETE' then old.id else new.id end;
    for rec in select p.id from public.chat_opportunities p join public.conversations c on c.id=p.conversation_id where c.contact_id=eid loop
      perform laiora_private.queue_entity('chat_opportunities',rec.id);
    end loop;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['payments','products','product_prices','chat_opportunities','opportunity_product_labels','opportunity_order_links','conversations','contacts'] loop
    execute format('create trigger enqueue_outbox after insert or update or delete on public.%I for each row execute function laiora_private.enqueue_related()',t);
  end loop;
end $$;

-- A confirmed/cancelled order changes the derived Sudah/Belum PO status.
create function laiora_private.enqueue_order_opportunities() returns trigger
language plpgsql security definer set search_path='' as $$
declare rec record;
begin
  if old.state is distinct from new.state or old.order_no is distinct from new.order_no then
    for rec in select opportunity_id from public.opportunity_order_links where order_id=new.id loop
      perform laiora_private.queue_entity('chat_opportunities',rec.opportunity_id);
    end loop;
  end if;
  return new;
end $$;
create trigger enqueue_order_opportunities after update on public.orders for each row execute function laiora_private.enqueue_order_opportunities();

create function public.laiora_ingest_message(p_account_ref text,p_chat_id text,p_message_id text,p_name text,p_phone text,
  p_body text,p_direction text,p_type text,p_sent_at timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare cid uuid; contact uuid; mid uuid; existing uuid;
begin
  if nullif(btrim(p_account_ref),'') is null or nullif(btrim(p_chat_id),'') is null or nullif(btrim(p_message_id),'') is null
    or p_direction is null or p_direction not in ('inbound','outbound') or p_sent_at is null then raise exception 'Event pesan tidak valid'; end if;
  if length(coalesce(p_body,''))>100000 or length(p_chat_id)>250 or length(p_message_id)>250 then raise exception 'Event pesan terlalu besar'; end if;
  insert into laiora_private.ingest_locks(account_ref,chat_id) values(p_account_ref,p_chat_id) on conflict do nothing;
  perform 1 from laiora_private.ingest_locks where account_ref=p_account_ref and chat_id=p_chat_id for update;
  -- One transaction owns this account/chat row; duplicate/replayed events cannot
  -- create a second message or opportunity. A service writer owns the RPC.
  select id,contact_id into cid,contact from public.conversations where account_ref=p_account_ref and external_chat_id=p_chat_id for update;
  if cid is null then
    if nullif(btrim(p_phone),'') is not null then
      insert into public.contacts(display_name,phone) values(nullif(btrim(p_name),''),btrim(p_phone))
        on conflict(phone) do update set display_name=coalesce(excluded.display_name,public.contacts.display_name) returning id into contact;
    else
      insert into public.contacts(display_name) values(nullif(btrim(p_name),'')) returning id into contact;
    end if;
    insert into public.conversations(contact_id,account_ref,external_chat_id,last_message_at) values(contact,p_account_ref,p_chat_id,p_sent_at)
      on conflict(account_ref,external_chat_id) do update set last_message_at=greatest(public.conversations.last_message_at,excluded.last_message_at)
      returning id,contact_id into cid,contact;
    insert into public.chat_opportunities(conversation_id,title) values(cid,'Percakapan baru');
  end if;
  select id into existing from public.messages where conversation_id=cid and external_message_id=p_message_id;
  if existing is not null then return existing; end if;
  insert into public.messages(conversation_id,external_message_id,direction,message_type,body,sent_at)
    values(cid,p_message_id,p_direction,coalesce(nullif(p_type,''),'text'),p_body,p_sent_at)
    on conflict(conversation_id,external_message_id) do nothing returning id into mid;
  if mid is null then select id into mid from public.messages where conversation_id=cid and external_message_id=p_message_id; return mid; end if;
  update public.contacts set display_name=coalesce(nullif(btrim(p_name),''),display_name) where id=contact;
  update public.conversations set last_message_at=greatest(last_message_at,p_sent_at) where id=cid;
  return mid;
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('branding','branding',false,2097152,array['image/png']);
grant select,insert,update,delete on storage.objects to authenticated;
create policy laiora_branding_read on storage.objects for select to authenticated
  using(bucket_id='branding' and (select public.laiora_has_access()));
create policy laiora_branding_insert on storage.objects for insert to authenticated
  with check(bucket_id='branding' and name ~ '^logos/[A-Za-z0-9._-]+[.]png$' and (select public.laiora_has_access()));
create policy laiora_branding_update on storage.objects for update to authenticated
  using(bucket_id='branding' and (select public.laiora_has_access()))
  with check(bucket_id='branding' and name ~ '^logos/[A-Za-z0-9._-]+[.]png$' and (select public.laiora_has_access()));
create policy laiora_branding_delete on storage.objects for delete to authenticated
  using(bucket_id='branding' and name ~ '^logos/[A-Za-z0-9._-]+[.]png$' and (select public.laiora_has_access()));
create policy laiora_payment_proof_insert on storage.objects for insert to authenticated
  with check(bucket_id='payment-proofs' and name ~ '^payments/[0-9a-f-]{36}/[0-9a-f-]{36}[.](png|jpg|jpeg|pdf)$'
    and exists(select 1 from public.payments p where p.id::text=split_part(storage.objects.name,'/',2))
    and (select public.laiora_has_access()));
create policy laiora_payment_proof_update on storage.objects for update to authenticated
  using(bucket_id='payment-proofs' and name ~ '^payments/[0-9a-f-]{36}/[0-9a-f-]{36}[.](png|jpg|jpeg|pdf)$' and (select public.laiora_has_access()))
  with check(bucket_id='payment-proofs' and name ~ '^payments/[0-9a-f-]{36}/[0-9a-f-]{36}[.](png|jpg|jpeg|pdf)$'
    and exists(select 1 from public.payments p where p.id::text=split_part(storage.objects.name,'/',2))
    and (select public.laiora_has_access()));
create policy laiora_payment_proof_delete on storage.objects for delete to authenticated
  using(bucket_id='payment-proofs' and name ~ '^payments/[0-9a-f-]{36}/[0-9a-f-]{36}[.](png|jpg|jpeg|pdf)$' and (select public.laiora_has_access()));

revoke all on all functions in schema laiora_private from public,anon,authenticated;
revoke all on function public.laiora_ingest_message(text,text,text,text,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.laiora_ingest_message(text,text,text,text,text,text,text,text,timestamptz) to service_role;
revoke all on function public.laiora_get_sequence(),public.laiora_initialize_sequence(integer,integer),public.laiora_update_settings(jsonb),
  public.laiora_save_order(jsonb,jsonb,uuid,integer,boolean,uuid),public.laiora_set_status(uuid,integer,text,text,boolean),
  public.laiora_record_payment(uuid,bigint,text,timestamptz,uuid),public.laiora_attach_payment_proof(uuid,text),public.laiora_save_product(uuid,text,text,text,bigint,date,boolean),
  public.laiora_manage_opportunity(uuid,text,uuid,text,uuid[],uuid) from public,anon;
grant execute on function public.laiora_get_sequence(),public.laiora_initialize_sequence(integer,integer),public.laiora_update_settings(jsonb),
  public.laiora_save_order(jsonb,jsonb,uuid,integer,boolean,uuid),public.laiora_set_status(uuid,integer,text,text,boolean),
  public.laiora_record_payment(uuid,bigint,text,timestamptz,uuid),public.laiora_attach_payment_proof(uuid,text),public.laiora_save_product(uuid,text,text,text,bigint,date,boolean),
  public.laiora_manage_opportunity(uuid,text,uuid,text,uuid[],uuid) to authenticated;

-- Source: 202610160006_sync_worker.sql
-- Durable, serialized Google Sheets projection. Apply after migration 005.
-- No Google credentials, spreadsheet content, or raw messages are stored here.
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
