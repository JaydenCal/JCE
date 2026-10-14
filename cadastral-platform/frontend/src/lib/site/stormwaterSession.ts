/**
 * The state of the stormwater panel (stage 9): the user's entries, the last answer of the server and the uploads. The analysis is run on request (a button), not after every
 * edit, because it is a heavier calculation than the object checks; an answer for an older design or older entries is marked STALE and never presented as current.
 *
 * Nothing is calculated here. The server is authoritative.
 */
import { EngineHttpError } from './engineApi';
import type { Endpoint } from './persist';
import { designSig } from './serverChecks';
import { EMPTY_FORM, formFromInputs, inputsPayload, type InputsForm, type StormwaterResult } from './stormwater';
import { deleteUpload, getStormwaterData, postAnalyse, postUpload, putInputs, type StormwaterData, type UploadKind } from './stormwaterApi';
import type { SiteDesign } from './types';

export type SwStatus = 'idle' | 'pending' | 'ok' | 'error' | 'no_server';
export interface OverlandSettings { on: boolean; cell: string; threshold: string; surface: 'design' | 'existing' }
export interface SwState {
  form: InputsForm; formErrors: string[]; rainfallSource: 'upload' | 'live'; overland: OverlandSettings;
  status: SwStatus; error: string; result: StormwaterResult | null; resultSig: string; stale: boolean;
  data: StormwaterData | null; busy: string; message: string; calls: number;
}
export const DEFAULT_OVERLAND: OverlandSettings = { on: false, cell: '0.5', threshold: '25', surface: 'design' };
const num = (s: string, fallback: number) => (s.trim() !== '' && Number.isFinite(Number(s)) && Number(s) > 0 ? Number(s) : fallback);

export class StormwaterSession {
  state: SwState = {
    form: { ...EMPTY_FORM, runoff: {} }, formErrors: [], rainfallSource: 'upload', overland: { ...DEFAULT_OVERLAND }, status: 'idle', error: '', result: null, resultSig: '', stale: false,
    data: null, busy: '', message: '', calls: 0,
  };
  listener: (s: SwState) => void = () => {};
  private abort: AbortController | null = null;
  private dead = false;
  constructor(private ep: Endpoint | null, private getDoc: () => SiteDesign) {
    if (!ep) this.state = { ...this.state, status: 'no_server', error: 'NO SERVER: THIS VIEW HAS NO CONNECTION TO THE STORMWATER HELPER' };
  }
  private put(p: Partial<SwState>) { this.state = { ...this.state, ...p }; this.state.stale = this.isStale(); if (!this.dead) this.listener(this.state); }
  private sigNow(): string { return JSON.stringify([designSig(this.getDoc()), this.state.form, this.state.rainfallSource, this.state.overland]); }
  private isStale(): boolean { return this.state.result !== null && this.state.resultSig !== this.sigNow(); }
  /** The document changed: an answer for the older document is stale. */
  documentChanged() { this.put({}); }

  setField<K extends keyof InputsForm>(key: K, value: InputsForm[K]) { this.put({ form: { ...this.state.form, [key]: value }, formErrors: [] }); }
  setRunoff(surface: string, value: string) { this.put({ form: { ...this.state.form, runoff: { ...this.state.form.runoff, [surface]: value } }, formErrors: [] }); }
  setRainfallSource(s: 'upload' | 'live') { this.put({ rainfallSource: s }); }
  setOverland(p: Partial<OverlandSettings>) { this.put({ overland: { ...this.state.overland, ...p } }); }

  /** Load the saved entries and the list of uploads. */
  async load() {
    if (!this.ep) return;
    try {
      const d = await getStormwaterData(this.ep);
      this.put({ data: d, form: d.inputs ? formFromInputs(d.inputs) : this.state.form });
    } catch (err) { this.put({ error: err instanceof EngineHttpError ? err.message : String(err) }); }
  }
  /** Save the entries so the next session starts with them. */
  async save() {
    if (!this.ep) return;
    const { inputs, errors } = inputsPayload(this.state.form);
    if (errors.length) { this.put({ formErrors: errors }); return; }
    this.put({ busy: 'Saving the entries', formErrors: [] });
    try { await putInputs(this.ep, inputs); this.put({ busy: '', message: 'ENTRIES SAVED' }); } catch (err) { this.put({ busy: '', error: err instanceof EngineHttpError ? err.message : String(err) }); }
  }
  /** Ask the server for the analysis of the design as it is now with the entries as they are now. */
  async run(): Promise<boolean> {
    if (!this.ep) return false;
    const { inputs, errors } = inputsPayload(this.state.form);
    if (errors.length) { this.put({ formErrors: errors }); return false; }
    const sig = this.sigNow(), ov = this.state.overland;
    this.abort?.abort(); const ac = this.abort = new AbortController();
    this.put({ status: 'pending', error: '', formErrors: [], message: '', calls: this.state.calls + 1 });
    try {
      const res = await postAnalyse(this.ep, {
        design: this.getDoc(), inputs, rainfall_source: this.state.rainfallSource,
        overland: ov.on ? { enabled: true, cell_m: num(ov.cell, 0.5), threshold_m2: num(ov.threshold, 25), surface: ov.surface } : null,
      }, ac.signal);
      if (this.dead || this.abort !== ac) return false;
      this.put({ status: 'ok', result: res, resultSig: sig });
      return true;
    } catch (err) {
      if (this.dead || this.abort !== ac || (err as { name?: string })?.name === 'AbortError') return false;
      this.put({ status: 'error', error: err instanceof EngineHttpError ? err.message : String(err) });
      return false;
    } finally { if (this.abort === ac) this.abort = null; }
  }
  async upload(kind: UploadKind, file: Blob, name: string, fields: Record<string, string> = {}): Promise<boolean> {
    if (!this.ep) return false;
    this.put({ busy: `Uploading ${name}`, error: '', message: '' });
    try {
      await postUpload(this.ep, kind, file, name, fields);
      this.put({ busy: '', message: `UPLOADED ${name.toUpperCase()}` });
      await this.load();
      return true;
    } catch (err) { this.put({ busy: '', error: err instanceof EngineHttpError ? err.message : String(err) }); return false; }
  }
  async remove(kind: UploadKind) {
    if (!this.ep) return;
    try { await deleteUpload(this.ep, kind); this.put({ message: 'REMOVED' }); await this.load(); } catch (err) { this.put({ error: err instanceof EngineHttpError ? err.message : String(err) }); }
  }
  dispose() { this.dead = true; this.abort?.abort(); this.abort = null; }
}
