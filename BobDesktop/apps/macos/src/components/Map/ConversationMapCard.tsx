import { useEffect, useMemo, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Bike, Bus, Car, Footprints, MapPin } from 'lucide-react'
import type { MapSpec, MapTravelMode } from '@bob-work/shared-types'
import { useT } from '../../i18n'

const modeIcons = { driving: Car, walking: Footprints, cycling: Bike, transit: Bus } satisfies Record<MapTravelMode, typeof Car>

function duration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60))
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60 ? `${minutes % 60} min` : ''}`.trim() : `${minutes} min`
}

function distance(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} km` : `${Math.round(meters)} m`
}

function markerIcon(kind: NonNullable<MapSpec['markers'][number]['kind']> | undefined, index: number) {
  if (kind === 'current-location') {
    return L.divIcon({
      className: 'conversation-map-marker conversation-map-marker--current',
      html: '<span aria-hidden="true"></span>',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    })
  }
  const label = kind === 'origin' ? 'A' : kind === 'destination' ? 'B' : String(index + 1)
  return L.divIcon({
    className: 'conversation-map-marker conversation-map-marker--place',
    html: `<span aria-hidden="true"><b>${label}</b></span>`,
    iconSize: [30, 38],
    iconAnchor: [15, 38],
    popupAnchor: [0, -36],
    tooltipAnchor: [0, -32],
  })
}

export function ConversationMapCard({ spec }: { spec: MapSpec }) {
  const t = useT()
  const container = useRef<HTMLDivElement>(null)
  const validMarkers = useMemo(() => spec.markers.filter(marker => Number.isFinite(marker.lat) && Number.isFinite(marker.lon)), [spec.markers])
  const mode = spec.route?.mode
  const ModeIcon = mode ? modeIcons[mode] : MapPin
  const modeLabel = mode ? {
    driving: t('chat.mapModeDriving'),
    walking: t('chat.mapModeWalking'),
    cycling: t('chat.mapModeCycling'),
    transit: t('chat.mapModeTransit'),
  }[mode] : ''

  useEffect(() => {
    if (!container.current || validMarkers.length === 0) return
    const map = L.map(container.current, { scrollWheelZoom: false, zoomControl: true, attributionControl: true })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map)
    const bounds = L.latLngBounds([])
    validMarkers.forEach((marker, index) => {
      const popup = document.createElement('div')
      const title = document.createElement('strong')
      title.textContent = marker.label
      popup.appendChild(title)
      if (marker.description) {
        popup.appendChild(document.createElement('br'))
        popup.appendChild(document.createTextNode(marker.description))
      }
      const inferredKind = marker.kind ?? (spec.route ? (index === 0 ? 'origin' : index === validMarkers.length - 1 ? 'destination' : 'place') : 'place')
      const pin = L.marker([marker.lat, marker.lon], { icon: markerIcon(inferredKind, index), title: marker.label })
        .addTo(map)
        .bindPopup(popup)
      pin.bindTooltip(marker.label, { direction: 'top' })
      bounds.extend([marker.lat, marker.lon])
    })
    if (spec.route?.coordinates.length) {
      const points = spec.route.coordinates.filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lon)).map(point => L.latLng(point.lat, point.lon))
      if (points.length) {
        L.polyline(points, { color: '#2563eb', weight: 5, opacity: 0.9 }).addTo(map)
        points.forEach(point => bounds.extend(point))
      }
    }
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 })
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => map.invalidateSize(false))
    if (observer) observer.observe(container.current)
    return () => { observer?.disconnect(); map.remove() }
  }, [spec, validMarkers])

  if (validMarkers.length === 0) return null
  return (
    <section className="conversation-map-card" aria-label={t('chat.mapInteractive')} data-testid="conversation-map-card">
      <header className="conversation-map-card__header">
        <div className="conversation-map-card__title"><MapPin size={17} /><strong>{spec.title}</strong></div>
        {spec.route ? (
          <div className="conversation-map-card__summary">
            <span><ModeIcon size={15} />{modeLabel}</span>
            <span>{distance(spec.route.distanceMeters)}</span>
            <span>{duration(spec.route.durationSeconds)}</span>
          </div>
        ) : <span className="conversation-map-card__count">{t('chat.mapPlaces', { count: validMarkers.length })}</span>}
      </header>
      <div ref={container} className="conversation-map-card__map" role="application" aria-label={t('chat.mapInteractive')} />
      {spec.route?.steps?.length ? (
        <details className="conversation-map-card__steps">
          <summary>{t('chat.mapSteps', { count: spec.route.steps.length })}</summary>
          <ol>{spec.route.steps.map((step, index) => <li key={`${index}-${step.instruction}`}><span>{step.instruction}</span><small>{distance(step.distanceMeters)} · {duration(step.durationSeconds)}</small></li>)}</ol>
        </details>
      ) : null}
      <footer>{spec.attribution}</footer>
    </section>
  )
}
