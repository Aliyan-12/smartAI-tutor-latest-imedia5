import json
import os
import re

from fastapi import HTTPException

from templates.presentation_layout import PresentationLayoutModel, SlideLayoutModel

TEMPLATES_BASE_DIR = "/app/servers/nextjs/app/presentation-templates"

_ZTYPE_TO_JSON = {
    "string": "string",
    "number": "number",
    "boolean": "boolean",
    "array": "array",
    "object": "object",
    "url": "string",
    "enum": "string",
}


def _build_json_schema_from_tsx(content: str, layout_name: str, layout_desc: str) -> dict:
    schema_match = re.search(r"z\.object\(\{([\s\S]*?)\}\)", content)
    properties: dict = {}
    if schema_match:
        block = schema_match.group(1)
        for field, ztype in re.findall(r"(\w+)\s*:\s*z\.(\w+)", block):
            if field.startswith("_"):
                continue
            json_type = _ZTYPE_TO_JSON.get(ztype, "string")
            if ztype == "array":
                properties[field] = {
                    "type": "array",
                    "items": {"type": "object"},
                    "description": field,
                }
            elif ztype in ("object", "url"):
                properties[field] = {"type": "object", "description": field}
            else:
                properties[field] = {"type": json_type, "description": field}
    if not properties:
        properties = {
            "title": {"type": "string"},
            "content": {"type": "string"},
        }
    return {
        "title": layout_name,
        "description": layout_desc,
        "type": "object",
        "properties": properties,
    }


def _parse_tsx_file(filepath: str) -> SlideLayoutModel | None:
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
    except Exception:
        return None

    lid = re.search(r"export\s+const\s+layoutId\s*=\s*['\"]([^'\"]+)['\"]", content)
    lname = re.search(r"export\s+const\s+layoutName\s*=\s*['\"]([^'\"]+)['\"]", content)
    ldesc = re.search(r"export\s+const\s+layoutDescription\s*=\s*['\"]([^'\"]+)['\"]", content)

    if not lid:
        return None

    layout_id = lid.group(1)
    layout_name = lname.group(1) if lname else layout_id
    layout_desc = ldesc.group(1) if ldesc else ""
    json_schema = _build_json_schema_from_tsx(content, layout_name, layout_desc)

    return SlideLayoutModel(
        id=layout_id,
        name=layout_name,
        description=layout_desc,
        json_schema=json_schema,
    )


async def get_layout_by_name(layout_name: str) -> PresentationLayoutModel:
    template_dir = os.path.join(TEMPLATES_BASE_DIR, layout_name)

    if not os.path.isdir(template_dir):
        raise HTTPException(
            status_code=404,
            detail=f"Template '{layout_name}' not found",
        )

    ordered = False
    settings_path = os.path.join(template_dir, "settings.json")
    if os.path.isfile(settings_path):
        try:
            with open(settings_path, "r", encoding="utf-8") as f:
                settings = json.load(f)
            ordered = bool(settings.get("ordered", False))
        except Exception:
            pass

    slides = []
    try:
        filenames = sorted(os.listdir(template_dir))
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Cannot read template dir: {exc}") from exc

    for filename in filenames:
        if not filename.endswith(".tsx"):
            continue
        if filename.startswith(".") or filename in ("index.tsx",):
            continue
        layout = _parse_tsx_file(os.path.join(template_dir, filename))
        if layout:
            slides.append(layout)

    if not slides:
        raise HTTPException(
            status_code=404,
            detail=f"No layouts found for template '{layout_name}'",
        )

    return PresentationLayoutModel(name=layout_name, ordered=ordered, slides=slides)
