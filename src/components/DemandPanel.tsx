import { useState, type ChangeEvent } from "react";
import { CHANNELS, ruleText } from "../lib/channels";
import { downloadCsv } from "../lib/format";
import { parseDemandCsv } from "../lib/sampleData";
import { useStore } from "../lib/store";
import { Button, Card } from "./Ui";

const SAMPLE_DEMAND =
  "MWMMHRP.0001.AAAA.B0_N, 120\nMWMMHRP.0004.AAAA.B0_N, 80\nMWMMPRK.2026.AAAA.B0_N, 60";

export function DemandPanel() {
  const { channel, setChannel, channelRules, skus, demand, setDemand, removeDemand, generate } = useStore();
  const [text, setText] = useState("");

  function parse() {
    const { demand: d, bad } = parseDemandCsv(text, skus);
    setDemand(d);
    if (bad.length) alert("Skipped SKU codes not in stock:\n" + bad.join("\n"));
  }

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const content = String(r.result);
      setText(content);
      const { demand: d, bad } = parseDemandCsv(content, skus);
      setDemand(d);
      if (bad.length) alert("Skipped SKU codes not in stock:\n" + bad.join("\n"));
    };
    r.readAsText(f);
  }

  return (
    <Card title="2 · Demand (by SKU #)">
      <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400">Channel (dispatch tolerance)</label>
      <select
        value={channel}
        onChange={(e) => setChannel(e.target.value)}
        className="w-full rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-600 dark:bg-slate-900"
      >
        {Object.keys(CHANNELS).map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <p className="my-1.5 text-[11px] text-slate-500 dark:text-slate-400">
        Rule: <b>{ruleText(channelRules[channel])}</b>
      </p>

      <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400">
        Paste demand rows <span className="font-normal">(SKU Code, Qty)</span>
      </label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"MWMMHRP.0001.AAAA.B0_N, 50\nMWMMHRP.0004.AAAA.B0_N, 30"}
        className="mt-1 min-h-20 w-full rounded-lg border border-slate-300 bg-white p-2 font-mono text-xs dark:border-slate-600 dark:bg-slate-900"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="sm" onClick={() => setText(SAMPLE_DEMAND)}>Load sample</Button>
        <Button variant="sm" onClick={() => downloadCsv("SKU Code,Qty\nMWMMHRP.0001.AAAA.B0_N,50\n", "demand_template.csv")}>
          Template
        </Button>
        <label className="cursor-pointer rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200">
          Upload .csv
          <input type="file" accept=".csv" className="hidden" onChange={onFile} />
        </label>
        <Button variant="sm" onClick={parse}>Parse</Button>
      </div>

      <div className="mt-2.5 space-y-1">
        {demand.length === 0 ? (
          <p className="text-[11px] text-slate-500 dark:text-slate-400">No demand parsed yet.</p>
        ) : (
          demand.map((d, i) => (
            <div
              key={d.sku}
              className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
            >
              <span>
                {skus[d.sku]?.name ?? d.sku} · <b>{d.qty}</b>
              </span>
              <Button variant="sm" onClick={() => removeDemand(i)}>
                x
              </Button>
            </div>
          ))
        )}
      </div>

      <div className="mt-2.5">
        <Button onClick={generate}>Generate picklist</Button>
      </div>
    </Card>
  );
}
