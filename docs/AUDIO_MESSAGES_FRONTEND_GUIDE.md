# Voice Messages — Frontend Implementation Guide (iOS & Android)

**Last Updated:** 2026-02-16  
**Backend Status:** ✅ Ready — no backend changes needed  
**Base URL:** `http://localhost:3000/api/v1`  
**Platform:** React Native (expo-av)

---

## Architecture

```
┌─────────────┐     JSON (~200B)     ┌─────────┐
│  Mobile App  │ ──────────────────► │ Backend  │  Step 1: Get presigned URL
│              │ ◄────────────────── │          │  Returns: { fileId, uploadUrl, s3Key }
│              │                      └─────────┘
│              │     Audio (~50-200KB)┌─────────┐
│              │ ──────────────────► │   S3     │  Step 2: Upload directly to S3
│              │                      └─────────┘
│              │     JSON (~100B)     ┌─────────┐
│              │ ──────────────────► │ Backend  │  Step 3: Confirm upload
│              │                      └─────────┘
│              │     JSON (~150B)     ┌─────────┐
│              │ ──────────────────► │ Backend  │  Step 4: Send chat message
└─────────────┘                      └─────────┘
```

**Audio goes directly from phone to S3. Backend only handles tiny JSON (~500 bytes total).**

---

## Part 1: Recording Audio

### Setup Permissions

```javascript
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';

const requestPermission = async () => {
  const { granted } = await Audio.requestPermissionsAsync();
  if (!granted) {
    Alert.alert('Permission needed', 'Microphone access is required for voice messages');
    return false;
  }
  return true;
};
```

### Recording Config

```javascript
// Configure audio mode
await Audio.setAudioModeAsync({
  allowsRecordingIOS: true,
  playsInSilentModeIOS: true,  // Important: plays even in silent mode
});

// Platform-specific recording settings
const RECORDING_OPTIONS = {
  ios: {
    extension: '.m4a',
    audioQuality: Audio.IOSAudioQuality.MEDIUM,
    sampleRate: 44100,
    numberOfChannels: 1,         // Mono — voice doesn't need stereo
    bitRate: 64000,              // 64kbps — good quality for voice
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
  },
  android: {
    extension: '.ogg',
    sampleRate: 16000,           // 16kHz is enough for voice
    numberOfChannels: 1,
    bitRateStrategy: Audio.AndroidBitRateStrategy.CONSTANT,
    bitRate: 32000,              // 32kbps — plenty for voice
    outputFormat: Audio.AndroidOutputFormat.OGG,
    audioEncoder: Audio.AndroidAudioEncoder.OPUS,
  },
};
```

### Start & Stop Recording

```javascript
let recording = null;
let startTime = 0;

const startRecording = async () => {
  if (!(await requestPermission())) return;

  recording = new Audio.Recording();
  await recording.prepareToRecordAsync(RECORDING_OPTIONS);
  startTime = Date.now();
  await recording.startAsync();
};

const stopRecording = async () => {
  await recording.stopAsync();
  
  const uri = recording.getURI();                               // local file path
  const duration = Math.round((Date.now() - startTime) / 1000); // seconds
  const fileInfo = await FileSystem.getInfoAsync(uri);
  const fileSize = fileInfo.size;                                // bytes
  const mimeType = Platform.OS === 'ios' ? 'audio/mp4' : 'audio/ogg';
  const extension = Platform.OS === 'ios' ? 'm4a' : 'ogg';

  // Cleanup
  await recording.stopAndUnloadAsync();
  recording = null;

  return { uri, duration, fileSize, mimeType, extension };
};

const cancelRecording = async () => {
  if (recording) {
    await recording.stopAndUnloadAsync();
    recording = null;
  }
};
```

### Audio Format Per Platform

| Platform | Format | Extension | MIME Type | File size (1 min) |
|----------|--------|-----------|-----------|-------------------|
| iOS | AAC | `.m4a` | `audio/mp4` | ~480 KB |
| Android | OGG+Opus | `.ogg` | `audio/ogg` | ~240 KB |

Both are native formats — no extra encoding libraries needed.

---

## Part 2: Upload Flow

### Step 1 → Get Presigned URL from Backend

```javascript
const getPresignedUrl = async (filename, mimeType, fileSize) => {
  const res = await fetch(`${BASE_URL}/files/presigned-url`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filename,
      mimeType,
      fileSize,
      purpose: 'CHAT_ATTACHMENT',
    }),
  });
  const { data } = await res.json();
  return data; // { fileId, uploadUrl, s3Key, expiresIn: 900 }
};
```

### Step 2 → Upload Directly to S3 (backend never sees audio)

```javascript
const uploadToS3 = async (uploadUrl, fileUri, mimeType) => {
  const fileBlob = await fetch(fileUri).then(r => r.blob());
  
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': mimeType,
      // ⚠️ Do NOT send Authorization header here! S3 will reject it.
    },
    body: fileBlob,
  });

  if (!res.ok) throw new Error('Upload to S3 failed');
};
```

### Step 3 → Confirm Upload with Backend

```javascript
const confirmUpload = async (fileId, s3Key) => {
  const res = await fetch(`${BASE_URL}/files/confirm-upload`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fileId, s3Key }),
  });
  return await res.json();
};
```

---

## Part 3: Send Chat Message

```javascript
const sendAudioMessage = async (threadId, fileId, duration) => {
  const res = await fetch(`${BASE_URL}/chat/threads/${threadId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messageType: 'AUDIO',
      attachmentIds: [fileId],
      metadata: { duration },
    }),
  });
  return await res.json();
};
```

---

## Part 4: Complete Send Function (copy-paste ready)

```javascript
/**
 * Full flow: upload audio + send as chat message
 */
const sendVoiceMessage = async (threadId, recordingResult) => {
  const { uri, duration, fileSize, mimeType, extension } = recordingResult;

  try {
    // 1. Get presigned URL
    const presign = await getPresignedUrl(
      `voice_${Date.now()}.${extension}`,
      mimeType,
      fileSize
    );

    // 2. Upload to S3
    await uploadToS3(presign.uploadUrl, uri, mimeType);

    // 3. Confirm
    await confirmUpload(presign.fileId, presign.s3Key);

    // 4. Send message
    const message = await sendAudioMessage(threadId, presign.fileId, duration);
    return message;

  } catch (error) {
    console.error('Voice message failed:', error);
    throw error;
  }
};

// Usage:
// const result = await stopRecording();
// await sendVoiceMessage(threadId, result);
```

---

## Part 5: Receiving & Playing Audio

### Message Structure (from GET /messages or WebSocket)

```json
{
  "id": "msg_abc123",
  "messageType": "AUDIO",
  "content": null,
  "metadata": { "duration": 32 },
  "senderUser": {
    "id": "user_xyz",
    "name": "Rajesh Kumar"
  },
  "attachments": [
    {
      "id": "file_abc123",
      "url": "https://mahajan-app.s3.ap-south-1.amazonaws.com/chat/2026/02/uuid.ogg",
      "fileName": "voice_1708089600.ogg",
      "mimeType": "audio/ogg",
      "sizeBytes": 85000,
      "type": "CHAT_AUDIO"
    }
  ],
  "createdAt": "2026-02-16T12:00:00Z"
}
```

### Playback

```javascript
import { Audio } from 'expo-av';

let currentSound = null;

const playAudio = async (audioUrl) => {
  // Stop any currently playing audio first
  if (currentSound) {
    await currentSound.unloadAsync();
    currentSound = null;
  }

  const { sound } = await Audio.Sound.createAsync(
    { uri: audioUrl },
    { shouldPlay: true }
  );
  currentSound = sound;

  // Track playback progress
  sound.setOnPlaybackStatusUpdate((status) => {
    if (status.isLoaded) {
      const progress = status.positionMillis / status.durationMillis;
      // → update your progress bar UI
    }
    if (status.didJustFinish) {
      sound.unloadAsync();
      currentSound = null;
      // → reset play button to initial state
    }
  });
};

const pauseAudio = async () => {
  if (currentSound) {
    await currentSound.pauseAsync();
  }
};

const resumeAudio = async () => {
  if (currentSound) {
    await currentSound.playAsync();
  }
};
```

### Cross-Platform Playback Note

iOS records AAC (.m4a), Android records OGG (.ogg).  
Both formats play on both platforms via `expo-av` — no conversion needed.

---

## Part 6: UI Components

### Chat Input Bar

```
Normal state:
┌──────────────────────────────────────────┐
│  [Type a message...        ]  📎  🎤    │
└──────────────────────────────────────────┘

Recording state:
┌──────────────────────────────────────────┐
│  🔴 Recording... 0:12        ❌    ✅   │
└──────────────────────────────────────────┘

Uploading state:
┌──────────────────────────────────────────┐
│  ⏳ Sending voice message...             │
└──────────────────────────────────────────┘
```

### Audio Message Bubble

```
┌─────────────────────────────────┐
│  ▶  ━━━━━━━●━━━━━━━━━━  0:32   │
│                    12:30 PM ✓✓  │
└─────────────────────────────────┘

Playing:
┌─────────────────────────────────┐
│  ⏸  ━━━━━━━━━━━●━━━━━  0:18   │
│                    12:30 PM ✓✓  │
└─────────────────────────────────┘
```

- ▶ / ⏸ Play/Pause toggle
- Seekable progress bar
- Duration from `metadata.duration`  
- Standard message info (time, read receipts)

---

## Common Mistakes to Avoid

| Mistake | What happens | Do this instead |
|---------|-------------|-----------------|
| Sending `Authorization` header to S3 PUT | 403 Forbidden | Only send `Content-Type` |
| Not calling `unloadAsync()` after playback | Memory leak, app slows down | Always cleanup in `didJustFinish` |
| Not setting `playsInSilentModeIOS: true` | Audio won't play when iPhone is on silent | Set it in `Audio.setAudioModeAsync()` |
| Recording in MP3 format | Need external library + large files | Use native formats (AAC/OGG) |
| Not checking file size before upload | Backend rejects files > 10MB | Check `fileSize < 10 * 1024 * 1024` |
| Not handling presigned URL expiry | Upload fails silently | URL expires in 15 min — upload immediately |

---

## Error Handling

| Error | Cause | What to show user |
|-------|-------|-------------------|
| Permission denied | Microphone not allowed | "Allow microphone access in Settings" |
| 400 on presigned-url | File > 10MB or bad MIME type | "Recording too long, try a shorter message" |
| 403 on S3 PUT | Presigned URL expired | Retry — get new URL and upload again |
| 400 on confirm-upload | File not in S3 yet | Retry upload |
| Network error | No internet | "No connection. Retry?" |

---

## Testing Checklist

- [ ] Record on iOS → send → plays on Android
- [ ] Record on Android → send → plays on iOS
- [ ] Cancel recording works (no upload happens)
- [ ] Duration shows correctly in bubble
- [ ] Play/Pause works
- [ ] Progress bar updates during playback
- [ ] Playing one message stops the previous one
- [ ] Works on silent mode (iOS)
- [ ] Retry works after network failure
- [ ] Thread list shows "🎤 Voice message" preview
- [ ] Long recording (2+ minutes) uploads without timeout

---

## Supported Audio MIME Types (backend accepts all)

```
audio/aac
audio/mp4
audio/mpeg
audio/ogg
audio/webm
audio/wav
audio/x-m4a
```
