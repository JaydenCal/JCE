"use client";
import { useEffect, useState } from "react";
import { ACK_KINDS, missingAcks, type AckKind } from "@/lib/acks";
import { api } from "@/lib/api";
const key = (p: string) => "acks:" + p;
export function useAcks(projectId: string) {
  const [present, setPresent] = useState<string[]>([]);
  useEffect(() => { try { setPresent(JSON.parse(localStorage.getItem(key(projectId)) || "[]")); } catch { /* */ } }, [projectId]);
  const save = (p: string[]) => { setPresent(p); try { localStorage.setItem(key(projectId), JSON.stringify(p)); } catch { /* */ } };
  return { present, save };
}
export function Acknowledgements({ projectId, present, onChange }: { projectId: string; present: string[]; onChange: (p: string[]) => void }) {
  const [err, setErr] = useState("");
  async function tick(kind: AckKind) {
    setErr("");
    try { const r = await api.acknowledge(projectId, [kind]); onChange(missingAcks([]).filter((k) => !r.export_gate_missing.includes(k))); }
    catch (e) { setErr((e as Error).message); }
  }
  return (<div className="space-y-3">{ACK_KINDS.map((a) => { const done = present.includes(a.kind);
    return (<label key={a.kind} className={`flex gap-3 rounded-xl border p-4 text-sm ${done ? "border-brand/50 bg-brand-soft/40" : "border-line"}`}>
      <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-[rgb(var(--brand))]" checked={done} disabled={done} onChange={() => tick(a.kind)} />
      <span><span className="mr-2 font-bold text-gold">{a.id}</span>{a.text}</span></label>); })}
    {err && <p role="alert" className="text-sm text-danger">{err}</p>}</div>);
}
