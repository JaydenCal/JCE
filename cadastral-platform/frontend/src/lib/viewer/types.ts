export type Vec3 = [number, number, number];

export interface LayerDef { c: string; n: string; on: boolean }
export interface PartDef {
  n: string; c: string; col: string; a?: number; ro?: number; me?: number;
  /** triangle indices; when absent, `v` is a triangle soup (9 numbers per triangle) */
  f?: number[] | null; v?: number[]; lines?: number[]; vc?: number[]; uv?: number[];
  cs?: boolean | number; tex?: string; eml?: number; ds?: boolean;
}
export interface LabelDef { t: string; p: Vec3; c: string; s?: number }
export interface ViewDef { dir: Vec3; ortho?: boolean; target?: Vec3; dist?: number }

/** Wall / fence collider: oriented box (centre, full size, yaw degrees about Z). */
export interface BoxCollider { c: Vec3; s: Vec3; yaw?: number; kind?: string }
/** Rectangular walkable floor plane at height z (local metres). */
export interface FloorPlane { n?: string; min: [number, number]; max: [number, number]; z: number }
export interface Walkable {
  /** names of parts (terrain TIN / slabs) whose triangles are walkable */
  terrain: string[];
  colliders: BoxCollider[];
  floors: FloorPlane[];
  spawn: { p: Vec3; yaw?: number };
}

export interface PlacedItem {
  id: string; itemId: string;
  /** base-centre of item in local metres */
  p: Vec3; /** degrees about Z */ yaw: number;
  surface?: 'ground' | 'floor' | 'wall'; level?: string; room?: string;
  /** compliance warnings from the server, e.g. 'over DBYD buffer' */
  warnings?: string[];
}

export interface CatalogueItem {
  id: string; title: string; brand?: string; retailer: string; category: string;
  price: number; currency?: string; priceAsAt?: string; url?: string; image?: string; sku?: string;
  /** real dimensions in metres: width (x), depth (y), height (z) */
  dims: { w: number; d: number; h: number };
  model_kind: 'glb' | 'gltf' | 'proxy'; model_url?: string;
  mount?: 'floor' | 'wall';
}

export interface SceneBundle {
  info: { title: string; subtitle?: string; FFL?: number; origin: Vec3; z0?: number };
  layers: LayerDef[]; parts: PartDef[]; labels?: LabelDef[];
  views?: Record<string, ViewDef>; summary?: [string, string][]; notes?: string[];
  walkable?: Walkable; items?: PlacedItem[];
  /** optional embedded catalogue entries (demo / offline) */
  catalogue?: CatalogueItem[];
}

export interface PickInfo { e: number; n: number; rl: number; depth: number | null; part: string }
export interface Settings {
  eyeHeight: number; fov: number; headBob: boolean; sensitivity: number; stepUp: number; slopeDeg: number;
}
export const DEFAULT_SETTINGS: Settings = { eyeHeight: 1.6, fov: 75, headBob: true, sensitivity: 1, stepUp: 0.4, slopeDeg: 45 };
