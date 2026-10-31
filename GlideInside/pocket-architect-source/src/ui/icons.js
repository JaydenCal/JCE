// Line icons drawn for Plan Studio. 24 px grid, 1.6 px stroke, currentColor.

const PATHS = {
  select: '<path d="M6 3.5v15.2l4.2-3.9 3 5.7 2.4-1.2-3-5.6 5.6-.5z"/>',
  room: '<rect x="3.5" y="5" width="17" height="14" rx="0.6"/><path d="M3.5 11.5H10v7.5M14 5v4"/>',
  wall: '<path d="M4.5 17.5l15-11"/><circle cx="4.5" cy="17.5" r="1.7"/><circle cx="19.5" cy="6.5" r="1.7"/>',
  door: '<path d="M3 19.5h18"/><path d="M6 19.5V6.5"/><path d="M6 6.5a13 13 0 0 1 13 13"/>',
  window: '<path d="M3 12h4M17 12h4"/><rect x="7" y="8.5" width="10" height="7"/><path d="M7 12h10"/>',
  furniture: '<path d="M5.5 11V8.2A2.2 2.2 0 0 1 7.7 6h8.6a2.2 2.2 0 0 1 2.2 2.2V11"/><path d="M3.5 12.5a2 2 0 0 1 4 0V15h9v-2.5a2 2 0 0 1 4 0V18h-17z"/><path d="M6 18v1.5M18 18v1.5"/>',
  stairs: '<path d="M3.5 20h5v-4.5h5V11h5V6.5H20.5"/><path d="M5 12.5l3.5-3.5M8.5 9v2.6M8.5 9H6"/>',
  deck: '<rect x="3.5" y="5" width="17" height="14" rx="0.6"/><path d="M8 5v14M12 5v14M16 5v14"/>',
  tank: '<ellipse cx="12" cy="6.5" rx="6.5" ry="2.5"/><path d="M5.5 6.5v11c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-11"/>',
  measure: '<rect x="2.5" y="8.5" width="19" height="7" rx="1"/><path d="M6.5 8.5v3M10.5 8.5v2M14.5 8.5v3M18.5 8.5v2"/>',
  underlay: '<rect x="3.5" y="4.5" width="17" height="15" rx="1"/><circle cx="9" cy="10" r="1.7"/><path d="M4 18l5-5 4 4 3-3 4.5 4.5"/>',
  status: '<path d="M17.5 3.5l3 3-8.5 8.5-3-3z"/><path d="M9 12.5c-3 0-4.2 2-4.2 3.8 0 1.2-.8 2.2-1.8 3 3 .4 6.2-.2 7.2-3.3"/>',
  wheel: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3"/><path d="M12 3.5v5.5M12 15v5.5M3.5 12H9M15 12h5.5"/>',
  undo: '<path d="M9 14L4.5 9.5 9 5"/><path d="M4.5 9.5h9a5.5 5.5 0 0 1 0 11H10"/>',
  redo: '<path d="M15 14l4.5-4.5L15 5"/><path d="M19.5 9.5h-9a5.5 5.5 0 0 0 0 11H14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  new: '<path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z"/><path d="M14 3.5V8h4.5M12 11v6M9 14h6"/>',
  open: '<path d="M3.5 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  save: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  up: '<path d="M6 14.5l6-6 6 6"/>',
  down: '<path d="M6 9.5l6 6 6-6"/>',
  warning: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.2v.1"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  trash: '<path d="M4.5 7h15M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10.5 11v6M13.5 11v6"/>',
  flip: '<path d="M12 3.5v17"/><path d="M8.5 8L3.5 12l5 4zM15.5 8l5 4-5 4z"/>',
  rotate: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5V9H15"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M15.5 15.5L20 20"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  roof: '<path d="M3 12l9-7 9 7"/><path d="M6 10v9h12v-9"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.1"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9" rx="1.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  walk: '<circle cx="13" cy="4.5" r="1.8"/><path d="M10 21l2-6-2-3 1-4 3 2 3 1M12 15l3 2 1 4M11 8L8 11"/>',
  cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12L4 7.5M12 12v9"/>',
  plan: '<rect x="3.5" y="4.5" width="17" height="15" rx="1"/><path d="M3.5 12h7V4.5M14 19.5v-6h6.5"/>',
};

export function icon(name, { size = 24, cls = '' } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (cls) svg.setAttribute('class', cls);
  svg.innerHTML = PATHS[name] || PATHS.info;
  return svg;
}

export const hasIcon = (name) => name in PATHS;
