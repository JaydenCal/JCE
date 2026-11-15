// File units for a boundary placed by hand (no coordinate system): scale to metres.
export const UNITS = Object.freeze([
  { id: 'm', label: 'Metres', toM: 1 },
  { id: 'mm', label: 'Millimetres', toM: 0.001 },
  { id: 'cm', label: 'Centimetres', toM: 0.01 },
  { id: 'ft', label: 'International feet', toM: 0.3048 },
  { id: 'usft', label: 'US survey feet', toM: 1200 / 3937 },
  { id: 'in', label: 'Inches', toM: 0.0254 },
  { id: 'yd', label: 'Yards', toM: 0.9144 },
  { id: 'km', label: 'Kilometres', toM: 1000 },
]);
export const unitFactor = (id) => (UNITS.find((u) => u.id === id) || UNITS[0]).toM;
