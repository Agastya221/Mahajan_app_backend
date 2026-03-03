📌 Overview

This document explains how to securely integrate Mapbox Directions API in the Mahajan backend using:

🔐 Token B — sk.xxx (Backend Only)
Scope: MAP:READ

This token is used only in the backend to:

Generate trip routes

Fetch route geometry (polyline)

Optionally compute ETA and distance

It must never be exposed to the mobile app.

🧠 Why We Use Backend Proxy

We DO NOT call Mapbox Directions API directly from the mobile app because:

APK can be reverse engineered

Public tokens can be abused

Billing quota can be drained

No caching control

No rate limiting

Instead:

Mobile App → Backend → Mapbox API

Backend controls:

Authentication

Caching

Rate limiting

Cost control

Error handling

🔐 1️⃣ Creating Token B

In Mapbox dashboard:

Go to Account → Tokens

Click Create token

Name it:

mahajan-backend-directions

Enable scope:

✅ MAP:READ

Do NOT enable any WRITE permissions.

🔐 2️⃣ Store Token Securely

In backend root directory:

backend/.env

Add:

MAPBOX_SECRET_TOKEN=sk.your_secret_token_here
Important Rules:

.env must be in .gitignore

Never commit this token

Never log this token

Never send this token to frontend

🚀 3️⃣ Backend Route — Get Trip Route
Endpoint
GET /trips/:tripId/route
Flow

Authenticate user

Fetch trip from database

Validate pickup & drop coordinates

Call Mapbox Directions API

Cache response

Return route coordinates only

🧱 Example Implementation (Express + TypeScript)
import fetch from "node-fetch";
import { Request, Response } from "express";

export async function getTripRoute(req: Request, res: Response) {
  try {
    const tripId = req.params.tripId;

    // 1. Fetch trip
    const trip = await Trip.findById(tripId);
    if (!trip) {
      return res.status(404).json({ error: "Trip not found" });
    }

    const { pickupLat, pickupLng, dropLat, dropLng } = trip;

    if (
      !pickupLat || !pickupLng ||
      !dropLat || !dropLng
    ) {
      return res.status(400).json({ error: "Invalid coordinates" });
    }

    // 2. Call Mapbox Directions API
    const url =
      `https://api.mapbox.com/directions/v5/mapbox/driving/` +
      `${pickupLng},${pickupLat};${dropLng},${dropLat}` +
      `?geometries=geojson&overview=full` +
      `&access_token=${process.env.MAPBOX_SECRET_TOKEN}`;

    const response = await fetch(url);
    const data = await response.json();

    if (!data.routes?.length) {
      return res.status(500).json({ error: "No route found" });
    }

    // 3. Extract route
    const route = data.routes[0];

    return res.json({
      coordinates: route.geometry.coordinates,
      distanceMeters: route.distance,
      durationSeconds: route.duration
    });

  } catch (error) {
    console.error("Mapbox route error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
📦 4️⃣ Route Caching Strategy

Routes do not change once a trip is created.

Cache Key
trip_route_${tripId}
TTL
24 hours
Simple In-Memory Cache (MVP)
const routeCache = new Map();

async function getRouteWithCache(tripId) {
  const cached = routeCache.get(tripId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const route = await callMapbox(tripId);

  routeCache.set(tripId, {
    data: route,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000
  });

  return route;
}
Production Upgrade (Recommended Later)

Use:

Redis

TTL: 24h

Same key format

🔐 5️⃣ Security Checklist
Rule	Required
Store sk.xxx in backend .env	✅
Add .env to .gitignore	✅
Never send token to frontend	✅
Never log token	✅
Use HTTPS for all requests	✅
Validate coordinates before calling Mapbox	✅
📡 6️⃣ What Frontend Receives

Frontend receives:

{
  "coordinates": [[lng, lat], [lng, lat]],
  "distanceMeters": 14321,
  "durationSeconds": 1240
}

Frontend never sees:

Secret token

Mapbox API URL

Raw billing metadata

📈 7️⃣ Future Improvements

Later enhancements:

Redis caching

Route deviation detection

ETA recalculation

Distance-based pricing

Rate limiting Mapbox calls

Monitoring Mapbox usage

🧾 Final Summary

Token B (sk.xxx with MAP:READ):

Lives only in backend .env

Used only to call Mapbox Directions API

Never exposed to mobile app

Protected by authentication

Cached to reduce cost

Upgradeable to Redis when scaling
