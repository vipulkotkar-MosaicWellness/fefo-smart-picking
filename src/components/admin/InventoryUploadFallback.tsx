import { useState, type ChangeEvent } from "react";
import { useAuth } from "../../lib/authStore";
import { parseShelfwiseCsv, type ParseShelfwiseResult } from "../../lib/shelfwiseCsv";
import { useStore } from "../../lib/store";
import { Button, Card, Tag } from "../Ui";

export function InventoryUploadFallback() {
  const uploadStockFallback = useStore((s) => s.uploadStockFallback);
  const myName = useAuth((s) => s.profile?.display_name ?? "Admin");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ParseShelfwiseResult | null>(null);
  const [parseError, setParseError] = useState("");
  const [uploading, setUploading] = useState(false);

  function reset() {
    setFileName("");
    setPreview(null);
    setParseError("");
  }

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file after a fix
    if (!file) return;
    setFileName(file.name);
    setPreview(null);
    setParseError("");
    const r = new FileReader();
    r.onload = () => {
      try {
        setPreview(parseShelfwiseCsv(String(r.result)));
      } catch (err) {
        setParseError((err as Error).message);
      }
    };
    r.readAsText(file);
  }

  async function confirmUpload() {
    if (!preview || preview.rows.length === 0) return;
    setUploading(true);
    const ok = await uploadStockFallback(preview.rows, myName);
    setUploading(false);
    if (ok) reset();
  }

  return (
    <Card title="Upload inventory (fallback)">
      <p className="mb-3 text-[11px] text-slate-500 dark:text-slate-400">
        Use this only when the hourly Shelfwise email sync is down. Upload the same export CSV you'd already have
        from Gmail — it's filtered and loaded exactly like the automated pipeline, and replaces the shared stock
        table for everyone. Refuses to run while any picklist is still open.
      </p>

      <label className="mb-3 flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-600">
        Choose Shelfwise export CSV
        <input type="file" accept=".csv" className="hidden" onChange={onFile} />
      </label>
      {fileName && <p className="mb-2 text-[11px] text-slate-500 dark:text-slate-400">Selected: {fileName}</p>}

      {parseError && (
        <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {parseError}
        </p>
      )}

      {preview && (
        <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-900">
          <p className="mb-1.5 font-semibold">
            {preview.rows.length.toLocaleString()} row(s) ready to upload, out of {preview.totalRows.toLocaleString()} in the file.
          </p>
          {(preview.dropped.facility || preview.dropped.invType || preview.dropped.status || preview.dropped.qtyZero) ? (
            <div className="flex flex-wrap gap-1.5">
              {preview.dropped.facility > 0 && <Tag tone="muted">{preview.dropped.facility} other facility</Tag>}
              {preview.dropped.invType > 0 && <Tag tone="muted">{preview.dropped.invType} not Good Inventory</Tag>}
              {preview.dropped.status > 0 && <Tag tone="muted">{preview.dropped.status} not Active</Tag>}
              {preview.dropped.qtyZero > 0 && <Tag tone="muted">{preview.dropped.qtyZero} zero qty</Tag>}
            </div>
          ) : (
            <p className="text-slate-500 dark:text-slate-400">Nothing dropped — every row matched.</p>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <Button
          variant="green"
          onClick={() => void confirmUpload()}
          disabled={!preview || preview.rows.length === 0 || uploading}
        >
          {uploading ? "Uploading…" : preview ? `Replace stock with these ${preview.rows.length.toLocaleString()} row(s)` : "Replace stock"}
        </Button>
        {(preview || parseError) && (
          <Button variant="sm" onClick={reset} disabled={uploading}>
            Cancel
          </Button>
        )}
      </div>
    </Card>
  );
}
