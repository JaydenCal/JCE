// Measure, underlay (move and calibrate) and the extension status brush.

import * as G from '../model/geometry.js';
import * as M from './math.js';
import { statusIdsFor } from './edit.js';
import { drawTag, fmtDim, drawHover } from './draw-annot.js';
import { buildScene } from './draw-plan.js';
import { h } from '../ui/dom.js';

function line(ctx, st, ed, a, b, { dashed = true, colour } = {}) {
  const sa = ed.toScreen(a);
  const sb = ed.toScreen(b);
  ctx.save();
  ctx.strokeStyle = colour || st.theme.c.accent;
  ctx.lineWidth = 1.6;
  if (dashed) ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(sa.x, sa.y);
  ctx.lineTo(sb.x, sb.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = colour || st.theme.c.accent;
  for (const p of [sa, sb]) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  return { sa, sb };
}

export function createMiscTools(ed, hooks = {}) {
  const { store } = ed;

  // Measure: two clicks, transient ----------------------------------------------------------------------------
  const measure = (() => {
    let a = null;
    let b = null;
    let done = false;
    return {
      id: 'measure',
      cursor: () => 'crosshair',
      hint: () => (a && !done ? 'Click the second point. Esc clears.' : done && a && b ? `Distance ${fmtDim(G.dist(a, b))} mm. Click or right click to measure again. Esc clears.` : 'Click two points to measure a distance, or right click anywhere on the plan. Nothing is saved.'),
      // Quick measure: a right click starts the measure at that point, the next click finishes it.
      startAt(ev) {
        a = b = ed.snap(ev.world, { alt: ev.alt });
        done = false;
        ed.setHint(measure.hint());
        ed.draw();
      },
      pointerDown(ev) {
        const p = ed.snap(ev.world, { alt: ev.alt });
        if (!a || done) {
          a = p;
          b = p;
          done = false;
        } else {
          b = p;
          done = true;
        }
        ed.setHint(measure.hint());
        ed.draw();
      },
      pointerMove(ev) {
        if (a && !done) {
          b = ed.snap(ev.world, { alt: ev.alt });
          ed.draw();
        }
      },
      cancel() {
        const was = !!a;
        a = b = null;
        done = false;
        ed.draw();
        return was;
      },
      deactivate() {
        a = b = null;
        done = false;
      },
      draw(ctx, st) {
        if (!a || !b) return;
        const { sa, sb } = line(ctx, st, ed, a, b);
        const d = G.dist(a, b);
        if (d < 1) return;
        const dx = Math.abs(b.x - a.x);
        const dy = Math.abs(b.y - a.y);
        drawTag(ctx, st, `${fmtDim(d)} mm`, (sa.x + sb.x) / 2, (sa.y + sb.y) / 2 - 16, { colour: st.theme.c.accent });
        if (dx > 1 && dy > 1) drawTag(ctx, st, `Δx ${fmtDim(dx)}  Δy ${fmtDim(dy)}`, (sa.x + sb.x) / 2, (sa.y + sb.y) / 2 + 8, { size: 10.5 });
      },
    };
  })();

  // Underlay: drag to move, click two points to calibrate -------------------------------------------------------------
  const underlay = (() => {
    let drag = null;
    let calib = null; // { pts: [] }
    const U = () => store.project.site?.underlay;

    function askDistance(p1, p2) {
      const measured = G.dist(p1, p2);
      const input = h('input', { class: 'ps-input ps-num', id: 'ps-calib-mm', type: 'number', min: '1', step: '1', placeholder: 'e.g. 4200', 'aria-label': 'True distance in millimetres' });
      const apply = () => {
        const mm = Number(input.value);
        if (!(mm > 0)) {
          input.focus();
          ed.toast('Enter the true distance in millimetres.', { kind: 'warn' });
          return;
        }
        const ok = ed.apply('Calibrate underlay', (p) => {
          p.site.underlay = M.calibrateUnderlay(p.site.underlay, p1, p2, mm);
        });
        if (ok !== null) {
          pop.close();
          calib = null;
          hooks.onCalibrated?.();
          ed.toast(`Underlay calibrated. The two points are now ${fmtDim(mm)} mm apart.`, { kind: 'ok' });
          ed.api.zoomToFit();
        }
      };
      const cancel = () => {
        pop.close();
        calib = null;
        hooks.onCalibrated?.();
        ed.draw();
      };
      const s = ed.toScreen(G.lerp(p1, p2, 0.5));
      const pop = ed.popover({
        x: s.x,
        y: s.y,
        title: 'Calibrate underlay',
        onEnter: apply,
        onCancel: cancel,
        content: h('div', null,
          h('p', { class: 'ps-hatch-note' }, 'What is the true distance between the two points you picked?'),
          h('div', { class: 'ps-field ps-field--stack' },
            h('label', { for: 'ps-calib-mm' }, 'True distance'),
            h('div', { class: 'ps-input-wrap' }, input, h('span', { class: 'ps-unit' }, 'mm'))),
          h('p', { class: 'ps-hatch-note ps-mono' }, `Currently reads ${fmtDim(measured)} mm`),
          h('div', { class: 'ps-popover-actions' },
            h('button', { class: 'ps-btn', type: 'button', onclick: cancel }, 'Cancel'),
            h('button', { class: 'ps-btn ps-btn--primary', type: 'button', onclick: apply }, 'Apply')),
        ),
      });
    }

    return {
      id: 'underlay',
      cursor: () => (calib ? 'crosshair' : drag ? 'grabbing' : U() && !U().locked ? 'move' : 'default'),
      hint() {
        if (!U()) return 'Add a PNG or JPG underlay in the panel, then trace over it.';
        if (calib) return calib.pts.length ? 'Click the second point of the known distance.' : 'Click the first point of a known distance on the underlay.';
        return U().locked ? 'The underlay is locked. Unlock it in the panel to move it.' : 'Drag to move the underlay. Use Calibrate to set its scale.';
      },
      beginCalibration() {
        calib = { pts: [] };
        ed.setHint(underlay.hint());
        ed.draw();
      },
      activate() {
        ed.setHint(underlay.hint());
      },
      projectChanged() {
        ed.setHint(underlay.hint());
      },
      pointerDown(ev) {
        if (!U()) return;
        if (calib) {
          if (ed.hasPopover()) return;
          calib.pts.push({ x: Math.round(ev.world.x), y: Math.round(ev.world.y) });
          if (calib.pts.length === 2) askDistance(calib.pts[0], calib.pts[1]);
          ed.setHint(underlay.hint());
          ed.draw();
          return;
        }
        if (U().locked) {
          ed.startPan(ev);
          return;
        }
        drag = { start: ev.world, orig: { x: U().x, y: U().y }, moved: false, screen: ev.screen };
      },
      pointerMove(ev) {
        if (calib?.pts.length === 1) ed.draw();
        if (!drag || !(ev.raw.buttons & 1)) return;
        const dx = Math.round(ev.world.x - drag.start.x);
        const dy = Math.round(ev.world.y - drag.start.y);
        if (!drag.moved && Math.hypot(ev.screen.x - drag.screen.x, ev.screen.y - drag.screen.y) < 4) return;
        drag.moved = true;
        drag.to = { x: drag.orig.x + dx, y: drag.orig.y + dy };
        ed.previewFn((p) => {
          p.site.underlay.x = drag.to.x;
          p.site.underlay.y = drag.to.y;
        });
      },
      pointerUp() {
        if (!drag) return;
        const d = drag;
        drag = null;
        if (d.moved && d.to) {
          ed.apply('Move underlay', (p) => {
            p.site.underlay.x = d.to.x;
            p.site.underlay.y = d.to.y;
          });
        }
        ed.clearPreview();
      },
      cancel() {
        if (drag) {
          drag = null;
          ed.clearPreview();
          return true;
        }
        if (calib) {
          ed.closePopover();
          calib = null;
          hooks.onCalibrated?.();
          ed.setHint(underlay.hint());
          ed.draw();
          return true;
        }
        return false;
      },
      deactivate() {
        drag = null;
        if (calib) {
          calib = null;
          hooks.onCalibrated?.();
        }
      },
      draw(ctx, st) {
        if (!calib?.pts.length) return;
        const a = calib.pts[0];
        const b = calib.pts[1] || ed.state.pointer?.world;
        if (!b) return;
        const { sa, sb } = line(ctx, st, ed, a, b, { dashed: calib.pts.length < 2 });
        const d = G.dist(a, b);
        if (d > 1) drawTag(ctx, st, `${fmtDim(d)} mm on screen`, (sa.x + sb.x) / 2, (sa.y + sb.y) / 2 - 16);
      },
    };
  })();

  // Status brush --------------------------------------------------------------------------------------------------------
  const status = (() => {
    let painting = null; // { ids:Set }
    let hover = null;
    const brush = () => (['new', 'existing', 'demolish'].includes(store.ui.toolArg) ? store.ui.toolArg : 'existing');
    const target = (world) => {
      const hit = ed.hit(world, ['opening', 'tank', 'wall', 'room']);
      return hit ? { hit, ids: statusIdsFor(store.level(), hit.kind, hit.item) } : null;
    };
    const stroke = (world) => {
      const t = target(world);
      hover = t?.hit || null;
      if (painting && t) {
        const before = painting.ids.size;
        t.ids.forEach((id) => painting.ids.add(id));
        if (painting.ids.size !== before) ed.previewOp('set_status', { ids: [...painting.ids], status: brush() });
      }
      ed.draw();
    };
    return {
      id: 'status',
      cursor: () => 'crosshair',
      hint: () => `Status brush: click walls or rooms to mark them ${brush()}. Drag to paint several. Choose the status in the panel.`,
      pointerDown(ev) {
        painting = { ids: new Set() };
        stroke(ev.world);
      },
      pointerMove(ev) {
        stroke(ev.world);
      },
      pointerUp() {
        if (!painting) return;
        const ids = [...painting.ids];
        painting = null;
        ed.clearPreview();
        if (ids.length) ed.run('set_status', { ids, status: brush() });
      },
      pointerLeave() {
        hover = null;
        ed.draw();
      },
      cancel() {
        if (!painting) return false;
        painting = null;
        ed.clearPreview();
        return true;
      },
      deactivate() {
        painting = null;
        hover = null;
      },
      draw(ctx, st) {
        if (!hover) return;
        const scene = buildScene(st.project, st.level, st.statusView);
        drawHover(ctx, st, scene, hover);
      },
    };
  })();

  return { measure, underlay, status };
}
