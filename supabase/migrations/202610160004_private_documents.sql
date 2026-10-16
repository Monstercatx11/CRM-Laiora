begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
('delivery-orders','delivery-orders',false,10485760,array['application/pdf']),
('payment-proofs','payment-proofs',false,10485760,array['image/jpeg','image/png','application/pdf']);
-- Uploads/deletes only through an authenticated backend using its service key.
create policy laiora_private_document_read on storage.objects for select to authenticated
using (bucket_id in ('delivery-orders','payment-proofs') and (select public.laiora_has_access()));
commit;
