// Tool definitions shared by the editor, the toolbox and the properties panel.

export const DOOR_FAMILY = ['door', 'sliding_door', 'garage_door', 'roller_door', 'opening'];

export const TOOL_DEFS = [
  { id: 'select', key: 'V', label: 'Select', icon: 'select' },
  { id: 'room', key: 'R', label: 'Room', icon: 'room' },
  { id: 'wall', key: 'W', label: 'Wall', icon: 'wall' },
  { id: 'door', key: 'D', label: 'Door', icon: 'door', family: DOOR_FAMILY },
  { id: 'window', key: 'N', label: 'Window', icon: 'window' },
  { id: 'furniture', key: 'F', label: 'Furniture', icon: 'furniture' },
  { id: 'stairs', key: 'S', label: 'Stairs', icon: 'stairs' },
  { id: 'deck', key: 'K', label: 'Deck or patio', icon: 'deck' },
  { id: 'tank', key: 'T', label: 'Rainwater tank', icon: 'tank' },
  { id: 'measure', key: 'M', label: 'Measure', icon: 'measure' },
  { id: 'underlay', key: 'U', label: 'Underlay', icon: 'underlay' },
  { id: 'status', key: 'X', label: 'Status brush', icon: 'status' },
];

// Rotation keys: comma turns left, full stop turns right, 90 degrees (15 with Shift). Returns degrees or 0.
export function rotationStep(e) {
  const left = e.code === 'Comma' || e.key === ',' || e.key === '<';
  const right = e.code === 'Period' || e.key === '.' || e.key === '>';
  if (!left && !right) return 0;
  return (right ? 1 : -1) * (e.shiftKey ? 15 : 90);
}

export const KEY_TO_TOOL = Object.fromEntries(TOOL_DEFS.map((t) => [t.key.toLowerCase(), t.id]));

// Every tool id the editor understands (the door family has one id per opening kind).
export const ALL_TOOLS = [...new Set([...TOOL_DEFS.map((t) => t.id), ...DOOR_FAMILY])];

export const OPENING_TOOL_KIND = { door: 'door', window: 'window', sliding_door: 'sliding_door', garage_door: 'garage_door', roller_door: 'roller_door', opening: 'opening' };

export const KIND_LABEL = {
  door: 'Door',
  window: 'Window',
  sliding_door: 'Sliding door',
  garage_door: 'Garage door',
  roller_door: 'Roller door',
  opening: 'Plain opening',
};

export const DECK_TYPES = [
  ['deck', 'Deck'],
  ['patio', 'Patio'],
  ['alfresco', 'Alfresco'],
  ['verandah', 'Verandah'],
];

export const STATUS_LABEL = { new: 'New', existing: 'Existing', demolish: 'Demolish' };

export const toolLabel = (id) => TOOL_DEFS.find((t) => t.id === id || t.family?.includes(id))?.label || id;
