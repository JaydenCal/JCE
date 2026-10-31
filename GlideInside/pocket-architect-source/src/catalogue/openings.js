// Opening presets (docs/SCOPE.md Appendix C). Sizes in mm.
// Each preset: { id, kind, name, width, height, sill, style }. `kind` is one of schema OPENING_KINDS.

const p = (id, kind, name, width, height, sill, style) => ({ id, kind, name, width, height, sill, style });

export const OPENING_PRESETS = [
  // Windows (sill = height of the bottom of the glass above the floor).
  p('window_sliding_1800', 'window', 'Sliding window 1800 x 1200', 1800, 1200, 900, 'sliding'),
  p('window_sliding_1200', 'window', 'Sliding window 1200 x 1200', 1200, 1200, 900, 'sliding'),
  p('window_sliding_2400', 'window', 'Sliding window 2400 x 1200', 2400, 1200, 900, 'sliding'),
  p('window_awning_600', 'window', 'Awning window 600 x 600', 600, 600, 1500, 'awning'),
  p('window_awning_1200', 'window', 'Awning window 1200 x 600', 1200, 600, 1500, 'awning'),
  p('window_kitchen_1800', 'window', 'Sliding window, high sill 1800 x 900', 1800, 900, 1200, 'sliding'),
  p('window_fixed_900', 'window', 'Fixed full height panel 900 x 2100', 900, 2100, 0, 'fixed'),
  p('window_double_hung_900', 'window', 'Double hung window 900 x 1500', 900, 1500, 600, 'double_hung'),
  p('window_louvre_600', 'window', 'Louvre window 600 x 1200', 600, 1200, 900, 'louvre'),
  // Hinged and cavity doors.
  p('door_internal', 'door', 'Internal door 820 x 2040', 820, 2040, 0, 'hinged'),
  p('door_entry', 'door', 'Entry door 870 x 2040', 870, 2040, 0, 'hinged'),
  p('door_wide', 'door', 'Wide door 920 x 2040', 920, 2040, 0, 'hinged'),
  p('door_cavity', 'door', 'Cavity slider 820 x 2040', 820, 2040, 0, 'cavity'),
  p('door_personal_access', 'door', 'Personal access door 820 x 2040', 820, 2040, 0, 'hinged'),
  // Sliding glass doors.
  p('sliding_door_2100', 'sliding_door', 'Sliding door 2100 x 2100', 2100, 2100, 0, 'sliding'),
  p('sliding_door_2400', 'sliding_door', 'Sliding door 2400 x 2100', 2400, 2100, 0, 'sliding'),
  p('sliding_door_3000', 'sliding_door', 'Sliding door 3000 x 2100', 3000, 2100, 0, 'sliding'),
  // Garage panel doors.
  p('garage_door_2400', 'garage_door', 'Garage panel door 2400 x 2100', 2400, 2100, 0, 'panel'),
  p('garage_door_4800', 'garage_door', 'Garage panel door 4800 x 2100', 4800, 2100, 0, 'panel'),
  // Roller doors for sheds.
  p('roller_door_2700', 'roller_door', 'Roller door 2700 x 2400', 2700, 2400, 0, 'roller'),
  p('roller_door_3000', 'roller_door', 'Roller door 3000 x 3000', 3000, 3000, 0, 'roller'),
  p('roller_door_3600', 'roller_door', 'Roller door 3600 x 4000', 3600, 4000, 0, 'roller'),
  // Plain openings (no leaf).
  p('opening_900', 'opening', 'Plain opening 900 x 2040', 900, 2040, 0, 'none'),
  p('opening_1800', 'opening', 'Wide plain opening 1800 x 2040', 1800, 2040, 0, 'none'),
];

export function presetsFor(kind) {
  return OPENING_PRESETS.filter((x) => x.kind === kind);
}

export const getPreset = (id) => OPENING_PRESETS.find((x) => x.id === id) || null;
