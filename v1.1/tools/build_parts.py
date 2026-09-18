# Gzowo Space Program - part model generator. Run inside Blender; writes one GLB per part to assets/parts.
import bpy, bmesh, math, os, json
from mathutils import Vector, Matrix

ROOT = "/Users/jurek/Downloads/Claude/Projects/GSP Game"
OUT = os.path.join(ROOT, "assets", "parts")
SEG = 64
D = {"S": 0.6, "M": 1.25, "L": 2.5}

MATS = {
    "paint_main": ((0.92, 0.92, 0.93), 0.0, 0.42),
    "paint_accent": ((0.025, 0.025, 0.03), 0.0, 0.5),
    "steel": ((0.62, 0.64, 0.67), 1.0, 0.28),
    "dark_metal": ((0.07, 0.07, 0.08), 1.0, 0.5),
    "nozzle": ((0.23, 0.2, 0.18), 1.0, 0.42),
    "foil": ((0.92, 0.66, 0.2), 1.0, 0.33),
    "solar": ((0.015, 0.035, 0.14), 0.6, 0.18),
    "glass": ((0.015, 0.02, 0.03), 0.0, 0.04),
    "fabric": ((0.9, 0.33, 0.04), 0.0, 0.85),
    "ablator": ((0.11, 0.075, 0.055), 0.0, 0.92),
}


def get_mat(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    col, metal, rough = MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*col, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    return m


def clear():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for me in list(bpy.data.meshes):
        bpy.data.meshes.remove(me)


def new_obj(name, bm, mats):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for mn in mats:
        me.materials.append(get_mat(mn))
    for p in me.polygons:
        p.use_smooth = True
    me.set_sharp_from_angle(angle=math.radians(38))
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def lathe(name, prof, seg=SEG, arc=None):
    """prof: [(r, z, mat)] bottom to top; mat colours the band up to the next point."""
    mats = []
    for _, _, m in prof:
        if m and m not in mats:
            mats.append(m)
    bm = bmesh.new()
    rings = []
    for r, z, _ in prof:
        if r < 1e-6:
            rings.append([bm.verts.new((0, 0, z))])
        else:
            rings.append([bm.verts.new((r * math.cos(2 * math.pi * i / seg), r * math.sin(2 * math.pi * i / seg), z)) for i in range(seg)])
    for k in range(len(prof) - 1):
        a, b = rings[k], rings[k + 1]
        mi = mats.index(prof[k][2])
        for i in range(seg):
            j = (i + 1) % seg
            if len(a) == 1 and len(b) == 1:
                continue
            if len(a) == 1:
                vs = (a[0], b[j], b[i])
            elif len(b) == 1:
                vs = (a[i], a[j], b[0])
            else:
                vs = (a[i], a[j], b[j], b[i])
            try:
                f = bm.faces.new(vs)
                f.material_index = mi
            except ValueError:
                pass
    return new_obj(name, bm, mats)


def box(name, size, loc=(0, 0, 0), mat="steel", bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=2, affect="EDGES", profile=0.5)
    for v in bm.verts:
        v.co += Vector(loc)
    return new_obj(name, bm, [mat])


def rod(name, p0, p1, r, mat="steel", seg=16):
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=d.length)
    rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation((p0 + p1) / 2) @ rot, verts=bm.verts)
    return new_obj(name, bm, [mat])


def prism(name, outline, thick, mat, bevel=0.0):
    """outline: [(x, z)] polygon in the XZ plane, extruded symmetrically along Y."""
    bm = bmesh.new()
    front = [bm.verts.new((x, -thick / 2, z)) for x, z in outline]
    back = [bm.verts.new((x, thick / 2, z)) for x, z in outline]
    bm.faces.new(front)
    bm.faces.new(list(reversed(back)))
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((front[i], back[i], back[j], front[j]))
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=2, affect="EDGES", profile=0.5)
    return new_obj(name, bm, [mat])


def join(name, objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.set_sharp_from_angle(angle=math.radians(38))
    return o


def ring_of(fn, n, phase=0.0):
    out = []
    for i in range(n):
        a = phase + 2 * math.pi * i / n
        o = fn(i)
        o.matrix_world = Matrix.Rotation(a, 4, "Z") @ o.matrix_world
        bpy.context.view_layer.update()
        out.append(o)
    return out


manifest = {}


def export(o):
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bb = [Vector(c) for c in o.bound_box]
    mn = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
    mx = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
    manifest[o.name] = {"min": [round(c, 4) for c in mn], "max": [round(c, 4) for c in mx], "tris": sum(len(p.vertices) - 2 for p in o.data.polygons)}
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, o.name + ".glb"), export_format="GLB", use_selection=True, export_apply=True, export_yup=True)


# ---------- stack parts ----------

def tank(name, dia, length, accent=True):
    r, h = dia / 2, length / 2
    b = min(0.05 * dia + 0.02, length * 0.1)
    e = 0.012 * dia + 0.004
    prof = [(0, -h, "dark_metal"), (r * 0.94, -h, "steel"), (r + e, -h + e, "steel"), (r + e, -h + b, "steel"), (r, -h + b + e, "paint_main")]
    if accent and length > dia * 0.9:
        aw = 0.09 * dia + 0.03
        top = h - b - e - 0.12 * dia
        prof += [(r, top - aw, "paint_accent"), (r, top, "paint_main")]
    prof += [(r, h - b - e, "steel"), (r + e, h - b, "steel"), (r + e, h - e, "steel"), (r * 0.94, h, "dark_metal"), (0, h, "dark_metal")]
    parts = [lathe(name, prof)]
    if length > dia * 1.5:
        parts.append(rod(name + "_feed", (r + 0.035 * dia, 0, -h + b * 1.5), (r + 0.035 * dia, 0, h - b * 1.5), 0.028 * dia, "steel"))
        parts.append(box(name + "_clampa", (0.08 * dia, 0.09 * dia, 0.04 * dia), (r + 0.03 * dia, 0, -h * 0.5), "dark_metal", 0.004 * dia))
        parts.append(box(name + "_clampb", (0.08 * dia, 0.09 * dia, 0.04 * dia), (r + 0.03 * dia, 0, h * 0.5), "dark_metal", 0.004 * dia))
    return join(name, parts)


def engine(name, dia, height, vacuum):
    r, h = dia / 2, height / 2
    top = h
    plate = 0.06 * height
    head = (0.34 if vacuum else 0.4) * height
    throat_z = top - plate - head
    exit_r = r * (0.97 if vacuum else 0.72)
    throat_r = r * (0.16 if vacuum else 0.2)
    wall = 0.012 * dia + 0.003
    parts = [lathe(name + "_mount", [(0, top, "dark_metal"), (r * 0.9, top, "steel"), (r * 0.9, top - plate, "steel"), (r * 0.5, top - plate * 1.6, "dark_metal"), (0, top - plate * 1.6, "dark_metal")][::-1])]
    parts.append(lathe(name + "_head", [
        (0, throat_z, "dark_metal"), (throat_r * 1.5, throat_z, "dark_metal"), (r * 0.36, throat_z + head * 0.25, "dark_metal"),
        (r * 0.42, throat_z + head * 0.55, "steel"), (r * 0.42, throat_z + head * 0.7, "dark_metal"), (r * 0.3, throat_z + head * 0.95, "dark_metal"), (0, throat_z + head * 0.95, "dark_metal")]))
    n = 14
    outer, inner = [], []
    for i in range(n + 1):
        t = i / n
        z = throat_z - t * (throat_z + h)
        rr = throat_r + (exit_r - throat_r) * (math.sin(t * math.pi / 2) ** 0.75)
        outer.append((rr, z, "nozzle"))
        inner.append((max(rr - wall, 0.001), z, "dark_metal"))
    prof = [(0, throat_z - 0.02 * height, "dark_metal")] + inner[1:] + [(outer[-1][0], outer[-1][1], "nozzle")] + list(reversed(outer[:-1]))
    prof = list(reversed(prof))
    parts.append(lathe(name + "_bell", prof))
    for i in range(3 if vacuum else 5):
        z = throat_z - (0.25 + 0.2 * i) * (throat_z + h) * (0.8 if vacuum else 0.9)
        t = (throat_z - z) / (throat_z + h)
        rr = throat_r + (exit_r - throat_r) * (math.sin(t * math.pi / 2) ** 0.75)
        parts.append(lathe(name + f"_hoop{i}", [(rr, z - wall, "steel"), (rr + wall * 1.6, z - wall, "steel"), (rr + wall * 1.6, z + wall, "steel"), (rr, z + wall, "steel")]))
    pr = 0.035 * dia
    parts += ring_of(lambda i: rod(name + f"_pipe{i}", (r * 0.62, 0, top - plate), (r * 0.36, 0, throat_z + head * 0.3), pr, "steel"), 4, math.pi / 4)
    parts.append(lathe(name + "_pump", [(0, -0.1 * dia, "steel"), (0.11 * dia, -0.1 * dia, "steel"), (0.13 * dia, 0, "steel"), (0.11 * dia, 0.1 * dia, "steel"), (0, 0.1 * dia, "steel")], 24))
    parts[-1].matrix_world = Matrix.Translation((r * 0.5, 0, throat_z + head * 0.6)) @ Matrix.Rotation(math.pi / 2, 4, "Y")
    return join(name, parts)


def decoupler(name, dia, height):
    r, h = dia / 2, height / 2
    e = 0.015 * dia
    parts = [lathe(name, [(r * 0.8, -h, "dark_metal"), (r, -h, "paint_accent"), (r + e, -h + e, "paint_accent"), (r + e, -e * 0.5, "foil"), (r + e, e * 0.5, "paint_accent"), (r + e, h - e, "paint_accent"), (r, h, "dark_metal"), (r * 0.8, h, "dark_metal"), (r * 0.8, -h, None)])]
    parts += ring_of(lambda i: box(name + f"_bolt{i}", (0.05 * dia, 0.07 * dia, height * 0.8), (r + e, 0, 0), "steel", 0.004 * dia), 8)
    return join(name, parts)


def nose(name, dia, height):
    r, h = dia / 2, height / 2
    n = 18
    prof = [(0, -h, "dark_metal"), (r * 0.94, -h, "paint_main")]
    for i in range(n + 1):
        t = i / n
        z = -h + 0.02 * height + t * (height * 0.98)
        rr = r * math.sqrt(max(1 - t ** 1.9, 0))
        mat = "paint_accent" if t > 0.82 else "paint_main"
        prof.append((rr if i < n else 0, z, mat))
    return join(name, [lathe(name, prof)])


def adapter(name, d0, d1, height):
    r0, r1, h = d0 / 2, d1 / 2, height / 2
    e = 0.01 * d1
    return join(name, [lathe(name, [(0, -h, "dark_metal"), (r1 * 0.94, -h, "steel"), (r1 + e, -h + e, "steel"), (r1 + e, -h + 0.08 * height, "paint_main"), (r0 + e, h - 0.08 * height, "steel"), (r0 + e, h - e, "steel"), (r0 * 0.94, h, "dark_metal"), (0, h, "dark_metal")])])


def srb(name, dia, height):
    r, h = dia / 2, height / 2
    nz = 0.11 * height
    body_b = -h + nz
    e = 0.012 * dia
    prof = [(0, body_b, "dark_metal"), (r * 0.9, body_b, "steel"), (r + e, body_b + e, "steel"), (r + e, body_b + 0.05 * height, "paint_main")]
    for k in range(1, 4):
        z = body_b + (h - body_b) * k / 4
        prof += [(r, z - 0.012 * height, "steel"), (r + e, z - 0.008 * height, "steel"), (r + e, z + 0.008 * height, "paint_main"), (r, z + 0.012 * height, "paint_main")]
    prof += [(r, h - 0.05 * height, "paint_accent"), (r, h - e, "steel"), (r * 0.94, h, "dark_metal"), (0, h, "dark_metal")]
    parts = [lathe(name, prof)]
    parts.append(lathe(name + "_nz", [(r * 0.3, body_b, "nozzle"), (r * 0.78, -h, "nozzle"), (r * 0.74, -h, "dark_metal"), (r * 0.26, body_b, "dark_metal")]))
    return join(name, parts)


def probe(name, dia, height):
    r, h = dia / 2, height / 2
    parts = [lathe(name, [(0, -h, "dark_metal"), (r * 0.94, -h, "steel"), (r, -h + 0.04 * height, "foil"), (r, h - 0.04 * height, "steel"), (r * 0.94, h, "dark_metal"), (0, h, "dark_metal")], 8 if dia < 1 else 64)]
    parts += ring_of(lambda i: box(name + f"_av{i}", (0.06 * dia, 0.3 * dia, height * 0.6), (r * (0.93 if dia < 1 else 1.0), 0, 0), "dark_metal", 0.004), 4, math.pi / 8 if dia < 1 else 0)
    return join(name, parts)


def capsule(name):
    r0, r1, H = 1.25, 0.625, 2.2
    h = H / 2
    prof = [(0, -h, "dark_metal"), (r0 * 0.95, -h, "steel"), (r0, -h + 0.06, "steel"), (r0, -h + 0.22, "paint_main"),
            (r0 * 0.985, -h + 0.3, "paint_main"), (r1 + 0.04, h - 0.22, "paint_accent"), (r1, h - 0.16, "steel"), (r1, h - 0.03, "steel"), (r1 * 0.94, h, "dark_metal"), (0, h, "dark_metal")]
    parts = [lathe(name, prof)]
    slope = math.atan2(r0 * 0.985 - r1 - 0.04, (h - 0.22) - (-h + 0.3))
    for a in (0.0, math.pi * 0.5, math.pi, math.pi * 1.5):
        zc = 0.25
        t = (zc - (-h + 0.3)) / ((h - 0.22) - (-h + 0.3))
        rc = r0 * 0.985 + (r1 + 0.04 - r0 * 0.985) * t
        w = box(name + "_win", (0.05, 0.34, 0.42), (0, 0, 0), "glass", 0.02)
        fr = box(name + "_winf", (0.035, 0.42, 0.5), (0, 0, 0), "steel", 0.02)
        for o, off in ((w, 0.012), (fr, 0.0)):
            o.matrix_world = Matrix.Rotation(a, 4, "Z") @ Matrix.Translation((rc + off, 0, zc)) @ Matrix.Rotation(-slope, 4, "Y")
        parts += [w, fr]
    hatch = box(name + "_hatch", (0.04, 0.6, 0.7), (0, 0, 0), "steel", 0.03)
    t = (-0.35 - (-h + 0.3)) / ((h - 0.22) - (-h + 0.3))
    rc = r0 * 0.985 + (r1 + 0.04 - r0 * 0.985) * t
    hatch.matrix_world = Matrix.Rotation(math.pi / 4, 4, "Z") @ Matrix.Translation((rc, 0, -0.35)) @ Matrix.Rotation(-slope, 4, "Y")
    parts.append(hatch)
    return join(name, parts)


def heatshield(name, dia, height):
    r, h = dia / 2, height / 2
    prof = [(0, -h, "ablator")]
    for i in range(1, 9):
        t = i / 8
        prof.append((r * 1.02 * math.sin(t * math.pi / 2), -h + height * 0.6 * (1 - math.cos(t * math.pi / 2)), "ablator"))
    prof += [(r * 1.02, h - 0.1 * height, "steel"), (r, h, "dark_metal"), (0, h, "dark_metal")]
    return join(name, [lathe(name, prof)])


def chute_stack(name, dia, height):
    r, h = dia / 2, height / 2
    prof = [(0, -h, "dark_metal"), (r * 0.94, -h, "steel"), (r, -h + 0.05, "steel"), (r, -h + 0.12, "fabric")]
    for i in range(1, 10):
        t = i / 9
        prof.append((r * math.cos(t * math.pi / 2) if i < 9 else 0, -h + 0.12 + (height - 0.12) * math.sin(t * math.pi / 2), "fabric" if i % 3 else "paint_main"))
    return join(name, [lathe(name, prof)])


def drum(name, dia, height, mid):
    r, h = dia / 2, height / 2
    e = 0.012 * dia
    return lathe(name, [(0, -h, "dark_metal"), (r * 0.94, -h, "steel"), (r + e, -h + e, "steel"), (r + e, -h + 0.18 * height, mid), (r + e, h - 0.18 * height, "steel"), (r + e, h - e, "steel"), (r * 0.94, h, "dark_metal"), (0, h, "dark_metal")])


def mono_tank(name):
    o = drum(name, 1.25, 0.5, "foil")
    return join(name, [o])


def wheel(name):
    o = drum(name, 1.25, 0.3, "paint_accent")
    parts = [o] + ring_of(lambda i: box(name + f"_v{i}", (0.04, 0.3, 0.14), (0.64, 0, 0), "steel", 0.005), 6)
    return join(name, parts)


def battery(name):
    o = drum(name, 1.25, 0.15, "paint_main")
    parts = [o] + ring_of(lambda i: box(name + f"_c{i}", (0.05, 0.22, 0.09), (0.64, 0, 0), "foil", 0.004), 8)
    return join(name, parts)


def fairing_base(name, dia, height):
    r, h = dia / 2, height / 2
    e = 0.015 * dia
    return join(name, [lathe(name, [(0, -h, "dark_metal"), (r * 0.94, -h, "steel"), (r + e, -h + e, "steel"), (r + e * 2.2, h - e, "paint_accent"), (r + e * 2.2, h, "dark_metal"), (r * 0.5, h, "dark_metal"), (r * 0.5, h - 0.02, "dark_metal"), (0, h - 0.02, "dark_metal")])])


def fairing_shell(name, dia, height):
    rb = dia / 2 + 0.033 * dia
    rw = rb * 1.22
    n = 16
    prof = [(rb, 0, "paint_main"), (rw, height * 0.08, "paint_main"), (rw, height * 0.55, "paint_accent"), (rw, height * 0.58, "paint_main")]
    for i in range(1, n + 1):
        t = i / n
        prof.append((rw * math.sqrt(max(1 - t ** 2.1, 0)) if i < n else 0, height * 0.58 + t * height * 0.42, "paint_main"))
    return join(name, [lathe(name, prof)])


# ---------- radial parts: mount face at x=0, part extends to +X, up is +Z ----------

def fin(name, root, tip, span, sweep, thick):
    o = prism(name, [(0, -root / 2), (span, -root / 2 - sweep), (span, -root / 2 - sweep + tip), (0, root / 2)], thick, "paint_main", thick * 0.3)
    base = box(name + "_base", (thick * 1.2, thick * 2.4, root * 1.04), (thick * 0.4, 0, 0), "paint_accent", thick * 0.2)
    return join(name, [o, base])


def gridfin(name):
    parts = [box(name + "_hinge", (0.12, 0.3, 0.16), (0.06, 0, 0.45), "dark_metal", 0.01)]
    w, hgt, t, depth = 1.1, 0.95, 0.025, 0.12
    parts.append(box(name + "_fr1", (depth, w, t), (depth / 2 + 0.03, 0, 0.42), "steel"))
    parts.append(box(name + "_fr2", (depth, w, t), (depth / 2 + 0.03, 0, 0.42 - hgt), "steel"))
    for s in (-1, 1):
        parts.append(box(name + f"_fs{s}", (depth, t, hgt), (depth / 2 + 0.03, s * w / 2, 0.42 - hgt / 2), "steel"))
    for i in range(1, 5):
        parts.append(box(name + f"_gh{i}", (depth * 0.8, w, t * 0.5), (depth / 2 + 0.03, 0, 0.42 - hgt * i / 5), "steel"))
        parts.append(box(name + f"_gv{i}", (depth * 0.8, t * 0.5, hgt), (depth / 2 + 0.03, -w / 2 + w * i / 5, 0.42 - hgt / 2), "steel"))
    return join(name, parts)


def leg(name):
    parts = [box(name + "_mount", (0.14, 0.34, 0.5), (0.07, 0, 0.9), "paint_accent", 0.02)]
    parts.append(rod(name + "_strut", (0.1, 0, 0.95), (1.25, 0, -1.35), 0.07, "paint_main"))
    parts.append(rod(name + "_piston", (0.1, 0, -0.3), (0.85, 0, -0.62), 0.045, "steel"))
    parts.append(box(name + "_low", (0.12, 0.26, 0.3), (0.06, 0, -0.3), "paint_accent", 0.02))
    parts.append(lathe(name + "_pad", [(0, -0.06, "dark_metal"), (0.3, -0.06, "dark_metal"), (0.3, 0, "steel"), (0.09, 0.07, "steel"), (0, 0.07, "steel")], 24))
    parts[-1].matrix_world = Matrix.Translation((1.27, 0, -1.4))
    return join(name, parts)


def rcs(name):
    parts = [box(name + "_blk", (0.1, 0.16, 0.16), (0.05, 0, 0), "paint_accent", 0.012)]
    for d in ((0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)):
        dv = Vector(d)
        parts.append(rod(name + "_n", Vector((0.07, 0, 0)) + dv * 0.07, Vector((0.07, 0, 0)) + dv * 0.16, 0.035, "nozzle", 12))
    parts.append(rod(name + "_nx", (0.1, 0, 0), (0.19, 0, 0), 0.035, "nozzle", 12))
    return join(name, parts)


def solar(name):
    parts = [box(name + "_hub", (0.12, 0.2, 0.2), (0.06, 0, 0), "dark_metal", 0.015), rod(name + "_boom", (0.1, 0, 0), (3.1, 0, 0), 0.025, "steel", 12)]
    for i in range(3):
        x0 = 0.3 + i * 0.95
        parts.append(box(name + f"_p{i}", (0.88, 0.02, 1.1), (x0 + 0.44, 0, 0), "solar"))
        parts.append(box(name + f"_pf{i}", (0.92, 0.012, 1.14), (x0 + 0.44, 0.006, 0), "steel"))
    return join(name, parts)


def antenna(name):
    dish = lathe(name + "_dish", [(0, 0, "paint_main"), (0.2, 0.025, "paint_main"), (0.38, 0.09, "paint_main"), (0.5, 0.2, "paint_main"), (0.49, 0.21, "steel"), (0.37, 0.1, "steel"), (0.19, 0.035, "steel"), (0, 0.012, "steel")], 48)
    feed = rod(name + "_feed", (0, 0, 0), (0, 0, 0.42), 0.012, "steel", 8)
    horn = lathe(name + "_horn", [(0, 0.4, "dark_metal"), (0.05, 0.4, "dark_metal"), (0.02, 0.47, "dark_metal"), (0, 0.47, "dark_metal")], 16)
    d = join(name + "_d", [dish, feed, horn])
    d.matrix_world = Matrix.Translation((0.16, 0, 0)) @ Matrix.Rotation(math.pi / 2, 4, "Y")
    base = box(name + "_base", (0.16, 0.18, 0.18), (0.08, 0, 0), "dark_metal", 0.015)
    return join(name, [base, d])


def radial_decoupler(name):
    parts = [box(name + "_plate", (0.06, 0.4, 1.3), (0.03, 0, 0), "paint_accent", 0.015)]
    parts.append(box(name + "_arm1", (0.26, 0.22, 0.2), (0.17, 0, 0.4), "steel", 0.02))
    parts.append(box(name + "_arm2", (0.26, 0.22, 0.2), (0.17, 0, -0.4), "steel", 0.02))
    parts.append(box(name + "_outer", (0.05, 0.34, 1.2), (0.295, 0, 0), "foil", 0.012))
    return join(name, parts)


def chute_radial(name):
    o = lathe(name, [(0, -0.3, "steel"), (0.13, -0.3, "steel"), (0.15, -0.26, "fabric"), (0.15, 0.2, "paint_main"), (0.1, 0.3, "paint_main"), (0, 0.32, "paint_main")], 32)
    o.matrix_world = Matrix.Translation((0.15, 0, 0))
    return join(name, [o, box(name + "_strap", (0.06, 0.32, 0.08), (0.03, 0, 0), "dark_metal", 0.01)])


def warhead(name, dia, height):
    r, h = dia / 2, height / 2
    n = 16
    prof = [(0, -h, "dark_metal"), (r * 0.94, -h, "steel"), (r, -h + 0.03 * height, "paint_accent")]
    for i in range(1, n + 1):
        t = i / n
        prof.append((r * (1 - t ** 1.6) if i < n else 0, -h + 0.03 * height + t * height * 0.97, "foil" if 0.2 < t < 0.27 else "paint_accent"))
    return join(name, [lathe(name, prof)])


BUILD = [
    ("probe_s", lambda n: probe(n, D["S"], 0.25)), ("probe_m", lambda n: probe(n, D["M"], 0.35)), ("capsule", capsule),
    ("tank_s_1", lambda n: tank(n, D["S"], 0.6)), ("tank_s_2", lambda n: tank(n, D["S"], 1.2)), ("tank_s_3", lambda n: tank(n, D["S"], 2.4)),
    ("tank_m_1", lambda n: tank(n, D["M"], 1.25)), ("tank_m_2", lambda n: tank(n, D["M"], 2.5)), ("tank_m_3", lambda n: tank(n, D["M"], 5.0)),
    ("tank_l_1", lambda n: tank(n, D["L"], 2.5)), ("tank_l_2", lambda n: tank(n, D["L"], 5.0)), ("tank_l_3", lambda n: tank(n, D["L"], 10.0)),
    ("engine_s_launch", lambda n: engine(n, D["S"], 0.9, False)), ("engine_s_vac", lambda n: engine(n, D["S"], 1.2, True)),
    ("engine_m_launch", lambda n: engine(n, D["M"], 1.8, False)), ("engine_m_vac", lambda n: engine(n, D["M"], 2.4, True)),
    ("engine_l_launch", lambda n: engine(n, D["L"], 3.2, False)), ("engine_l_vac", lambda n: engine(n, D["L"], 4.2, True)),
    ("decoupler_s", lambda n: decoupler(n, D["S"], 0.12)), ("decoupler_m", lambda n: decoupler(n, D["M"], 0.2)), ("decoupler_l", lambda n: decoupler(n, D["L"], 0.35)),
    ("nose_s", lambda n: nose(n, D["S"], 0.9)), ("nose_m", lambda n: nose(n, D["M"], 1.8)), ("nose_l", lambda n: nose(n, D["L"], 3.2)),
    ("adapter_sm", lambda n: adapter(n, D["S"], D["M"], 0.8)), ("adapter_ml", lambda n: adapter(n, D["M"], D["L"], 1.6)),
    ("srb_s", lambda n: srb(n, D["S"], 4.0)), ("srb_m", lambda n: srb(n, D["M"], 8.0)),
    ("heatshield_m", lambda n: heatshield(n, D["M"], 0.2)), ("heatshield_l", lambda n: heatshield(n, D["L"], 0.35)),
    ("chute_m", lambda n: chute_stack(n, D["M"], 0.5)), ("mono_m", mono_tank), ("wheel_m", wheel), ("battery_m", battery),
    ("fairing_m_base", lambda n: fairing_base(n, D["M"], 0.25)), ("fairing_m_shell", lambda n: fairing_shell(n, D["M"], 4.0)),
    ("fairing_l_base", lambda n: fairing_base(n, D["L"], 0.4)), ("fairing_l_shell", lambda n: fairing_shell(n, D["L"], 8.0)),
    ("fin_small", lambda n: fin(n, 0.8, 0.35, 0.55, 0.35, 0.035)), ("fin_large", lambda n: fin(n, 2.2, 0.9, 1.5, 1.0, 0.07)),
    ("gridfin", gridfin), ("leg", leg), ("rcs", rcs), ("solar", solar), ("antenna", antenna),
    ("radial_decoupler", radial_decoupler), ("chute_radial", chute_radial),
    ("warhead_s", lambda n: warhead(n, D["S"], 1.1)), ("warhead_m", lambda n: warhead(n, D["M"], 2.0)),
]


def build_all(only=None):
    os.makedirs(OUT, exist_ok=True)
    for name, fn in BUILD:
        if only and name not in only:
            continue
        clear()
        export(fn(name))
    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    return manifest


def showcase():
    """Lay every part out in one scene for a visual check."""
    clear()
    x = 0.0
    for name, fn in BUILD:
        o = fn(name)
        bpy.context.view_layer.update()
        w = max(o.dimensions.x, o.dimensions.y)
        o.location.x = x + w / 2
        x += w + 0.6


if __name__ == "__main__":
    build_all()
