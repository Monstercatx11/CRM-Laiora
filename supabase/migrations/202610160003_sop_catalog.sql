-- Catalog only. No historical promo, sample customer, or live order is seeded.
begin;
insert into public.products(sku,name,size) values
('BR-ORI-R','Brownies Original','Regular'),
('BR-CHIP-R','Brownies Choco Chips','Regular'),
('BR-ALM-R','Brownies Almond','Regular'),
('BR-FER-R','Brownies Ferrero Rocher','Regular'),
('BR-OVO-R','Brownies Ovomaltine','Regular'),
('BJ-MIX-R','Bolu Jadul Choco Cheese','Regular'),
('BJ-CHO-R','Bolu Jadul Full Choco','Regular'),
('BJ-CHE-R','Bolu Jadul Full Cheese','Regular'),
('BJ-GEN-R','Bolu Jadul Regular generic','Regular'),
('BR-ORI-P','Brownies Original','Personal'),
('BR-CHIP-P','Brownies Choco Chips','Personal'),
('BR-ALM-P','Brownies Almond','Personal'),
('BR-FER-P','Brownies Ferrero Rocher','Personal'),
('BR-OVO-P','Brownies Ovomaltine','Personal'),
('BJ-CHO-P','Bolu Jadul Choco','Personal'),
('BJ-CHE-P','Bolu Jadul Cheese','Personal');
insert into public.product_prices(product_id,unit_price,effective_from)
select p.id,v.price,date '2026-10-07' from public.products p join (values
('BR-ORI-R',130000),('BR-CHIP-R',140000),('BR-ALM-R',154000),('BR-FER-R',185000),('BR-OVO-R',185000),
('BJ-MIX-R',115000),('BJ-CHO-R',115000),('BJ-CHE-R',115000),('BJ-GEN-R',115000),
('BR-ORI-P',65000),('BR-CHIP-P',70000),('BR-ALM-P',75000),('BR-FER-P',90000),('BR-OVO-P',93000),
('BJ-CHO-P',30000),('BJ-CHE-P',30000)
) as v(sku,price) on p.sku=v.sku;
commit;
