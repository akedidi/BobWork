import { Ionicons } from '@expo/vector-icons'
import React, { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { WebView } from 'react-native-webview'
import type { MapSpec } from '../mapSpec'
import { colors } from '../theme'

function mapHtml(spec: MapSpec) {
  const payload = JSON.stringify(spec).replace(/</g, '\\u003c')
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"><style>
  html,body,#map{width:100%;height:100%;margin:0;background:#e5e7eb} .leaflet-control-attribution{font-size:8px}
  .marker{background:transparent;border:0}.pin{display:grid;width:28px;height:28px;place-items:center;border:2px solid white;border-radius:50% 50% 50% 0;background:#e53935;color:white;box-shadow:0 2px 7px #0006;transform:rotate(-45deg);font:800 10px system-ui}.pin b{transform:rotate(45deg)}
  .current{display:block;width:18px;height:18px;margin:3px;border:3px solid white;border-radius:50%;background:#2563eb;box-shadow:0 0 0 5px #2563eb3d,0 2px 7px #0005}
  </style></head><body><div id="map"></div><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script>
  const spec=${payload};const map=L.map('map',{scrollWheelZoom:false});L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);const bounds=[];
  spec.markers.filter(m=>Number.isFinite(m.lat)&&Number.isFinite(m.lon)).forEach((m,i)=>{const inferred=m.kind||(spec.route?(i===0?'origin':i===spec.markers.length-1?'destination':'place'):'place');const current=inferred==='current-location';const label=inferred==='origin'?'A':inferred==='destination'?'B':String(i+1);const icon=L.divIcon({className:'marker',html:current?'<span class="current"></span>':'<span class="pin"><b>'+label+'</b></span>',iconSize:current?[24,24]:[30,38],iconAnchor:current?[12,12]:[15,38],popupAnchor:[0,-34]});L.marker([m.lat,m.lon],{icon,title:m.label}).addTo(map).bindPopup('<strong>'+String(m.label).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))+'</strong>');bounds.push([m.lat,m.lon])});
  if(spec.route&&Array.isArray(spec.route.coordinates)){const points=spec.route.coordinates.filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon)).map(p=>[p.lat,p.lon]);if(points.length){L.polyline(points,{color:'#2563eb',weight:5,opacity:.9}).addTo(map);bounds.push(...points)}}if(bounds.length)map.fitBounds(bounds,{padding:[24,24],maxZoom:15});
  </script></body></html>`
}

export function ConversationMapCard({ spec }: { spec: MapSpec }) {
  const source = useMemo(() => ({ html: mapHtml(spec) }), [spec])
  const count = spec.markers.filter(marker => Number.isFinite(marker.lat) && Number.isFinite(marker.lon)).length
  return <View style={styles.card} accessibilityLabel={spec.title}>
    <View style={styles.header}><Ionicons name="location" size={18} color={colors.danger} /><Text style={styles.title} numberOfLines={2}>{spec.title}</Text><Text style={styles.count}>{count}</Text></View>
    <WebView source={source} originWhitelist={['about:blank', 'https://*']} javaScriptEnabled domStorageEnabled={false} setSupportMultipleWindows={false} scrollEnabled={false} style={styles.map} />
  </View>
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden', marginTop: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.surface },
  header: { minHeight: 46, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 17, fontWeight: '800' },
  count: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  map: { width: '100%', height: 270, backgroundColor: colors.surfaceRaised },
})
