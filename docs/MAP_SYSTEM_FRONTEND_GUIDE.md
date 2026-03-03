# 🗺️ Map System — Frontend Guide

> **Date**: 2026-03-03
> **Backend**: Mapbox Directions + Geocoding API (proxied through backend)
> **Breaking changes**: None — all additive

---

## Architecture

```
Mobile App ──► Backend (proxy) ──► Mapbox API
              │
              ├── Auth check
              ├── Redis cache (24h routes, 1h geocoding)
              ├── Rate limiting (30/min)
              └── Token is NEVER exposed to frontend
```

---

## 1️⃣ Get Trip Route (Swiggy/Zomato style)

### `GET /api/v1/trips/:tripId/route`

Returns the driving route polyline between source and destination. Both sender and receiver (and driver) can call this. Cached for 24 hours.

**Auth**: Required  
**Who can call**: Source org members, Destination org members, Driver assigned to trip

#### Response

```json
{
  "success": true,
  "data": {
    "coordinates": [[73.791, 20.006], [73.785, 19.998], ...],
    "distanceMeters": 185300,
    "durationSeconds": 12600,
    "distanceKm": 185.3,
    "durationMinutes": 210
  }
}
```

| Field | Type | What it is |
|---|---|---|
| `coordinates` | `[lng, lat][]` | GeoJSON coordinate array — draw this as polyline on the map |
| `distanceMeters` | `number` | Total driving distance in meters |
| `durationSeconds` | `number` | Estimated driving time in seconds |
| `distanceKm` | `number` | Distance in km (human readable) |
| `durationMinutes` | `number` | Duration in minutes (human readable) |

#### Error Cases

| Status | When |
|---|---|
| 404 | Trip not found |
| 403 | User is not sender, receiver, or driver |
| 400 | Trip doesn't have coordinates set |
| 400 | No driving route found (e.g. across ocean) |

#### Usage with React Native Mapbox

```typescript
// Fetch route
const { data } = await api.get(`/trips/${tripId}/route`);

// Draw polyline on Mapbox map
<MapboxGL.ShapeSource id="routeSource" shape={{
  type: 'Feature',
  geometry: {
    type: 'LineString',
    coordinates: data.coordinates,  // [[lng, lat], ...]
  }
}}>
  <MapboxGL.LineLayer id="routeLine" style={{
    lineColor: '#4A90D9',
    lineWidth: 4,
    lineCap: 'round',
    lineJoin: 'round',
  }} />
</MapboxGL.ShapeSource>
```

#### Combining with Live Tracking

```
Route polyline:  GET /trips/:tripId/route        → draw the road line
Live truck:      GET /trips/:tripId/latest        → truck marker position
Location history:GET /trips/:tripId/locations     → breadcrumb trail
WebSocket:       tracking:location-update event  → real-time position updates
```

---

## 2️⃣ Forward Geocoding (Search → Locations)

### `GET /api/v1/map/geocode/forward`

Search for places by text. Used in trip creation when selecting destination for unregistered receivers.

**Auth**: Required  
**Rate limit**: 30/min

#### Query Parameters

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `q` | string | ✅ | — | Search query (min 2 chars, max 200) |
| `limit` | number | ❌ | 5 | Number of results (1-10) |

#### Example

```
GET /api/v1/map/geocode/forward?q=Nashik+APMC+Market&limit=3
```

#### Response

```json
{
  "success": true,
  "data": [
    {
      "id": "dXJuOm...",
      "name": "APMC Market",
      "fullAddress": "APMC Market, Pimpalgaon Baswant, Nashik, Maharashtra 422209",
      "lat": 20.0063,
      "lng": 73.7910,
      "city": "Nashik",
      "state": "Maharashtra",
      "pincode": "422209"
    }
  ]
}
```

---

## 3️⃣ Reverse Geocoding (Pin Drop → Address)

### `GET /api/v1/map/geocode/reverse`

Convert lat/lng coordinates to an address. Used when user drops a pin on the map.

**Auth**: Required  
**Rate limit**: 30/min

#### Query Parameters

| Param | Type | Required | Description |
|---|---|---|---|
| `lat` | number | ✅ | Latitude (-90 to 90) |
| `lng` | number | ✅ | Longitude (-180 to 180) |

#### Example

```
GET /api/v1/map/geocode/reverse?lat=20.0063&lng=73.7910
```

#### Response

```json
{
  "success": true,
  "data": {
    "name": "Pimpalgaon Baswant APMC",
    "fullAddress": "APMC Road, Pimpalgaon Baswant, Nashik, Maharashtra 422209",
    "lat": 20.0063,
    "lng": 73.7910,
    "city": "Nashik",
    "state": "Maharashtra",
    "pincode": "422209"
  }
}
```

---

## 4️⃣ Trip Create/Edit — Coordinate Fields

**New optional fields** on `POST /api/v1/trips` and `PATCH /api/v1/trips/:tripId`:

| Field | Type | Description |
|---|---|---|
| `sourceLat` | number | Source latitude (from org address or geocoder) |
| `sourceLng` | number | Source longitude |
| `destLat` | number | Destination latitude |
| `destLng` | number | Destination longitude |

These are optional — if not provided, the trip route endpoint returns a 400 error asking for coordinates.

#### How to get coordinates

| Source | How |
|---|---|
| **Registered Mahajan** | Use the org's address — geocode it once and cache |
| **Unregistered receiver** | Use the forward geocode or pin drop endpoints above |

---

## Summary of All Map Endpoints

| Endpoint | Purpose | Cache |
|---|---|---|
| `GET /trips/:tripId/route` | Route polyline for Swiggy-style tracking | 24h Redis |
| `GET /map/geocode/forward?q=...` | Search places by text | 1h Redis |
| `GET /map/geocode/reverse?lat=&lng=` | Pin drop → address | 1h Redis |
