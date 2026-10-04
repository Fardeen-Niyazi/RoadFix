import os, json, sqlite3, smtplib, math, uuid, datetime, shutil
from email.message import EmailMessage
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

from fastapi import FastAPI, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from google import genai
from google.genai import types

BASE = os.path.dirname(__file__)
DATA_DIR = os.environ.get('DATA_DIR', BASE)
UPLOADS = os.path.join(DATA_DIR, 'uploads')
os.makedirs(UPLOADS, exist_ok=True)
DB = os.path.join(DATA_DIR, 'roadfix.db')
STATIC = os.path.join(BASE, 'static')

app = FastAPI(title="RoadFix API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_api_key = os.environ.get('GEMINI_API_KEY', '')
client = genai.Client(api_key=_api_key)
RATES = json.load(open(os.path.join(BASE, 'rates.json')))

def db():
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    return c

c = db()
c.execute('''CREATE TABLE IF NOT EXISTS reports(
  id TEXT PRIMARY KEY, type TEXT, severity TEXT, size REAL, depth REAL,
  lat REAL, lng REAL, cost REAL, cost_breakdown TEXT, department TEXT,
  status TEXT, photo TEXT, count INTEGER, priority INTEGER, email TEXT,
  description TEXT, created_at TEXT)''')
c.commit(); c.close()

PROMPT = '''You are a road-damage inspector AI. Analyze this photo of a road issue.
Return ONLY valid JSON, no markdown, with keys:
{"valid": true if the photo actually shows a road issue (pothole, waterlogging, broken speed breaker, faulty signal, damaged road edge), false otherwise,
 "issue_type": one of ["pothole","waterlogging_blocked_drain","broken_speed_breaker","faulty_traffic_signal","damaged_road_edge","other"],
 "severity": "low"|"medium"|"high",
 "area_m2": number (estimated affected area in square meters, default 1),
 "depth_cm": number (estimated depth in cm for potholes/road edge, else 0),
 "length_m": number (estimated length in meters for drains/speed breakers/road edge, else 0),
 "description": one sentence}'''

def analyze(image_bytes, declared_type):
    resp = client.models.generate_content(
        model='gemma-4-26b-a4b-it',
        contents=[types.Part.from_bytes(data=image_bytes, mime_type='image/jpeg'),
                  f"{PROMPT}\nThe citizen reports the issue as '{declared_type}'. Use it unless the photo clearly contradicts it."])
    text = resp.text.strip().strip('`').replace('json\n', '')
    return json.loads(text[text.index('{'):text.rindex('}')+1])

def estimate_cost(a):
    r = RATES.get(a['issue_type'], RATES['other'])
    if a['issue_type'] == 'pothole':
        material = a['area_m2'] * max(a['depth_cm'], 5) * r['material_per_m2_per_cm']
        labour, traffic = r['labour_flat'], r['traffic_management_flat']
        parts = {'material': round(material), 'labour': labour, 'traffic_management': traffic}
    else:
        base_units = a.get('length_m') or a['area_m2'] or 1
        unit_cost_key = 'per_meter' if 'per_meter' in r else ('per_unit' if 'per_unit' in r else None)
        unit = base_units * r.get(unit_cost_key, 1000)
        parts = {'repair_units': round(unit), 'labour': r['labour_flat'], 'traffic_management': r['traffic_management_flat']}
    parts['total'] = sum(parts.values())
    return parts

def haversine(lat1, lng1, lat2, lng2):
    R = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1); dl = math.radians(lng2 - lng1)
    a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2 * R * math.asin(math.sqrt(a))

def send_email(to_desc, subject, body, photo_path):
    user, pwd = os.environ.get('GMAIL_USER'), os.environ.get('GMAIL_APP_PASSWORD')
    if not user or 'you@gmail' in user or not pwd or 'your_app' in pwd:
        print(f'\n[EMAIL MOCK to {to_desc}]\n{subject}\n{body}\n')
        return False
    msg = EmailMessage()
    msg['From'], msg['To'], msg['Subject'] = user, user, subject
    msg.set_content(body)
    if photo_path:
        msg.add_attachment(open(photo_path, 'rb').read(), maintype='image', subtype='jpeg', filename='issue.jpg')
    try:
        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as s:
            s.login(user, pwd); s.send_message(msg)
        return True
    except Exception as e:
        print('EMAIL ERROR:', e); return False

@app.get('/nearby')
def nearby(lat: float, lng: float, issue_type: str):
    c = db()
    out = []
    for row in c.execute("SELECT * FROM reports WHERE type=? AND status!='fixed'", (issue_type,)):
        age_days = (datetime.datetime.now() - datetime.datetime.fromisoformat(row['created_at'])).days
        if age_days <= 7 and haversine(lat, lng, row['lat'], row['lng']) <= 50:
            out.append(dict(row))
    c.close()
    return out

@app.post('/report')
async def report(image: UploadFile, lat: float = Form(...), lng: float = Form(...),
                 issue_type: str = Form('other'), description: str = Form(''), skip_merge: bool = Form(False)):
    data = await image.read()
    fname = f'{uuid.uuid4().hex}.jpg'
    path = os.path.join(UPLOADS, fname)
    open(path, 'wb').write(data)

    ai_available = True
    try:
        a = analyze(data, issue_type)
        if a.get('valid') is False:
            return {'error': 'not_road_issue', 'message': 'This photo does not appear to show a road issue. Please upload a clear photo of the problem.'}
    except Exception as e:
        print('AI ERROR:', e)
        ai_available = False
        a = {'issue_type': issue_type if issue_type in RATES else 'other', 'severity': 'unknown',
             'area_m2': 1, 'depth_cm': 10, 'length_m': 1, 'description': description or 'Road issue (AI analysis unavailable)'}

    cost = estimate_cost(a)
    dept = RATES.get(a['issue_type'], RATES['other'])['department']

    c = db()
    # duplicate merge: same type within 50m, not fixed, newer than 7 days
    dup = None
    if not skip_merge:
        for row in c.execute("SELECT * FROM reports WHERE type=? AND status!='fixed'", (a['issue_type'],)):
            age_days = (datetime.datetime.now() - datetime.datetime.fromisoformat(row['created_at'])).days
            if age_days <= 7 and haversine(lat, lng, row['lat'], row['lng']) <= 50:
                dup = row; break
    if dup:
        count = dup['count'] + 1
        priority = {'low': 1, 'medium': 5, 'high': 9}.get(a['severity'], 5) + count * 2
        c.execute('UPDATE reports SET count=?, priority=? WHERE id=?', (count, priority, dup['id']))
        c.commit(); c.close()
        return {'merged': True, 'ticket_id': dup['id'], 'duplicate_count': count,
                'message': f'Merged with existing ticket {dup["id"]} ({count} reports)'}

    rid = f'RF-{uuid.uuid4().hex[:6].upper()}'
    priority = {'low': 1, 'medium': 5, 'high': 9}.get(a['severity'], 5)
    c.execute('INSERT INTO reports VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
              (rid, a['issue_type'], a['severity'], a['area_m2'], a.get('depth_cm', 0),
               lat, lng, cost['total'], json.dumps(cost), dept, 'reported', fname, 1, priority, '', a['description'],
               datetime.datetime.now().isoformat()))
    c.commit(); c.close()

    body = (f'New RoadFix report {rid}\nType: {a["issue_type"]} | Severity: {a["severity"]}\n'
            f'Location: {lat}, {lng}\nDescription: {a["description"]}\n'
            f'Estimated cost: INR {cost["total"]}\nBreakdown: {json.dumps(cost, indent=2)}\n'
            f'Photo attached. Priority: {priority}/10\n'
            f'Escalation: auto-escalates to senior officer if not actioned within 48h.')
    sent = send_email(dept, f'RoadFix {rid}: {a["issue_type"]} ({a["severity"]})', body, path)
    return {'merged': False, 'ticket_id': rid, 'analysis': a, 'cost': cost, 'department': dept,
            'priority': priority, 'email_sent': sent, 'ai_available': ai_available}

@app.get('/reports/{rid}')
def get_report(rid: str):
    c = db()
    row = c.execute('SELECT * FROM reports WHERE id=?', (rid,)).fetchone()
    c.close()
    return dict(row) if row else {'error': 'not found'}

@app.get('/reports')
def reports():
    c = db()
    rows = [dict(r) for r in c.execute('SELECT * FROM reports ORDER BY datetime(created_at) DESC')]
    c.close()
    return rows

@app.post('/reports/{rid}/status')
def set_status(rid: str, status: str):
    c = db()
    c.execute('UPDATE reports SET status=? WHERE id=?', (status, rid))
    c.commit(); c.close()
    return {'ok': True}

app.mount('/uploads', StaticFiles(directory=UPLOADS), name='uploads')
if os.path.isdir(STATIC):
    app.mount('/assets', StaticFiles(directory=os.path.join(STATIC, 'assets')), name='assets')
    from fastapi.responses import FileResponse, HTMLResponse

    @app.get('/{full_path:path}')
    def spa(full_path: str):
        if full_path.startswith(('reports', 'nearby', 'uploads', 'docs', 'openapi.json')):
            from fastapi import HTTPException; raise HTTPException(404)
        f = os.path.join(STATIC, full_path)
        if full_path and os.path.isfile(f):
            return FileResponse(f)
        return FileResponse(os.path.join(STATIC, 'index.html'))

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=int(os.environ.get('PORT', 8000)))
