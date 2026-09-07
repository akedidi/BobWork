#!/usr/bin/env python3
"""Structured map tools for Bob Work (Photon + Valhalla, configurable endpoints)."""
from __future__ import annotations

import json
import datetime as dt
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

GEOCODER = os.environ.get("BOB_MAP_GEOCODER_URL", "https://photon.komoot.io").rstrip("/")
ROUTER = os.environ.get("BOB_MAP_ROUTER_URL", "https://valhalla1.openstreetmap.de").rstrip("/")
USER_AGENT = os.environ.get("BOB_MAP_USER_AGENT", "Bob-Work/1.0 map-tools (interactive user requests)")
ATTRIBUTION = "© OpenStreetMap contributors"
_last_request = 0.0
_cache: dict[str, Any] = {}

TOOLS = [
    {"name": "map_geocode", "description": "Recherche un lieu ou une adresse et renvoie des résultats structurés affichables sur une carte.", "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}, "limit": {"type": "integer", "minimum": 1, "maximum": 10}, "language": {"type": "string"}}, "required": ["query"]}},
    {"name": "map_reverse_geocode", "description": "Identifie le lieu correspondant à des coordonnées.", "inputSchema": {"type": "object", "properties": {"lat": {"type": "number", "minimum": -90, "maximum": 90}, "lon": {"type": "number", "minimum": -180, "maximum": 180}, "language": {"type": "string"}}, "required": ["lat", "lon"]}},
    {"name": "map_search_poi", "description": "Recherche plusieurs points d’intérêt. Si near est omis et que l’utilisateur a autorisé sa position dans les réglages, la recherche est centrée sur sa position actuelle.", "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}, "near": {"type": "object", "properties": {"lat": {"type": "number"}, "lon": {"type": "number"}}, "required": ["lat", "lon"]}, "limit": {"type": "integer", "minimum": 1, "maximum": 10}, "language": {"type": "string"}}, "required": ["query"]}},
    {"name": "map_current_location", "description": "Renvoie la dernière position actuelle que l’utilisateur a explicitement autorisée dans les réglages Bob Work ou BobMobile.", "inputSchema": {"type": "object", "properties": {}}},
    {"name": "map_route", "description": "Calcule un itinéraire conduite, marche, vélo ou transports. Si origin est omis, utilise la position actuelle autorisée dans les réglages.", "inputSchema": {"type": "object", "properties": {"origin": {"oneOf": [{"type": "string"}, {"$ref": "#/$defs/place"}]}, "destination": {"oneOf": [{"type": "string"}, {"$ref": "#/$defs/place"}]}, "mode": {"type": "string", "enum": ["driving", "walking", "cycling", "transit"]}, "language": {"type": "string"}}, "required": ["destination"], "$defs": {"place": {"type": "object", "properties": {"lat": {"type": "number"}, "lon": {"type": "number"}, "label": {"type": "string"}}, "required": ["lat", "lon"]}}}},
]

def _current_location() -> dict[str, Any]:
    path = Path(__file__).with_name("current-location.json")
    if not path.is_file():
        raise RuntimeError("La position actuelle n’est pas autorisée. Activez-la dans Réglages > Général > Position actuelle.")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        lat, lon = float(value["lat"]), float(value["lon"])
    except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError) as error:
        raise RuntimeError("La position actuelle enregistrée est invalide. Actualisez-la dans les réglages.") from error
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise RuntimeError("La position actuelle enregistrée est invalide. Actualisez-la dans les réglages.")
    return {"id": "current-location", "kind": "current-location", "label": "Ma position actuelle", "lat": lat, "lon": lon, "updatedAt": value.get("updatedAt")}

def _request(url: str, body: dict[str, Any] | None = None) -> Any:
    global _last_request
    key = url if body is None else url + "\n" + json.dumps(body, sort_keys=True)
    if key in _cache:
        return _cache[key]
    wait = 0.25 - (time.monotonic() - _last_request)
    if wait > 0:
        time.sleep(wait)
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT, "Accept": "application/json", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            value = json.load(response)
    except Exception as first_error:  # Apple's system Python can reject the public Valhalla TLS handshake.
        command = ["curl", "-sS", "--fail-with-body", "--max-time", "25", "-H", f"User-Agent: {USER_AGENT}", "-H", "Accept: application/json"]
        if data is not None:
            command += ["-H", "Content-Type: application/json", "--data-binary", "@-"]
        command.append(url)
        done = subprocess.run(command, input=data, capture_output=True, timeout=30, check=False)
        if done.returncode != 0:
            detail = done.stdout.decode("utf-8", "replace").strip() or done.stderr.decode("utf-8", "replace").strip()
            raise RuntimeError(detail or str(first_error)) from first_error
        value = json.loads(done.stdout)
    _last_request = time.monotonic()
    _cache[key] = value
    return value

def _label(props: dict[str, Any]) -> str:
    name = props.get("name") or props.get("street") or props.get("city") or props.get("country") or "Lieu"
    details = [props.get(key) for key in ("housenumber", "street", "city", "state", "country")]
    suffix = ", ".join(str(value) for value in details if value and str(value) not in str(name))
    return f"{name} — {suffix}" if suffix else str(name)

def _markers(features: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = []
    for index, feature in enumerate(features):
        coordinates = feature.get("geometry", {}).get("coordinates", [])
        if len(coordinates) < 2:
            continue
        props = feature.get("properties", {})
        result.append({"id": str(props.get("osm_id") or index + 1), "kind": "place", "label": _label(props), "description": props.get("type") or props.get("osm_value"), "category": props.get("osm_key"), "lon": float(coordinates[0]), "lat": float(coordinates[1])})
    return result

def _photon(query: str, limit: int, language: str, near: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    params: dict[str, Any] = {"q": query, "limit": min(max(limit, 1), 10), "lang": language}
    if near:
        params.update({"lat": float(near["lat"]), "lon": float(near["lon"])})
    data = _request(f"{GEOCODER}/api/?{urllib.parse.urlencode(params)}")
    return _markers(data.get("features", []))

def _reverse(lat: float, lon: float, language: str) -> list[dict[str, Any]]:
    params = urllib.parse.urlencode({"lat": lat, "lon": lon, "lang": language})
    return _markers(_request(f"{GEOCODER}/reverse?{params}").get("features", []))

def _place(value: Any, language: str) -> dict[str, Any]:
    if value is None or (isinstance(value, str) and value.strip().lower() in {"current", "current location", "ma position", "ma position actuelle", "mi ubicación", "mi posición"}):
        return _current_location()
    if isinstance(value, dict) and "lat" in value and "lon" in value:
        return {"lat": float(value["lat"]), "lon": float(value["lon"]), "label": str(value.get("label") or "Lieu")}
    if not isinstance(value, str) or not value.strip():
        raise RuntimeError("Le départ et l’arrivée doivent être un lieu ou des coordonnées")
    matches = _photon(value.strip(), 1, language)
    if not matches:
        raise RuntimeError(f"Lieu introuvable : {value}")
    return matches[0]

def _decode_polyline6(value: str) -> list[dict[str, float]]:
    coordinates, index, lat, lon = [], 0, 0, 0
    while index < len(value):
        deltas = []
        for _ in range(2):
            result, shift = 0, 0
            while True:
                byte = ord(value[index]) - 63
                index += 1
                result |= (byte & 0x1f) << shift
                shift += 5
                if byte < 0x20:
                    break
            deltas.append(~(result >> 1) if result & 1 else result >> 1)
        lat += deltas[0]
        lon += deltas[1]
        coordinates.append({"lat": lat / 1_000_000, "lon": lon / 1_000_000})
    return coordinates

def _map(title: str, markers: list[dict[str, Any]], route: dict[str, Any] | None = None, routing: str | None = None) -> dict[str, Any]:
    value: dict[str, Any] = {"schemaVersion": 1, "kind": "bob-map", "title": title, "markers": markers, "fitBounds": True, "attribution": ATTRIBUTION, "provider": {"geocoding": "Photon / OpenStreetMap", "tiles": "OpenStreetMap"}}
    if route:
        value["route"] = route
        value["provider"]["routing"] = routing or "Valhalla / OpenStreetMap"
    return value

def call(name: str, args: dict[str, Any]) -> dict[str, Any]:
    language = str(args.get("language") or "fr")[:2]
    if name in ("map_geocode", "map_search_poi"):
        query = str(args.get("query") or "").strip()
        if not query:
            raise RuntimeError("La recherche ne peut pas être vide")
        near = args.get("near") if name == "map_search_poi" else None
        if name == "map_search_poi" and near is None:
            try:
                current = _current_location()
                near = {"lat": current["lat"], "lon": current["lon"]}
            except RuntimeError:
                pass
        places = _photon(query, int(args.get("limit", 5)), language, near)
        return _map(query, places)
    if name == "map_current_location":
        current = _current_location()
        return _map("Ma position actuelle", [current])
    if name == "map_reverse_geocode":
        lat, lon = float(args["lat"]), float(args["lon"])
        return _map("Lieu identifié", _reverse(lat, lon, language) or [{"id": "coordinate", "label": f"{lat:.6f}, {lon:.6f}", "lat": lat, "lon": lon}])
    if name == "map_route":
        mode = str(args.get("mode") or "driving")
        costings = {"driving": "auto", "walking": "pedestrian", "cycling": "bicycle", "transit": "multimodal"}
        if mode not in costings:
            raise RuntimeError("Mode d’itinéraire invalide")
        origin, destination = _place(args.get("origin"), language), _place(args.get("destination"), language)
        payload = {"locations": [{"lat": origin["lat"], "lon": origin["lon"]}, {"lat": destination["lat"], "lon": destination["lon"]}], "costing": costings[mode], "units": "kilometers", "language": language, "directions_options": {"units": "kilometers", "language": language}}
        if mode == "transit":
            payload["date_time"] = {"type": 0, "value": dt.datetime.now().astimezone().strftime("%Y-%m-%dT%H:%M")}
        try:
            trip = _request(f"{ROUTER}/route", payload).get("trip", {})
        except RuntimeError as error:
            if mode == "transit":
                raise RuntimeError("Aucun itinéraire en transports n’est disponible pour cette zone ou cet horaire sur le serveur configuré. Essayez marche/vélo/voiture ou configurez un serveur Valhalla avec les données GTFS locales.") from error
            raise
        legs = trip.get("legs", [])
        geometry, steps = [], []
        for leg in legs:
            geometry.extend(_decode_polyline6(leg.get("shape", "")))
            for maneuver in leg.get("maneuvers", []):
                steps.append({"instruction": maneuver.get("instruction", ""), "distanceMeters": round(float(maneuver.get("length", 0)) * 1000), "durationSeconds": round(float(maneuver.get("time", 0)))})
        summary = trip.get("summary", {})
        route = {"mode": mode, "coordinates": geometry, "distanceMeters": round(float(summary.get("length", 0)) * 1000), "durationSeconds": round(float(summary.get("time", 0))), "steps": steps}
        origin_kind = "current-location" if origin.get("kind") == "current-location" else "origin"
        return _map(f"{origin['label']} → {destination['label']}", [{**origin, "id": "origin", "kind": origin_kind}, {**destination, "id": "destination", "kind": "destination"}], route)
    raise RuntimeError(f"Outil inconnu : {name}")

def mcp_result(value: Any) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": json.dumps(value, ensure_ascii=False)}], "structuredContent": value, "isError": False}

def main() -> None:
    for raw in sys.stdin:
        rid = None
        try:
            request = json.loads(raw)
            rid, method = request.get("id"), request.get("method")
            if method == "initialize":
                payload = {"protocolVersion": "2025-06-18", "capabilities": {"tools": {}}, "serverInfo": {"name": "bob-work-map-tools", "version": "1.1.0"}}
            elif method == "tools/list":
                payload = {"tools": TOOLS}
            elif method == "tools/call":
                params = request.get("params", {})
                payload = mcp_result(call(params.get("name", ""), params.get("arguments", {})))
            elif method == "notifications/initialized":
                continue
            else:
                raise RuntimeError(f"Méthode MCP inconnue : {method}")
            print(json.dumps({"jsonrpc": "2.0", "id": rid, "result": payload}, ensure_ascii=False), flush=True)
        except Exception as exc:  # noqa: BLE001
            print(json.dumps({"jsonrpc": "2.0", "id": rid, "error": {"code": -32000, "message": str(exc)}}, ensure_ascii=False), flush=True)

if __name__ == "__main__":
    main()
