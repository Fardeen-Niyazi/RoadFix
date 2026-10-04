# 🚧 RoadFix

**One photo. One tap. A costed, routed, tracked work order.**

RoadFix lets citizens report potholes, waterlogging/blocked drains, broken speed breakers, faulty traffic signals, and damaged road edges. A multimodal AI (Gemma 4) classifies the issue from the photo, estimates severity and size, a deterministic rate table produces a credible cost estimate, duplicates auto-merge, and the right department gets an email with the photo, location, severity, and cost. A public map creates accountability.

## How it solves the problem

| Pain point | RoadFix answer |
|---|---|
| Complaints lost in phone calls | Photo + GPS + timestamp in one tap |
| Vague reports | Gemma 4 AI detects type, severity, approx. size |
| Uncredible cost guesses | Cost = Schedule-of-Rates table × AI-estimated dimensions |
| Wrong department | AI + rules route to Roads / Drainage / Traffic / Municipal |
| 50 reports for 1 pothole | Duplicate merge within ~50 m → one priority ticket |
| No accountability | Public map + status (reported → assigned → in progress → fixed) |
| Tickets ignored | Auto-escalation rule + priority scoring (severity, volume) |
| Expensive repairs | Nearby-issue batching (stubbed in prototype) |

## Architecture

```
[React PWA] --photo+GPS--> [FastAPI] --image--> [Gemma 4 via Gemini API]
                               |                          |
                               v                          v
                       [SQLite + uploads] <---- JSON {type, severity, size}
                               |
                               v
                    rate table -> cost estimate -> Gmail SMTP email -> public map
```

## Tech stack

- **AI**: Gemma 4 (`gemma-4-26b-a4b-it`) via the Gemini API — open-weight, multimodal (image → structured JSON). Also eligible as an in-repo recipe for `gemma-4-31b-it`.
- **Backend**: Python FastAPI, SQLite, Gmail SMTP
- **Frontend**: React + Vite, Leaflet + OpenStreetMap (no API key)
- **Rates**: `backend/rates.json` — modeled on PWD/municipal Schedule of Rates; swap in your local numbers

## Setup

```bash
cp .env.example .env   # fill in GEMINI_API_KEY and Gmail app password
cd backend && pip install fastapi "uvicorn[standard]" google-genai python-multipart python-dotenv && uvicorn main:app --port 8000
cd frontend && npm install && npm run dev -- --host
```

Open `http://<your-LAN-IP>:5173` on your phone (same Wi-Fi) to capture real photos with real GPS.

## Hackathon note

- **Best Use of Gemma 4**: multimodal image understanding drives detection, severity, size estimation, and routing.
- **Best Open-Source AI Project**: open-weight Gemma 4 is the core of the product; MIT license; original implementation.

## Roadmap (post-prototype)

Contractor fixed-photo upload, true cron escalation, batching of nearby repairs into one work order, priority scoring with schools/hospitals proximity + traffic data.
