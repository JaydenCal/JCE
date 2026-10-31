// Furniture catalogue: plan symbols (draw2d) and low poly models (build3d) for about 45 items.
// This module must not import three: build3d receives the THREE namespace as an argument.
//
// Item: { id, name, category, w, d, h, draw2d(ctx, w, d), build3d(THREE, { w, d, h }) }
//   w, d, h are default sizes in mm. +y (plan) and +z (3D) are the front of the item.
//   draw2d draws centred on (0,0) in mm; the caller sets transform, strokeStyle, fillStyle and lineWidth.
//   build3d returns a THREE.Group in metres, origin at the item centre on the floor.

import { LIVING, DINING } from './furn/living.js';
import { KITCHEN } from './furn/kitchen.js';
import { BEDROOM } from './furn/bedroom.js';
import { BATHROOM, LAUNDRY } from './furn/wet.js';
import { WORK } from './furn/work.js';

export const CATEGORIES = ['Living', 'Dining', 'Kitchen', 'Bedroom', 'Bathroom', 'Laundry', 'Study', 'Outdoor', 'Garage and shed'];

const ALL = [...LIVING, ...DINING, ...KITCHEN, ...BEDROOM, ...BATHROOM, ...LAUNDRY, ...WORK];

export const FURNITURE = CATEGORIES.flatMap((c) => ALL.filter((f) => f.category === c));

const BY_ID = new Map(FURNITURE.map((f) => [f.id, f]));

export const getFurniture = (id) => BY_ID.get(id) || null;
