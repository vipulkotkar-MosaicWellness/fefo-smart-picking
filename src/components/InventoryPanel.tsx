import { useMemo, useState } from "react";
import { downloadCsv } from "../lib/format";
import { filterStock, paginate, sortStock, type SortMode } from "../lib/inventoryView";
import { useStore } from "../lib/store";
import type { StockRow } from "../lib/types";
import { BatchDetailDrawer, InventoryTable } from "./InventoryTable";
import { Button, Card } from "./Ui";

const PAGE_SIZE = 100;

export function InventoryPanel() {
  const { stock, visibleFacilities, savedInventoryViews, saveInventoryView, deleteInventoryView } = useStore();

  const [text, setText] = useState("");
  const [batch, setBatch] = useState("");
  const [location, setLocation] = useState("");
  const [minQty, setMinQty] = useState("");
  const [sort, setSort] = useState<SortMode>("expiry");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<StockRow | null>(null);

  const filtered = useMemo(
    () =>
      filterStock(stock, {
        visibleFacilities,
        text,
        batch,
        location,
        minQty: minQty ? Number(minQty) : undefined,
      }),
    [stock, visibleFacilities, text, batch, location, minQty],
  );
  const sorted = useMemo(() => sortStock(filtered, sort), [filtered, sort]);
  const { items, totalPages } = useMemo(() => paginate(sorted, page, PAGE_SIZE), [sorted, page]);

  function applyView(v: (typeof savedInventoryViews)[number]) {
    setText(v.filters.text ?? "");
    setBatch(v.filters.batch ?? "");
    setLocation(v.filters.location ?? "");
    setMinQty(v.filters.minQty != null ? String(v.filters.minQty) : "");
    setSort(v.sort);
    setPage(1);
  }

  function saveView() {
    const name = window.prompt("Name this view");
    if (!name) return;
    saveInventoryView({
      name,
      filters: { text: text || undefined, batch: batch || undefined, location: location || undefined, minQty: minQty ? Number(minQty) : undefined },
      sort,
    });
  }

  function exportCsv() {
    const header = "Facility,SKU,SKU Name,Location,Batch,Expiry,Qty,Shelf months\n";
    const body = sorted
      .map((b) => [b.location, b.sku, b.name, b.bin, b.batch, `${b.exp[0]}-${String(b.exp[1]).padStart(2, "0")}`, b.qty, b.shelf].join(","))
      .join("\n");
    downloadCsv(header + body, "inventory_export.csv");
  }

  return (
    <Card title={`Live inventory — ${visibleFacilities.length ? visibleFacilities.join(", ") : "none selected"}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => { setText(e.target.value); setPage(1); }}
          placeholder="Filter by SKU code or name…"
          className="min-w-48 flex-1 rounded-lg border border-slate-300 p-1.5 text-xs dark:border-slate-600 dark:bg-slate-900"
        />
        <input
          type="text"
          value={batch}
          onChange={(e) => { setBatch(e.target.value); setPage(1); }}
          placeholder="Batch code…"
          className="w-32 rounded-lg border border-slate-300 p-1.5 text-xs dark:border-slate-600 dark:bg-slate-900"
        />
        <input
          type="text"
          value={location}
          onChange={(e) => { setLocation(e.target.value); setPage(1); }}
          placeholder="Location / bin…"
          className="w-32 rounded-lg border border-slate-300 p-1.5 text-xs dark:border-slate-600 dark:bg-slate-900"
        />
        <input
          type="number"
          min={0}
          value={minQty}
          onChange={(e) => { setMinQty(e.target.value); setPage(1); }}
          placeholder="Min qty"
          className="w-20 rounded-lg border border-slate-300 p-1.5 text-xs dark:border-slate-600 dark:bg-slate-900"
        />
        <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)} className="rounded-lg border border-slate-300 p-1.5 text-xs dark:border-slate-600 dark:bg-slate-900">
          <option value="expiry">Sort: earliest expiry</option>
          <option value="facility">Sort: facility / location</option>
        </select>
        <Button variant="sm" onClick={saveView}>Save view</Button>
        <Button variant="sm" onClick={exportCsv}>Export CSV</Button>
      </div>

      {savedInventoryViews.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Saved views:</span>
          {savedInventoryViews.map((v) => (
            <span key={v.name} className="inline-flex items-center gap-1 rounded-full border border-slate-300 pl-2 pr-1 py-0.5 text-[11px] dark:border-slate-600">
              <button onClick={() => applyView(v)} className="hover:underline">{v.name}</button>
              <button onClick={() => deleteInventoryView(v.name)} aria-label={`Delete view ${v.name}`} className="rounded px-1 text-slate-400 hover:text-rose-600">×</button>
            </span>
          ))}
        </div>
      )}

      <p className="mb-1 text-[11px] text-slate-500 dark:text-slate-400">
        Only <b>Good + Active</b> stock currently on hand. {sorted.length.toLocaleString()} row(s) match.
      </p>

      {visibleFacilities.length === 0 ? (
        <p className="py-3 text-center text-xs text-slate-500">Tick a facility in the header to view its inventory.</p>
      ) : (
        <>
          <InventoryTable rows={items} onSelect={setSelected} />
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
            <span>Page {page} of {totalPages}</span>
            <div className="flex gap-1.5">
              <Button variant="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Prev</Button>
              <Button variant="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</Button>
            </div>
          </div>
        </>
      )}

      {selected && <BatchDetailDrawer row={selected} onClose={() => setSelected(null)} />}
    </Card>
  );
}
