import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const ICONS = { pothole: '🕳️', waterlogging_blocked_drain: '🌊', broken_speed_breaker: '⚠️', faulty_traffic_signal: '🚦', damaged_road_edge: '🚧', other: '❗' }
const markerIcon = (type, count) => L.divIcon({
  html: `<div style="position:relative"><div style="font-size:22px;background:#fff;border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;border:2px solid #0f766e;box-shadow:0 2px 6px rgba(0,0,0,.3)">${ICONS[type] || '❗'}</div>${count > 1 ? `<div style="position:absolute;top:-6px;right:-8px;background:#ef4444;color:#fff;border-radius:999px;font-size:11px;padding:1px 6px;font-weight:700">×${count}</div>` : ''}</div>`,
  className: '', iconSize: [34, 34], iconAnchor: [17, 17],
})
const sevColor = { low: '#22c55e', medium: '#f59e0b', high: '#ef4444' }

export default function ReportPage() {
  const { id } = useParams()
  const [report, setReport] = useState(null)
  const mapRef = useRef(null)
  const mapInstance = useRef(null)

  useEffect(() => { fetch(`/reports/${id}`).then(r => r.json()).then(setReport) }, [id])

  useEffect(() => {
    if (!report || report.error || mapInstance.current) return
    const sm = L.map(mapRef.current).setView([report.lat, report.lng], 16)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(sm)
    L.marker([report.lat, report.lng], { icon: markerIcon(report.type, report.count) }).addTo(sm)
      .bindPopup(`<b>${report.id}</b><br>${ICONS[report.type] || ''} ${report.type} — ${report.severity}`).openPopup()
    mapInstance.current = sm
  }, [report])

  return (
    <div className="container">
      <div className="header">
        <h1>🚧 RoadFix Report</h1>
        <p>{id}</p>
      </div>
      {!report ? <p className="muted">Loading…</p> : report.error ? <p>Report not found.</p> : (
        <>
          <div className="card">
            {report.photo && <img className="issue" src={`/uploads/${report.photo}`} alt="issue" />}
            <h3>{ICONS[report.type]} {report.type.replaceAll('_', ' ')}</h3>
            <p><b>Severity:</b> <span style={{ color: sevColor[report.severity] }}>{report.severity}</span> · <b>Status:</b> {report.status === 'reported' ? 'pending' : report.status} · <b>{report.count}</b> report(s) · Priority {report.priority}/10</p>
            <p>💰 Estimated cost: <b>₹{report.cost}</b> · 🏢 {report.department}</p>
            <p className="muted">📝 {report.description}</p>
            <div className="row" style={{ marginTop: 10 }}>
              <label><b>Update status:</b></label>
              {[['reported', 'pending'], ['in progress', 'in progress'], ['fixed', 'fixed']].map(([val, label]) => (
                <button key={val} className={report.status === val ? 'btn btn-sm' : 'btn btn-ghost btn-sm'}
                  onClick={async () => { await fetch(`/reports/${report.id}/status?status=${encodeURIComponent(val)}`, { method: 'POST' }); fetch(`/reports/${report.id}`).then(r => r.json()).then(setReport) }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="card">
            <h3>📍 Location</h3>
            <div ref={mapRef} className="map" />
          </div>
        </>
      )}
      <Link to="/"><button className="btn btn-ghost">← Back to RoadFix</button></Link>
    </div>
  )
}
