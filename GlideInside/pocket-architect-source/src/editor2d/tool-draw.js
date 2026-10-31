// Drawing tools: room, wall (polyline), stairs and deck or patio.

import * as G from '../model/geometry.js';
import * as M from './math.js';
import { drawTag, fmtDim } from './draw-annot.js';
import { OUTDOOR_TYPES, ROOM_TYPES, ROOM_LABELS } from '../model/schema.js';
import { suggestRoomName } from '../ui/schedules.js';
import { h } from '../ui/dom.js';

function rectPath(ctx, ed, rect) {
  const a = ed.toScreen({ x: rect.x, y: rect.y });
  const b = ed.toScreen({ x: rect.x + rect.w, y: rect.y + rect.h });
  ctx.beginPath();
  ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
  return { a, b };
}

function drawRectPreview(ctx, st, ed, rect, label) {
  ctx.save();
  const { a, b } = rectPath(ctx, ed, rect);
  ctx.fillStyle = st.theme.c.accentSoft;
  ctx.globalAlpha = 0.35;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = st.theme.c.accent;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.restore();
  if (rect.w > 0 && (b.x - a.x) > 60) drawTag(ctx, st, fmtDim(rect.w), (a.x + b.x) / 2, a.y - 14);
  if (rect.h > 0 && (b.y - a.y) > 40) drawTag(ctx, st, fmtDim(rect.h), a.x - 12, (a.y + b.y) / 2, { align: 'right' });
  if (label) drawTag(ctx, st, label, (a.x + b.x) / 2, (a.y + b.y) / 2);
}

// A tool that drags out a rectangle. Hooks: onRect(rect, a, b), onClick(a), hint(), label(rect).
function rectTool(ed, id, hooks) {
  let a = null;
  let b = null;
  let pending = false; // rectangle kept on screen while a popover is open
  const reset = () => {
    a = b = null;
    pending = false;
    ed.draw();
  };
  const snapAt = (ev) => ed.snap(ev.world, { alt: ev.alt });
  return {
    id,
    cursor: () => 'crosshair',
    hint: hooks.hint,
    reset,
    pointerDown(ev) {
      if (pending) return;
      a = snapAt(ev);
      b = a;
    },
    pointerMove(ev) {
      if (!a || pending) return;
      b = snapAt(ev);
    },
    pointerUp() {
      if (!a || pending) return;
      const rect = M.dragRect(a, b);
      if (rect.w < 300 && rect.h < 300) {
        const at = a;
        a = b = null;
        hooks.onClick?.(at);
        ed.draw();
        return;
      }
      pending = !!hooks.onRect(rect, a, b, { keep: () => { pending = true; }, done: reset });
      if (!pending) reset();
    },
    cancel() {
      const was = !!a;
      ed.closePopover();
      reset();
      return was;
    },
    deactivate() {
      ed.closePopover();
      a = b = null;
      pending = false;
    },
    draw(ctx, st) {
      if (!a) return;
      const rect = M.dragRect(a, b);
      if (rect.w < 1 && rect.h < 1) return;
      drawRectPreview(ctx, st, ed, rect, hooks.label?.(rect, a, b));
    },
  };
}

export function createDrawTools(ed) {
  const { store } = ed;
  let lastRoomType = 'living';

  // Room -------------------------------------------------------------------------------------------------
  const room = rectTool(ed, 'room', {
    hint: () => 'Drag a rectangle to draw a room. Shared walls merge. Esc cancels.',
    label: (r) => `${(r.w * r.h / 1e6).toFixed(2)} m²`,
    onRect(rect, a, b, ctl) {
      if (rect.w < 300 || rect.h < 300) {
        ed.toast('Drag a larger rectangle. A room is at least 0.3 m each way.', { kind: 'warn' });
        return false;
      }
      const level = store.level();
      let type = lastRoomType;
      let touched = false;
      const typeSel = h('select', { class: 'ps-select', id: 'ps-room-type', 'aria-label': 'Room type' },
        h('optgroup', { label: 'Indoor' }, ROOM_TYPES.filter((t) => !OUTDOOR_TYPES.includes(t)).map((t) => h('option', { value: t, selected: t === type }, ROOM_LABELS[t]))),
        h('optgroup', { label: 'Outdoor' }, OUTDOOR_TYPES.map((t) => h('option', { value: t, selected: t === type }, ROOM_LABELS[t]))),
      );
      const nameIn = h('input', { class: 'ps-input', id: 'ps-room-name', type: 'text', maxlength: '60', value: suggestRoomName(level, type), 'aria-label': 'Room name' });
      nameIn.addEventListener('input', () => { touched = true; });
      typeSel.addEventListener('change', () => {
        type = typeSel.value;
        if (!touched) nameIn.value = suggestRoomName(level, type);
      });
      const create = () => {
        const res = ed.run('add_room', { type, name: nameIn.value.trim() || undefined, x: rect.x, y: rect.y, width: rect.w, depth: rect.h });
        if (res) {
          lastRoomType = type;
          pop.close();
          ctl.done();
        }
      };
      const cancel = () => {
        pop.close();
        ctl.done();
      };
      const s = ed.toScreen({ x: rect.x + rect.w, y: rect.y });
      const pop = ed.popover({
        x: s.x,
        y: s.y,
        title: 'New room',
        onEnter: create,
        onCancel: ctl.done,
        content: h('div', null,
          h('p', { class: 'ps-hatch-note ps-mono' }, `${fmtDim(rect.w)} × ${fmtDim(rect.h)} mm · ${(rect.w * rect.h / 1e6).toFixed(2)} m²`),
          h('div', { class: 'ps-field ps-field--stack' }, h('label', { for: 'ps-room-type' }, 'Type'), typeSel),
          h('div', { class: 'ps-field ps-field--stack' }, h('label', { for: 'ps-room-name' }, 'Name'), nameIn),
          h('div', { class: 'ps-popover-actions' },
            h('button', { class: 'ps-btn', type: 'button', onclick: cancel }, 'Cancel'),
            h('button', { class: 'ps-btn ps-btn--primary', type: 'button', onclick: create }, 'Create room')),
        ),
      });
      ctl.keep();
      return true;
    },
  });

  // Stairs ---------------------------------------------------------------------------------------------------
  const stairs = rectTool(ed, 'stairs', {
    hint: () => 'Drag a rectangle along the run, starting at the bottom step. Click for a standard flight.',
    label: (r) => `${fmtDim(Math.max(r.w, r.h))} × ${fmtDim(Math.min(r.w, r.h))}`,
    onClick(p) {
      ed.run('add_stair', { x: p.x, y: p.y });
    },
    onRect(rect, a, b) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const alongX = rect.w > rect.h;
      const length = alongX ? rect.w : rect.h;
      const width = alongX ? rect.h : rect.w;
      if (width < 600 || length < 1000) {
        ed.toast('Drag a larger rectangle. Stairs are at least 0.6 m wide and 1 m long.', { kind: 'warn' });
        return false;
      }
      const rotation = alongX ? (dx > 0 ? 270 : 90) : dy > 0 ? 0 : 180;
      ed.run('add_stair', { x: Math.round(rect.x + rect.w / 2), y: Math.round(rect.y + rect.h / 2), width, length, rotation });
      return false;
    },
  });

  // Deck or patio -----------------------------------------------------------------------------------------------
  const deckType = () => (OUTDOOR_TYPES.includes(store.ui.toolArg) ? store.ui.toolArg : 'deck');
  const deck = rectTool(ed, 'deck', {
    hint: () => `Drag a rectangle for a ${ROOM_LABELS[deckType()].toLowerCase()}. It has no walls. Change the type in the panel.`,
    label: (r) => `${(r.w * r.h / 1e6).toFixed(2)} m²`,
    onClick(p) {
      ed.run('add_room', { type: deckType(), name: suggestRoomName(store.level(), deckType()), x: p.x - 1500, y: p.y - 1500, width: 3000, depth: 3000 });
    },
    onRect(rect) {
      if (rect.w < 600 || rect.h < 600) {
        ed.toast('Drag a larger rectangle. An outdoor area is at least 0.6 m each way.', { kind: 'warn' });
        return false;
      }
      ed.run('add_room', { type: deckType(), name: suggestRoomName(store.level(), deckType()), x: rect.x, y: rect.y, width: rect.w, depth: rect.h });
      return false;
    },
  });

  // Wall polyline ---------------------------------------------------------------------------------------------------
  const wall = (() => {
    let start = null;
    let last = null;
    let hover = null;
    let history = [];
    let buf = '';

    const target = (ev) => {
      if (ev.shift && last) {
        const p = M.constrainPoint(last, ev.world, { stepDeg: 15, snapMm: ed.snapOn() && !ev.alt ? ed.snapMm() : 0 });
        return { ...p, kind: 'angle' };
      }
      return ed.snap(ev.world, { alt: ev.alt, extraPoints: start ? [start] : [] });
    };
    const finish = () => {
      start = last = hover = null;
      history = [];
      buf = '';
      ed.setHint(t.hint());
      ed.draw();
    };
    const addTo = (p) => {
      if (G.dist(last, p) < 100) return false;
      if (!ed.run('add_wall', { x1: last.x, y1: last.y, x2: p.x, y2: p.y })) return false;
      history.push(p);
      return true;
    };
    const t = {
      id: 'wall',
      cursor: () => 'crosshair',
      hint: () => (last ? 'Click the next point. Shift locks 15 degrees. Type a length, then Enter. Double click or Esc finishes.' : 'Click to start a wall. Click again to continue. Walls join at their ends.'),
      pointerDown(ev) {
        const p = target(ev);
        buf = '';
        if (!last) {
          start = last = hover = p;
          history = [p];
          ed.setHint(t.hint());
          return;
        }
        if (addTo(p)) {
          const closed = G.samePoint(p, start) && history.length > 2;
          last = p;
          if (closed) finish();
        }
      },
      pointerMove(ev) {
        hover = target(ev);
      },
      dblClick() {
        finish();
      },
      keyDown(e) {
        if (!last) return false;
        if (e.key === 'Enter') {
          if (buf && hover) {
            const len = Number(buf);
            const dir = G.norm(G.sub(hover, last));
            if (len >= 100 && (dir.x || dir.y)) {
              const p = { x: Math.round(last.x + dir.x * len), y: Math.round(last.y + dir.y * len) };
              if (addTo(p)) last = p;
            }
            buf = '';
            ed.draw();
          } else finish();
          return true;
        }
        if (/^[0-9.]$/.test(e.key)) {
          buf += e.key;
          ed.draw();
          return true;
        }
        if (e.key === 'Backspace') {
          if (buf) buf = buf.slice(0, -1);
          else if (history.length > 1) {
            store.undo();
            history.pop();
            last = history[history.length - 1];
          }
          ed.draw();
          return true;
        }
        return false;
      },
      cancel() {
        if (!last) return false;
        finish();
        return true;
      },
      deactivate() {
        start = last = hover = null;
        history = [];
        buf = '';
      },
      draw(ctx, st) {
        if (!hover) return;
        const hs = ed.toScreen(hover);
        ctx.save();
        ctx.strokeStyle = st.theme.c.accent;
        ctx.lineWidth = 1.5;
        if (hover.kind === 'endpoint') {
          ctx.beginPath();
          ctx.arc(hs.x, hs.y, 7, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.moveTo(hs.x - 6, hs.y);
          ctx.lineTo(hs.x + 6, hs.y);
          ctx.moveTo(hs.x, hs.y - 6);
          ctx.lineTo(hs.x, hs.y + 6);
          ctx.stroke();
        }
        if (last) {
          const ls = ed.toScreen(last);
          ctx.setLineDash([7, 4]);
          ctx.lineWidth = Math.max(2, (store.project.settings.intWall || 100) * st.view.scale);
          ctx.globalAlpha = 0.7;
          ctx.beginPath();
          ctx.moveTo(ls.x, ls.y);
          ctx.lineTo(hs.x, hs.y);
          ctx.stroke();
          ctx.restore();
          const len = G.dist(last, hover);
          if (len > 1) {
            const ang = (Math.round(M.angleDeg(last, hover) * 10) / 10 + 360) % 360;
            drawTag(ctx, st, buf ? `${buf} mm` : `${fmtDim(len)}  ${ang.toFixed(ang % 1 ? 1 : 0)}°`, (ls.x + hs.x) / 2, (ls.y + hs.y) / 2 - 16, { colour: st.theme.c.accent });
          }
          return;
        }
        ctx.restore();
      },
    };
    return t;
  })();

  return { room, wall, stairs, deck };
}
