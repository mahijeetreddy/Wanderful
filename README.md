# Wanderful - Multi-Agent AI Travel Planner

Wanderful is a full-stack AI travel planning application that combines CrewAI agents, live travel APIs, LLM fallback routing, and an interactive cinematic React UI. The app collects trip preferences, searches live flight/hotel/weather/local data, and generates a structured Markdown itinerary with hotel map switching and flight recovery suggestions.

## What It Does

- Generates personalized day-by-day travel itineraries from origin, destination, dates, budget, travelers, currency, and interests.
- Uses CrewAI agents for orchestration, flight research, hotel research, weather/logistics, activity planning, and final itinerary compilation.
- Integrates live provider data from SerpAPI Google Flights, SerpAPI Google Hotels, OpenWeather, and SerpAPI web search.
- Supports Gemini as the primary LLM provider with Groq fallback for quota or provider failures.
- Renders a cinematic React + TypeScript frontend with a full-screen travel video hero, glass UI, Tailwind styling, and Markdown itinerary rendering.
- Includes a free maps experience using Leaflet + OpenStreetMap for hotel comparison and map-based hotel switching.
- Adds flight recovery UX when flights or return details are missing, including surrounding-date and nearby-airport suggestions.

## Architecture

```txt
User
  |
  v
React + Vite UI
  |
  v
Flask API
  |
  +--> Deterministic data collection
  |      +--> SerpAPI Flights
  |      +--> SerpAPI Hotels
  |      +--> OpenWeather
  |      +--> SerpAPI Local Search
  |
  +--> CrewAI planning workflow
         +--> Gemini primary LLM
         +--> Groq fallback LLM
         +--> Structured Markdown itinerary
```

The current web flow uses a fast planner path: live data is collected deterministically before the LLM writes the final itinerary. This reduces unsupported tool-call errors and keeps provider-specific logic isolated from the agent workflow.

## Tech Stack

**Backend**
- Python 3.10+
- Flask
- CrewAI
- Pydantic
- python-dotenv
- requests
- Gemini API
- Groq API
- SerpAPI
- OpenWeather API

**Frontend**
- React
- TypeScript
- Vite
- Tailwind CSS
- GSAP
- lucide-react
- react-markdown
- Leaflet
- React-Leaflet
- OpenStreetMap

## Project Structure

```txt
.
|-- agents.py              # CrewAI agent factories
|-- tasks.py               # CrewAI task definitions
|-- tools.py               # External API tools for flights, hotels, weather, and local search
|-- data_collector.py      # Deterministic provider collection and structured options normalization
|-- main.py                # CLI entry point and travel input model
|-- web_app.py             # Flask API server
|-- src/                   # React + TypeScript frontend
|-- static/                # Legacy Flask static assets
|-- templates/             # Legacy Flask template fallback
|-- .env.example           # Safe environment variable template
|-- requirements.txt       # Python dependencies
|-- package.json           # Frontend dependencies and scripts
`-- README.md
```

## Environment Variables

Copy the example file and fill in your own keys:

```bash
cp .env.example .env
```

Required for the main AI workflow:

```env
GEMINI_API_KEY=
LLM_PROVIDER=gemini
LLM_MODEL=gemini-2.5-flash
```

Recommended fallback:

```env
GROQ_API_KEY=
GROQ_MODEL=groq/llama-3.1-8b-instant
```

Live data providers:

```env
SERPAPI_API_KEY=
OPENWEATHER_API_KEY=
```

Maps:

```env
MAP_PROVIDER=osm
```

The map implementation uses Leaflet + OpenStreetMap and does not require a paid maps API key.

## Local Setup

### 1. Install Python dependencies

```bash
pip install -r requirements.txt
```

### 2. Install frontend dependencies

```bash
npm install
```

### 3. Start the Flask API

```bash
python web_app.py
```

By default, Flask reads `PORT` from the environment or falls back to `5000`. During development, this project has commonly been run on `5052`.

### 4. Start the React frontend

```bash
npm run dev
```

Open the Vite URL:

```txt
http://127.0.0.1:5173
```

The Vite proxy sends `/api` requests to the Flask backend target configured in `vite.config.ts`.

## API Endpoints

### `POST /api/plan`

Generates the final itinerary and structured UI options.

Request body:

```json
{
  "origin": "LAX",
  "destination": "HNL",
  "start_date": "2026-06-20",
  "end_date": "2026-06-24",
  "budget": "2500",
  "currency_code": "USD",
  "adults": "1",
  "interests": "quiet beaches, local food, hiking"
}
```

Response shape:

```json
{
  "itinerary": "Markdown itinerary",
  "options": {
    "hotels": [],
    "flights": [],
    "flight_recovery": [],
    "map_center": null
  }
}
```

### `POST /api/flight-options`

Runs a targeted alternate flight search without regenerating the full itinerary.

Example instruction:

```json
{
  "origin": "LAX",
  "destination": "HNL",
  "start_date": "2026-06-20",
  "end_date": "2026-06-24",
  "budget": "2500",
  "currency_code": "USD",
  "adults": "1",
  "interests": "quiet beaches",
  "instruction": "try leaving two days earlier"
}
```

## Current Features

- Multi-agent travel planning workflow with CrewAI.
- Gemini primary LLM with Groq fallback.
- Live flights via SerpAPI Google Flights.
- Live hotels via SerpAPI Google Hotels.
- Weather summaries via OpenWeather.
- Local attraction and restaurant research via SerpAPI search.
- Fast deterministic data collection before LLM response generation.
- Structured options payload for hotels, flights, map center, and recovery suggestions.
- Cinematic full-screen React UI for Wanderful.
- Markdown itinerary rendering with styled headings, lists, tables, links, and raw Markdown export.
- Free hotel map using Leaflet + OpenStreetMap.
- Hotel card/marker selection sync.
- Flight recovery suggestions for weak or missing flight results.
- Natural-language alternate flight search input.

## Reliability Features

- Environment-based API key loading with `python-dotenv`.
- No hardcoded secrets.
- Provider request timeouts.
- Graceful missing-key messages.
- Structured error responses from Flask.
- LLM fallback from Gemini to Groq for quota-style errors.
- Fast planner mode to avoid unsupported LLM tool calls.
- `.gitignore` excludes `.env`, logs, runtime credentials, build output, dependencies, and local vector/database stores.

## Verification

Backend compile check:

```bash
python -m py_compile main.py agents.py tasks.py tools.py web_app.py data_collector.py
```

Frontend production build:

```bash
npm run build
```

Note: on some Windows environments, Vite/esbuild may require permission to spawn the build process.

## Roadmap

Planned AI engineering extensions:

- RAG travel knowledge base with ChromaDB, FAISS, or Qdrant.
- Embeddings with Sentence Transformers, Jina AI, or Nomic.
- Structured JSON itinerary generation.
- User preference memory for travel style, budget, likes, dislikes, and past trips.
- Deterministic recommendation engine for hotels, activities, and route choices.
- Local model support with Ollama or LM Studio.
- Evaluation framework for itinerary quality, hallucination rate, retrieval quality, and latency.
- Optional knowledge graph for destinations, neighborhoods, attractions, hotels, and transit.

## Security Notes

Do not commit `.env`, API keys, local CrewAI runtime files, logs, or generated build folders. This repository includes a `.gitignore` configured to exclude those artifacts.
