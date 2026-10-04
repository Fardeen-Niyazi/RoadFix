import { useState, useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const TYPES = ['pothole', 'waterlogging_blocked_drain', 'broken_speed_breaker', 'faulty_traffic_signal', 'damaged_road_edge', 'other']

export default function App() {
  const [photo, setPhoto] = useState(null)
  const [preview, setPreview] = useState(null)
  const [gps, setGps] = useState(null)
  const [type, setType] = useState('pothole')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [reports, setReports] = useState([])
  const mapRef = useRef(null)
  const mapInstance = useRef(null)

  useEffect(() => {
    navigator.geolocation.getCurrentPosition(p => setGps({ lat: p.coords.latitude, lng: p.coords.longitude }), () => setGps({ lat: 28.6139, lng: 77.2090 }))
    fetch('/reports').then(r => r.json()).then(setReports).catch(() => {})
  }, [])

  useEffect(() => {
    if (!gps || mapInstance.current) return
    mapInstance.current = L.map(mapRef.current).setView([gps.lat, gps.lng], 14)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(mapInstance.current)
  }, [gps])

  useEffect(() => {
    if (!mapInstance.current) return
    mapInstance.current.eachLayer(l => { if (l instanceof L.Marker) l.remove() })
    reports.forEach(r => L.marker([r.lat, r.lng]).addTo(mapInstance.current)
      .bindPopup(`<b>${r.ticket_id || r.id}</b><br>${r.type} — ${r.severity}<br>₹${r.cost}<br>${r.status} (${r.count} reports)`))
  }, [reports])

  async function submit(e) {
    e.preventDefault()
    if (!photo || !gps) return
    setLoading(true)
    const fd = new FormData()
    fd.append('image', photo)
    fd.append('lat', gps.lat)
    fd.append('lng', gps.lng)
    fd.append('issue_type', type)
    const r = await fetch('/report', { method: 'POST', body: fd })
    setResult(await r.json())
    setLoading(false)
    fetch('/reports').then(r => r.json()).then(setReports)
  }

  const sevColor = { low: '#22c55e', medium: '#f59e0b', high: '#ef4444' }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', fontFamily: 'system-ui', padding: 16 }}>
      <h1 style={{ color: '#0f766e' }}>🚧 RoadFix</h1>
      <p style={{ color: '#555' }}>Report road damage. Gemma 4 AI detects, estimates cost, and emails the right department.</p>

      <form onSubmit={submit} style={{ background: '#f0fdfa', padding: 16, borderRadius: 12 }}>
        <input type="file" accept="image/*" capture="environment"
          onChange={e => { const f = e.target.files[0]; setPhoto(f); setPreview(URL.createObjectURL(f)) }} />
        {preview && <img src={preview} alt="preview" style={{ width: '100%', maxHeight: 220, objectFit: 'cover', marginTop: 8, borderRadius: 8 }} />}
        <div style={{ marginTop: 8 }}>📍 GPS: {gps ? `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}` : 'locating…'}</div>
        <select value={type} onChange={e => setType(e.target.value)} style={{ marginTop: 8, padding: 8, width: '100%' }}>
          {TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
        <button disabled={loading} style={{ marginTop: 10, padding: '10px 20px', background: '#0f766e', color: 'white', border: 'none', borderRadius: 8, width: '100%', fontSize: 16 }}>
          {loading ? '🤖 Gemma 4 analyzing…' : 'Report Issue'}
        </button>
      </form>

      {result && (
        <div style={{ marginTop: 16, border: '1px solid #99f6e4', borderRadius: 12, padding: 16 }}>
          {result.merged ? (
            <h3>🔀 {result.message}</h3>
          ) : (
            <>
              <h3>✅ Ticket {result.ticket_id}</h3>
              <p><b>AI says:</b> {result.analysis.description}</p>
              <p>Type: <b>{result.analysis.issue_type}</b> · Severity:
                <span style={{ color: sevColor[result.analysis.severity] }}> <b>{result.analysis.severity}</b></span> · Dept: <b>{result.department}</b></p>
              <p>Priority score: <b>{result.priority}/10</b> · Email to dept: {result.email_sent ? 'sent ✉️' : 'mocked (check backend console)'}</p>
              <h4>💰 Cost estimate (INR)</h4>
              <ul>{Object.entries(result.cost).filter(([k]) => k !== 'total').map(([k, v]) => <li key={k}>{k}: ₹{v}</li>)}</ul>
              <h3>Total: ₹{result.cost.total}</h3>
            </>
          )}
        </div>
      )}

      <h2 style={{ marginTop: 24 }}>🗺️ Public map</h2>
      <div ref={mapRef} style={{ height: 320, borderRadius: 12 }} />
      <h3>Recent reports</h3>
      {reports.map(r => (
        <div key={r.id} style={{ borderBottom: '1px solid #eee', padding: 8 }}>
          <b>{r.id}</b> — {r.type} ({r.severity}) · ₹{r.cost} · {r.status} · {r.count} report(s)
          <button onClick={async () => { await fetch(`/reports/${r.id}/status?status=fixed`, { method: 'POST' }); fetch('/reports').then(r => r.json()).then(setReports) }}
            style={{ float: 'right' }}>Mark fixed</button>
        </div>
      ))}
    </div>
  )
}
