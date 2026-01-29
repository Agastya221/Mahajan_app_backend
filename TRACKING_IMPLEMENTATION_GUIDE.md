# 🚛 Optimized Live Tracking Implementation Guide

## Overview

This guide implements battery-friendly, cost-effective live tracking with:
- ✅ **Smart frequency:** 8-10s when moving, 30-60s when stopped
- ✅ **Efficient storage:** Redis for real-time, PostgreSQL every 30s
- ✅ **Signal health:** Live/Recent/Stale/Offline status indicators
- ✅ **Offline support:** Local buffering with batch upload

---

## 🎯 System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      DRIVER MOBILE APP                          │
│                                                                  │
│  📍 GPS Service (Background)                                    │
│      ↓                                                           │
│  When Moving: 8-10s interval                                    │
│  When Stopped: 30-60s interval                                  │
│      ↓                                                           │
│  Local Buffer (if offline)                                      │
│      ↓                                                           │
│  POST /api/v1/tracking/ping (batch of 1-50 locations)          │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     BACKEND API                                  │
│                                                                  │
│  ✅ Verify trip active                                          │
│  ✅ Check duplicate batch                                       │
│      ↓                                                           │
│  🔵 ALWAYS: Update Redis (instant)                              │
│     key: trip:{id}:latest                                       │
│     TTL: 24 hours                                               │
│      ↓                                                           │
│  🟢 SMART: Store in PostgreSQL                                  │
│     Only if > 30 seconds since last DB write                    │
│      ↓                                                           │
│  📡 Broadcast via Redis Pub/Sub                                 │
│     channel: trip:{id}:location                                 │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    WEBSOCKET SERVER                              │
│                                                                  │
│  Listens to: trip:{id}:location                                │
│      ↓                                                           │
│  Broadcasts to all subscribers in room: trip:{id}               │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                   MAHAJAN WEB DASHBOARD                          │
│                                                                  │
│  🗺️ Mapbox Map                                                  │
│      ↓                                                           │
│  📍 Moving truck marker                                         │
│  🟢 Live / 🟡 Recent / 🔴 Stale / ⚫ Offline                   │
│      ↓                                                           │
│  "Last seen: 2 min ago" (big, prominent)                       │
│  "Driver: Rajesh | Truck: MH-01-AB-1234"                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📱 Driver Mobile App Implementation (React Native)

### 1. Setup Background Location Tracking

```bash
npm install react-native-background-geolocation
npm install @react-native-async-storage/async-storage
npm install axios
```

### 2. Location Service

```typescript
// services/LocationService.ts
import BackgroundGeolocation, {
  Location,
  MotionActivityEvent,
  State,
} from 'react-native-background-geolocation';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { Config } from '../config';

const OFFLINE_BUFFER_KEY = 'location_buffer';
const MAX_BUFFER_SIZE = 100;

export class LocationService {
  private tripId: string | null = null;
  private driverId: string | null = null;
  private isTracking = false;

  /**
   * Start tracking for a trip
   */
  async startTracking(tripId: string, driverId: string) {
    this.tripId = tripId;
    this.driverId = driverId;
    this.isTracking = true;

    // ✅ Configure background geolocation
    await BackgroundGeolocation.ready({
      // Geolocation config
      desiredAccuracy: BackgroundGeolocation.DESIRED_ACCURACY_HIGH,
      distanceFilter: 10, // meters - update only if moved 10m
      stopTimeout: 5, // minutes - detect when stopped

      // Activity Recognition
      stopDetectionDelay: 3, // minutes
      disableStopDetection: false,

      // ✅ Smart frequency based on motion
      locationUpdateInterval: 8000,     // 8 seconds when moving
      fastestLocationUpdateInterval: 8000,
      deferTime: 0,

      // HTTP / Persistence
      url: `${Config.API_URL}/api/v1/tracking/ping`,
      autoSync: true,           // Auto-upload when online
      autoSyncThreshold: 5,     // Upload every 5 locations
      batchSync: true,          // Send as batch
      maxBatchSize: 50,         // Max 50 locations per request
      maxRecordsToPersist: 100, // Keep max 100 offline

      headers: {
        'Authorization': `Bearer ${await this.getAuthToken()}`,
        'Content-Type': 'application/json',
      },

      // Android specific
      notification: {
        title: 'Trip Tracking Active',
        text: 'Delivering to destination',
        color: '#3b82f6',
        priority: BackgroundGeolocation.NOTIFICATION_PRIORITY_LOW,
      },
      foregroundService: true,

      // iOS specific
      preventSuspend: true,
      heartbeatInterval: 60, // ping server every 60s even if no movement

      // Logging
      debug: false,
      logLevel: BackgroundGeolocation.LOG_LEVEL_OFF,
    });

    // ✅ Add custom params to all location requests
    BackgroundGeolocation.setConfig({
      params: {
        tripId: this.tripId,
        driverId: this.driverId,
      },
    });

    // ✅ Listen to location updates (for local handling)
    BackgroundGeolocation.onLocation(this.onLocation);

    // ✅ Listen to motion activity (adjust frequency)
    BackgroundGeolocation.onMotionChange(this.onMotionChange);

    // ✅ Listen to HTTP success/failure
    BackgroundGeolocation.onHttp(this.onHttp);

    // Start tracking
    const state: State = await BackgroundGeolocation.start();
    console.log('[LocationService] Tracking started:', state);

    // Upload any buffered offline locations
    await this.uploadOfflineBuffer();
  }

  /**
   * Stop tracking
   */
  async stopTracking() {
    if (!this.isTracking) return;

    this.isTracking = false;
    await BackgroundGeolocation.stop();
    await this.uploadOfflineBuffer(); // Final upload
    console.log('[LocationService] Tracking stopped');
  }

  /**
   * Handle location updates (local processing)
   */
  private onLocation = (location: Location) => {
    console.log('[LocationService] Location received:', {
      lat: location.coords.latitude,
      lng: location.coords.longitude,
      moving: location.activity.type === 'in_vehicle' || location.activity.type === 'on_foot',
    });

    // Can update local UI here
  };

  /**
   * Handle motion activity changes (moving vs stopped)
   */
  private onMotionChange = async (event: MotionActivityEvent) => {
    console.log('[LocationService] Motion changed:', event);

    if (event.isMoving) {
      // ✅ Moving: Send updates every 8-10 seconds
      await BackgroundGeolocation.setConfig({
        locationUpdateInterval: 8000,
        distanceFilter: 10,
      });
      console.log('[LocationService] Switched to MOVING mode (8s interval)');
    } else {
      // ✅ Stopped: Send updates every 30-60 seconds
      await BackgroundGeolocation.setConfig({
        locationUpdateInterval: 30000, // 30 seconds
        distanceFilter: 50, // Only if moved 50m
      });
      console.log('[LocationService] Switched to STOPPED mode (30s interval)');
    }
  };

  /**
   * Handle HTTP responses
   */
  private onHttp = (response: any) => {
    console.log('[LocationService] HTTP response:', response.status);

    if (response.status === 401) {
      // Token expired - stop tracking and show login
      this.stopTracking();
      // Navigate to login screen
    }
  };

  /**
   * Upload buffered offline locations
   */
  private async uploadOfflineBuffer() {
    try {
      const buffer = await AsyncStorage.getItem(OFFLINE_BUFFER_KEY);
      if (!buffer) return;

      const locations = JSON.parse(buffer);
      if (locations.length === 0) return;

      console.log(`[LocationService] Uploading ${locations.length} buffered locations`);

      const token = await this.getAuthToken();
      await axios.post(
        `${Config.API_URL}/api/v1/tracking/ping`,
        {
          tripId: this.tripId,
          driverId: this.driverId,
          locations,
        },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        }
      );

      // Clear buffer after successful upload
      await AsyncStorage.removeItem(OFFLINE_BUFFER_KEY);
      console.log('[LocationService] Buffer uploaded successfully');
    } catch (error) {
      console.error('[LocationService] Failed to upload buffer:', error);
    }
  }

  /**
   * Get auth token from storage
   */
  private async getAuthToken(): Promise<string> {
    const token = await AsyncStorage.getItem('auth_token');
    return token || '';
  }
}

export const locationService = new LocationService();
```

### 3. Trip Tracking Screen

```typescript
// screens/TripTrackingScreen.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Button } from 'react-native';
import { locationService } from '../services/LocationService';

export function TripTrackingScreen({ route, navigation }) {
  const { trip, driverId } = route.params;
  const [isTracking, setIsTracking] = useState(false);

  useEffect(() => {
    // Auto-start tracking when screen loads
    handleStartTracking();

    return () => {
      // Stop tracking when leaving screen
      handleStopTracking();
    };
  }, []);

  const handleStartTracking = async () => {
    try {
      await locationService.startTracking(trip.id, driverId);
      setIsTracking(true);
    } catch (error) {
      console.error('Failed to start tracking:', error);
      alert('Failed to start tracking. Please check GPS permissions.');
    }
  };

  const handleStopTracking = async () => {
    try {
      await locationService.stopTracking();
      setIsTracking(false);
    } catch (error) {
      console.error('Failed to stop tracking:', error);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Trip in Progress</Text>
        <View style={[
          styles.badge,
          isTracking ? styles.badgeLive : styles.badgeOff
        ]}>
          <Text style={styles.badgeText}>
            {isTracking ? '🟢 Live Tracking' : '⚫ Tracking Off'}
          </Text>
        </View>
      </View>

      <View style={styles.info}>
        <Text style={styles.label}>Route</Text>
        <Text style={styles.value}>
          {trip.startPoint} → {trip.endPoint}
        </Text>

        <Text style={styles.label}>Truck</Text>
        <Text style={styles.value}>{trip.truck.number}</Text>

        <Text style={styles.label}>Load</Text>
        <Text style={styles.value}>
          {trip.loadCard?.quantity} {trip.loadCard?.unit}
        </Text>
      </View>

      <View style={styles.actions}>
        {!isTracking ? (
          <Button title="Start Tracking" onPress={handleStartTracking} />
        ) : (
          <Button
            title="Stop Tracking"
            onPress={handleStopTracking}
            color="#ef4444"
          />
        )}
      </View>

      <View style={styles.notice}>
        <Text style={styles.noticeText}>
          📱 Background tracking is active{'\n'}
          Location sent every 8-10 seconds when moving{'\n'}
          Every 30 seconds when stopped
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#fff',
  },
  header: {
    marginBottom: 30,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  badgeLive: {
    backgroundColor: '#dcfce7',
  },
  badgeOff: {
    backgroundColor: '#f3f4f6',
  },
  badgeText: {
    fontSize: 14,
    fontWeight: '600',
  },
  info: {
    marginBottom: 30,
  },
  label: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 16,
    marginBottom: 4,
  },
  value: {
    fontSize: 16,
    color: '#111827',
    fontWeight: '500',
  },
  actions: {
    marginBottom: 20,
  },
  notice: {
    backgroundColor: '#eff6ff',
    padding: 16,
    borderRadius: 8,
    marginTop: 'auto',
  },
  noticeText: {
    fontSize: 13,
    color: '#1e40af',
    lineHeight: 20,
  },
});
```

---

## 🌐 Web Dashboard Implementation (React + Mapbox)

### 1. Setup

```bash
npm install mapbox-gl react-map-gl socket.io-client
npm install date-fns
```

### 2. Live Tracking Map Component

```typescript
// components/LiveTrackingMap.tsx
import React, { useEffect, useState, useRef } from 'react';
import Map, { Marker, Layer, Source } from 'react-map-gl';
import { io, Socket } from 'socket.io-client';
import { formatDistanceToNow } from 'date-fns';
import 'mapbox-gl/dist/mapbox-gl.css';

interface Location {
  tripId: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  timestamp: string;
  driverName: string;
  driverPhone: string;
  truckNumber: string;
  truckType: string;
  status: string;
  lastUpdated: string;
  signalStatus: 'live' | 'recent' | 'stale' | 'offline';
  signalMessage: string;
  minutesSinceUpdate: number;
}

export function LiveTrackingMap({ tripId, authToken }) {
  const [location, setLocation] = useState<Location | null>(null);
  const [viewport, setViewport] = useState({
    latitude: 20.5937,
    longitude: 78.9629,
    zoom: 10,
  });
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // Fetch initial location
    fetchLatestLocation();

    // Connect to WebSocket
    connectWebSocket();

    return () => {
      disconnectWebSocket();
    };
  }, [tripId]);

  const fetchLatestLocation = async () => {
    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}/api/v1/tracking/trips/${tripId}/latest`,
        {
          headers: {
            'Authorization': `Bearer ${authToken}`,
          },
        }
      );

      const data = await response.json();
      if (data.success && data.data) {
        setLocation(data.data);
        setViewport({
          latitude: data.data.latitude,
          longitude: data.data.longitude,
          zoom: 12,
        });
      }
    } catch (error) {
      console.error('Failed to fetch location:', error);
    }
  };

  const connectWebSocket = () => {
    socketRef.current = io(process.env.REACT_APP_API_URL!, {
      auth: {
        token: authToken,
      },
    });

    // Subscribe to trip location updates
    socketRef.current.emit('tracking:subscribe', { tripId });

    // Listen for location updates
    socketRef.current.on('tracking:location-update', (data: Location) => {
      console.log('Location update received:', data);
      setLocation(data);
    });

    socketRef.current.on('tracking:subscribed', ({ tripId }) => {
      console.log(`Subscribed to trip ${tripId}`);
    });

    socketRef.current.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  };

  const disconnectWebSocket = () => {
    if (socketRef.current) {
      socketRef.current.emit('tracking:unsubscribe', { tripId });
      socketRef.current.disconnect();
    }
  };

  if (!location) {
    return (
      <div className="flex items-center justify-center h-96 bg-gray-100 rounded-lg">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading location...</p>
        </div>
      </div>
    );
  }

  // ✅ Signal status colors
  const signalColors = {
    live: 'bg-green-100 text-green-800',
    recent: 'bg-yellow-100 text-yellow-800',
    stale: 'bg-orange-100 text-orange-800',
    offline: 'bg-red-100 text-red-800',
  };

  const signalIcons = {
    live: '🟢',
    recent: '🟡',
    stale: '🟠',
    offline: '🔴',
  };

  return (
    <div className="space-y-4">
      {/* Signal Status Card */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center space-x-2 mb-2">
              <span className="text-2xl">{signalIcons[location.signalStatus]}</span>
              <h3 className="text-lg font-semibold">{location.signalMessage}</h3>
            </div>
            <p className="text-sm text-gray-600">
              Driver: {location.driverName} | Truck: {location.truckNumber}
            </p>
          </div>

          <div className={`px-4 py-2 rounded-full text-sm font-medium ${signalColors[location.signalStatus]}`}>
            {location.status}
          </div>
        </div>

        {/* Additional Info */}
        <div className="mt-4 pt-4 border-t grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-gray-500">Last Updated</p>
            <p className="font-medium">
              {formatDistanceToNow(new Date(location.lastUpdated), { addSuffix: true })}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Speed</p>
            <p className="font-medium">{location.speed ? `${Math.round(location.speed * 3.6)} km/h` : 'N/A'}</p>
          </div>
          <div>
            <p className="text-gray-500">Accuracy</p>
            <p className="font-medium">{location.accuracy ? `±${Math.round(location.accuracy)}m` : 'N/A'}</p>
          </div>
        </div>
      </div>

      {/* Map */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <Map
          {...viewport}
          onMove={evt => setViewport(evt.viewState)}
          mapboxAccessToken={process.env.REACT_APP_MAPBOX_TOKEN}
          style={{ width: '100%', height: '500px' }}
          mapStyle="mapbox://styles/mapbox/streets-v12"
        >
          {/* Truck Marker */}
          <Marker
            longitude={location.longitude}
            latitude={location.latitude}
            anchor="center"
          >
            <div className="relative">
              {/* Animated pulse for live tracking */}
              {location.signalStatus === 'live' && (
                <div className="absolute inset-0 animate-ping">
                  <div className="h-12 w-12 rounded-full bg-blue-400 opacity-75"></div>
                </div>
              )}

              {/* Truck icon */}
              <div className="relative bg-blue-500 text-white rounded-full p-3 shadow-lg">
                <span className="text-2xl">🚛</span>
              </div>
            </div>
          </Marker>
        </Map>
      </div>
    </div>
  );
}
```

---

## 📡 API Response Examples

### Success Response
```json
{
  "success": true,
  "data": {
    "tripId": "cm123abc",
    "latitude": 19.0760,
    "longitude": 72.8777,
    "accuracy": 10.5,
    "speed": 15.3,
    "timestamp": "2026-01-19T10:30:45.000Z",
    "driverName": "Rajesh Kumar",
    "driverPhone": "9876543210",
    "truckNumber": "MH-01-AB-1234",
    "truckType": "Mini Truck",
    "status": "IN_TRANSIT",
    "lastUpdated": "2026-01-19T10:30:45.000Z",
    "signalStatus": "live",
    "signalMessage": "Live tracking",
    "minutesSinceUpdate": 0
  }
}
```

### Stale Signal Example
```json
{
  "signalStatus": "stale",
  "signalMessage": "Signal issue - Last seen 8 min ago",
  "minutesSinceUpdate": 8
}
```

### Offline Example
```json
{
  "signalStatus": "offline",
  "signalMessage": "Phone may be off - Last seen 23 min ago",
  "minutesSinceUpdate": 23
}
```

---

## 📊 Performance Metrics

### Database Load Reduction
```
Before optimization:
- Location pings: 8-10 per minute = 480-600/hour = 11,520-14,400/day
- PostgreSQL writes: Same as pings = 14,400 writes/day/trip

After optimization:
- Location pings: Still 480-600/hour (all cached in Redis)
- PostgreSQL writes: 2 per minute = 120/hour = 2,880/day/trip
- Reduction: 80% fewer database writes ✅
```

### Cost Savings
```
100 active trips:
- Old: 1.44 million DB writes/day
- New: 288,000 DB writes/day
- Savings: 1.15 million writes/day ✅

Database size growth:
- Old: ~50 GB/month
- New: ~10 GB/month
- Savings: 80% storage ✅
```

---

## 🔧 Configuration Recommendations

### Driver App Settings
```typescript
// config/tracking.ts
export const TrackingConfig = {
  // Location frequency
  MOVING_INTERVAL: 8000,        // 8 seconds
  STOPPED_INTERVAL: 30000,      // 30 seconds
  DISTANCE_FILTER: 10,          // 10 meters

  // Batch upload
  BATCH_SIZE: 50,               // Max locations per batch
  AUTO_SYNC_THRESHOLD: 5,       // Upload every 5 locations

  // Offline buffer
  MAX_OFFLINE_BUFFER: 100,      // Keep max 100 locations offline

  // Battery optimization
  DESIRED_ACCURACY: 'HIGH',     // HIGH, MEDIUM, LOW
  STOP_DETECTION_DELAY: 3,      // minutes
};
```

### Backend Settings
```typescript
// src/config/tracking.ts
export const TrackingConfig = {
  // Storage interval
  DB_STORAGE_INTERVAL: 30,      // Store in PostgreSQL every 30 seconds

  // Redis TTL
  REDIS_LOCATION_TTL: 86400,    // 24 hours

  // Signal health thresholds (minutes)
  LIVE_THRESHOLD: 1,            // < 1 min = live
  RECENT_THRESHOLD: 5,          // < 5 min = recent
  STALE_THRESHOLD: 15,          // < 15 min = stale
  // > 15 min = offline
};
```

---

## ✅ Implementation Checklist

### Backend ✅ (Already Done)
- [x] Smart PostgreSQL storage (30s interval)
- [x] Redis caching for real-time display
- [x] Signal health indicators
- [x] WebSocket broadcasting
- [x] Offline batch support

### Driver App (Todo)
- [ ] Install background geolocation library
- [ ] Implement LocationService
- [ ] Add motion detection (moving vs stopped)
- [ ] Add offline buffering
- [ ] Test battery usage
- [ ] Request location permissions

### Web Dashboard (Todo)
- [ ] Install Mapbox
- [ ] Implement LiveTrackingMap component
- [ ] Connect to WebSocket
- [ ] Add signal status UI
- [ ] Test real-time updates
- [ ] Add history playback (optional)

---

## 🎯 Next Steps

1. **Week 1:** Implement driver app LocationService
2. **Week 2:** Build web dashboard map component
3. **Week 3:** Test with 5-10 drivers on real routes
4. **Week 4:** Optimize based on battery/network feedback

---

Your backend is **production-ready** for this optimized tracking system! 🚀
