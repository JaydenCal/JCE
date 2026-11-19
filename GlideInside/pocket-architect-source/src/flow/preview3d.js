// A 3D preview with orbit for the Check it step: a second viewer on the same project, in its own element. WebGL missing: a plain note.
import { h } from '../ui/dom.js';

export async function mount3dPreview(host, store, catalogue) {
  host.replaceChildren(h('div', { class: 'gf-empty', dataset: { ps: 'flow-3d-loading' } }, 'Loading the 3D view'));
  try {
    const m = await import('../viewer3d/viewer.js');
    host.replaceChildren();
    const v = m.createViewer3D(host, store, { catalogue });
    if (v.unavailable) return v;
    v.setMode?.('orbit');
    v.setActive?.(true);
    try { await v.snapToRoom?.('aerial', { duration: 0.01, site: true }); } catch { /* the viewer keeps its own framing */ }
    host.append(h('div', { class: 'gf-note', style: { position: 'absolute', left: '10px', bottom: '6px', top: 'auto', right: 'auto', margin: '0', color: '#fff', background: 'rgba(18,38,58,.78)', padding: '2px 8px', borderRadius: '999px', fontSize: '12px', pointerEvents: 'none' } }, 'Drag to orbit, scroll to zoom'));
    return v;
  } catch (e) {
    console.warn('[flow] 3D preview unavailable', e);
    host.replaceChildren(h('div', { class: 'gf-empty' }, 'The 3D preview could not be loaded. The editor still has the 3D view.'));
    return null;
  }
}
