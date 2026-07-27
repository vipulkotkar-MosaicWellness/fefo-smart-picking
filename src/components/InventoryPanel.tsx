import { useStore } from "../lib/store";
import { Card } from "./Ui";
import { InventoryTable } from "./InventoryTable";

export function InventoryPanel() {
  const visible = useStore((s) => s.visibleFacilities);
  return (
    <Card title={`Live inventory — ${visible.length ? visible.join(", ") : "none selected"}`}>
      <p className="mb-1 text-[11px] text-slate-500 dark:text-slate-400">
        Only <b>Good + Active</b> stock. <b>Reserved</b> = soft-blocked by an open picking task. Use the header
        checkboxes to show / hide facilities.
      </p>
      <InventoryTable />
    </Card>
  );
}
