# Gzowo Space Program - launch site, mobile launch platform and tree models. Run inside Blender.
# Axes: X east, Y north, Z up. Pad centre at the origin, hangar to the west, crawlerway along X.
import bpy, bmesh, math, os
from mathutils import Vector, Matrix

ROOT = "/Users/jurek/Downloads/Claude/Projects/GSP Game"
OUT = os.path.join(ROOT, "assets", "site")

MATS = {
    "s_concrete": ((0.55, 0.55, 0.54), 0.0, 0.85, 0),
    "s_road": ((0.36, 0.36, 0.37), 0.0, 0.9, 0),
    "s_scorch": ((0.09, 0.085, 0.08), 0.0, 0.95, 0),
    "s_white": ((0.9, 0.9, 0.91), 0.0, 0.55, 0),
    "s_panel": ((0.74, 0.76, 0.79), 0.0, 0.5, 0),
    "s_dark": ((0.05, 0.05, 0.06), 0.3, 0.5, 0),
    "s_steel": ((0.62, 0.64, 0.67), 0.9, 0.4, 0),
    "s_red": ((0.75, 0.12, 0.08), 0.0, 0.5, 0),
    "s_hazard": ((0.95, 0.62, 0.05), 0.0, 0.5, 0),
    "s_lamp": ((1.0, 0.95, 0.85), 0.0, 0.5, 5.0),
    "tree_bark": ((0.2, 0.13, 0.08), 0.0, 0.9, 0),
    "tree_leaf": ((0.08, 0.2, 0.09), 0.0, 0.85, 0),
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


def finish(bm, mat):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("m")
    bm.to_mesh(me)
    bm.free()
    me.materials.append(get_mat(mat))
    o = bpy.data.objects.new("m", me)
    bpy.context.scene.collection.objects.link(o)
    objs.append(o)
    return o


def box(size, loc, mat, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    if bevel:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=2, affect="EDGES", profile=0.5)
    for v in bm.verts:
        v.co += Vector(loc)
    return finish(bm, mat)


def cyl(r0, r1, z0, z1, loc, mat, seg=32, smooth=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r0, radius2=max(r1, 0.0001), depth=z1 - z0)
    for v in bm.verts:
        v.co += Vector((loc[0], loc[1], (z0 + z1) / 2))
    o = finish(bm, mat)
    if smooth:
        for p in o.data.polygons:
            p.use_smooth = True
        o.data.set_sharp_from_angle(angle=math.radians(40))
    return o


def sphere(r, loc, mat):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=r)
    for v in bm.verts:
        v.co += Vector(loc)
    o = finish(bm, mat)
    for p in o.data.polygons:
        p.use_smooth = True
    return o


def beam(p0, p1, t, mat):
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * t, v.co.y * t, v.co.z * d.length))
    rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation((p0 + p1) / 2) @ rot, verts=bm.verts)
    return finish(bm, mat)


def reset():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    objs.clear()


def export(name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, name + ".glb"), export_format="GLB", use_selection=True, export_apply=True, export_yup=True)
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def lattice_tower(cx, cy, w, h, step, mat):
    hw = w / 2
    corners = [(cx - hw, cy - hw), (cx + hw, cy - hw), (cx + hw, cy + hw), (cx - hw, cy + hw)]
    for x, y in corners:
        box((0.45, 0.45, h), (x, y, h / 2), mat)
    z = 0.0
    k = 0
    while z + step <= h + 0.01:
        for i in range(4):
            a, b = corners[i], corners[(i + 1) % 4]
            beam((a[0], a[1], z + step), (b[0], b[1], z + step), 0.25, mat)
            if (i + k) % 2 == 0:
                beam((a[0], a[1], z), (b[0], b[1], z + step), 0.18, mat)
            else:
                beam((b[0], b[1], z), (a[0], a[1], z + step), 0.18, mat)
        z += step
        k += 1


def build_site():
    reset()
    # apron, scorch ring and flame marks
    cyl(70, 70, 0.0, 0.06, (0, 0, 0), "s_concrete", 64, False)
    cyl(16, 16, 0.06, 0.09, (0, 0, 0), "s_scorch", 48, False)
    for a in range(16):
        ang = a * math.pi / 8
        o = box((18, 0.5, 0.02), (0, 0, 0.075), "s_hazard")
        o.matrix_world = Matrix.Rotation(ang, 4, "Z") @ Matrix.Translation((58, 0, 0))
    # crawlerway from hangar door to pad
    box((400, 26, 0.08), (-262, 0, 0.04), "s_road")
    for s in (-1, 1):
        box((400, 0.5, 0.02), (-262, s * 11.5, 0.09), "s_hazard")
        box((400, 5.5, 0.03), (-262, s * 5.5, 0.095), "s_concrete")
    # hangar exterior with open east door
    hx, hw, hd, hh = -494, 64, 64, 60
    box((hw, hd, 0.6), (hx, 0, hh + 0.3), "s_white")
    box((0.8, hd, hh), (hx - hw / 2, 0, hh / 2), "s_white")
    for s in (-1, 1):
        box((hw, 0.8, hh), (hx, s * hd / 2, hh / 2), "s_white")
        box((0.8, (hd - 30) / 2, hh), (hx + hw / 2, s * (15 + (hd - 30) / 4), hh / 2), "s_white")
    box((0.8, 30, hh - 52), (hx + hw / 2, 0, 52 + (hh - 52) / 2), "s_white")
    box((hw - 2, hd - 2, 0.2), (hx, 0, 0.1), "s_concrete")
    box((2, 28, 50), (hx - hw / 2 + 2, 0, 25), "s_dark")
    z = 6.0
    while z < hh:
        for s in (-1, 1):
            box((hw + 0.1, 0.1, 0.12), (hx, s * (hd / 2 + 0.42), z), "s_panel")
        box((0.1, hd + 0.1, 0.12), (hx - hw / 2 - 0.42, 0, z), "s_panel")
        z += 6.0
    for i in range(9):
        y = -hd / 2 + hd * i / 8
        box((0.12, 0.12, hh), (hx - hw / 2 - 0.42, y, hh / 2), "s_panel")
    for i in range(9):
        x = hx - hw / 2 + hw * i / 8
        for s in (-1, 1):
            box((0.12, 0.12, hh), (x, s * (hd / 2 + 0.42), hh / 2), "s_panel")
    box((1.0, 34, 4), (hx + hw / 2 + 0.2, 0, 56), "s_dark")
    for s in (-1, 1):
        box((0.6, 0.6, 52), (hx + hw / 2 + 0.3, s * 15.3, 26), "s_hazard")
    # low support buildings
    box((40, 22, 9), (-420, 70, 4.5), "s_white", 0.2)
    box((40.4, 22.4, 1.2), (-420, 70, 6.5), "s_dark")
    box((26, 18, 6), (-370, 74, 3), "s_panel", 0.2)
    cyl(5, 5, 0, 30, (-350, -70, 0), "s_white", 24)
    sphere(9, (-350, -70, 36), "s_white")
    # fixed service tower north of the pad, with two short arms
    lattice_tower(0, 17, 7, 56, 7, "s_red")
    for z in (14, 28, 42):
        box((8.5, 8.5, 0.3), (0, 17, z), "s_steel")
    for z in (21, 35, 49):
        box((2.2, 7.5, 1.4), (0, 10, z), "s_steel", 0.1)
        box((2.6, 1.2, 2.0), (0, 6.6, z), "s_hazard", 0.1)
    box((0.5, 0.5, 14), (0, 17, 63), "s_steel")
    # lightning masts
    for ang in (math.radians(200), math.radians(320), math.radians(80)):
        x, y = 46 * math.cos(ang), 46 * math.sin(ang)
        lattice_tower(x, y, 3, 60, 10, "s_steel")
        box((0.25, 0.25, 22), (x, y, 71), "s_white")
    # propellant farm
    for i, x in enumerate((60, 80)):
        sphere(7, (x, 60, 8.5), "s_white")
        for ax, ay in ((-4, -4), (4, -4), (4, 4), (-4, 4)):
            beam((x + ax, 60 + ay, 0), (x + ax * 0.8, 60 + ay * 0.8, 5), 0.4, "s_steel")
    for i in range(3):
        cyl(3, 3, 0, 14, (100, 40 + i * 9, 0), "s_white", 24)
    beam((60, 53, 0.4), (8, 8, 0.4), 0.5, "s_steel")
    # flood lights
    for x, y in ((30, -30), (-30, -30), (30, 30)):
        box((0.4, 0.4, 24), (x, y, 12), "s_steel")
        box((4, 0.6, 2), (x, y, 25), "s_dark")
        box((3.6, 0.2, 1.6), (x - (0.45 if x > 0 else -0.45) * 0, y + (0.4 if y < 0 else -0.4), 25), "s_lamp")
    return export("site")


def build_crawler():
    reset()
    box((22, 22, 1.6), (0, 0, 2.2), "s_steel", 0.15)
    box((22.4, 22.4, 0.25), (0, 0, 2.95), "s_panel")
    cyl(5.2, 5.2, 2.9, 3.0, (0, 0, 0), "s_scorch", 32, False)
    for sx in (-1, 1):
        for sy in (-1, 1):
            box((8.5, 3.6, 1.5), (sx * 6.5, sy * 8.6, 0.75), "s_dark", 0.3)
            box((7.5, 2.6, 0.5), (sx * 6.5, sy * 8.6, 1.65), "s_steel")
    for s in (-1, 1):
        box((22, 0.5, 0.35), (0, s * 10.9, 3.2), "s_hazard")
        box((0.5, 22, 0.35), (s * 10.9, 0, 3.2), "s_hazard")
    return export("crawler")


def build_tree():
    reset()
    cyl(0.22, 0.12, 0, 3.2, (0, 0, 0), "tree_bark", 6)
    cyl(2.1, 0.9, 1.6, 4.4, (0, 0, 0), "tree_leaf", 7)
    cyl(1.6, 0.6, 3.6, 6.4, (0, 0, 0), "tree_leaf", 7)
    cyl(1.05, 0.0, 5.6, 8.6, (0, 0, 0), "tree_leaf", 7)
    return export("tree")


def build_all():
    return {"site": build_site(), "crawler": build_crawler(), "tree": build_tree()}


if __name__ == "__main__":
    build_all()
