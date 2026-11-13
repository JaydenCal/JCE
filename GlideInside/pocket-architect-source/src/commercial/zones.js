// Commercial zone classes. The zone NAME is read first, the code only when the name is missing (NSW 2022 employment zones reform:
// E1 Local Centre, E2 Commercial Centre, E3 Productivity Support, E4 General Industrial, E5 Heavy Industrial; C1 to C4 are the
// environmental zones). Queensland lots carry no looked up zone, so the person chooses the class by hand.

import { classifyZone } from '../site/zone-class.js';

export const ZONE_CLASSES = ['industrial', 'commercial'];
export const ZONE_CLASS_LABEL = { industrial: 'Industrial', commercial: 'Commercial (business)' };

const INDUSTRIAL_NAME = /industr|warehouse/i;
const INDUSTRIAL_CODE = /^(IN\d|E4|E5)$/i;
const COMMERCIAL_CODE = /^(B\d|E1|E2|E3|SP\d)$/i;

/**
 * { cls: 'industrial' | 'commercial' | 'residential' | 'other' | 'unknown', employment, text } for a lot.
 * 'employment' is true for industrial and commercial. The name wins over the code.
 */
export function zoneClass(lot) {
  const code = String(lot?.zoning?.code || '').trim();
  const name = String(lot?.zoning?.name || '').trim();
  const text = [code, name].filter(Boolean).join(' ');
  if (!code && !name) return { cls: 'unknown', employment: false, text: '' };
  const base = classifyZone(code, name);
  if (base === 'residential') return { cls: 'residential', employment: false, text };
  if (base === 'employment' || base === 'mixed') {
    let cls = 'commercial';
    if (name) cls = INDUSTRIAL_NAME.test(name) ? 'industrial' : 'commercial';
    else cls = INDUSTRIAL_CODE.test(code) ? 'industrial' : COMMERCIAL_CODE.test(code) || /^MU1$/i.test(code) ? 'commercial' : 'commercial';
    return { cls, employment: true, text };
  }
  return { cls: 'other', employment: false, text };
}

/** The class used for rules: the person's choice when set, else the looked up zone, else null (not known). */
export function effectiveClass(project) {
  const chosen = project?.commercial?.zoneClass;
  if (ZONE_CLASSES.includes(chosen)) return chosen;
  const z = zoneClass(project?.site?.lot);
  return z.employment ? z.cls : null;
}

export const RESIDENTIAL_NOTE = 'This zone may not permit commercial use, check with council';
