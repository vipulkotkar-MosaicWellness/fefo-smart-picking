-- Adds the manufacturer's Vendor batch code to the stock table, alongside the
-- existing Uniware-internal Batch Code. Populated from the "Vendor batch
-- code" column already present in the Shelfwise Inventory export — see
-- apps-script/ShelfwiseIngest.gs and src/lib/shelfwiseCsv.ts.
alter table stock add column if not exists vendor_batch text;
