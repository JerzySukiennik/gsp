# Gzowo Space Program - assembly hangar generator. Run inside Blender; writes assets/hangar/hangar.glb.
import bpy, bmesh, math, os
from mathutils import Vector, Matrix

ROOT = "/Users/jurek/Downloads/Claude/Projects/GSP Game"
OUT = os.path.join(ROOT, "assets", "hangar", "hangar.glb")
W, DEPTH, H = 64.0, 64.0, 58.0

MATS = {
    "h_floor": ((0.5, 0.51, 0.52), 0.0, 0.22, 0),
    "h_floor_line": ((0.9, 0.9, 0.9), 0.0, 0.4, 0),
    "h_floor_hazard": ((0.95, 0.62, 0.05), 0.0, 0.5, 0),
    "h_wall": ((0.9, 0.9, 0.91), 0.0, 0.6, 0),
    "h_seam": ((0.62, 0.63, 0.65), 0.0, 0.6, 0),
    "h_steel": ((0.78, 0.79, 0.8), 0.0, 0.45, 0),
    "h_dark": ((0.06, 0.06, 0.07), 0.2, 0.5, 0),
    "h_crane": ((0.93, 0.6, 0.06), 0.0, 0.45, 0),
    "h_light": ((1, 1, 1), 0.0, 0.5, 2.2),
    "h_sky": ((0.75, 0.87, 1.0), 0.0, 0.5, 1.6),
    "h_crate": ((0.82, 0.82, 0.8), 0.0, 0.7, 0),
    "h_pad": ((0.3, 0.31, 0.33), 0.9, 0.35, 0),
}


def get_mat(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    col, metal, rough, emit = MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*col, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = (*col, 1)
        b.inputs["Emission Strength"].default_value = emit
    return m


objs = []


def box(size, loc, mat, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    if bevel:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=2, affect="EDGES", profile=0.5)
    for v in bm.verts:
        v.co += Vector(loc)
    me = bpy.data.meshes.new("b")
    bm.to_mesh(me)
    bm.free()
    me.materials.append(get_mat(mat))
    o = bpy.data.objects.new("b", me)
    bpy.context.scene.collection.objects.link(o)
    objs.append(o)
    return o


def disc(r0, r1, z, thick, mat, seg=96):
    bm = bmesh.new()
    vo_b = [bm.verts.new((r1 * math.cos(2 * math.pi * i / seg), r1 * math.sin(2 * math.pi * i / seg), z)) for i in range(seg)]
    vo_t = [bm.verts.new((v.co.x, v.co.y, z + thick)) for v in vo_b]
    if r0 > 0:
        vi_t = [bm.verts.new((r0 * math.cos(2 * math.pi * i / seg), r0 * math.sin(2 * math.pi * i / seg), z + thick)) for i in range(seg)]
    for i in range(seg):
        j = (i + 1) % seg
        bm.faces.new((vo_b[i], vo_b[j], vo_t[j], vo_t[i]))
        if r0 > 0:
            bm.faces.new((vo_t[i], vo_t[j], vi_t[j], vi_t[i]))
    if r0 <= 0:
        bm.faces.new(vo_t)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("d")
    bm.to_mesh(me)
    bm.free()
    me.materials.append(get_mat(mat))
    o = bpy.data.objects.new("d", me)
    bpy.context.scene.collection.objects.link(o)
    objs.append(o)
    return o


def build():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    objs.clear()
    hw, hd = W / 2, DEPTH / 2

    box((W, DEPTH, 0.4), (0, 0, -0.2), "h_floor")
    disc(0, 7.0, 0.0, 0.35, "h_pad")
    disc(7.0, 7.35, 0.0, 0.36, "h_floor_hazard")
    disc(10.5, 10.75, 0.0, 0.012, "h_floor_line")
    disc(16.0, 16.15, 0.0, 0.012, "h_floor_line")
    for a in range(12):
        ang = a * math.pi / 6
        o = box((4.5, 0.15, 0.012), (0, 0, 0.006), "h_floor_line")
        o.matrix_world = Matrix.Rotation(ang, 4, "Z") @ Matrix.Translation((13.3, 0, 0))
    box((0.3, DEPTH * 0.9, 0.012), (-hw + 9, 0, 0.006), "h_floor_hazard")
    box((0.3, DEPTH * 0.9, 0.012), (hw - 9, 0, 0.006), "h_floor_hazard")

    t = 0.6
    box((t, DEPTH, H), (-hw - t / 2, 0, H / 2), "h_wall")
    box((t, DEPTH, H), (hw + t / 2, 0, H / 2), "h_wall")
    box((W, t, H), (0, hd + t / 2, H / 2), "h_wall")
    box((W, t, H), (0, -hd - t / 2, H / 2), "h_wall")
    box((W + 2, DEPTH + 2, t), (0, 0, H + t / 2), "h_wall")

    z = 6.0
    while z < H - 1:
        for sx in (-1, 1):
            box((0.06, DEPTH, 0.09), (sx * (hw - 0.03), 0, z), "h_seam")
        box((W, 0.06, 0.09), (0, hd - 0.03, z), "h_seam")
        z += 6.0
    n = 8
    for i in range(n + 1):
        y = -hd + DEPTH * i / n
        for sx in (-1, 1):
            box((0.9, 0.7, H), (sx * (hw - 0.45), y, H / 2), "h_steel", 0.05)
        box((W, 0.7, 1.6), (0, y, H - 0.8), "h_steel", 0.05)
    for i in range(1, n):
        x = -hw + W * i / n
        box((0.7, 0.9, H), (x, hd - 0.45, H / 2), "h_steel", 0.05)

    door_w, door_h = 30.0, 50.0
    box((door_w + 2.4, 0.5, door_h + 1.2), (0, -hd + 0.25, (door_h + 1.2) / 2), "h_steel")
    segs = 10
    for i in range(segs):
        zc = door_h * (i + 0.5) / segs
        box((door_w, 0.3, door_h / segs - 0.16), (0, -hd + 0.62, zc), "h_wall", 0.04)
    box((door_w, 0.34, 0.5), (0, -hd + 0.64, 0.25), "h_floor_hazard")

    for i in range(7):
        x = -hw + W * (i + 0.5) / 7
        box((3.2, DEPTH * 0.82, 0.12), (x, 0, H - 0.04), "h_sky")
    for zl in (10.0, 24.0, 38.0):
        for sx in (-1, 1):
            box((0.12, DEPTH * 0.86, 0.5), (sx * (hw - 1.0), 0, zl), "h_light")
        box((W * 0.86, 0.12, 0.5), (0, hd - 1.0, zl), "h_light")

    cz = H - 5.0
    for sx in (-1, 1):
        box((1.0, DEPTH, 1.2), (sx * (hw - 1.6), 0, cz - 1.6), "h_steel", 0.05)
    cy = 9.0
    for dy in (-1.4, 1.4):
        box((W - 3.0, 0.9, 2.2), (0, cy + dy, cz), "h_crane", 0.06)
    for sx in (-1, 1):
        box((1.8, 4.4, 2.6), (sx * (hw - 1.6), cy, cz), "h_crane", 0.08)
    box((3.4, 3.8, 1.5), (5.0, cy, cz + 0.2), "h_dark", 0.08)
    box((0.14, 0.14, 9.0), (5.0, cy, cz - 5.0), "h_dark")
    box((1.0, 0.5, 1.2), (5.0, cy, cz - 10.0), "h_crane", 0.1)

    tx, ty = -13.5, 12.0
    for dx in (-2, 2):
        for dy in (-2, 2):
            box((0.4, 0.4, 46), (tx + dx, ty + dy, 23), "h_steel", 0.03)
    lvl = 5.0
    while lvl < 46:
        box((4.8, 4.8, 0.25), (tx, ty, lvl), "h_dark")
        box((7.5, 1.6, 0.2), (tx + 5.8, ty - 1.6, lvl), "h_steel")
        for k in (-0.7, 0.7):
            box((7.5, 0.06, 0.06), (tx + 5.8, ty - 1.6 + k, lvl + 1.1), "h_crane")
        lvl += 8.0

    for side in (-1, 1):
        for r in range(5):
            y0 = -22 + r * 9.0
            x0 = side * (hw - 4.5)
            for px in (-1.4, 1.4):
                for py in (-3.4, 3.4):
                    box((0.16, 0.16, 8.4), (x0 + px, y0 + py, 4.2), "h_crane")
            for s in range(4):
                zs = 0.4 + s * 2.6
                box((3.0, 7.0, 0.14), (x0, y0, zs), "h_steel")
                for c in range(3):
                    if (r * 7 + s * 3 + c + (side > 0)) % 4 == 0:
                        continue
                    hgt = 1.2 + ((r + s + c) % 3) * 0.4
                    box((2.2, 1.7, hgt), (x0, y0 - 2.3 + c * 2.3, zs + 0.07 + hgt / 2), "h_crate" if (r + c + s) % 3 else "h_dark", 0.04)

    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = "hangar"
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_apply=True, export_yup=True)
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


if __name__ == "__main__":
    build()
