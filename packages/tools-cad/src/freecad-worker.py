import json
import math
import os
import traceback
import FreeCAD as App
import Part
import Mesh
import Sketcher


def write_report(path, value):
    with open(path, "w", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, separators=(",", ":"))


def shape_metrics(shape):
    bounds = shape.BoundBox
    return {
        "valid": bool(shape.isValid()),
        "closed": bool(shape.isClosed()),
        "solidCount": len(shape.Solids),
        "volumeMm3": float(shape.Volume),
        "boundsMm": {
            "x": float(bounds.XLength), "y": float(bounds.YLength), "z": float(bounds.ZLength),
            "min": [float(bounds.XMin), float(bounds.YMin), float(bounds.ZMin)],
            "max": [float(bounds.XMax), float(bounds.YMax), float(bounds.ZMax)],
        },
    }


def add_parameter(feature, name, value, kind="App::PropertyLength"):
    feature.addProperty(kind, name, "Design parameters")
    setattr(feature, name, value)


def make_enclosure(request):
    spec = request["spec"]
    p = spec["parameters"]
    board = p["board"]
    enclosure = p["enclosure"]
    bw, bl, bt = (float(board[k]) for k in ("width", "length", "thickness"))
    wall = float(enclosure["wallThickness"])
    floor = float(enclosure["floorThickness"])
    clearance = float(enclosure["boardClearance"])
    cover_gap = float(enclosure["coverClearance"])
    cover_thickness = float(enclosure["coverThickness"])
    standoff_height = float(enclosure["standoffHeight"])
    hole_inset = float(board["mountHoleInset"])
    board_hole_diameter = float(board["mountHoleDiameter"])
    screw_hole_diameter = float(enclosure["screwHoleDiameter"])
    standoff_outer = float(enclosure.get("standoffOuterDiameter", 3.2))
    base_height = float(enclosure.get("baseHeight", 12.0))
    cover_side_depth = float(enclosure.get("coverSideDepth", 5.0))
    if min(wall, floor, clearance, cover_gap, cover_thickness, standoff_height) <= 0:
        raise ValueError("All enclosure thicknesses and clearances must be positive")
    outer_w, outer_l = bw + 2 * clearance + 2 * wall, bl + 2 * clearance + 2 * wall
    inner_w, inner_l = outer_w - 2 * wall, outer_l - 2 * wall
    if floor >= base_height or standoff_height > base_height - floor:
        raise ValueError("Standoff and floor dimensions do not fit the base height")
    if hole_inset * 2 >= min(bw, bl) or screw_hole_diameter >= board_hole_diameter:
        raise ValueError("Mounting hole layout is geometrically invalid")

    doc = App.newDocument("ESP32_C3_SuperMini_Enclosure")
    outer = Part.makeBox(outer_w, outer_l, base_height)
    cavity = Part.makeBox(inner_w, inner_l, base_height - floor + 1, App.Vector(wall, wall, floor))
    base_shape = outer.cut(cavity)
    board_x, board_y = (outer_w - bw) / 2, (outer_l - bl) / 2
    centers = [
        (board_x + hole_inset, board_y + hole_inset),
        (board_x + bw - hole_inset, board_y + hole_inset),
        (board_x + hole_inset, board_y + bl - hole_inset),
        (board_x + bw - hole_inset, board_y + bl - hole_inset),
    ]
    for x, y in centers:
        support = Part.makeCylinder(standoff_outer / 2, standoff_height, App.Vector(x, y, floor))
        bore = Part.makeCylinder(screw_hole_diameter / 2, standoff_height + floor + 0.2, App.Vector(x, y, -0.1))
        base_shape = base_shape.fuse(support).cut(bore)
    base_shape = base_shape.removeSplitter()

    board_shape = Part.makeBox(bw, bl, bt, App.Vector(board_x, board_y, floor + standoff_height))
    for x, y in centers:
        drill = Part.makeCylinder(board_hole_diameter / 2, bt + 0.2, App.Vector(x, y, floor + standoff_height - 0.1))
        board_shape = board_shape.cut(drill)

    cap_wall = wall
    cap_inner_w, cap_inner_l = outer_w + 2 * cover_gap, outer_l + 2 * cover_gap
    cap_outer_w, cap_outer_l = cap_inner_w + 2 * cap_wall, cap_inner_l + 2 * cap_wall
    cap_x, cap_y = (outer_w - cap_outer_w) / 2, (outer_l - cap_outer_l) / 2
    cap_bottom = base_height - cover_side_depth
    cap_height = cover_side_depth + cover_gap + cover_thickness
    cap_outer = Part.makeBox(cap_outer_w, cap_outer_l, cap_height, App.Vector(cap_x, cap_y, cap_bottom))
    cap_inner = Part.makeBox(cap_inner_w, cap_inner_l, cap_height - cover_thickness + 0.1, App.Vector(cap_x + cap_wall, cap_y + cap_wall, cap_bottom - 0.1))
    cover_shape = cap_outer.cut(cap_inner).removeSplitter()

    base = doc.addObject("PartDesign::Feature", "Base")
    base.Label = "Enclosure base with four hollow standoffs"
    base.Shape = base_shape
    add_parameter(base, "OuterWidth", outer_w)
    add_parameter(base, "OuterLength", outer_l)
    add_parameter(base, "WallThickness", wall)
    add_parameter(base, "FloorThickness", floor)
    add_parameter(base, "BoardClearance", clearance)
    add_parameter(base, "StandoffHeight", standoff_height)
    add_parameter(base, "Exportable", True, "App::PropertyBool")
    cover = doc.addObject("PartDesign::Feature", "Cover")
    cover.Label = "Clearance-fit enclosure cover"
    cover.Shape = cover_shape
    add_parameter(cover, "CoverGap", cover_gap)
    add_parameter(cover, "CoverWall", cap_wall)
    add_parameter(cover, "CoverThickness", cover_thickness)
    add_parameter(cover, "Exportable", True, "App::PropertyBool")
    board_obj = doc.addObject("PartDesign::Feature", "BoardEnvelope")
    board_obj.Label = "Unverified ESP32-C3 board envelope (fixture assumption)"
    board_obj.Shape = board_shape
    add_parameter(board_obj, "BoardWidth", bw)
    add_parameter(board_obj, "BoardLength", bl)
    add_parameter(board_obj, "BoardThickness", bt)
    add_parameter(board_obj, "Exportable", False, "App::PropertyBool")
    doc.recompute()

    base_metrics, cover_metrics, board_metrics = map(lambda obj: shape_metrics(obj.Shape), (base, cover, board_obj))
    base_cover_intersection = float(base.Shape.common(cover.Shape).Volume)
    base_board_intersection = float(base.Shape.common(board_obj.Shape).Volume)
    cover_board_intersection = float(cover.Shape.common(board_obj.Shape).Volume)
    assembly = Part.makeCompound([base.Shape, cover.Shape])
    assembly_bounds = shape_metrics(assembly)["boundsMm"]
    step_path, stl_path = request["stepPath"], request["stlPath"]
    doc.saveAs(request["modelPath"])
    Part.export([base, cover], step_path)
    Mesh.export([base, cover], stl_path)
    step = Part.read(step_path)
    mesh = Mesh.Mesh(stl_path)
    checks = {
        "baseValid": base_metrics["valid"] and base_metrics["solidCount"] == 1,
        "coverValid": cover_metrics["valid"] and cover_metrics["solidCount"] == 1,
        "boardEnvelopeValid": board_metrics["valid"] and board_metrics["solidCount"] == 1,
        "noBaseCoverIntersection": base_cover_intersection < 1e-6,
        "noBaseBoardIntersection": base_board_intersection < 1e-6,
        "noCoverBoardIntersection": cover_board_intersection < 1e-6,
        "stepReimport": bool(step.isValid() and step.Volume > 0),
        "stepVolumeMm3": float(step.Volume),
        "stlReimport": bool(mesh.CountFacets > 0 and mesh.isSolid()),
        "stlFacetCount": int(mesh.CountFacets),
        "assemblyBounds": assembly_bounds,
    }
    ok = all(checks[k] for k in ("baseValid", "coverValid", "boardEnvelopeValid", "noBaseCoverIntersection", "noBaseBoardIntersection", "noCoverBoardIntersection", "stepReimport", "stlReimport"))
    assumptions = [{"parameter": item.get("parameter", "unspecified"), "reason": item.get("reason", "Fixture assumption must be confirmed against the exact board revision"), "source": item.get("source", "fixture assumption; not verified against manufacturer documentation")} for item in spec.get("assumptions", [])]
    report = {
        "ok": ok, "modelId": spec["modelId"], "units": "mm", "version": App.Version()[0],
        "parameters": {"outerMm": {"width": assembly_bounds["x"], "length": assembly_bounds["y"], "height": assembly_bounds["z"]}, "baseOuterMm": {"width": outer_w, "length": outer_l, "height": base_height}, "innerMm": {"width": inner_w, "length": inner_l}, "wallThicknessMm": wall, "floorThicknessMm": floor, "boardClearanceMm": clearance, "coverClearanceMm": cover_gap, "standoffHeightMm": standoff_height},
        "checks": checks, "shapes": [{"name": "Base", **base_metrics}, {"name": "Cover", **cover_metrics}, {"name": "BoardEnvelope", **board_metrics}],
        "intersectionsMm3": {"base-cover": base_cover_intersection, "base-board": base_board_intersection, "cover-board": cover_board_intersection}, "assumptions": assumptions,
        "warnings": ["Geometric checks do not confirm board dimensions, mounting-hole positions, fit, material, fastener strength, printability, or thermal performance."],
        "files": {"model": request["modelPath"], "step": step_path, "stl": stl_path},
    }
    doc.recompute()
    write_report(request["reportPath"], report)
    App.closeDocument(doc.Name)


def inspect_document(request):
    path = request["modelPath"]
    if path.lower().endswith(".fcstd"):
        doc = App.openDocument(path)
        objects = top_level_shape_objects(doc)
        shape_by_name = {obj.Name: obj.Shape for obj in objects}
    elif path.lower().endswith((".step", ".stp")):
        shape = Part.read(path)
        objects = []
        shape_by_name = {"ImportedSTEP": shape}
    else:
        raise ValueError("FreeCAD worker can inspect only FCStd and STEP geometry")
    shapes = [{"name": name, **shape_metrics(shape)} for name, shape in shape_by_name.items()]
    errors = [item["name"] for item in shapes if not item["valid"] or item["solidCount"] == 0 or item["volumeMm3"] <= 0]
    intersections, clearances = {}, []
    if request["action"] == "assembly":
        names = list(shape_by_name)
        for i, left in enumerate(names):
            for right in names[i + 1:]:
                left_shape, right_shape = shape_by_name[left], shape_by_name[right]
                overlap = float(left_shape.common(right_shape).Volume)
                intersections[left + "-" + right] = overlap
                clearances.append({"components": [left, right], "intersectionVolumeMm3": overlap, "distanceMm": float(left_shape.distToShape(right_shape)[0]), "boundingBoxesOverlap": bool(left_shape.BoundBox.intersect(right_shape.BoundBox) is not None)})
    assumptions = []
    metadata_report = {}
    metadata_path = os.path.join(os.path.dirname(path), "geometry.json")
    if path.lower().endswith(".fcstd") and os.path.isfile(metadata_path):
        try:
            with open(metadata_path, "r", encoding="utf-8") as stream:
                metadata_report = json.load(stream)
                assumptions = metadata_report.get("assumptions", [])
        except Exception:
            assumptions = [{"parameter": "model.assumptions", "reason": "Associated geometry assumptions could not be read."}]
    checks = {"shapeCount": len(shapes), "validShapeCount": len(shapes) - len(errors), "intersectionsMm3": intersections}
    source_checks = metadata_report.get("checks", {})
    for key in ("componentDimensionsStatus", "clearanceRequirementsStatus"):
        if key in source_checks:
            checks[key] = source_checks[key]
    failed_requirement = any(checks.get(key) == "FAIL" for key in ("componentDimensionsStatus", "clearanceRequirementsStatus"))
    report = {"ok": len(shapes) > 0 and not errors and all(value < 1e-6 for value in intersections.values()) and not failed_requirement, "version": App.Version()[0], "shapes": shapes, "checks": checks, "clearances": clearances, "assumptions": assumptions, "warnings": ["Bounding-box and geometric distance checks do not prove physical compatibility."]}
    write_report(request["reportPath"], report)
    if path.lower().endswith(".fcstd"):
        App.closeDocument(doc.Name)


def export_model(request):
    doc = App.openDocument(request["modelPath"])
    objects = []
    for obj in top_level_shape_objects(doc):
        if not hasattr(obj, "Shape") or obj.Shape.isNull():
            continue
        if "Exportable" in obj.PropertiesList and not obj.Exportable:
            continue
        if "Exportable" not in obj.PropertiesList and obj.Name == "BoardEnvelope":
            continue
        objects.append(obj)
    if not objects:
        raise ValueError("Model contains no exportable component solids")
    if request["format"] == "step":
        Part.export(objects, request["outputPath"])
        imported = Part.read(request["outputPath"])
        check = {"reimport": bool(imported.isValid() and imported.Volume > 0), "volumeMm3": float(imported.Volume), "solidCount": len(imported.Solids)}
    elif request["format"] == "stl":
        Mesh.export(objects, request["outputPath"])
        imported = Mesh.Mesh(request["outputPath"])
        check = {"reimport": bool(imported.CountFacets > 0 and imported.isSolid()), "facetCount": int(imported.CountFacets), "isSolid": bool(imported.isSolid())}
    else:
        raise ValueError("Unsupported CAD export format")
    write_report(request["reportPath"], {"ok": check["reimport"], "checks": check, "version": App.Version()[0], "warnings": []})
    App.closeDocument(doc.Name)


def run_request(request):
    try:
        action = request["action"]
        if action == "create":
            if request["spec"].get("modelId") == "mao-parametric-part":
                make_parametric_part(request)
            elif request["spec"].get("modelId") == "mao-parametric-assembly":
                make_parametric_assembly(request)
            else:
                make_enclosure(request)
        elif action in ("inspect", "assembly"):
            inspect_document(request)
        elif action == "export":
            export_model(request)
        else:
            raise ValueError("Unknown CAD worker action")
    except Exception as exc:
        traceback.print_exc()
        try:
            write_report(request["reportPath"], {"ok": False, "error": str(exc), "warnings": []})
        except Exception:
            pass


def primitive_shape(spec):
    position = spec.get("positionMm", [0, 0, 0])
    vector = App.Vector(float(position[0]), float(position[1]), float(position[2]))
    if spec["type"] == "box":
        size = spec["sizeMm"]
        return Part.makeBox(float(size[0]), float(size[1]), float(size[2]), vector)
    if spec["type"] == "cylinder":
        return Part.makeCylinder(float(spec["diameterMm"]) / 2, float(spec["heightMm"]), vector)
    raise ValueError("Unsupported CAD primitive; only box and cylinder are supported")


def top_level_shape_objects(doc):
    result = []
    for obj in doc.Objects:
        if not hasattr(obj, "Shape") or obj.Shape.isNull():
            continue
        if not (obj.TypeId in ("PartDesign::Body", "PartDesign::Feature", "Part::Feature") or obj.TypeId.startswith("Part::")):
            continue
        parents = getattr(obj, "InList", [])
        if any(parent.TypeId == "PartDesign::Body" for parent in parents):
            continue
        result.append(obj)
    return result


def profile_geometry(profile):
    kind = profile["type"]
    if kind == "rectangle":
        x, y = profile.get("positionMm", [0, 0])
        width, length = float(profile["widthMm"]), float(profile["lengthMm"])
        points = [App.Vector(x, y, 0), App.Vector(x + width, y, 0), App.Vector(x + width, y + length, 0), App.Vector(x, y + length, 0)]
        return [Part.LineSegment(points[index], points[(index + 1) % 4]) for index in range(4)]
    if kind == "circle":
        x, y = profile.get("centerMm", [0, 0])
        return [Part.Circle(App.Vector(x, y, 0), App.Vector(0, 0, 1), float(profile["diameterMm"]) / 2)]
    if kind == "circle-array":
        return [Part.Circle(App.Vector(center[0], center[1], 0), App.Vector(0, 0, 1), float(profile["diameterMm"]) / 2) for center in profile["centersMm"]]
    raise ValueError("Unsupported sketch profile")


def add_sketch(doc, body, name, profile, plane_z):
    sketch = body.newObject("Sketcher::SketchObject", name)
    sketch.Placement.Base = App.Vector(0, 0, float(plane_z))
    geometry = profile_geometry(profile)
    for index, item in enumerate(geometry):
        sketch.addGeometry(item, False)
        sketch.addConstraint(Sketcher.Constraint("Block", index))
    doc.recompute()
    return sketch


def component_placement(component):
    position = component.get("positionMm", [0, 0, 0])
    rotation = component.get("rotationDeg", [0, 0, 0])
    # FreeCAD's three-number constructor is yaw, pitch, roll; the input contract is XYZ Euler.
    euler = App.Rotation(float(rotation[2]), float(rotation[1]), float(rotation[0]))
    return App.Placement(App.Vector(float(position[0]), float(position[1]), float(position[2])), euler)


def create_sketch_component(doc, component):
    internal_name = "Body_" + component["id"].replace("-", "_")
    body = doc.addObject("PartDesign::Body", internal_name)
    body.Label = component["id"]
    body.Placement = component_placement(component)
    history = []
    sketch = add_sketch(doc, body, "BaseProfile", component["profile"], 0)
    history.append({"component": component["id"], "type": sketch.TypeId, "name": sketch.Name, "fullyConstrained": bool(sketch.FullyConstrained), "geometryCount": len(sketch.Geometry)})
    current = body.newObject("PartDesign::Pad", "BasePad")
    current.Profile = sketch
    current.Length = float(component["baseHeightMm"])
    doc.recompute()
    sketch.Visibility = False
    history.append({"component": component["id"], "type": current.TypeId, "name": current.Name, "lengthMm": float(current.Length), "valid": bool(not current.Shape.isNull() and current.Shape.isValid())})
    if current.Shape.isNull() or not current.Shape.isValid():
        raise ValueError("Base Pad failed for component " + component["id"])

    for index, operation in enumerate(component["features"]):
        kind = operation["type"]
        sequence = index + 1
        if kind in ("pad", "extrude"):
            profile = operation["profile"]
            sketch = add_sketch(doc, body, "Profile_%02d" % sequence, profile, operation.get("planeZmm", 0))
            feature = body.newObject("PartDesign::Pad", "Pad_%02d" % sequence)
            feature.Profile = sketch
            feature.Length = float(operation["heightMm"])
            doc.recompute()
            sketch.Visibility = False
            history.append({"component": component["id"], "type": sketch.TypeId, "name": sketch.Name, "fullyConstrained": bool(sketch.FullyConstrained), "geometryCount": len(sketch.Geometry)})
            history.append({"component": component["id"], "type": feature.TypeId, "name": operation.get("name", feature.Name), "heightMm": float(feature.Length), "valid": bool(not feature.Shape.isNull() and feature.Shape.isValid())})
        elif kind in ("pocket", "hole_array"):
            if kind == "hole_array":
                profile = {"type": "circle-array", "diameterMm": operation["diameterMm"], "centersMm": operation["centersMm"]}
            else:
                profile = operation["profile"]
            plane_z = operation.get("planeZmm", component["baseHeightMm"])
            sketch = add_sketch(doc, body, "PocketProfile_%02d" % sequence, profile, plane_z)
            feature = body.newObject("PartDesign::Pocket", "Pocket_%02d" % sequence)
            feature.Profile = sketch
            feature.Length = float(operation.get("depthMm", component["baseHeightMm"]))
            feature.Reversed = bool(operation.get("reversed", False))
            doc.recompute()
            sketch.Visibility = False
            history.append({"component": component["id"], "type": sketch.TypeId, "name": sketch.Name, "fullyConstrained": bool(sketch.FullyConstrained), "geometryCount": len(sketch.Geometry)})
            history.append({"component": component["id"], "type": feature.TypeId, "name": operation.get("name", feature.Name), "depthMm": float(feature.Length), "holeCount": len(sketch.Geometry) if kind == "hole_array" else 0, "valid": bool(not feature.Shape.isNull() and feature.Shape.isValid())})
        elif kind in ("fillet", "chamfer"):
            feature_type = "PartDesign::Fillet" if kind == "fillet" else "PartDesign::Chamfer"
            feature = body.newObject(feature_type, "%s_%02d" % (kind.title(), sequence))
            feature.Base = (current, operation["edgeNames"])
            if kind == "fillet":
                feature.Radius = float(operation["radiusMm"])
                amount = float(feature.Radius)
            else:
                feature.Size = float(operation["sizeMm"])
                amount = float(feature.Size)
            doc.recompute()
            history.append({"component": component["id"], "type": feature.TypeId, "name": operation.get("name", feature.Name), "edgeNames": operation["edgeNames"], "radiusOrSizeMm": amount, "valid": bool(not feature.Shape.isNull() and feature.Shape.isValid())})
        else:
            raise ValueError("Unsupported feature operation " + kind)
        if feature.Shape.isNull() or not feature.Shape.isValid() or len(feature.Shape.Solids) != 1:
            raise ValueError("Feature %s failed or produced invalid multi-solid geometry" % operation.get("name", kind))
        current = feature
        body.Tip = feature
    body.addProperty("App::PropertyBool", "Exportable", "MAO CAD"); body.Exportable = True
    body.addProperty("App::PropertyString", "ParametersJson", "MAO CAD"); body.ParametersJson = json.dumps(component, sort_keys=True)
    return body, history


def make_reference_component(doc, component):
    dimensions = component["dimensionsMm"]
    obj = doc.addObject("PartDesign::Feature", "Reference_" + component["id"].replace("-", "_"))
    obj.Label = component["id"] + " (reference envelope)"
    obj.Shape = Part.makeBox(float(dimensions["width"]), float(dimensions["length"]), float(dimensions["height"]))
    obj.Placement = component_placement(component)
    obj.addProperty("App::PropertyBool", "Exportable", "MAO CAD"); obj.Exportable = False
    obj.addProperty("App::PropertyString", "Confidence", "MAO CAD"); obj.Confidence = component["confidence"]
    obj.addProperty("App::PropertyString", "Source", "MAO CAD"); obj.Source = component["source"]
    return obj


def make_parametric_assembly(request):
    spec = request["spec"]
    doc = App.newDocument("MAO_Parametric_Assembly")
    components, history, failed = [], [], []
    for component in spec["parameters"]["components"]:
        if component.get("referenceOnly"):
            obj = make_reference_component(doc, component)
        else:
            obj, component_history = create_sketch_component(doc, component)
            history.extend(component_history)
        components.append((component, obj))
    doc.recompute()
    shapes = [(component, obj, obj.Shape) for component, obj in components]
    component_reports = []
    for component, obj, shape in shapes:
        metrics = shape_metrics(shape)
        if not metrics["valid"] or metrics["solidCount"] != 1 or metrics["volumeMm3"] <= 0:
            failed.append(component["id"])
        component_reports.append({"id": component["id"], "referenceOnly": bool(component.get("referenceOnly")), "confidence": component.get("confidence", "design-generated"), "source": component.get("source", "parameterized CAD specification"), "tolerancesMm": component.get("tolerancesMm"), **metrics})
    intersections, clearances = {}, []
    for index, (left_component, _left_obj, left_shape) in enumerate(shapes):
        for right_component, _right_obj, right_shape in shapes[index + 1:]:
            key = left_component["id"] + "-" + right_component["id"]
            overlap = float(left_shape.common(right_shape).Volume)
            separation = float(left_shape.distToShape(right_shape)[0])
            intersections[key] = overlap
            clearances.append({"components": [left_component["id"], right_component["id"]], "intersectionVolumeMm3": overlap, "distanceMm": separation, "boundingBoxesOverlap": bool(left_shape.BoundBox.intersect(right_shape.BoundBox) is not None)})
    all_valid = not failed
    no_collisions = all(value < 1e-6 for value in intersections.values())
    assembly = Part.makeCompound([shape for _, _, shape in shapes])
    bounds = shape_metrics(assembly)["boundsMm"]
    dimension_comparisons = []
    unverified_dimensions = False
    for component, obj, shape in shapes:
        declared = component.get("dimensionsMm")
        if not declared:
            continue
        measured = shape_metrics(shape)["boundsMm"]
        tolerance = float(component.get("tolerancesMm", {}).get("linear", 0))
        deltas = {key: abs(float(measured[axis]) - float(declared[key])) for key, axis in (("width", "x"), ("length", "y"), ("height", "z"))}
        confidence = component.get("confidence", "unknown")
        status = "NEEDS_REVIEW" if confidence != "verified" else "PASS" if all(delta <= tolerance for delta in deltas.values()) else "FAIL"
        if status != "PASS":
            unverified_dimensions = True
        dimension_comparisons.append({"component": component["id"], "declaredMm": declared, "measuredBoundingBoxMm": {"width": measured["x"], "length": measured["y"], "height": measured["z"]}, "absoluteDeltaMm": deltas, "toleranceMm": tolerance, "confidence": confidence, "source": component.get("source"), "status": status, "warning": "Bounding-box agreement alone does not prove physical compatibility."})
    dimension_failure = any(item["status"] == "FAIL" for item in dimension_comparisons)
    clearance_checks = []
    for requirement in spec["parameters"].get("clearanceRequirements", []):
        target_ids = set(requirement["components"])
        measured = next((item for item in clearances if set(item["components"]) == target_ids), None)
        if measured is None:
            status, gap = "FAIL", None
        else:
            gap = float(measured["distanceMm"])
            matches = abs(gap - float(requirement["nominalGapMm"])) <= float(requirement["toleranceMm"])
            status = "NEEDS_REVIEW" if requirement["confidence"] != "verified" else "PASS" if matches else "FAIL"
        clearance_checks.append({"components": requirement["components"], "nominalGapMm": float(requirement["nominalGapMm"]), "measuredGapMm": gap, "toleranceMm": float(requirement["toleranceMm"]), "confidence": requirement["confidence"], "source": requirement["source"], "status": status, "warning": "Distance is a geometric result and does not establish assembly fit or physical compatibility."})
    clearance_failure = any(item["status"] == "FAIL" for item in clearance_checks)
    unverified_clearance = any(item["status"] == "NEEDS_REVIEW" for item in clearance_checks)
    step_path, stl_path = request["stepPath"], request["stlPath"]
    doc.saveAs(request["modelPath"])
    export_objects = [obj for _, obj in components if obj.Exportable]
    Part.export(export_objects, step_path)
    Mesh.export(export_objects, stl_path)
    step = Part.read(step_path)
    mesh = Mesh.Mesh(stl_path)
    checks = {"allComponentsValid": all_valid, "invalidComponents": failed, "noVolumeCollisions": no_collisions, "stepReimport": bool(step.isValid() and step.Volume > 0), "stepVolumeMm3": float(step.Volume), "stlReimport": bool(mesh.CountFacets > 0 and mesh.isSolid()), "stlFacetCount": int(mesh.CountFacets), "assemblyBounds": bounds, "componentDimensionsStatus": "FAIL" if dimension_failure else "NEEDS_REVIEW" if unverified_dimensions else "PASS", "clearanceRequirementsStatus": "FAIL" if clearance_failure else "NEEDS_REVIEW" if unverified_clearance else "PASS"}
    ok = all(checks[key] for key in ("allComponentsValid", "noVolumeCollisions", "stepReimport", "stlReimport")) and not dimension_failure and not clearance_failure
    assumptions = [{"parameter": item.get("parameter", "unspecified"), "reason": item.get("reason", "Fixture assumption must be confirmed"), "source": item.get("source", "fixture assumption")} for item in spec.get("assumptions", [])]
    for component, _, _ in shapes:
        if component.get("referenceOnly") and component.get("confidence") != "verified":
            assumptions.append({"parameter": component["id"] + " dimensions", "reason": "Reference envelope dimensions are not verified against a supplied manufacturer drawing or physical measurement.", "source": component.get("source", "not documented")})
    report = {"ok": ok, "modelId": spec["modelId"], "units": "mm", "version": App.Version()[0], "parameters": {"outerMm": {"width": bounds["x"], "length": bounds["y"], "height": bounds["z"]}, "nominalParameters": spec["parameters"].get("nominalParameters", {})}, "checks": checks, "components": component_reports, "componentDimensions": dimension_comparisons, "clearances": clearances, "clearanceChecks": clearance_checks, "featureHistory": history, "assumptions": assumptions, "warnings": ["Bounding boxes do not establish fit or compatibility. Unverified dimensions require engineering review.", "Geometric gaps and collisions do not certify mechanical load, printability, material behavior or thermal safety."], "files": {"model": request["modelPath"], "step": step_path, "stl": stl_path}}
    write_report(request["reportPath"], report)
    App.closeDocument(doc.Name)


def make_parametric_part(request):
    spec = request["spec"]
    doc = App.newDocument("MAO_Parametric_Part")
    objects = []
    failed = []
    for part_spec in spec["parameters"]["parts"]:
        shape = primitive_shape(part_spec["base"])
        for feature in part_spec["features"]:
            operand = primitive_shape(feature["shape"])
            if feature["operation"] == "union":
                shape = shape.fuse(operand).removeSplitter()
            elif feature["operation"] == "cut":
                shape = shape.cut(operand).removeSplitter()
            else:
                raise ValueError("Unsupported boolean operation; use union or cut")
        internal_name = "Part_" + part_spec["id"].replace("-", "_")
        obj = doc.addObject("PartDesign::Feature", internal_name)
        obj.Label = part_spec["id"]
        obj.Shape = shape
        add_parameter(obj, "Exportable", True, "App::PropertyBool")
        add_parameter(obj, "ParameterSpec", json.dumps(part_spec, sort_keys=True), "App::PropertyString")
        objects.append(obj)
        metrics = shape_metrics(shape)
        if not metrics["valid"] or metrics["solidCount"] != 1 or metrics["volumeMm3"] <= 0:
            failed.append(part_spec["id"])
    doc.recompute()
    intersections = {}
    for index, left in enumerate(objects):
        for right in objects[index + 1:]:
            intersections[left.Name + "-" + right.Name] = float(left.Shape.common(right.Shape).Volume)
    all_valid = not failed
    no_intersections = all(value < 1e-6 for value in intersections.values())
    assembly = Part.makeCompound([obj.Shape for obj in objects])
    bounds = shape_metrics(assembly)["boundsMm"]
    doc.saveAs(request["modelPath"])
    export_objects = [obj for obj in objects if obj.Exportable]
    Part.export(export_objects, request["stepPath"])
    Mesh.export(export_objects, request["stlPath"])
    step = Part.read(request["stepPath"])
    mesh = Mesh.Mesh(request["stlPath"])
    checks = {
        "allPartsValid": all_valid,
        "invalidParts": failed,
        "noPartIntersections": no_intersections,
        "intersectionsMm3": intersections,
        "stepReimport": bool(step.isValid() and step.Volume > 0),
        "stepVolumeMm3": float(step.Volume),
        "stlReimport": bool(mesh.CountFacets > 0 and mesh.isSolid()),
        "stlFacetCount": int(mesh.CountFacets),
        "assemblyBounds": bounds,
    }
    ok = all(checks[key] for key in ("allPartsValid", "noPartIntersections", "stepReimport", "stlReimport"))
    assumptions = [{"parameter": item.get("parameter", "unspecified"), "reason": item.get("reason", "Fixture assumption must be confirmed"), "source": item.get("source", "fixture assumption")} for item in spec.get("assumptions", [])]
    report = {
        "ok": ok,
        "modelId": spec["modelId"],
        "units": "mm",
        "version": App.Version()[0],
        "parameters": {"outerMm": {"width": bounds["x"], "length": bounds["y"], "height": bounds["z"]}, "parts": [{"id": item["id"], "featureCount": len(item["features"]), "parameterSpec": item} for item in spec["parameters"]["parts"]]},
        "checks": checks,
        "shapes": [{"name": obj.Name, **shape_metrics(obj.Shape)} for obj in objects],
        "intersectionsMm3": intersections,
        "assumptions": assumptions,
        "warnings": ["Boolean validity and dimensions do not certify load, fit, material, manufacturing, or thermal safety."],
        "files": {"model": request["modelPath"], "step": request["stepPath"], "stl": request["stlPath"]},
    }
    write_report(request["reportPath"], report)
    App.closeDocument(doc.Name)
