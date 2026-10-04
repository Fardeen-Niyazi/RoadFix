import { useState, useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const TYPES = ['pothole', 'waterlogging_blocked_drain', 'broken_speed_breaker', 'faulty_traffic_signal', 'damaged_road_edge', 'other']
const ICONS = { pothole: '🕳️', waterlogging_blocked_drain: '🌊', broken_speed_breaker: '⚠️', faulty_traffic_signal: '🚦', damaged_road_edge: '🚧', other: '❗' }
const markerIcon = (type, count) => L.divIcon({
  html: `<div style="position:relative"><div style="font-size:22px;background:#fff;border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;border:2px solid #0f766e;box-shadow:0 2px 6px rgba(0,0,0,.3)">${ICONS[type] || '❗'}</div>${count > 1 ? `<div style="position:absolute;top:-6px;right:-8px;background:#ef4444;color:#fff;border-radius:999px;font-size:11px;padding:1px 6px;font-weight:700">×${count}</div>` : ''}</div>`,
  className: '', iconSize: [34, 34], iconAnchor: [17, 17],
})
const sevColor = { low: '#22c55e', medium: '#f59e0b', high: '#ef4444' }

export default function App() {
  const [photo, setPhoto] = useState(null)
  const [preview, setPreview] = useState(null)
  const [gps, setGps] = useState(null)
  const [type, setType] = useState('pothole')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [reports, setReports] = useState([])
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [mergeCandidates, setMergeCandidates] = useState(null)
  const searchTimer = useRef(null)
  const mapRef = useRef(null)
  const mapInstance = useRef(null)

  useEffect(() => {
    navigator.geolocation.getCurrentPosition(p => setGps({ lat: p.coords.latitude, lng: p.coords.longitude }), () => setGps({ lat: 28.6139, lng: 77.2090 }))
    fetch('/reports').then(r => r.json()).then(setReports).catch(() => { })
  }, [])

  useEffect(() => {
    if (!gps || mapInstance.current) return
    mapInstance.current = L.map(mapRef.current).setView([gps.lat, gps.lng], 14)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(mapInstance.current)
  }, [gps])

  useEffect(() => {
    if (!mapInstance.current) return
    mapInstance.current.eachLayer(l => { if (l instanceof L.Marker) l.remove() })
    reports.forEach(r => L.marker([r.lat, r.lng], { icon: markerIcon(r.type, r.count) }).addTo(mapInstance.current)
      .bindPopup(`<b>${r.id}</b><br>${ICONS[r.type] || ''} ${r.type} — ${r.severity}<br>₹${r.cost}<br>${r.status} (${r.count} reports)<br><a href="/report/${r.id}" target="_blank">🔗 View report</a>`))
  }, [reports])

  function searchLocation(q) {
    setQuery(q)
    clearTimeout(searchTimer.current)
    if (q.length < 3) { setSuggestions([]); return }
    searchTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`, { headers: { 'Accept': 'application/json' } })
        setSuggestions(await r.json())
      } catch { setSuggestions([]) }
    }, 400)
  }

  function pickSuggestion(s) {
    setGps({ lat: parseFloat(s.lat), lng: parseFloat(s.lon) })
    setQuery(s.display_name)
    setSuggestions([])
    if (mapInstance.current) mapInstance.current.flyTo([parseFloat(s.lat), parseFloat(s.lon)], 15)
  }

  function currentLocation() {
    navigator.geolocation.getCurrentPosition(p => setGps({ lat: p.coords.latitude, lng: p.coords.longitude }), () => alert('GPS unavailable'))
  }

  async function submit(e) {
    e.preventDefault()
    if (!photo || !gps) return
    if (!photo.type.startsWith('image/')) return alert('Please upload an image file.')
    if (photo.size > 10 * 1024 * 1024) return alert('Image too large (max 10 MB).')
    // check for nearby same-type reports first
    try {
      const nearby = await fetch(`/nearby?lat=${gps.lat}&lng=${gps.lng}&issue_type=${encodeURIComponent(type)}`).then(r => r.json())
      if (nearby.length > 0) { setMergeCandidates(nearby); return }
    } catch { }
    doSubmit(false)
  }

  async function doSubmit(skipMerge) {
    setMergeCandidates(null)
    setLoading(true)
    const fd = new FormData()
    fd.append('image', photo)
    fd.append('lat', gps.lat)
    fd.append('lng', gps.lng)
    fd.append('issue_type', type)
    fd.append('skip_merge', skipMerge)
    const r = await fetch('/report', { method: 'POST', body: fd })
    setResult(await r.json())
    setLoading(false)
    fetch('/reports').then(r => r.json()).then(setReports)
  }

  const [shareId, setShareId] = useState(null)

  function shareText(id, type, severity, cost, dept) {
    const url = `${window.location.origin}/report/${id}`
    return { text: `🚧 RoadFix ${id}: ${type} (${severity}) · ₹${cost} · ${dept}`, url }
  }

  function shareLink(id) {
    setShareId(shareId === id ? null : id)
  }

  function ShareMenu({ id, report }) {
    const { text, url } = shareText(id, report?.type || '', report?.severity || '', report?.cost || '', report?.department || '')
    const encoded = encodeURIComponent(`${text}\n${url}`)
    return (
      <div className="share-pop-menu">
        <a href={`https://twitter.com/intent/tweet?text=${encoded}`} target="_blank">𝕏 / Twitter</a>
        <a href={`https://wa.me/?text=${encoded}`} target="_blank">💬 WhatsApp</a>
        <button onClick={() => { navigator.clipboard.writeText(`${text}\n${url}`); alert('Copied!') }}>📋 Copy link</button>
        <button onClick={() => navigator.share?.({ title: 'RoadFix report', text, url })}>📤 Share via phone (incl. Instagram)</button>
      </div>
    )
  }

  return (
    <div className="container">
      <div className="header">
        <h1>🚧 RoadFix</h1>
        <p>One photo. One tap. A costed, routed, tracked work order.</p>
        <p style={{ marginTop: 8, fontSize: 13, opacity: .8 }}>
          {reports.length} tickets · {reports.filter(r => r.status === 'fixed').length} fixed · {reports.reduce((a, r) => a + (r.count > 1 ? r.count - 1 : 0), 0)} duplicates merged
        </p>
      </div>

      <div className="card">
        <h3>Report an issue</h3>

        <div className="step">
          <div className="step-label"><span className="step-num">1</span> Photo</div>
          <div className="row">
            <label className="dropzone"
              onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('drop-active') }}
              onDragLeave={e => { e.currentTarget.classList.remove('drop-active') }}
              onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('drop-active'); const f = e.dataTransfer.files[0]; if (f) { setPhoto(f); setPreview(URL.createObjectURL(f)) } }}>
              {preview ? (
                <>
                  <img src={preview} alt="preview" style={{ width: '100%', maxHeight: 160, objectFit: 'cover', borderRadius: 10 }} />
                  <span className="muted" style={{ fontSize: 12, marginTop: 4 }}>↻ tap or drop to replace photo</span>
                </>
              ) : (
                <>
                  <span style={{ fontSize: 34 }}>📷</span>
                  <span style={{ fontWeight: 600, color: 'var(--teal-dark)' }}>Choose photo or drag & drop</span>
                  <span className="muted" style={{ fontSize: 12 }}>JPG/PNG · max 10 MB</span>
                </>
              )}
              <input type="file" accept="image/*" capture="environment"
                onChange={e => { const f = e.target.files[0]; setPhoto(f); setPreview(URL.createObjectURL(f)) }} />
            </label>
          </div>
        </div>

        <div className="step">
          <div className="step-label"><span className="step-num">2</span> Location</div>
          <input type="text" placeholder="🔍 Search location (e.g. Connaught Place, Delhi)" value={query} onChange={e => searchLocation(e.target.value)} />
          {suggestions.length > 0 && (
            <div className="suggest">
              {suggestions.map((s, i) => (
                <div key={i} className="suggest-item" onClick={() => pickSuggestion(s)}>📍 {s.display_name}</div>
              ))}
            </div>
          )}
          <div className="row" style={{ marginTop: 10 }}>
            <p className="muted" style={{ margin: 0 }}>📍 {gps ? `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}` : 'locating…'}</p>
            <button className="btn btn-ghost btn-sm" onClick={currentLocation}>📍 Use my current location</button>
          </div>
        </div>

        <div className="step">
          <div className="step-label"><span className="step-num">3</span> Issue type</div>
          <select value={type} onChange={e => setType(e.target.value)}>
            {TYPES.map(t => <option key={t} value={t}>{ICONS[t]} {t.replaceAll('_', ' ')}</option>)}
          </select>
        </div>

        <button className="btn" style={{ width: '100%', marginTop: 16 }} disabled={loading} onClick={submit}>
          {loading ? '🤖 Gemma 4 analyzing…' : 'Submit Report'}
        </button>
      </div>

      {mergeCandidates && (
        <div className="card card-accent-amber" style={{ background: '#fffbeb' }}>
          <div className="merge-banner">🔀 Duplicate detected — {mergeCandidates.length} nearby {type.replaceAll('_', ' ')} report(s)</div>
          {mergeCandidates.map(r => (
            <div key={r.id} className="report-row"><span><b>{r.id}</b> · {r.severity} · ₹{r.cost} · {r.count} report(s) · {r.status}</span></div>
          ))}
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => doSubmit(false)}>Join existing ticket (merge)</button>
            <button className="btn btn-ghost" onClick={() => doSubmit(true)}>Create new ticket anyway</button>
          </div>
        </div>
      )}

      {result && result.error && (
        <div className="card card-accent-red" style={{ background: '#fef2f2' }}>
          <h3>⚠️ {result.message}</h3>
        </div>
      )}

      {result && !result.error && (
        <div className={`card ${result.merged ? 'card-accent-amber' : 'card-accent-green'}`}>
          {result.merged ? (
            <>
              <h3>🔀 {result.message}</h3>
              <div className="share-pop">
                <button className="btn btn-ghost" onClick={() => shareLink(result.ticket_id)}>🔗 Share</button>
                {shareId === result.ticket_id && <ShareMenu id={result.ticket_id} report={result.analysis && { ...result.analysis, cost: result.cost.total, department: result.department, type: result.analysis.issue_type }} />}
              </div>
            </>
          ) : (
            <>
              <h3>✅ Ticket <span className="ticket-badge">{result.ticket_id}</span></h3>
              {result.ai_available === false && (
                <p style={{ background: '#fef9c3', padding: 10, borderRadius: 8 }}>⚠️ AI analysis unavailable — the cost is a rough estimate from the declared type only. A human should verify.</p>
              )}
              <p><b>AI says:</b> {result.analysis.description}</p>
              <p>{ICONS[result.analysis.issue_type]} <b>{result.analysis.issue_type.replaceAll('_', ' ')}</b> ·
                <span className={`sev-chip sev-${result.analysis.severity || 'unknown'}`} style={{ margin: '0 6px' }}>{result.analysis.severity || 'unknown'}</span>· 🏢 {result.department}</p>
              <p className="muted">Priority {result.priority}/10 · Email: {result.email_sent ? 'sent ✉️' : 'mocked (see backend console)'}</p>
              <h4>💰 Cost estimate</h4>
              {Object.entries(result.cost).filter(([k]) => k !== 'total').map(([k, v]) => (
                <div key={k} className="cost-row"><span>{k}</span><b>₹{v}</b></div>
              ))}
              <div className="cost-row" style={{ borderBottom: 'none' }}><span><b>Total</b></span><b style={{ fontSize: 20, color: 'var(--teal-dark)' }}>₹{result.cost.total}</b></div>
              <div className="share-pop">
                <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => shareLink(result.ticket_id)}>🔗 Share</button>
                {shareId === result.ticket_id && <ShareMenu id={result.ticket_id} report={result.analysis && { ...result.analysis, cost: result.cost.total, department: result.department, type: result.analysis.issue_type }} />}
              </div>
            </>
          )}
        </div>
      )}

      <div className="card">
        <h3>🗺️ Public map</h3>
        <div className="badges">
          {TYPES.map(t => <span key={t} className="badge">{ICONS[t]} {t.replaceAll('_', ' ')}</span>)}
        </div>
        <div ref={mapRef} className="map" />
      </div>

      <div className="card">
        <h3>Recent reports</h3>
        {reports.map(r => (
          <div key={r.id} className="rep">
            <div className="rep-top">
              <span style={{ fontSize: 20 }}>{ICONS[r.type] || '❗'}</span>
              <span className="rep-id">{r.id}</span>
              <span>{r.type.replaceAll('_', ' ')}</span>
              <span className="chip">{r.severity}</span>
              <span className="chip">₹{r.cost}</span>
              <span className={`chip ${r.status === 'fixed' ? 'chip-status-fixed' : r.status === 'in progress' ? 'chip-status-prog' : ''}`}>{r.status === 'reported' ? 'pending' : r.status}</span>
            </div>
            <div className="rep-actions">
              <a className="btn btn-ghost btn-sm" href={`/report/${r.id}`} target="_blank" style={{ textDecoration: 'none' }}>View</a>
              <div className="share-pop">
                <button className="btn btn-ghost btn-sm" onClick={() => shareLink(r.id)}>🔗 Share</button>
                {shareId === r.id && <ShareMenu id={r.id} report={r} />}
              </div>
              {[['reported', 'pending'], ['in progress', 'in progress'], ['fixed', 'fixed']].map(([val, label]) => (
                <button key={val} className={r.status === val ? 'btn btn-sm' : 'btn btn-ghost btn-sm'}
                  onClick={async () => { await fetch(`/reports/${r.id}/status?status=${encodeURIComponent(val)}`, { method: 'POST' }); fetch('/reports').then(r => r.json()).then(setReports) }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
