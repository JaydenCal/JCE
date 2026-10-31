// Plan Studio catalogue: furniture, finishes, opening presets, tanks and design templates.
//
//   catalogue.FURNITURE, CATEGORIES, getFurniture(id)
//   catalogue.finishes   { MATERIALS, COLOURS, getMaterial, getColour, materialsFor, coloursFor, findColour, validateFinish }
//   catalogue.validateFinish(target, material, colour)   throws Error with a short helpful message
//   catalogue.openings   { OPENING_PRESETS, presetsFor(kind) }
//   catalogue.tanks      { TANKS }
//   catalogue.templates  the TEMPLATES array, each { id, name, type, description, levels, create() }
//   catalogue.createFromTemplate(id)   returns a new project

import { catalogue } from './core.js';
import { TEMPLATES, createFromTemplate } from './templates.js';

catalogue.templates = TEMPLATES;
catalogue.createFromTemplate = createFromTemplate;

export { catalogue };
export default catalogue;
