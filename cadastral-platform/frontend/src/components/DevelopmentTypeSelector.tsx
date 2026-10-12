"use client";
import { DEVELOPMENT_TYPES, DEFAULT_DEVELOPMENT_TYPE, isDevelopmentType, type DevelopmentType } from "@/lib/api";

const key = (projectId: string) => `jce.devtype.${projectId}`;
/** Per-viewer convenience only (localStorage may be unavailable); the value is sent with every run request. */
export function loadDevelopmentType(projectId: string): DevelopmentType {
  try { const v = localStorage.getItem(key(projectId)); return isDevelopmentType(v) ? v : DEFAULT_DEVELOPMENT_TYPE; } catch { return DEFAULT_DEVELOPMENT_TYPE; }
}
export function saveDevelopmentType(projectId: string, v: DevelopmentType) { try { localStorage.setItem(key(projectId), v); } catch { /* ignore */ } }

export function DevelopmentTypeSelector({ value, onChange }: { value: DevelopmentType; onChange: (v: DevelopmentType) => void }) {
  const cur = DEVELOPMENT_TYPES.find((d) => d.value === value);
  return (<div className="card space-y-2">
    <label htmlFor="dev-type" className="font-bold">Development type</label>
    <select id="dev-type" className="input w-full" value={value} onChange={(e) => onChange(e.target.value as DevelopmentType)}>
      {DEVELOPMENT_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
    </select>
    <p className="text-sm text-muted">{cur?.note} Setbacks, site cover and height are taken only from rules for this type; anything not found is reported as unresolved.</p>
  </div>);
}
