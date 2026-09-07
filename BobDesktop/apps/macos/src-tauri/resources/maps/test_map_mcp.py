import importlib.util
import pathlib
import tempfile
import unittest
from unittest.mock import patch

MODULE_PATH = pathlib.Path(__file__).with_name("map_mcp.py")
SPEC = importlib.util.spec_from_file_location("map_mcp", MODULE_PATH)
assert SPEC and SPEC.loader
map_mcp = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(map_mcp)


class MapMcpTests(unittest.TestCase):
    def setUp(self):
        map_mcp._cache.clear()

    def test_geocode_returns_map_contract(self):
        photon = {"features": [{"geometry": {"coordinates": [2.3522, 48.8566]}, "properties": {"osm_id": 1, "name": "Paris", "country": "France", "type": "city"}}]}
        with patch.object(map_mcp, "_request", return_value=photon):
            result = map_mcp.call("map_geocode", {"query": "Paris"})
        self.assertEqual(result["kind"], "bob-map")
        self.assertEqual(result["markers"][0]["label"], "Paris — France")
        self.assertEqual(result["attribution"], "© OpenStreetMap contributors")

    def test_route_normalizes_valhalla_result(self):
        # Polyline6 for two nearby points; decoding itself is verified separately.
        valhalla = {"trip": {"summary": {"length": 2.5, "time": 420}, "legs": [{"shape": "_izlhA~rlgdF_{geC~ywl@", "maneuvers": [{"instruction": "Continuez", "length": 2.5, "time": 420}]}]}}
        with patch.object(map_mcp, "_request", return_value=valhalla):
            result = map_mcp.call("map_route", {"origin": {"lat": 48.85, "lon": 2.35, "label": "A"}, "destination": {"lat": 48.87, "lon": 2.38, "label": "B"}, "mode": "walking"})
        self.assertEqual(result["route"]["mode"], "walking")
        self.assertEqual(result["route"]["distanceMeters"], 2500)
        self.assertGreater(len(result["route"]["coordinates"]), 0)
        self.assertEqual(result["markers"][0]["id"], "origin")

    def test_invalid_mode_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError, "invalide"):
            map_mcp.call("map_route", {"origin": {}, "destination": {}, "mode": "plane"})

    def test_current_location_can_be_route_origin(self):
        valhalla = {"trip": {"summary": {"length": 1.2, "time": 600}, "legs": []}}
        with tempfile.TemporaryDirectory() as directory:
            server = pathlib.Path(directory) / "server.py"
            server.write_text("", encoding="utf-8")
            server.with_name("current-location.json").write_text('{"lat":48.8566,"lon":2.3522}', encoding="utf-8")
            with patch.object(map_mcp, "__file__", str(server)), patch.object(map_mcp, "_request", return_value=valhalla):
                result = map_mcp.call("map_route", {"destination": {"lat": 48.86, "lon": 2.34, "label": "Musée"}, "mode": "walking"})
        self.assertEqual(result["markers"][0]["kind"], "current-location")
        self.assertEqual(result["markers"][1]["kind"], "destination")

    def test_poi_search_keeps_multiple_markers(self):
        photon = {"features": [
            {"geometry": {"coordinates": [2.35, 48.85]}, "properties": {"osm_id": 1, "name": "Café A"}},
            {"geometry": {"coordinates": [2.36, 48.86]}, "properties": {"osm_id": 2, "name": "Café B"}},
        ]}
        with patch.object(map_mcp, "_request", return_value=photon):
            result = map_mcp.call("map_search_poi", {"query": "cafés", "near": {"lat": 48.85, "lon": 2.35}, "limit": 5})
        self.assertEqual(len(result["markers"]), 2)
        self.assertTrue(all(marker["kind"] == "place" for marker in result["markers"]))


if __name__ == "__main__":
    unittest.main()
