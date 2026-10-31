// Design templates. Each create() builds a fresh project through the operations registry only.

import { createProject } from '../model/schema.js';
import { shedWorkshop, shedFarm } from './tpl/sheds.js';
import { grannyFlat } from './tpl/granny.js';
import { houseSingle } from './tpl/house1.js';
import { houseDouble } from './tpl/house2.js';
import { duplex } from './tpl/duplex.js';
import { extensionStarter } from './tpl/extension.js';

export const TEMPLATES = [
  {
    id: 'blank',
    name: 'Blank house',
    type: 'house',
    description: 'An empty single storey design to start from scratch.',
    levels: 1,
    create: () => createProject({ name: 'Blank house', type: 'house' }),
  },
  {
    id: 'shed_workshop',
    name: 'Shed: garage and workshop',
    type: 'shed',
    description: 'A 9 x 7 m steel shed with two roller doors, a workbench, shelving and room for a car.',
    levels: 1,
    create: shedWorkshop,
  },
  {
    id: 'shed_farm',
    name: 'Farm machinery shed',
    type: 'shed',
    description: 'A 15 x 9 m machinery shed with three 3.6 m roller doors, 4.2 m walls and a 22,500 L tank.',
    levels: 1,
    create: shedFarm,
  },
  {
    id: 'granny_flat',
    name: 'Granny flat, 2 bedroom',
    type: 'unit',
    description: 'About 60 m2: open kitchen, dining and living, two bedrooms with robes, bathroom, laundry and a 2.4 m deep front deck.',
    levels: 1,
    create: grannyFlat,
  },
  {
    id: 'house_single',
    name: 'Single storey, 4 bedroom',
    type: 'house',
    description: 'About 200 m2 plus a double garage: lounge, open plan kitchen, dining and family to a roofed alfresco, master with walk-in robe and ensuite, three more bedrooms, bathroom, WC and laundry.',
    levels: 1,
    create: houseSingle,
  },
  {
    id: 'house_double',
    name: 'Double storey, 4 bedroom',
    type: 'house',
    description: 'Ground floor with garage, entry, living, study, open plan kitchen, dining and family and a guest bedroom. First floor with master suite, three bedrooms, bathroom and rumpus around the stair void.',
    levels: 2,
    create: houseDouble,
  },
  {
    id: 'duplex',
    name: 'Duplex, two 3 bedroom units',
    type: 'unit',
    description: 'Two mirror image attached units sharing a party wall. Each has a single garage, open living to a courtyard patio, three bedrooms, bathroom, ensuite and laundry.',
    levels: 1,
    create: duplex,
  },
  {
    id: 'extension_starter',
    name: 'Extension: rear family room',
    type: 'extension',
    description: 'An existing 3 bedroom house (marked existing) with a new rear family room and deck. One section of the existing rear wall is marked for demolition where the house opens into the new room.',
    levels: 1,
    create: extensionStarter,
  },
];

export function createFromTemplate(id) {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown template ${id}`);
  return t.create();
}
