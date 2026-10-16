-- Foundation only: deployed through migrations on a reviewed development project.
-- No account, secret, live order sequence, or external integration is provisioned here.
begin;
create schema laiora_private;
revoke all on schema laiora_private from public;

create table laiora_private.app_account (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique references auth.users(id) on delete restrict
);
create table laiora_private.order_sequences (
  year integer primary key check (year between 2000 and 2099),
  last_value integer not null check (last_value between 0 and 9999)
);
create function public.laiora_has_access() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from laiora_private.app_account where user_id = auth.uid());
$$;
revoke all on function public.laiora_has_access() from public;
grant execute on function public.laiora_has_access() to authenticated;

create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  size text not null check (size in ('Personal','Regular')),
  active boolean not null default true,
  unique(name,size)
);
create table public.product_prices (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  unit_price bigint not null check (unit_price >= 0),
  effective_from date not null,
  unique(product_id,effective_from)
);
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  display_name text,
  phone text unique,
  created_at timestamptz not null default now()
);
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id),
  account_ref text not null,
  external_chat_id text not null,
  last_message_at timestamptz,
  unique(account_ref,external_chat_id)
);
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id),
  external_message_id text not null,
  direction text not null check(direction in ('inbound','outbound')),
  message_type text not null default 'text',
  body text,
  sent_at timestamptz not null,
  received_at timestamptz not null default now(),
  unique(conversation_id,external_message_id)
);
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_no text unique check(order_no ~ '^[0-9]{2}-[0-9]{4}$'),
  state text not null default 'draft' check(state in ('draft','confirmed','cancelled')),
  revision_no integer not null default 0 check(revision_no >= 0),
  raw_form text,
  channel text not null default 'manual',
  sender_name text, sender_phone text,
  recipient_name text, recipient_phone text,
  delivery_date date, delivery_time_note text,
  address text, shipping_method text, operational_notes text,
  shipping_fee bigint check(shipping_fee >= 0),
  greeting_card_choice text not null default 'undecided' check(greeting_card_choice in ('yes','no','undecided')),
  greeting_card_qty integer not null default 0 check(greeting_card_qty >= 0),
  card_unit_price bigint not null default 5000 check(card_unit_price >= 0),
  card_from text, card_to text, card_message text,
  product_quantity integer not null default 0 check(product_quantity >= 0),
  product_total bigint not null default 0 check(product_total >= 0),
  card_total bigint generated always as (case when greeting_card_choice='yes' then greeting_card_qty::bigint * card_unit_price else 0 end) stored,
  subtotal bigint generated always as (product_total + case when greeting_card_choice='yes' then greeting_card_qty::bigint * card_unit_price else 0 end) stored,
  grand_total bigint generated always as (product_total + case when greeting_card_choice='yes' then greeting_card_qty::bigint * card_unit_price else 0 end + shipping_fee) stored,
  completeness text not null default 'incomplete' check(completeness in ('incomplete','complete')),
  production_status text not null default 'unscheduled' check(production_status in ('unscheduled','scheduled','in_progress','ready_to_pack','ready_to_handover')),
  fulfillment_status text not null default 'waiting' check(fulfillment_status in ('waiting','in_transit','picked_up','completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(greeting_card_choice='yes' or greeting_card_qty=0),
  check(state <> 'confirmed' or (order_no is not null and delivery_date is not null and product_quantity > 0)),
  check(state <> 'draft' or order_no is null)
);
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  product_id uuid references public.products(id),
  product_name text not null,
  size text not null,
  quantity integer not null check(quantity > 0),
  unit_price bigint not null check(unit_price >= 0),
  line_total bigint generated always as (quantity::bigint * unit_price) stored,
  cutting_note text, item_note text
);
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  amount bigint not null check(amount > 0),
  paid_at timestamptz,
  reference text,
  verification_status text not null default 'pending' check(verification_status in ('pending','confirmed','rejected')),
  verified_at timestamptz,
  verified_by uuid references auth.users(id),
  proof_path text,
  created_at timestamptz not null default now(),
  check(verification_status <> 'confirmed' or (verified_at is not null and verified_by is not null))
);
create table public.order_revisions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  revision_no integer not null,
  before_data jsonb, after_data jsonb not null,
  actor_id uuid, changed_at timestamptz not null default now(),
  unique(order_id,revision_no)
);
create table public.chat_opportunities (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id),
  title text,
  follow_up text not null default 'new' check(follow_up in ('new','needs_review','waiting_for_data','done')),
  created_at timestamptz not null default now()
);
create table public.opportunity_product_labels (
  opportunity_id uuid not null references public.chat_opportunities(id),
  product_id uuid not null references public.products(id),
  source text not null check(source in ('suggested','manual','confirmed')),
  source_message_id uuid references public.messages(id),
  primary key(opportunity_id,product_id)
);
create table public.opportunity_order_links (
  opportunity_id uuid not null references public.chat_opportunities(id),
  order_id uuid not null references public.orders(id),
  primary key(opportunity_id,order_id)
);
create table public.outbox_jobs (
  id bigint generated always as identity primary key,
  entity_type text not null, entity_id uuid not null,
  entity_version bigint not null,
  operation text not null default 'upsert',
  state text not null default 'pending' check(state in ('pending','processing','done','failed')),
  attempts integer not null default 0 check(attempts >= 0),
  available_at timestamptz not null default now(),
  leased_until timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  unique(entity_type,entity_id,entity_version)
);
create index orders_delivery_idx on public.orders(delivery_date,state);
create index orders_recipient_idx on public.orders(recipient_name);
create index order_items_order_idx on public.order_items(order_id);
create index payments_order_idx on public.payments(order_id);
create index messages_chat_time_idx on public.messages(conversation_id,sent_at);
create index opportunities_chat_idx on public.chat_opportunities(conversation_id);
create index opportunity_orders_order_idx on public.opportunity_order_links(order_id);
create index outbox_pending_idx on public.outbox_jobs(state,available_at);

-- Read-only Data API for the one explicitly bound account. Mutations require a
-- backend with a verified user session; never put its service key in a browser.
do $$
declare t text;
begin
  foreach t in array array['products','product_prices','contacts','conversations','messages','orders','order_items','payments','order_revisions','chat_opportunities','opportunity_product_labels','opportunity_order_links','outbox_jobs'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    if t <> 'outbox_jobs' then
      execute format('grant select on public.%I to authenticated',t);
      execute format('create policy laiora_read on public.%I for select to authenticated using ((select public.laiora_has_access()))',t);
    end if;
  end loop;
end $$;
grant usage, select on sequence public.outbox_jobs_id_seq to service_role;

create view public.chat_tracking with (security_invoker=true) as
select p.id as opportunity_id,p.conversation_id,p.title,p.follow_up,
  c.contact_id,c.last_message_at,
  case when exists (
    select 1 from public.opportunity_order_links l join public.orders o on o.id=l.order_id
    where l.opportunity_id=p.id and o.state='confirmed'
  ) then 'Sudah PO' else 'Belum PO' end as po_status
from public.chat_opportunities p join public.conversations c on c.id=p.conversation_id;
revoke all on public.chat_tracking from anon,authenticated;
grant select on public.chat_tracking to authenticated,service_role;
commit;
