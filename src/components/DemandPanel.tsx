import { useState, type ChangeEvent } from "react";
import { useAuth } from "../lib/authStore";
import { CHANNELS } from "../lib/channels";
import { downloadCsv } from "../lib/format";
import { parseDemandCsv } from "../lib/sampleData";
import { useStore } from "../lib/store";
import { PartnerMark } from "./partners/PartnerMark";
import { Button, Card } from "./Ui";

const SAMPLE_DEMAND =
  "Blinkit, MWMMHRP.0001.AAAA.B0_N, 120\nAmazon, MWMMHRP.0004.AAAA.B0_N, 80\nMyntra, MWMMPRK.2026.AAAA.B0_N, 60";

const TEMPLATE = "Channel,SKU Code,Qty\nBlinkit,MWMMHRP.0001.AAAA.B0_N,50\nAmazon,MWMMHRP.0004.AAAA.B0_N,30\n";

export function DemandPanel() {
  const { channelRules, skus, demand, setDemand, removeDemand, generate } = useStore();
  const userId = useAuth((s) => s.userId);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function onGenerate() {
    setBusy(true);
    try {
      await generate(userId);
    } finally {
      setBusy(false);
    }
  }

  function parse() {
    const { demand: d, badSku, badChannel } = parseDemandCsv(text, skus, channelRules);
    setDemand(d);
    if (badChannel.length) alert("Unknown channel(s) — check spelling against the tolerance list:\n" + [...new Set(badChannel)].join("\n"));
    if (badSku.length) alert("Skipped SKU codes not in stock:\n" + [...new Set(badSku)].join("\n"));
  }

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const content = String(r.result);
      setText(content);
      const { demand: d, badSku, badChannel } = parseDemandCsv(content, skus, channelRules);
      setDemand(d);
      if (badChannel.length) alert("Unknown channel(s) — check spelling against the tolerance list:\n" + [...new Set(badChannel)].join("\n"));
      if (badSku.length) alert("Skipped SKU codes not in stock:\n" + [...new Set(badSku)].join("\n"));
    };
    r.readAsText(f);
  }

  const channelCount = new Set(demand.map((d) => d.channel)).size;

  return (
    <Card title="Demand (multi-channel CSV)">
      <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400">
        Paste demand rows <span className="font-normal">(Channel, SKU Code, Qty)</span> — one channel per row, mix
        as many channels as you like. A separate picking task is created per channel.
      </label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"Blinkit, MWMMHRP.0001.AAAA.B0_N, 50\nAmazon, MWMMHRP.0004.AAAA.B0_N, 30"}
        className="mt-1 min-h-24 w-full rounded-lg border border-slate-300 bg-white p-2 font-mono text-xs dark:border-slate-600 dark:bg-slate-900"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="sm" onClick={() => setText(SAMPLE_DEMAND)}>Load sample</Button>
        <Button variant="sm" onClick={() => downloadCsv(TEMPLATE, "demand_template.csv")}>Template</Button>
        <label className="cursor-pointer rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200">
          Upload .csv
          <input type="file" accept=".csv" className="hidden" onChange={onFile} />
        </label>
        <Button variant="sm" onClick={parse}>Parse</Button>
      </div>

      <p className="mt-2 text-[10px] text-slate-500 dark:text-slate-400">
        Valid channels: {Object.keys(CHANNELS).join(", ")}
      </p>

      <div className="mt-2.5 space-y-1">
        {demand.length === 0 ? (
          <p className="text-[11px] text-slate-500 dark:text-slate-400">No demand parsed yet.</p>
        ) : (
          demand.map((d, i) => (
            <div
              key={`${d.channel}-${d.sku}`}
              className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
            >
              <span className="inline-flex items-center gap-1.5">
                <PartnerMark name={d.channel} compact /> · {skus[d.sku]?.name ?? d.sku} · <b>{d.qty}</b>
              </span>
              <Button variant="sm" onClick={() => removeDemand(i)}>x</Button>
            </div>
          ))
        )}
      </div>

      <div className="mt-2.5">
        <Button onClick={() => void onGenerate()} disabled={demand.length === 0 || busy}>
          {busy ? "Generating…" : `Generate picklist${channelCount > 1 ? `s (${channelCount} channels)` : ""}`}
        </Button>
      </div>
    </Card>
  );
}
