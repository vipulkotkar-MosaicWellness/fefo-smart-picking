import { useState, type ChangeEvent } from "react";
import { downloadCsv } from "../lib/format";
import { parseStockCsv, SAMPLE_STOCK } from "../lib/sampleData";
import { useStore } from "../lib/store";
import { Button, Card } from "./Ui";
import { InventoryTable } from "./InventoryTable";

const TEMPLATE =
  "Location,Bin,SKU Code,SKU Name,Batch,Expiry(YYYY-MM),Qty,Shelf life(months),Inventory Type,Active\n" +
  "SL Mother Hub,SLM-A1,MWMMHRP.0001.AAAA.B0_N,MM DHT Blocking Shampoo,SH-2411,2026-11,40,24,Good,Active\n";

export function StockPanel() {
  const { loadStock, notice, stock, skus, locations } = useStore();
  const [text, setText] = useState("");

  function loadPasted() {
    const rows = parseStockCsv(text);
    if (rows.length === 0) {
      alert("No valid stock rows found — check the column order against the template.");
      return;
    }
    loadStock(rows);
  }

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const content = String(r.result);
      setText(content);
      const rows = parseStockCsv(content);
      if (rows.length) loadStock(rows);
    };
    r.readAsText(f);
  }

  return (
    <Card title="1 · Upload stock">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="sm" onClick={() => loadStock(SAMPLE_STOCK)}>
          Load sample stock
        </Button>
        <Button variant="sm" onClick={() => downloadCsv(TEMPLATE, "stock_template.csv")}>
          Download template
        </Button>
        <label className="cursor-pointer rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200">
          Upload stock .csv
          <input type="file" accept=".csv" className="hidden" onChange={onFile} />
        </label>
      </div>

      <label className="mt-3 block text-[11px] font-semibold text-slate-500 dark:text-slate-400">
        Or paste rows{" "}
        <span className="font-normal">
          (Location, Bin, SKU Code, SKU Name, Batch, Expiry YYYY-MM, Qty, Shelf life, Inventory Type, Active)
        </span>
      </label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="SL Mother Hub, SLM-A1, MWMMHRP.0001.AAAA.B0_N, MM DHT Blocking Shampoo, SH-2411, 2026-11, 40, 24, Good, Active"
        className="mt-1 min-h-20 w-full rounded-lg border border-slate-300 bg-white p-2 font-mono text-xs dark:border-slate-600 dark:bg-slate-900"
      />
      <div className="mt-2">
        <Button variant="ghost" onClick={loadPasted}>
          Load pasted stock
        </Button>
      </div>

      <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
        <b>{stock.length}</b> stock rows across <b>{locations().length}</b> location(s), <b>{Object.keys(skus).length}</b> SKUs.
        {notice ? ` · ${notice}` : ""}
      </p>

      <details className="mt-1">
        <summary className="cursor-pointer text-xs font-semibold text-teal-800 dark:text-teal-300">
          View inventory at selected location (on-hand / reserved / available)
        </summary>
        <InventoryTable />
      </details>
    </Card>
  );
}
