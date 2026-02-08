# Mahajan App Backend API Documentation

**Base URL**: `http://localhost:3000/api/v1` (or your deployed URL)

## Authentication

Most endpoints require valid authentication headers.

- **Header**: `Authorization`
- **Value**: `Bearer <access_token>`

The access token is obtained via the `/auth` endpoints.

---

## 1. Auth Module (`/api/v1/auth`)

### GET `/widget-config`
Get MSG91 widget configuration for frontend initialization.
- **Access**: Public
- **Response**:
  ```json
  {
    "success": true,
    "data": { "widgetId": "...", "tokenAuth": "..." }
  }
  ```

### POST `/verify-widget-token`
Verify MSG91 widget/SDK access token.
- **Access**: Public
- **Request Body**:
  - `accessToken` (string, required): The token received from MSG91 SDK/Widget.
- **Response**:
  - **Existing User**:
    ```json
    {
      "success": true,
      "isNewUser": false,
      "user": { ... },
      "tokens": { "accessToken": "...", "refreshToken": "..." }
    }
    ```
  - **New User**:
    ```json
    {
      "success": true,
      "isNewUser": true,
      "phone": "...",
      "verificationToken": "..."
    }
    ```

### POST `/register`
Complete registration for new users.
- **Access**: Public
- **Request Body**:
  - `name` (string, required, min 2–100 chars): User's full name.
  - `verificationToken` (string, required): The token received from `/verify-widget-token`.
  - `registerAs` (enum, default `MAHAJAN`): `MAHAJAN` or `DRIVER`.
- **Behavior**:
  - `MAHAJAN`: Auto-creates Org + OrgMember for the user.
  - `DRIVER`: Auto-creates DriverProfile and links any pending trips assigned to this phone number.
- **Response**: Returns user object and auth tokens.

### POST `/refresh`
Refresh access token.
- **Access**: Public
- **Request Body**:
  - `refreshToken` (string, required).

### POST `/logout`
Logout user.
- **Access**: Private
- **Request Body**:
  - `refreshToken` (string, optional): To revoke specific refresh token.

---

## 2. Organizations Module (`/api/v1/orgs`)

> **Note**: Each MAHAJAN is the sole owner of their org. Member management endpoints have been removed — members are managed implicitly through registration.

### POST `/`
Create a new organization.
- **Access**: Private (MAHAJAN only)
- **Request Body**:
  - `name` (string, required, min 2 chars): Org name.
  - `city` (string, optional).
  - `phone` (string, optional): Valid phone format.
  - `address` (string, optional).
  - `gstin` (string, required): Valid 15-char Indian GSTIN format.
  - `roleType` (enum, default `BOTH`): `SOURCE_COLLECTOR`, `DESTINATION_DISTRIBUTOR`, or `BOTH`.

### GET `/`
Get all organizations for the current user.
- **Access**: Private

### GET `/:orgId`
Get organization by ID.
- **Access**: Private (Member only)

### PATCH `/:orgId`
Update organization details.
- **Access**: Private (Owner only)
- **Request Body**: Partial — any of `name`, `city`, `phone`, `address`, `gstin`, `roleType`.

### DELETE `/:orgId`
Delete organization.
- **Access**: Private (Owner only)

---

## 3. Drivers Module (`/api/v1/drivers`)

> **Note**: Drivers are independent — they are not tied to any org. A DriverProfile is auto-created when a user registers with `registerAs: "DRIVER"`. These endpoints are for manual management.

### POST `/`
Create a driver profile for an existing user.
- **Access**: Private
- **Request Body**:
  - `userId` (string, required): CUID of the user.
  - `licenseNo` (string, optional).
  - `emergencyPhone` (string, optional): Valid phone format.
  - `notes` (string, optional).
  - `deviceId` (string, optional).

### GET `/`
List drivers with pagination.
- **Access**: Private
- **Query Params**:
  - `phone` (string, optional): Filter by driver's phone number.
  - `page`, `limit`: Pagination.

### GET `/:driverId`
Get driver by ID.
- **Access**: Private

### PATCH `/:driverId`
Update driver profile.
- **Access**: Private
- **Request Body**: Partial — any of `licenseNo`, `emergencyPhone`, `notes`, `deviceId`.

### DELETE `/:driverId`
Delete driver profile.
- **Access**: Private

---

## 4. Trucks Module (`/api/v1/trucks`)

### POST `/`
Create a new truck.
- **Access**: Private
- **Request Body**:
  - `orgId` (string, required): CUID of owning org.
  - `number` (string, required, min 3 chars).
  - `type` (string, optional).
  - `capacity` (number, optional).

### GET `/`
Get all trucks.

### GET `/:truckId`
Get truck by ID.

### PATCH `/:truckId`
Update truck details.
- **Request Body**: `number`, `type`, `capacity`.

### DELETE `/:truckId`
Delete truck.

---

## 5. Items Module (`/api/v1/items`)

**Note**: All routes start with `/api/v1/items/:orgId`. Requires Org Membership.

### POST `/:orgId`
Create a new item in Master.
- **Request Body**:
  - `name` (string, required).
  - `nameHindi` (string, optional).
  - `category` (string, optional).
  - `hsn` (string, optional): HSN Code.
  - `defaultUnit` (enum, default 'KG'): `KG`, `BAG`, `TON`, `CRATE`, `BOX`, `BUNDLE`, `TRAY`, `SACK`, `PETI`, `DOZEN`, `PIECE`, `QUINTAL`, `OTHER`.
  - `defaultCustomUnit` (string, optional): Required if unit is 'OTHER'.

### GET `/:orgId`
List items.
- **Query Params**:
  - `category`: Filter by category.
  - `search`: Search by name.
  - `includeInactive`: 'true' or 'false'.
  - `page`, `limit`: Pagination.

### GET `/:orgId/categories`
Get distinct item categories.

### GET `/:orgId/:itemId`
Get item by ID.

### PATCH `/:orgId/:itemId`
Update item.

### DELETE `/:orgId/:itemId`
Soft delete item.

---

## 6. Trips Module (`/api/v1/trips`)

### POST `/`
Create a new trip.
- **Access**: Private
- **Request Body**:
  - `sourceOrgId` (string, required): CUID of source org.
  - `destinationOrgId` (string, required): CUID of destination org.
  - `truckNumber` (string, required): Truck registration number (looked up or created automatically).
  - `driverPhone` (string, required): Indian phone number format `+91XXXXXXXXXX`. If the driver is registered, they are linked automatically. If not, stored as `pendingDriverPhone` and linked when they register.
  - `startPoint` (string, required).
  - `endPoint` (string, required).
  - `estimatedDistance` (number, optional, positive).
  - `estimatedArrival` (ISO Date string, optional).
  - `notes` (string, optional).
  - **Driver Payment Config** (optional — set payment terms at trip creation):
    - `driverPaymentAmount` (number, optional, positive): Total amount payable to driver.
    - `driverPaymentPaidBy` (enum, optional): `SOURCE`, `DESTINATION`, or `SPLIT`.
    - `driverPaymentSplitSourceAmount` (number, optional): Source's share (required if `SPLIT`).
    - `driverPaymentSplitDestAmount` (number, optional): Destination's share (required if `SPLIT`).

### GET `/`
Get all trips.
- **Access**: Private
- **Query Params**:
  - `orgId` (string, optional): Filter trips by org. If omitted, returns trips for all user's orgs.
  - `status` (enum, optional): Filter by trip status.
  - `page`, `limit`: Pagination (max 100).
- **Response**: Each trip includes:
  - `sourceOrg` — `{ id, name, phone }`
  - `destinationOrg` — `{ id, name, phone }`
  - `truck`, `driver` (with user name/phone), `latestLoc`
  - `loadCard` — with full `items[]` array (`itemName`, `quantity`, `unit`, `rate`, `grade`, etc.)
  - `receiveCard` — with full `items[]` array

### GET `/:tripId`
Get trip details (full detail view).
- **Access**: Private
- **Response**: Includes everything from list view plus:
  - `sourceOrg` / `destinationOrg` — `{ id, name, phone, gstin, city }`
  - `events[]` — timeline of trip events (last 20)
  - `loadCard` — with items, attachments, and `createdByUser`
  - `receiveCard` — with items (including `loadItem` reference), attachments, `createdByUser`, `approvedByUser`

### PATCH `/:tripId/status`
Update trip status.
- **Access**: Private
- **Request Body**:
  - `status` (enum): `CREATED`, `ASSIGNED`, `LOADED`, `IN_TRANSIT`, `ARRIVED`, `REACHED`, `DELIVERED`, `COMPLETED`, `CLOSED`, `CANCELLED`, `DISPUTED`.
  - `remarks` (string, optional).

### POST `/:tripId/load-card`
Create Load Card (Source side).
- **Access**: Private
- **Request Body**:
  - `items` (array, min 1, max 100): List of items.
    - `itemId` (CUID, optional): Link to item master.
    - `itemName` (string, required, max 200).
    - `itemNameHindi` (string, optional, max 200).
    - `quantity` (number, required, positive).
    - `unit` (enum): `KG`, `BAG`, `TON`, `CRATE`, `BOX`, `BUNDLE`, `TRAY`, `SACK`, `PETI`, `DOZEN`, `PIECE`, `QUINTAL`, `OTHER`.
    - `customUnit` (string, optional, max 50): Required when `unit` is `OTHER`.
    - `rate` (number, optional, positive): Price per unit.
    - `grade` (string, optional, max 50).
    - `remarks` (string, optional, max 500).
  - `attachmentIds` (array of CUIDs, min 1): Photo IDs from File module.
  - `remarks` (string, optional, max 1000).

### POST `/:tripId/receive-card`
Create Receive Card (Destination side).
- **Access**: Private
- **Request Body**:
  - `items` (array, min 1, max 100): List of received items.
    - `loadItemId` (CUID, optional): Link to corresponding load card item.
    - `itemId` (CUID, optional): Link to item master.
    - `itemName` (string, required, max 200).
    - `itemNameHindi` (string, optional, max 200).
    - `quantity` (number, required, positive): Quantity received.
    - `unit` (enum): Same as load card units.
    - `customUnit` (string, optional, max 50): Required when `unit` is `OTHER`.
    - `rate` (number, optional, positive).
    - `grade` (string, optional, max 50).
    - `qualityIssue` (string, optional, max 200): e.g., "Damaged", "Rotten", "Wet".
    - `remarks` (string, optional, max 500).
  - `attachmentIds` (array of CUIDs, min 1): Photo IDs from File module.
  - `remarks` (string, optional, max 1000).
- **Note**: Shortage and shortage percentage are auto-calculated by comparing received quantity against the load card.

---

## 7. Chat Module (`/api/v1/chat`)

### POST `/threads`
Create or get chat thread (idempotent — returns existing thread if one already exists).
- **Access**: Private
- **Request Body**:
  - `accountId` (string, optional): For account/ledger chats.
  - `tripId` (string, optional): For trip-based chats.
  - **Constraint**: Provide exactly one of `accountId` or `tripId`.
- **Response**: `201` if newly created, `200` if already exists.
  ```json
  {
    "success": true,
    "data": { "id": "...", "orgId": "...", "accountId": "...", "account": { ... }, ... },
    "message": "Thread created"
  }
  ```

### GET `/threads`
Get user's chat threads (sorted by pinned first, then latest message).
- **Access**: Private
- **Query Params**:
  - `accountId` (string, optional): Filter by account.
  - `tripId` (string, optional): Filter by trip.
  - `page`, `limit`: Pagination.
- **Response**: Each thread includes `lastMessageText`, `unreadCount`, `isPinned`, `isArchived`, and related account/trip details.

### GET `/threads/:threadId`
Get a single thread by ID.
- **Access**: Private

### GET `/threads/:threadId/messages`
Get messages in a thread.
- **Access**: Private
- **Query Params**:
  - `limit` (number, default 50): Messages per page.
  - `offset` (number, default 0): Pagination offset.
- **Response**: Each message includes:
  - `id`, `content`, `messageType`, `senderUserId`, `sender` (name, phone)
  - `isDelivered`, `deliveredAt` — single tick (delivered to recipient)
  - `isRead`, `readAt` — double tick (read by recipient)
  - `replyToId`, `replyTo` — reply context with original message content, sender, and first attachment
  - `attachments[]` — array of `{ id, type, url, mimeType, fileName, sizeBytes }`
  - `createdAt`

### POST `/threads/:threadId/messages`
Send a message in a thread.
- **Access**: Private
- **Request Body**:
  - `content` (string, max 5000, optional): Message text.
  - `messageType` (enum, default `TEXT`): One of `TEXT`, `IMAGE`, `PDF`, `FILE`, `SYSTEM_MESSAGE`, `PAYMENT_UPDATE`, `INVOICE_UPDATE`, `LOCATION`.
  - `attachmentIds` (array of CUID strings, max 10, optional): IDs of uploaded files (must be status `COMPLETED` via the Files module).
  - `replyToId` (string CUID, optional): ID of message being replied to.
  - **Validation**:
    - `TEXT` messages **require** `content`.
    - `IMAGE` / `PDF` / `FILE` messages **require** `attachmentIds`.
    - Other types (SYSTEM_MESSAGE, PAYMENT_UPDATE, etc.) are system-generated only.
- **Response** (`201`):
  ```json
  {
    "success": true,
    "data": {
      "id": "...",
      "content": "Hello!",
      "messageType": "TEXT",
      "senderUserId": "...",
      "sender": { "id": "...", "name": "...", "phone": "..." },
      "replyTo": null,
      "attachments": [],
      "isDelivered": false,
      "isRead": false,
      "createdAt": "..."
    }
  }
  ```

### POST `/threads/:threadId/delivered`
Mark all unread messages from other senders as delivered (single tick).
- **Access**: Private
- **Response**:
  ```json
  {
    "success": true,
    "data": { "count": 3 },
    "message": "Marked 3 message(s) as delivered"
  }
  ```

### POST `/threads/:threadId/read`
Mark all unread messages from other senders as read (double tick). Also sets `isDelivered` if not already set.
- **Access**: Private
- **Response**:
  ```json
  {
    "success": true,
    "data": { "count": 3 },
    "message": "Marked 3 message(s) as read"
  }
  ```

### POST `/threads/:threadId/pin`
Toggle pin/unpin a thread.
- **Access**: Private
- **Request Body**:
  - `isPinned` (boolean): `true` to pin, `false` to unpin.

### POST `/threads/:threadId/archive`
Toggle archive/unarchive a thread.
- **Access**: Private
- **Request Body**:
  - `isArchived` (boolean): `true` to archive, `false` to unarchive.

### GET `/unread`
Get unread message counts across all threads.
- **Access**: Private
- **Response**: Array of `{ threadId, unreadCount }` for threads with unread messages.

### GET `/search`
Search messages across threads in an org.
- **Access**: Private
- **Query Params**:
  - `orgId` (string, required): Organization ID.
  - `query` (string, required): Search term (matches message content, payment reference, or invoice number).
- **Response**: Array of matching messages with sender, thread, payment, and invoice context.

### WebSocket Events (Chat)

**Client → Server:**
| Event | Payload | Description |
|-------|---------|-------------|
| `chat:join` | `{ threadId }` | Join a chat room. Auto-marks messages as delivered. |
| `chat:leave` | `{ threadId }` | Leave a chat room. |

**Server → Client:**
| Event | Payload | Description |
|-------|---------|-------------|
| `chat:joined` | `{ threadId }` | Confirmation of joining a chat room. |
| `chat:left` | `{ threadId }` | Confirmation of leaving a chat room. |
| `chat:message` | Full message object | New message broadcast to all participants in the thread. |
| `chat:delivered` | `{ threadId, userId, deliveredAt, count }` | Messages marked as delivered by a user. |
| `chat:read` | `{ threadId, userId, readAt, count }` | Messages marked as read by a user. |

> **Note**: Typing indicators have been **removed**. The `POST /threads/:threadId/typing` endpoint no longer exists.

---

## 8. Driver Payments Module

> Driver payment endpoints are nested under trips (`/api/v1/trips/:tripId/driver-payment`) and orgs (`/api/v1/orgs/:orgId/pending-driver-payments`).

### POST `/trips/:tripId/driver-payment`
Create or update driver payment terms for a trip.
- **Access**: Private (source or destination mahajan)
- **Request Body**:
  - `totalAmount` (number, required, positive): Total amount payable to the driver.
  - `paidBy` (enum, default `SOURCE`): `SOURCE`, `DESTINATION`, or `SPLIT`.
  - `splitSourceAmount` (number, optional, positive): Required if `paidBy` is `SPLIT`.
  - `splitDestAmount` (number, optional, positive): Required if `paidBy` is `SPLIT`.
  - `remarks` (string, optional).
- **Response** (`201`): DriverPayment object.

### POST `/trips/:tripId/driver-payment/record`
Record a payment made to the driver.
- **Access**: Private (source or destination mahajan)
- **Request Body**:
  - `amount` (number, required, positive): Amount being paid.
  - `remarks` (string, optional).
- **Response**: Updated DriverPayment with new `paidAmount` and auto-advanced `status`.
- **Status Transitions**: `PENDING` → `PARTIALLY_PAID` → `PAID` (based on paidAmount vs totalAmount).

### GET `/trips/:tripId/driver-payment`
Get driver payment status for a trip.
- **Access**: Private (source or destination mahajan)
- **Response**: DriverPayment object including trip details and driver info.

### GET `/orgs/:orgId/pending-driver-payments`
List all pending/partially-paid driver payments for an org.
- **Access**: Private (org member)
- **Response**: Array of DriverPayment objects with trip and driver details.

**DriverPayment Status Values**: `PENDING`, `PARTIALLY_PAID`, `PAID`, `DISPUTED`

---

## 9. Users Module (`/api/v1/users`)

### POST `/me/gstin`
Submit GST number for verification.
- **Access**: Private (MAHAJAN only)
- **Request Body**:
  - `gstin` (string, required): Valid 15-char Indian GSTIN format (`XX AAAAA 9999 A 9 Z X`).
- **Response**:
  ```json
  {
    "success": true,
    "data": { "id": "...", "name": "...", "phone": "...", "gstin": "...", "isVerified": false }
  }
  ```
- **Note**: GSTIN is stored but `isVerified` remains `false` until admin verification.

### GET `/me/gstin`
Get current user's GSTIN verification status.
- **Access**: Private
- **Response**:
  ```json
  {
    "success": true,
    "data": { "id": "...", "gstin": "22AAAAA0000A1Z5", "isVerified": false }
  }
  ```

---

## 10. Tracking Module (`/api/v1/tracking`)

### POST `/ping`
Submit GPS locations (Driver App only).
- **Request Body**:
  - `tripId` (string, required).
  - `driverId` (string, required).
  - `locations` (array):
    - `latitude` (number), `longitude` (number).
    - `accuracy` (number), `speed` (number).
    - `timestamp` (ISO Date string).

### GET `/trips/:tripId/locations`
Get location history.

### GET `/trips/:tripId/latest`
Get latest location.

---

## 11. Ledger Module (`/api/v1/ledger`)

### POST `/accounts`
Create ledger account between two orgs.
- **Request Body**: `ownerOrgId`, `counterpartyOrgId`.

### POST `/invoices`
Create invoice.
- **Request Body**:
  - `accountId` (string, required).
  - `invoiceNumber` (string, required).
  - `amount` (number, required).
  - `description`, `dueDate`, `attachmentIds`.

### POST `/payments`
Record payment.
- **Request Body**:
  - `accountId` (string).
  - `amount` (number).
  - `paymentMethod` (string).
  - `transactionId` (string).
  - `tag` (enum): `SENT`, `RECEIVED`.

---

## 12. Files Module (`/api/v1/files`)

### POST `/presigned-url`
Get S3/R2 upload URL.
- **Request Body**:
  - `filename` (string).
  - `mimeType` (string).
  - `fileSize` (number).
  - `purpose` (enum): `LOAD_CARD`, `RECEIVE_CARD`, `INVOICE`, `PAYMENT_PROOF`, `RECEIPT`, `CHAT_ATTACHMENT`.
- **Response**: `{ uploadUrl, fileId, key }`.
- **Note**: `CHAT_ATTACHMENT` auto-detects file type — image MIME types become `CHAT_IMAGE`, everything else becomes `CHAT_DOCUMENT`.

### POST `/confirm-upload`
Confirm upload success.
- **Request Body**:
  - `fileId` (string).
  - `s3Key` (string).

### GET `/:fileId/download-url`
Get view/download URL.

---

## 13. Exports (`/api/v1/exports`)

### POST `/:orgId`
Generate export.
- **Request Body**:
  - `exportType`: `LEDGER`, `TRIPS`, `FULL_REPORT`.
  - `format`: `XLSX`, `PDF`, `CSV`.
  - `startDate`, `endDate`.
  - `includeItems`, `includePayments`.
