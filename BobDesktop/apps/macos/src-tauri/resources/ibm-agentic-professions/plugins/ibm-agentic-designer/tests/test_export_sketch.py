import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "export_sketch.py"
SPEC = importlib.util.spec_from_file_location("export_sketch", SCRIPT)
assert SPEC and SPEC.loader
export_sketch = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(export_sketch)


def notes_design():
    def screen(screen_id, title):
        return {
            "id": screen_id,
            "type": "Page",
            "name": title,
            "layout": {"width": 390, "height": 844, "mode": "VERTICAL", "padding": 24, "gap": 16},
            "style": {"background": "{surface}"},
            "children": [
                {
                    "id": f"{screen_id}-title",
                    "type": "Text",
                    "text": title,
                    "layout": {"width": "fill", "height": 40},
                    "style": {"fontSize": 28, "fontWeight": 700, "color": "$ink"},
                },
                {
                    "id": f"{screen_id}-card",
                    "type": "Card",
                    "layout": {"width": "fill", "height": 120, "mode": "VERTICAL", "padding": 16},
                    "style": {"background": "#ffffff", "border": "1px solid #d8d8d8", "radius": 12},
                    "children": [
                        {"id": f"{screen_id}-body", "type": "Text", "text": "Contenu de la note", "style": {"fontSize": 16, "color": "#303030"}}
                    ],
                },
                {
                    "id": f"{screen_id}-action",
                    "type": "Button",
                    "text": "Nouvelle note",
                    "layout": {"width": "fill", "height": 48},
                    "style": {"background": "#0f62fe", "color": "#ffffff", "radius": 12},
                },
            ],
        }

    return {
        "version": "1.0",
        "document": {"id": "notes", "name": "Notes", "pages": [screen("notes-list", "Mes notes"), screen("note-detail", "Détail")]},
        "tokens": {"surface": {"value": "#f7f8fb"}, "ink": {"value": "#161616"}},
        "components": {},
        "assets": {},
        "metadata": {"title": "Notes mobile"},
    }


class SketchExportTests(unittest.TestCase):
    def test_loose_content_and_object_actions_are_not_dropped(self):
        source = notes_design()
        source["document"]["pages"][0]["children"] = [
            {
                "id": "intro",
                "type": "Section",
                "heading": "Bienvenue",
                "body": "Retrouvez toutes vos notes.",
            },
            {
                "id": "actions",
                "type": "Group",
                "actions": [{"id": "create", "label": "Créer une note"}],
            },
        ]
        canonical = export_sketch.normalize_design_ir(source)
        children = canonical["document"]["pages"][0]["children"]
        self.assertEqual(["Bienvenue", "Retrouvez toutes vos notes."], [item["text"] for item in children[0]["children"]])
        self.assertEqual("Button", children[1]["children"][0]["type"])
        self.assertEqual("Créer une note", children[1]["children"][0]["text"])

    def test_screens_are_distinct_styled_artboards_with_laid_out_children(self):
        package = export_sketch.build_package(notes_design())
        artboards = package["page"]["layers"]
        self.assertEqual(2, len(artboards))
        self.assertTrue(all(layer["_class"] == "MSImmutableArtboardGroup" for layer in artboards))
        self.assertEqual([0, 470], [layer["frame"]["x"] for layer in artboards])
        self.assertTrue(all(layer["hasBackgroundColor"] for layer in artboards))

        first_children = artboards[0]["layers"]
        self.assertEqual([24, 80, 216], [layer["frame"]["y"] for layer in first_children])
        self.assertGreater(first_children[1]["layers"][0]["style"]["fills"][0]["color"]["alpha"], 0)
        title_attributes = first_children[0]["attributedString"]["attributes"]
        self.assertEqual("Inter-Bold", title_attributes[0]["attributes"]["MSAttributedStringFontAttribute"]["attributes"]["name"])
        self.assertEqual("Mes notes", first_children[0]["attributedString"]["string"])

    def test_real_zip_contains_sketch_document_and_page(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "notes.design.json"
            output = root / "notes.sketch"
            source.write_text(json.dumps(notes_design()), encoding="utf-8")
            export_sketch.write_sketch(source, output)
            self.assertEqual(b"PK", output.read_bytes()[:2])
            with zipfile.ZipFile(output) as archive:
                self.assertEqual(
                    {"document.json", "meta.json", "pages/bobwork-page-1.json", "user.json", "workspace.json"},
                    set(archive.namelist()),
                )
                page = json.loads(archive.read("pages/bobwork-page-1.json"))
                self.assertEqual(2, len(page["layers"]))


if __name__ == "__main__":
    unittest.main()
