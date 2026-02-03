# Mahajan App Backend API Documentation

**Base URL**: `http://localhost:5000/api/v1` (or your deployed URL)

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
  - `name` (string, required, min 2 chars): User's full name.
  - `verificationToken` (string, required): The token received from `/verify-widget-token`.
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

### POST `/`
Create a new organization.
- **Access**: Private
- **Request Body**:
  - `name` (string, required, min 2 chars): Org name.
  - `city` (string, optional).
  - `phone` (string, optional): Valid phone format.
  - `address` (string, optional).
  - `gstin` (string, required): Valid GSTIN format.
  - `roleType` (enum, default 'BOTH'): `SOURCE`, `DESTINATION`, or `BOTH`.

### GET `/`
Get all organizations for the current user.

### GET `/:orgId`
Get organization by ID.
- **Access**: Private (Member only)

### PATCH `/:orgId`
Update organization details.
- **Access**: Private (Owner only)
- **Request Body**: (Partial of Create Org)

### DELETE `/:orgId`
Delete organization.
- **Access**: Private (Owner only)

### POST `/:orgId/members`
Add a member to the organization.
- **Access**: Private (Owner only)
- **Request Body**:
  - `userId` (string, required): CUID of user to add.
  - `role` (enum, default 'STAFF'): `ADMIN`, `MANAGER`, `STAFF`, `DRIVER`.

### PATCH `/:orgId/members/:memberId`
Update member role.

### DELETE `/:orgId/members/:memberId`
Remove member.

---

## 3. Drivers Module (`/api/v1/drivers`)

### POST `/`
Create a new driver profile.
- **Access**: Private
- **Request Body**:
  - `userId` (string, required): CUID of the user (must be registered).
  - `orgId` (string, optional): Link to an organization.
  - `licenseNo` (string, optional).
  - `emergencyPhone` (string, optional).
  - `notes` (string, optional).
  - `deviceId` (string, optional).

### GET `/`
Get all drivers.

### GET `/:driverId`
Get driver by ID.

### PATCH `/:driverId`
Update driver profile.
- **Request Body**:
  - `licenseNo`, `emergencyPhone`, `notes`, `deviceId`.

### DELETE `/:driverId`
Delete driver profile.

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
  - `defaultUnit` (enum, default 'KG'): `KG`, `TON`, `PIECE`, `BOX`, `BAG`, `OTHER`.
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
  - `sourceOrgId` (string, required).
  - `destinationOrgId` (string, required).
  - `truckId` (string, required).
  - `driverId` (string, required).
  - `startPoint` (string, required).
  - `endPoint` (string, required).
  - `estimatedDistance` (number, optional).
  - `estimatedArrival` (ISO Date string, optional).
  - `notes` (string, optional).

### GET `/`
Get all trips.

### GET `/:tripId`
Get trip details.

### PATCH `/:tripId/status`
Update trip status.
- **Request Body**:
  - `status` (enum): `SCHEDULED`, `STARTED`, `COMPLETED`, `CANCELLED`.
  - `remarks` (string, optional).

### POST `/:tripId/load-card`
Create Load Card (Source side).
- **Request Body**:
  - `items` (array): List of items.
    - `itemId` (optional), `itemName` (required), `quantity` (required), `unit` (enum), `rate`, `grade`, `remarks`.
  - `attachmentIds` (array of strings, required): Photo IDs from File module.
  - `remarks` (string).

### POST `/:tripId/receive-card`
Create Receive Card (Destination side).
- **Request Body**:
  - `items` (array): Contains `qualityIssue`, `shortage` etc.
  - `attachmentIds` (array, required).
  - `remarks`.

---

## 7. Chat Module (`/api/v1/chat`)

### POST `/threads`
Create or get chat thread.
- **Request Body**:
  - `accountId` (string, optional): For account/ledger chats.
  - `tripId` (string, optional): For trip-based chats.
  - **Constraint**: Provide exactly one of `accountId` or `tripId`.

### GET `/threads`
Get user's chat threads.

### GET `/threads/:threadId/messages`
Get messages.

### POST `/threads/:threadId/messages`
Send message.
- **Request Body**:
  - `content` (string, optional).
  - `attachmentIds` (array of strings, optional).
  - **Constraint**: Must have content OR attachments.

### POST `/threads/:threadId/read`
Mark messages as read.

### POST `/threads/:threadId/typing`
Set typing status.

---

## 8. Tracking Module (`/api/v1/tracking`)

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

## 9. Ledger Module (`/api/v1/ledger`)

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

## 10. Files Module (`/api/v1/files`)

### POST `/presigned-url`
Get S3/R2 upload URL.
- **Request Body**:
  - `filename` (string).
  - `mimeType` (string).
  - `fileSize` (number).
  - `purpose` (enum): `LOAD_CARD`, `RECEIVE_CARD`, `INVOICE`, `CHAT_ATTACHMENT`.
- **Response**: `{ uploadUrl, fileId, key }`.

### POST `/confirm-upload`
Confirm upload success.
- **Request Body**:
  - `fileId` (string).
  - `s3Key` (string).

### GET `/:fileId/download-url`
Get view/download URL.

---

## 11. Exports (`/api/v1/exports`)

### POST `/:orgId`
Generate export.
- **Request Body**:
  - `exportType`: `LEDGER`, `TRIPS`, `FULL_REPORT`.
  - `format`: `XLSX`, `PDF`, `CSV`.
  - `startDate`, `endDate`.
  - `includeItems`, `includePayments`.
