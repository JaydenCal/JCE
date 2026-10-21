"""GLB (binary glTF 2.0) of the whole site model: the terrain and the other parts of the scene bundle, the aerial image when asked for, every site design object and the
buildings (a stored Plan Studio GLB of a building is merged in where one is present).

Axes: glTF is Y up, so a local point (E, N, U) (metres from the bundle origin) is written (E, U, -N). The scene node ``extras`` carry the MGA origin, the EPSG code and the status
labels, so the file can be put back in MGA. Node names: a site design object is a node NAMED BY ITS OBJECT ID with ``extras.kind`` set to its type; bundle parts are named by the
part name under the group nodes SITE_TERRAIN, SITE_CONTEXT and SITE_AERIAL.

The export is for review and coordination: it is INDICATIVE ONLY (see ``ExportContext.status_lines``). A dimension the object does not have is not drawn: the object is a marker
or an outline and its extras say which input is NOT SET.
"""
from __future__ import annotations

import base64
import json
import math
import re
import struct
from typing import Any

import numpy as np

from app.design.site_design import SiteObject

from . import meshes as M
from .common import ExportContext, ExportTimeout, check_deadline

#: display conventions (not requirements): a small lift so a draped surface does not fight the terrain, a marker size for an object with no dimensions, a minimum drawn width of a line
LIFT_M = 0.03
MARKER_M = 0.4
MIN_LINE_WIDTH_M = 0.15
MAX_GLB_BYTES = 120 * 1024 * 1024
JSON_CHUNK, BIN_CHUNK = 0x4E4F534A, 0x004E4942
#: sanity caps of a stored building GLB (not engineering values): they keep one upload from making the export build unbounded work
MAX_ACCESSOR_COUNT = 2_000_000
MAX_NODES = 20_000
MAX_MESHES = 10_000
MAX_PRIMITIVES = 50_000
MAX_ITEMS = 50_000                  # accessors, buffer views, materials, textures, images and samplers, each
JSON_BYTES_PER_ITEM = 160           # a rough size of the JSON of one accessor, view, node or mesh, for the running total

COLOURS = {
    "tree": "#3f7d3a", "rwt": "#2f6fa3", "stormwater_pit": "#555b61", "osd": "#2a5d8a", "osd_basin": "#3a76a8", "retaining_wall": "#8a7f72", "infiltration_trench": "#9a8a62",
    "stormwater_pipe": "#2b6cb0", "service_trace": "#c05621", "landscape_area": "#7aa35a", "grading_area": "#c2b280", "building": "#d8d3c4", "pool": "#4fa3c7", "footpath": "#b9b7b0",
    "furniture": "#8a6f4d", "driveway": "#8d8f8e", "pool_barrier": "#6b7280", "overflow_route": "#3182ce", "sewer_drain": "#9b2c2c", "service_node": "#d69e2e", "water_service": "#2b6cb0",
    "discharge_point": "#e53e3e",
}
SERVICE_COLOURS = {"water": "#2b6cb0", "sewer": "#9b2c2c", "stormwater": "#2c7a7b", "gas": "#d69e2e", "electricity": "#e53e3e", "telecommunications": "#805ad5", "other": "#718096"}


class GlbMergeError(Exception):
    pass


class GlbTooLarge(ValueError):
    """The GLB being built would pass the export limit. Raised BEFORE the bytes that would pass it are added; the API answers 413."""


def _rgba(hex_: str, a: float = 1.0) -> list[float]:
    h = hex_.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    srgb = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]       # glTF base colours are linear
    return [round(v, 5) for v in lin] + [a]


class Glb:
    """A tiny glTF writer: one buffer, accessors with min and max, deduplicated materials."""

    def __init__(self, max_bytes: int = MAX_GLB_BYTES, deadline: float | None = None) -> None:
        self.max_bytes = max_bytes
        self.deadline = deadline
        self._items = 0
        self.bin = bytearray()
        self.views: list[dict[str, Any]] = []
        self.accessors: list[dict[str, Any]] = []
        self.meshes: list[dict[str, Any]] = []
        self.materials: list[dict[str, Any]] = []
        self.nodes: list[dict[str, Any]] = []
        self.images: list[dict[str, Any]] = []
        self.textures: list[dict[str, Any]] = []
        self.samplers: list[dict[str, Any]] = []
        self._mat: dict[str, int] = {}

    # ---- the running total
    def charge(self, bin_bytes: int, items: int = 1) -> None:
        """Refuse (``GlbTooLarge``) before ``bin_bytes`` more of binary data and ``items`` more JSON elements would take the file past the limit. Also the time check of a build."""
        check_deadline(self.deadline)
        est = 12 + 8 + 8 + ((len(self.bin) + 3) & ~3) + bin_bytes + 3 + JSON_BYTES_PER_ITEM * (self._items + items)
        if est > self.max_bytes:
            raise GlbTooLarge("THE GLB WOULD BE LARGER THAN THE EXPORT LIMIT")
        self._items += items

    # ---- buffers
    def view(self, data: bytes, target: int | None = None) -> int:
        self.charge(len(data))
        while len(self.bin) % 4:
            self.bin.append(0)
        v: dict[str, Any] = {"buffer": 0, "byteOffset": len(self.bin), "byteLength": len(data)}
        if target:
            v["target"] = target
        self.bin += data
        self.views.append(v)
        return len(self.views) - 1

    def accessor(self, arr: np.ndarray, kind: str, comp: int, target: int | None) -> int:
        self.charge(int(arr.nbytes), 0)                    # before tobytes() copies the array
        bv = self.view(arr.tobytes(), target)
        a: dict[str, Any] = {"bufferView": bv, "componentType": comp, "count": int(arr.shape[0]), "type": kind}
        if kind in ("VEC3", "VEC2") and arr.dtype == np.float32 and arr.shape[0]:
            a["min"] = [float(x) for x in arr.min(axis=0)]
            a["max"] = [float(x) for x in arr.max(axis=0)]
        self.accessors.append(a)
        return len(self.accessors) - 1

    def material(self, colour: str, alpha: float = 1.0, name: str = "", texture: int | None = None, unlit: bool = False) -> int:
        key = f"{colour}|{alpha:.2f}|{texture}|{unlit}"
        if key in self._mat:
            return self._mat[key]
        pbr: dict[str, Any] = {"baseColorFactor": _rgba(colour, alpha), "metallicFactor": 0.0, "roughnessFactor": 0.9}
        if texture is not None:
            pbr["baseColorTexture"] = {"index": texture}
            pbr["baseColorFactor"] = [1.0, 1.0, 1.0, alpha]
        m: dict[str, Any] = {"name": name or colour, "pbrMetallicRoughness": pbr, "doubleSided": True}
        if alpha < 1.0:
            m["alphaMode"] = "BLEND"
        self.materials.append(m)
        self._mat[key] = len(self.materials) - 1
        return self._mat[key]

    def texture_from_jpeg(self, data: bytes, mime: str = "image/jpeg") -> int:
        bv = self.view(data)
        self.images.append({"bufferView": bv, "mimeType": mime})
        if not self.samplers:
            self.samplers.append({"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071})
        self.textures.append({"source": len(self.images) - 1, "sampler": 0})
        return len(self.textures) - 1

    # ---- geometry (points are (E, N, U) local metres)
    def primitive(self, pts: list[M.Vec], idx: list[int] | None, material: int, mode: int = 4, uv: list[tuple[float, float]] | None = None) -> dict[str, Any] | None:
        if not pts or (mode == 4 and (not idx or len(idx) < 3)):
            return None
        p = np.asarray(pts, dtype=np.float32).reshape(-1, 3)
        gp = np.stack([p[:, 0], p[:, 2], -p[:, 1]], axis=1).astype(np.float32)
        prim: dict[str, Any] = {"attributes": {"POSITION": self.accessor(gp, "VEC3", 5126, 34962)}, "material": material, "mode": mode}
        if uv is not None and len(uv) == len(pts):
            t = np.asarray(uv, dtype=np.float32).reshape(-1, 2)
            t[:, 1] = 1.0 - t[:, 1]                                   # three.js uv origin is the bottom left of the image, glTF is the top left
            prim["attributes"]["TEXCOORD_0"] = self.accessor(np.ascontiguousarray(t), "VEC2", 5126, 34962)
        if idx is not None:
            ia = np.asarray(idx, dtype=np.uint32)
            prim["indices"] = self.accessor(ia, "SCALAR", 5125, 34963)
        return prim

    def mesh(self, name: str, prims: list[dict[str, Any]]) -> int | None:
        prims = [p for p in prims if p]
        if not prims:
            return None
        self.meshes.append({"name": name, "primitives": prims})
        return len(self.meshes) - 1

    def node(self, name: str, mesh: int | None = None, children: list[int] | None = None, extras: dict[str, Any] | None = None, matrix: list[float] | None = None) -> int:
        n: dict[str, Any] = {"name": name}
        if mesh is not None:
            n["mesh"] = mesh
        if children:
            n["children"] = children
        if extras:
            n["extras"] = extras
        if matrix:
            n["matrix"] = matrix
        self.nodes.append(n)
        return len(self.nodes) - 1

    # ---- merge another GLB (a stored building GLB)
    def merge(self, data: bytes, matrix: np.ndarray, name: str, extras: dict[str, Any]) -> int:
        """Merge a stored building GLB under a new node. The GLB is validated first (``validate_gltf``) and merged into scratch lists; this file is changed ONLY when the whole merge worked,
        so a bad building leaves it as it was. Raises ``GlbMergeError`` for a GLB that cannot be merged and ``GlbTooLarge`` when the merged file would pass the limit."""
        j, binc = parse_glb(data)
        validate_gltf(j, binc)
        if j.get("extensionsRequired"):
            raise GlbMergeError("THE BUILDING GLB NEEDS EXTENSIONS THIS EXPORT DOES NOT MERGE: " + ", ".join(map(str, j["extensionsRequired"])))
        if j.get("skins") or any("sparse" in a for a in j.get("accessors", [])):
            raise GlbMergeError("THE BUILDING GLB USES SKINS OR SPARSE ACCESSORS, WHICH THIS EXPORT DOES NOT MERGE")
        if any(b.get("uri") for b in j.get("buffers", [])):
            raise GlbMergeError("THE BUILDING GLB REFERENCES AN EXTERNAL BUFFER")
        n_items = sum(len(j.get(k, [])) for k in ("bufferViews", "accessors", "meshes", "materials", "nodes", "images", "textures", "samplers")) + 1
        self.charge(len(binc) + 3, n_items)                             # refuse before anything is copied
        base = (len(self.bin) + 3) & ~3
        bv0, ac0, ms0, mt0, nd0, im0, tx0, sp0 = (len(self.views), len(self.accessors), len(self.meshes), len(self.materials), len(self.nodes), len(self.images), len(self.textures),
                                                  len(self.samplers))
        views: list[dict[str, Any]] = []
        accessors: list[dict[str, Any]] = []
        samplers: list[dict[str, Any]] = []
        images: list[dict[str, Any]] = []
        textures: list[dict[str, Any]] = []
        materials: list[dict[str, Any]] = []
        meshes: list[dict[str, Any]] = []
        nodes: list[dict[str, Any]] = []
        for v in j.get("bufferViews", []):
            w = {k: v[k] for k in ("byteLength", "byteStride", "target") if k in v}
            w["buffer"], w["byteOffset"] = 0, base + int(v.get("byteOffset", 0))
            views.append(w)
        for a in j.get("accessors", []):
            w = {k: a[k] for k in ("componentType", "count", "type", "min", "max", "normalized") if k in a}
            if "bufferView" in a:
                w["bufferView"] = a["bufferView"] + bv0
                w["byteOffset"] = a.get("byteOffset", 0)
            accessors.append(w)
        samplers += [{k: s_[k] for k in ("magFilter", "minFilter", "wrapS", "wrapT") if k in s_} for s_ in j.get("samplers", [])]
        for im in j.get("images", []):
            if "bufferView" not in im:
                raise GlbMergeError("THE BUILDING GLB HAS AN IMAGE THAT IS NOT EMBEDDED")
            images.append({"bufferView": im["bufferView"] + bv0, "mimeType": im.get("mimeType", "image/png")})
        for t in j.get("textures", []):
            w = {"source": t.get("source", 0) + im0}
            if "sampler" in t:
                w["sampler"] = t["sampler"] + sp0
            textures.append(w)
        for m in j.get("materials", []):
            w = {k: v for k, v in m.items() if k in MATERIAL_KEYS}
            for key in ("normalTexture", "occlusionTexture", "emissiveTexture"):
                if key in w:
                    w[key] = {k: (v + tx0 if k == "index" else v) for k, v in w[key].items() if k in ("index", "texCoord", "scale", "strength")}
            pbr = w.get("pbrMetallicRoughness")
            if pbr:
                pbr = {k: v for k, v in pbr.items() if k in PBR_KEYS}
                for key in ("baseColorTexture", "metallicRoughnessTexture"):
                    if key in pbr:
                        pbr[key] = {k: (v + tx0 if k == "index" else v) for k, v in pbr[key].items() if k in ("index", "texCoord")}
                w["pbrMetallicRoughness"] = pbr
            materials.append(w)
        for m in j.get("meshes", []):
            prims = []
            for p in m.get("primitives", []):
                q = {k: v for k, v in p.items() if k in ("mode",)}
                q["attributes"] = {k: v + ac0 for k, v in p.get("attributes", {}).items()}
                if "indices" in p:
                    q["indices"] = p["indices"] + ac0
                if "material" in p:
                    q["material"] = p["material"] + mt0
                prims.append(q)
            meshes.append({"name": m.get("name", ""), "primitives": prims})
        for n in j.get("nodes", []):
            w = {k: n[k] for k in ("name", "matrix", "translation", "rotation", "scale") if k in n}
            if "mesh" in n:
                w["mesh"] = n["mesh"] + ms0
            if n.get("children"):
                w["children"] = [c + nd0 for c in n["children"]]
            nodes.append(w)
        scenes = j.get("scenes") or [{"nodes": list(range(len(j.get("nodes", []))))}]
        roots = [r + nd0 for r in scenes[j.get("scene", 0)].get("nodes", [])]
        wrapper: dict[str, Any] = {"name": name}
        if roots:
            wrapper["children"] = roots
        if extras:
            wrapper["extras"] = extras
        wrapper["matrix"] = [float(x) for x in matrix.T.reshape(-1)]
        # commit: nothing above can fail past this point
        while len(self.bin) % 4:
            self.bin.append(0)
        self.bin += binc
        self.views += views
        self.accessors += accessors
        self.samplers += samplers
        self.images += images
        self.textures += textures
        self.materials += materials
        self.meshes += meshes
        self.nodes += nodes
        self.nodes.append(wrapper)
        return len(self.nodes) - 1

    # ---- file
    def to_bytes(self, roots: list[int], extras: dict[str, Any]) -> bytes:
        doc: dict[str, Any] = {"asset": {"version": "2.0", "generator": "JCESITE site export", "extras": extras}, "scene": 0, "scenes": [{"name": "SITE", "nodes": roots}], "nodes": self.nodes}
        for k, v in (("meshes", self.meshes), ("materials", self.materials), ("accessors", self.accessors), ("bufferViews", self.views), ("images", self.images),
                     ("textures", self.textures), ("samplers", self.samplers)):
            if v:
                doc[k] = v
        while len(self.bin) % 4:
            self.bin.append(0)
        doc["buffers"] = [{"byteLength": len(self.bin)}]
        js = json.dumps(doc, separators=(",", ":"), ensure_ascii=True).encode("ascii")
        js += b" " * ((4 - len(js) % 4) % 4)
        total = 12 + 8 + len(js) + 8 + len(self.bin)
        if total > self.max_bytes:
            raise GlbTooLarge("THE GLB WOULD BE LARGER THAN THE EXPORT LIMIT")
        return b"glTF" + struct.pack("<II", 2, total) + struct.pack("<II", len(js), JSON_CHUNK) + js + struct.pack("<II", len(self.bin), BIN_CHUNK) + bytes(self.bin)


MATERIAL_KEYS = ("name", "pbrMetallicRoughness", "normalTexture", "occlusionTexture", "emissiveTexture", "emissiveFactor", "alphaMode", "alphaCutoff", "doubleSided")
PBR_KEYS = ("baseColorFactor", "baseColorTexture", "metallicFactor", "roughnessFactor", "metallicRoughnessTexture")
_COMP_BYTES = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
_TYPE_COMPS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT2": 4, "MAT3": 9, "MAT4": 16}


def parse_glb(data: bytes) -> tuple[dict[str, Any], bytes]:
    """The JSON chunk and the BIN chunk of a GLB. Raises ``GlbMergeError`` when it is not a version 2 GLB or its chunks do not fit the file."""
    if len(data) < 20 or data[:4] != b"glTF":
        raise GlbMergeError("NOT A GLB FILE")
    ver, length = struct.unpack_from("<II", data, 4)
    if ver != 2 or length > len(data):
        raise GlbMergeError("NOT A VERSION 2 GLB FILE, OR TRUNCATED")
    pos, js, binc = 12, None, b""
    while pos + 8 <= length:
        n, t = struct.unpack_from("<II", data, pos)
        if pos + 8 + n > length:
            raise GlbMergeError("A CHUNK OF THE GLB RUNS PAST THE END OF THE FILE")
        body = data[pos + 8:pos + 8 + n]
        if t == JSON_CHUNK and js is None:
            try:
                js = json.loads(body.decode("utf-8"))
            except (ValueError, RecursionError):
                raise GlbMergeError("THE JSON CHUNK OF THE GLB IS NOT VALID JSON") from None
        elif t == BIN_CHUNK and not binc:
            binc = bytes(body)
        pos = (pos + 8 + n + 3) & ~3
    if js is None:
        raise GlbMergeError("THE GLB HAS NO JSON CHUNK")
    if not isinstance(js, dict):
        raise GlbMergeError("THE JSON CHUNK OF THE GLB IS NOT AN OBJECT")
    return js, binc


def _int(v: Any, lo: int = 0, hi: int | None = None) -> bool:
    return isinstance(v, int) and not isinstance(v, bool) and v >= lo and (hi is None or v <= hi)


def _index(v: Any, n: int, what: str) -> int:
    if not _int(v, 0, n - 1):
        raise GlbMergeError(f"THE BUILDING GLB HAS AN INDEX THAT IS NOT AN INTEGER IN RANGE ({what})")
    return v


def _numbers(v: Any, n: int | None, what: str) -> None:
    if not isinstance(v, list) or (n is not None and len(v) != n) or len(v) > 16 or any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) for x in v):
        raise GlbMergeError(f"THE BUILDING GLB HAS A BAD NUMBER LIST ({what})")


def _listed(j: dict[str, Any], key: str, cap: int) -> list[dict[str, Any]]:
    v = j.get(key, [])
    if not isinstance(v, list) or any(not isinstance(x, dict) for x in v):
        raise GlbMergeError(f"THE BUILDING GLB HAS A {key} ENTRY THAT IS NOT AN OBJECT")
    if len(v) > cap:
        raise GlbMergeError(f"THE BUILDING GLB HAS TOO MANY {key} ({len(v)}, AT MOST {cap})")
    return v


def validate_gltf(j: Any, binc: bytes, max_count: int = MAX_ACCESSOR_COUNT) -> None:
    """Check a glTF JSON against its BIN chunk before it is stored or merged. Raises ``GlbMergeError``. Every index is an integer in range, every buffer view and every accessor lies inside
    the BIN chunk, an accessor has at most ``max_count`` elements, and the numbers of nodes, meshes and other arrays are capped. The export never reads past ``binc``."""
    if not isinstance(j, dict):
        raise GlbMergeError("THE GLB JSON IS NOT AN OBJECT")
    views, accs = _listed(j, "bufferViews", MAX_ITEMS), _listed(j, "accessors", MAX_ITEMS)
    meshes, nodes = _listed(j, "meshes", MAX_MESHES), _listed(j, "nodes", MAX_NODES)
    mats, texs = _listed(j, "materials", MAX_ITEMS), _listed(j, "textures", MAX_ITEMS)
    imgs, smps = _listed(j, "images", MAX_ITEMS), _listed(j, "samplers", MAX_ITEMS)
    _listed(j, "buffers", 8)
    scenes = _listed(j, "scenes", 64)
    if not isinstance(j.get("extensionsRequired", []), list):
        raise GlbMergeError("THE GLB extensionsRequired IS NOT A LIST")
    for b in j.get("buffers", []):
        if not _int(b.get("byteLength"), 0) or b.get("uri") is not None and not isinstance(b.get("uri"), str):
            raise GlbMergeError("THE BUILDING GLB HAS A BAD BUFFER")
    for v in views:
        if not _int(v.get("buffer", 0), 0, 0):
            raise GlbMergeError("THE BUILDING GLB USES A BUFFER OTHER THAN THE BIN CHUNK")
        off, ln = v.get("byteOffset", 0), v.get("byteLength")
        if not _int(off) or not _int(ln, 1) or off + ln > len(binc):
            raise GlbMergeError("A BUFFER VIEW OF THE BUILDING GLB LIES OUTSIDE THE BIN CHUNK")
        if "byteStride" in v and not _int(v["byteStride"], 4, 252):
            raise GlbMergeError("A BUFFER VIEW OF THE BUILDING GLB HAS A BAD STRIDE")
        if "target" in v and not _int(v["target"]):
            raise GlbMergeError("A BUFFER VIEW OF THE BUILDING GLB HAS A BAD TARGET")
    for a in accs:
        ct, ty = a.get("componentType"), a.get("type")
        if ct not in _COMP_BYTES or isinstance(ct, bool) or ty not in _TYPE_COMPS:
            raise GlbMergeError("AN ACCESSOR OF THE BUILDING GLB HAS A BAD COMPONENT TYPE OR TYPE")
        cnt = a.get("count")
        if not _int(cnt, 1, max_count):
            raise GlbMergeError(f"AN ACCESSOR OF THE BUILDING GLB HAS A COUNT OUTSIDE 1 TO {max_count}")
        if not _int(a.get("byteOffset", 0)):
            raise GlbMergeError("AN ACCESSOR OF THE BUILDING GLB HAS A BAD BYTE OFFSET")
        if "bufferView" in a:
            v = views[_index(a["bufferView"], len(views), "accessor bufferView")]
            elem = _COMP_BYTES[ct] * _TYPE_COMPS[ty]
            stride = v.get("byteStride") or elem
            if a.get("byteOffset", 0) + stride * (cnt - 1) + elem > v["byteLength"]:
                raise GlbMergeError("AN ACCESSOR OF THE BUILDING GLB RUNS PAST ITS BUFFER VIEW")
        for k in ("min", "max"):
            if k in a:
                _numbers(a[k], None, "accessor " + k)
        if "normalized" in a and not isinstance(a["normalized"], bool):
            raise GlbMergeError("AN ACCESSOR OF THE BUILDING GLB HAS A BAD normalized FLAG")
    for im in imgs:
        if "bufferView" in im:
            _index(im["bufferView"], len(views), "image bufferView")
        if "mimeType" in im and im["mimeType"] not in ("image/png", "image/jpeg"):
            raise GlbMergeError("AN IMAGE OF THE BUILDING GLB IS NOT A PNG OR A JPEG")
    for s_ in smps:
        if any(k in s_ and not _int(s_[k]) for k in ("magFilter", "minFilter", "wrapS", "wrapT")):
            raise GlbMergeError("A SAMPLER OF THE BUILDING GLB HAS A BAD VALUE")
    for t in texs:
        _index(t.get("source"), len(imgs), "texture source")
        if "sampler" in t:
            _index(t["sampler"], len(smps), "texture sampler")

    def tex_ref(r: Any, what: str) -> None:
        if not isinstance(r, dict):
            raise GlbMergeError(f"THE BUILDING GLB HAS A TEXTURE REFERENCE THAT IS NOT AN OBJECT ({what})")
        _index(r.get("index"), len(texs), what)
        if "texCoord" in r and not _int(r["texCoord"], 0, 8):
            raise GlbMergeError(f"THE BUILDING GLB HAS A BAD texCoord ({what})")
        for k in ("scale", "strength"):
            if k in r:
                _numbers([r[k]], 1, what + " " + k)

    for m in mats:
        if "name" in m and not isinstance(m["name"], str):
            raise GlbMergeError("A MATERIAL NAME IS NOT TEXT")
        for key in ("normalTexture", "occlusionTexture", "emissiveTexture"):
            if key in m:
                tex_ref(m[key], key)
        if "emissiveFactor" in m:
            _numbers(m["emissiveFactor"], 3, "emissiveFactor")
        if "alphaMode" in m and m["alphaMode"] not in ("OPAQUE", "MASK", "BLEND"):
            raise GlbMergeError("A MATERIAL HAS A BAD alphaMode")
        if "alphaCutoff" in m:
            _numbers([m["alphaCutoff"]], 1, "alphaCutoff")
        if "doubleSided" in m and not isinstance(m["doubleSided"], bool):
            raise GlbMergeError("A MATERIAL HAS A BAD doubleSided FLAG")
        pbr = m.get("pbrMetallicRoughness")
        if pbr is not None:
            if not isinstance(pbr, dict):
                raise GlbMergeError("A MATERIAL HAS A pbrMetallicRoughness THAT IS NOT AN OBJECT")
            for key in ("baseColorTexture", "metallicRoughnessTexture"):
                if key in pbr:
                    tex_ref(pbr[key], key)
            if "baseColorFactor" in pbr:
                _numbers(pbr["baseColorFactor"], 4, "baseColorFactor")
            for key in ("metallicFactor", "roughnessFactor"):
                if key in pbr:
                    _numbers([pbr[key]], 1, key)
    prims_total = 0
    for m in meshes:
        ps = m.get("primitives", [])
        if not isinstance(ps, list) or any(not isinstance(p, dict) for p in ps):
            raise GlbMergeError("A MESH OF THE BUILDING GLB HAS PRIMITIVES THAT ARE NOT OBJECTS")
        prims_total += len(ps)
        if prims_total > MAX_PRIMITIVES:
            raise GlbMergeError("THE BUILDING GLB HAS TOO MANY PRIMITIVES")
        if "name" in m and not isinstance(m["name"], str):
            raise GlbMergeError("A MESH NAME IS NOT TEXT")
        for p in ps:
            at = p.get("attributes", {})
            if not isinstance(at, dict) or len(at) > 32:
                raise GlbMergeError("A PRIMITIVE HAS BAD ATTRIBUTES")
            for k, v in at.items():
                _index(v, len(accs), "attribute " + str(k)[:20])
            if "indices" in p:
                _index(p["indices"], len(accs), "indices")
            if "material" in p:
                _index(p["material"], len(mats), "material")
            if "mode" in p and not _int(p["mode"], 0, 6):
                raise GlbMergeError("A PRIMITIVE HAS A BAD MODE")
    for n in nodes:
        if "mesh" in n:
            _index(n["mesh"], len(meshes), "node mesh")
        ch = n.get("children", [])
        if not isinstance(ch, list) or len(ch) > len(nodes):
            raise GlbMergeError("A NODE HAS BAD CHILDREN")
        for c in ch:
            _index(c, len(nodes), "node child")
        if "name" in n and not isinstance(n["name"], str):
            raise GlbMergeError("A NODE NAME IS NOT TEXT")
        for key, size in (("matrix", 16), ("translation", 3), ("rotation", 4), ("scale", 3)):
            if key in n:
                _numbers(n[key], size, "node " + key)
    # the node graph is a forest: no node is its own ancestor and none has two parents
    parent: dict[int, int] = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", []):
            if c in parent or c == i:
                raise GlbMergeError("THE NODE GRAPH OF THE BUILDING GLB HAS A NODE WITH TWO PARENTS OR A NODE THAT IS ITS OWN CHILD")
            parent[c] = i
    for i in range(len(nodes)):
        seen, k = 0, i
        while k in parent:
            k = parent[k]
            seen += 1
            if seen > len(nodes):
                raise GlbMergeError("THE NODE GRAPH OF THE BUILDING GLB HAS A CYCLE")
    if "scene" in j:
        _index(j["scene"], len(scenes) or 1, "scene")                 # with no scenes the merge takes every node as a root, which is scene 0
    for sc in scenes:
        ns = sc.get("nodes", [])
        if not isinstance(ns, list) or len(ns) > len(nodes):
            raise GlbMergeError("A SCENE HAS BAD NODES")
        for r in ns:
            _index(r, len(nodes), "scene node")


# ---------------------------------------------------------------------------------------------------- terrain sampling
class Sampler:
    """Terrain levels for draping. A level is never invented: where the terrain does not reach, the mean level of the known terrain is used for drawing and the object is flagged."""

    def __init__(self, ctx: ExportContext, terrain: Any) -> None:
        self.terrain = terrain
        self.known = False
        self.fallback = 0.0
        if terrain is not None:
            try:
                z = terrain.surface.vertices[:, 2]
                self.fallback = float(np.mean(z))
                self.known = True
            except Exception:  # noqa: BLE001
                self.terrain = None
        self.flags: set[str] = set()

    def z(self, x: float, y: float, given: float | None = None) -> float:
        if given is not None:
            return float(given)
        if self.terrain is None:
            self.flags.add("TERRAIN DATA NOT AVAILABLE, DRAWN AT RL 0")
            return 0.0
        v = float(np.asarray(self.terrain.surface.z_at(x, y)).reshape(-1)[0])
        if not math.isfinite(v):
            self.flags.add("OUTSIDE THE TERRAIN, EXTRAPOLATED, NOT SURVEYED")
            return self.fallback
        return v


def pv(o: SiteObject, key: str) -> Any:
    p = o.params.get(key)
    return None if p is None or p.value is None else p.value


def num(o: SiteObject, key: str, positive: bool = True) -> float | None:
    v = pv(o, key)
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        return None
    return float(v) if (v > 0 or not positive) else None


def _xyz(o: SiteObject) -> list[tuple[float, float, float | None]]:
    g = o.geometry
    pts = [g.p] if g.kind == "point" else g.pts if g.kind == "polyline" else g.ring
    return [(float(p[0]), float(p[1]), float(p[2]) if len(p) > 2 else None) for p in pts]


def object_prims(g: Glb, o: SiteObject, s: Sampler, O: tuple[float, float], note: list[str]) -> list[tuple[str, list[dict[str, Any]], dict[str, Any]]]:
    """(suffix, primitives, extra extras) for the parts of one object. Coordinates are made local to the bundle origin here."""
    col = SERVICE_COLOURS.get(str(pv(o, "service_kind")), "#718096") if o.type == "service_existing" else COLOURS.get(o.type, "#999999")
    alpha = 0.4 if o.status == "to_be_removed" else (0.75 if (o.origin == "ai_proposal" and o.accepted == "pending") else 1.0)
    mat = g.material(col, alpha, o.type)
    P = _xyz(o)
    loc = lambda x, y: (x - O[0], y - O[1])  # noqa: E731

    def zs(lift: float = LIFT_M) -> list[float]:
        return [s.z(x, y, z) + (lift if z is None else 0.0) for x, y, z in P]

    def prim(mesh: M.Mesh, m: int = mat, mode: int = 4) -> dict[str, Any] | None:
        pts, idx = mesh
        return g.primitive([(a - O[0], b - O[1], c) for a, b, c in pts], idx, m, mode)

    def marker(x: float, y: float, h: float = MARKER_M, w: float = MARKER_M) -> dict[str, Any] | None:
        z0 = s.z(x, y, P[0][2])
        return prim(M.box(x, y, z0, w, w, h))

    t, geom = o.type, o.geometry
    out: list[tuple[str, list[dict[str, Any]], dict[str, Any]]] = []
    if t == "building":
        b = o.building
        assert b is not None
        lv = b.levels[b.datum_index]
        ffl, h = num(o, "ffl_rl", False), num(o, "height_m")
        prims = []
        for ring in lv.rings:
            if ffl is not None and h is not None:
                prims.append(prim(M.prism(ring, ffl, ffl + h)))
            elif ffl is not None:
                prims.append(prim(M.prism(ring, ffl - 0.2, ffl)))
                note.append(f"{o.id}: HEIGHT NOT SET, ONLY THE SLAB AT FFL IS DRAWN")
            else:
                prims.append(prim(M.fill(ring, [s.z(p[0], p[1]) + LIFT_M for p in ring])))
                note.append(f"{o.id}: FFL NOT SET, ONLY THE FOOTPRINT IS DRAWN ON THE TERRAIN")
        out.append(("", [p for p in prims if p], {"ffl_rl": ffl, "height_m": h}))
    elif t in ("landscape_area", "grading_area", "osd_basin", "footpath", "pool") and geom.kind == "polygon":
        ring = [(p[0], p[1]) for p in geom.ring]
        base = [s.z(x, y, z) + (LIFT_M if z is None else 0.0) for x, y, z in P]
        if t == "grading_area" and num(o, "target_level_m", False) is not None:
            base = [num(o, "target_level_m", False) or 0.0] * len(ring)
        out.append(("", [prim(M.fill(ring, base))], {}))
        if t == "pool":
            wl = num(o, "water_level_rl", False)
            if wl is not None:
                out.append((".water", [prim(M.fill(ring, [wl] * len(ring)), g.material("#3aa6d8", 0.55, "pool water"))], {"kind": "pool_water", "walkable": False}))
            else:
                note.append(f"{o.id}: WATER LEVEL NOT SET, NO WATER SURFACE DRAWN")
    elif geom.kind == "polyline" and t in ("driveway", "footpath", "infiltration_trench", "stormwater_pipe", "service_trace", "overflow_route", "sewer_drain", "water_service", "service_existing"):
        pts = [(p[0], p[1]) for p in P]
        w = num(o, "width_m")
        if w is None and num(o, "diameter_mm") is not None:
            w = max((num(o, "diameter_mm") or 0.0) / 1000.0, MIN_LINE_WIDTH_M)
        if w is None:
            w = MIN_LINE_WIDTH_M
            note.append(f"{o.id}: WIDTH NOT SET, DRAWN {MIN_LINE_WIDTH_M} M WIDE FOR DISPLAY ONLY")
        z = zs()
        if t == "service_existing":
            d = num(o, "depth_m")
            if d is not None:
                z = [v - d - LIFT_M for v in z]
            else:
                note.append(f"{o.id}: DEPTH NOT AVAILABLE, DRAWN ON THE GROUND")
        out.append(("", [prim(M.ribbon(pts, w, z))], {}))
    elif t in ("retaining_wall", "pool_barrier") and geom.kind == "polyline":
        pts = [(p[0], p[1]) for p in P]
        base = zs(0.0)
        th = num(o, "thickness_m") or (0.05 if t == "pool_barrier" else 0.2)
        rls = o.vertex_rls
        h = num(o, "height_m")
        if rls and all(v is not None for v in rls.top) and all(v is not None for v in rls.bottom):
            out.append(("", [prim(M.wall(pts, th, list(rls.bottom), list(rls.top)))], {}))             # type: ignore[arg-type]
        elif h is not None:
            out.append(("", [prim(M.wall(pts, th, base, [v + h for v in base]))], {}))
        else:
            out.append(("", [prim(M.ribbon(pts, th, [v + LIFT_M for v in base]))], {}))
            note.append(f"{o.id}: HEIGHT NOT SET, ONLY THE LINE IS DRAWN")
    elif geom.kind == "point":
        x, y = P[0][0], P[0][1]
        z0 = s.z(x, y, P[0][2])
        if t == "tree":
            h, cd, td = num(o, "height_m"), num(o, "canopy_diameter_m"), num(o, "trunk_diameter_mm")
            if h is not None and cd is not None:
                tr = (td / 2000.0) if td else 0.1
                out.append(("", [prim(M.cylinder(x, y, z0, tr, h * 0.5, 12), g.material("#6b4f2f", alpha, "trunk")), prim(M.ellipsoid(x, y, z0 + h * 0.65, cd / 2, h * 0.35), mat)], {}))
            else:
                out.append(("", [marker(x, y, 1.0, 0.3)], {}))
                note.append(f"{o.id}: TREE DIMENSIONS NOT SET, DRAWN AS A MARKER")
        elif t == "rwt":
            shape = pv(o, "shape")
            if shape in ("slimline", "underground"):
                ln, wd, h = num(o, "length_m"), num(o, "width_m"), num(o, "height_m")
                if ln and wd and h:
                    out.append(("", [prim(M.box(x, y, z0 - (h if shape == "underground" else 0.0), wd, ln, h, geom.yaw_deg or 0.0))], {}))
                else:
                    out.append(("", [marker(x, y)], {}))
            else:
                dia, h = num(o, "diameter_m"), num(o, "height_m")
                if dia and h:
                    out.append(("", [prim(M.cylinder(x, y, z0, dia / 2, h))], {}))
                else:
                    out.append(("", [marker(x, y)], {}))
                    note.append(f"{o.id}: TANK DIMENSIONS NOT SET, DRAWN AS A MARKER")
        elif t in ("osd", "stormwater_pit", "furniture"):
            wd, ln, h = num(o, "width_m"), num(o, "length_m") or num(o, "depth_m"), num(o, "height_m")
            if wd and ln and (h or t == "stormwater_pit"):
                out.append(("", [prim(M.box(x, y, z0, wd, ln, h or 0.05, geom.yaw_deg or 0.0))], {}))
            else:
                out.append(("", [marker(x, y)], {}))
                note.append(f"{o.id}: DIMENSIONS NOT SET, DRAWN AS A MARKER")
        else:
            out.append(("", [marker(x, y, 0.6, 0.35)], {}))
    elif geom.kind == "polygon":
        ring = [(p[0], p[1]) for p in geom.ring]
        out.append(("", [prim(M.fill(ring, zs()))], {}))
    elif geom.kind == "polyline":
        pts = [(p[0], p[1]) for p in P]
        out.append(("", [prim(M.ribbon(pts, MIN_LINE_WIDTH_M, zs()))], {}))
    return out


def building_matrix(o: SiteObject, O: tuple[float, float]) -> np.ndarray | None:
    """The placement of a building GLB (Plan Studio, Y up) in the glTF axes of this export. Mirrors ``glbMatrix`` of the viewer."""
    b = o.building
    ffl = num(o, "ffl_rl", False)
    if b is None or ffl is None:
        return None
    n = math.radians(b.frame.north_deg or 0.0)
    cn, sn = math.cos(n), math.sin(n)
    to_local = np.array([[cn, 0, sn, 0], [sn, 0, -cn, 0], [0, 1, 0, 0], [0, 0, 0, 1]], float)
    a = math.radians(-b.frame.yaw_deg)
    yaw = np.array([[math.cos(a), -math.sin(a), 0, 0], [math.sin(a), math.cos(a), 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]], float)
    datum = b.levels[b.datum_index].elevation_m or 0.0
    place = np.eye(4)
    place[0, 3], place[1, 3], place[2, 3] = b.frame.origin[0] - O[0], b.frame.origin[1] - O[1], ffl - datum
    c = np.array([[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]], float)        # (E, N, U) to glTF (E, U, -N)
    return c @ place @ yaw @ to_local


# ---------------------------------------------------------------------------------------------------- the scene bundle
def bundle_nodes(g: Glb, ctx: ExportContext, include_aerial: bool) -> list[int]:
    b = ctx.bundle
    if not b:
        return []
    groups: dict[str, list[int]] = {"SITE_TERRAIN": [], "SITE_CONTEXT": [], "SITE_AERIAL": []}
    tex = None
    if include_aerial:
        m = re.match(r"^data:(image/[a-z]+);base64,(.*)$", str(ctx.info.get("ground_texture") or ""), re.S)
        if m:
            tex = g.texture_from_jpeg(base64.b64decode(m.group(2)), m.group(1))
    for p in b.get("parts") or []:
        check_deadline(g.deadline)
        cls = str(p.get("c") or "")
        if cls == "aerial" and not (include_aerial and tex is not None):
            continue
        col = str(p.get("col") or "#999999")
        alpha = float(p.get("a", 1.0) or 1.0)
        prims: list[dict[str, Any] | None] = []
        if p.get("v"):
            v = np.asarray(p["v"], float).reshape(-1, 3)
            pts = [tuple(r) for r in v.tolist()]
            idx = list(p["f"]) if p.get("f") else list(range(len(pts)))
            uv = None
            if cls == "aerial" and p.get("uv"):
                uvs = np.asarray(p["uv"], float).reshape(-1, 2)
                uv = [tuple(r) for r in uvs.tolist()]
            mat = g.material(col, 1.0 if cls == "aerial" else alpha, str(p.get("n")), texture=tex if cls == "aerial" else None)
            prims.append(g.primitive(pts, idx, mat, 4, uv))                                 # type: ignore[arg-type]
        if p.get("lines"):
            ln = np.asarray(p["lines"], float).reshape(-1, 3)
            prims.append(g.primitive([tuple(r) for r in ln.tolist()], None, g.material(col, 1.0, str(p.get("n")) + " line"), 1))        # type: ignore[arg-type]
        mi = g.mesh(str(p.get("n")), [x for x in prims if x])
        if mi is None:
            continue
        grp = "SITE_AERIAL" if cls == "aerial" else "SITE_TERRAIN" if cls in ("surface", "existing", "context", "contours", "cutfill") else "SITE_CONTEXT"
        groups[grp].append(g.node(str(p.get("n")), mesh=mi, extras={"kind": "bundle_part", "class": cls}))
    nodes = []
    for name, kids in groups.items():
        if kids:
            extras: dict[str, Any] = {"kind": "group"}
            if name == "SITE_TERRAIN":
                extras["terrain_status"] = ctx.terrain_status
            if name == "SITE_AERIAL":
                extras["note"] = str(ctx.info.get("ground_texture_note") or "AERIAL IMAGERY FOR INFORMATION ONLY")
                extras["source"] = str(ctx.info.get("ground_texture_source") or "")
                extras["capture_date"] = str(ctx.info.get("ground_texture_date") or "CAPTURE DATE NOT STATED")
            nodes.append(g.node(name, children=kids, extras=extras))
    return nodes


def build_glb(ctx: ExportContext, terrain: Any = None, include_aerial: bool = False, building_glbs: dict[str, bytes] | None = None, deadline: float | None = None,
              max_bytes: int = MAX_GLB_BYTES) -> bytes:
    """The GLB of the whole site. ``building_glbs`` maps a building object id to the bytes of its stored GLB. Raises ``GlbTooLarge`` before the file would pass ``max_bytes`` and
    ``ExportTimeout`` after ``deadline`` (a ``time.monotonic`` value). A building GLB that cannot be merged is skipped with a note; the rest of the export is built."""
    g = Glb(max_bytes, deadline)
    O = ctx.origin
    roots = bundle_nodes(g, ctx, include_aerial)
    s = Sampler(ctx, terrain)
    notes: list[str] = list(ctx.notes)
    obj_nodes: list[int] = []
    for o in ctx.design.objects:
        check_deadline(g.deadline)
        base_extras = {"kind": o.type, "id": o.id, "status": o.status, "origin": o.origin, "verified": o.verified, "label": (o.label or "").upper(),
                       **({"accepted": o.accepted} if o.accepted else {}),
                       **({"service_kind": pv(o, "service_kind"), "unverified": not o.verified, "indicative": "UNVERIFIED SERVICE, INDICATIVE ONLY" if not o.verified else "INDICATIVE ONLY"} if o.type == "service_existing" else {})}
        parts = object_prims(g, o, s, O, notes)
        kids: list[int] = []
        mi_main = None
        for suffix, prims, extra in parts:
            mi = g.mesh(o.id + suffix, prims)
            if mi is None:
                continue
            if suffix == "":
                mi_main = mi
                if extra:
                    base_extras["detail"] = extra
            else:
                kids.append(g.node(o.id + suffix, mesh=mi, extras={"kind": extra.get("kind", o.type), "id": o.id + suffix, "parent": o.id, **{k: v for k, v in extra.items() if k != "kind"}}))
        if o.type == "building" and building_glbs and o.id in building_glbs:
            m = building_matrix(o, O)
            if m is not None:
                try:
                    kids.append(g.merge(building_glbs[o.id], m, o.id + ".glb", {"kind": "building_glb", "id": o.id + ".glb", "parent": o.id}))
                    base_extras["glb"] = "MERGED"
                except (GlbTooLarge, ExportTimeout):
                    raise
                except Exception as e:  # noqa: BLE001  (one bad stored building model must not take the export down: it is skipped and the note says so)
                    reason = f": {e}" if isinstance(e, GlbMergeError) else ""
                    base_extras["glb"] = "BUILDING MODEL SKIPPED, INVALID" + reason
                    notes.append(f"{o.id}: BUILDING MODEL SKIPPED, INVALID{reason}")
            else:
                base_extras["glb"] = "NOT MERGED: FFL NOT SET"
        elif o.type == "building" and o.building and o.building.glb_name:
            base_extras["glb"] = "NOT STORED ON THE SERVER, THE BUILDING IS DRAWN AS A BLOCK"
        if mi_main is None and not kids:
            continue
        obj_nodes.append(g.node(o.id, mesh=mi_main, children=kids or None, extras=base_extras))
    if obj_nodes:
        roots.append(g.node("SITE_DESIGN", children=obj_nodes, extras={"kind": "group", "objects": len(obj_nodes)}))
    if s.flags:
        notes += sorted(s.flags)
    extras = {"title": ctx.title, "project_id": ctx.project_id, "origin_mga": [O[0], O[1]], "srid": ctx.srid, "coordinates": ctx.coordinate_text(), "up_axis": "Y; x = E, y = RL, z = minus N, all from origin_mga",
              "status": ctx.status_lines(), "notes": sorted(set(notes))[:200], "generated": ctx.date_text(), "aerial_included": bool(include_aerial)}
    return g.to_bytes(roots, extras)
