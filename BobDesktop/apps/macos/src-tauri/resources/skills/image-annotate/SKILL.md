---
name: image-annotate
description: Annotate screenshots or images with red rectangles, arrows, or labels to highlight UI regions — uses shared Python + Pillow.
icon: designer
user-invocable: true
---

# Image annotate

Draw clear visual callouts on screenshots and images attached to the prompt (or paths the user gives). Prefer the shared Bob Work Python runtime, which already includes Pillow.

## When to use

- User asks to highlight, circle, box, underline, or mark something on a screenshot / PNG / JPEG / WebP
- User wants red (or other color) rectangles, arrows, or short labels on an image
- Compare two screenshots with annotated regions

## Runtime (native — no plugin install)

1. Prefer `$BOB_WORK_SHARED_PYTHON` when set.
2. Else use `~/.bob/runtimes/shared/python/venv/bin/python` if it exists.
3. Else `python3` on PATH.
4. Verify Pillow once: `python -c "from PIL import Image, ImageDraw; print('ok')"`.
5. If Pillow is missing, install into the **shared** venv only when the user accepts:  
   `"$python" -m pip install --upgrade Pillow`  
   Do **not** invent a plugin `privateDependencies` PyPI shorthand.

## How to annotate

1. Open the source image with Pillow (`Image.open`).
2. Draw with `ImageDraw.Draw`:
   - **Rectangle highlight**: `outline=(220, 38, 38)`, `width=max(3, image.width // 400)`.
   - Optional semi-transparent fill via an RGBA overlay if the user asks for a “mask”.
   - **Arrow / line**: same red stroke; keep geometry simple.
   - **Label**: short text near the box; white fill + red outline for readability.
3. Coordinates: accept user pixels; if they describe a region in words (“the Save button top-right”), estimate carefully and state the assumption.
4. Save as a **new** PNG in the workspace (never overwrite the attachment unless asked):  
   e.g. `annotated-<stem>.png` next to the source or under the active project folder.
5. Cite the **absolute path** of the annotated file in the reply so Bob Work can preview it.

## Minimal recipe

```python
from PIL import Image, ImageDraw

src = Image.open(source_path).convert("RGBA")
draw = ImageDraw.Draw(src)
# xy = (left, top, right, bottom)
draw.rectangle(xy, outline=(220, 38, 38), width=4)
src.convert("RGB").save(output_path, format="PNG")
```

## Forbidden

- Loading Docling / Office / Visualize only to draw boxes
- Claiming annotation is impossible when shared Python + Pillow are available
- Overwriting the original attachment without an explicit request
- Creating a plugin just to wrap Pillow

## Language

- Skill file: English.
- User-facing replies: same language as the user prompt.
