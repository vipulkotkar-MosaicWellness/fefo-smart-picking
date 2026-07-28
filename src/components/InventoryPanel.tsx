import { useStore } from "../lib/store";
import { Card } from "./Ui";
import { InventoryTable } from "./InventoryTable";

export function InventoryPanel() {
  const { visibleFacilities: visible, skuFilter, setSkuFilter } = useStore();
  return (
    <Card title={`Live inventory — ${visible.length ? visible.join(", ") : "none selected"}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={skuFilter}
          onChange={(e) => setSkuFilter(e.target.value)}
          placeholder="Filter by SKU code or name…"
          className="min-w-56 flex-1 rounded-lg border border-slate-300 p-1.5 text-xs dark:border-slate-600 dark:bg-slate-900"
        />
        {skuFilter && (
          <button
            onClick={() => setSkuFilter("")}
            className="rounded-md border border-slate-300 px-2 py-1 text-[11px] dark:border-slate-600"
          >
            Clear
          </button>
        )}
      </div>
      <p className="mb-1 text-[11px] text-slate-500 dark:text-slate-400">
        Only <b>Good + Active</b> stock currently on hand. Use the header checkboxes to show / hide facilities.
      </p>
      <InventoryTable />
    </Card>
  );
}
