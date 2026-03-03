# 💳 Razorpay Payment Integration — Frontend Guide

> **For**: Frontend / React Native developers
> **Date**: 2026-03-04
> **Backend**: Express + Prisma + Razorpay Node.js SDK

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                REACT NATIVE APP                              │
│                                                              │
│  1. User taps "Pay Now"                                      │
│     ↓                                                        │
│  2. POST /razorpay/create-order/payment  ────→  Backend      │
│     ↓                                                        │
│  3. Open Razorpay Checkout (SDK)                             │
│     ↓ (user pays via UPI/Card/NetBanking)                    │
│  4. On success → POST /razorpay/verify  ────→  Backend       │
│     ↓                                                        │
│  5. Backend verifies signature → auto-confirms payment       │
│     → updates ledger → posts chat notification               │
│                                                              │
│  ✅ Done! No manual "Mark as Paid" / "Confirm" needed.       │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔑 Setup

Install Razorpay React Native SDK:
```bash
npm install react-native-razorpay
```

The `key_id` is returned by the backend in every create-order response — **never hardcode it**.

---

## 📡 API Endpoints

### 1. Create Order — For Existing Payment Request

When a payment request already exists (receiver asked for money), the payer clicks "Pay Now":

```
POST /api/v1/razorpay/create-order/payment
Authorization: Bearer <token>
```

**Request:**
```json
{
  "paymentId": "clx1abc..."
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "orderId": "order_PxYz123456",
    "amount": 18550,
    "currency": "INR",
    "keyId": "rzp_test_xxxxx",
    "paymentId": "clx1abc...",
    "description": "Payment to Mahajan Fruits, Nashik"
  }
}
```

> **Note**: `amount` is in **paise** (₹185.50 = 18550)

---

### 2. Create Order — For Trip Payment (Pay Now on Trip)

When a Mahajan wants to pay for a specific trip directly:

```
POST /api/v1/razorpay/create-order/trip
Authorization: Bearer <token>
```

**Request:**
```json
{
  "tripId": "clx2def...",
  "accountId": "clx3ghi...",
  "amount": 25000,
  "tag": "FINAL",
  "remarks": "Apple shipment - Nov batch"
}
```

> `amount` here is in **rupees** (₹25,000) — backend converts to paise

**Response:**
```json
{
  "success": true,
  "data": {
    "orderId": "order_AbCd789012",
    "amount": 2500000,
    "currency": "INR",
    "keyId": "rzp_test_xxxxx",
    "paymentId": "clx4jkl...",
    "description": "Trip payment to Mahajan Trading Co."
  }
}
```

---

### 3. Create Order — For Driver Payment

```
POST /api/v1/razorpay/create-order/driver
Authorization: Bearer <token>
```

**Request:**
```json
{
  "tripId": "clx2def..."
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "orderId": "order_DrIv345678",
    "amount": 850000,
    "currency": "INR",
    "keyId": "rzp_test_xxxxx",
    "tripId": "clx2def...",
    "description": "Driver payment - Ramesh Kumar"
  }
}
```

---

### 4. Verify Payment (After Checkout Success)

```
POST /api/v1/razorpay/verify
Authorization: Bearer <token>
```

**Request:**
```json
{
  "razorpay_order_id": "order_PxYz123456",
  "razorpay_payment_id": "pay_AbCd789012",
  "razorpay_signature": "hex_signature_string..."
}
```

**Response (success):**
```json
{
  "success": true,
  "data": {
    "success": true,
    "message": "Payment verified and confirmed",
    "paymentId": "clx1abc...",
    "razorpayPaymentId": "pay_AbCd789012"
  }
}
```

---

### 5. Check Order Status

```
GET /api/v1/razorpay/order/:orderId/status
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "orderId": "order_PxYz123456",
    "status": "paid",
    "amount": 18550,
    "amountPaid": 18550,
    "amountDue": 0,
    "currency": "INR"
  }
}
```

| Status | Meaning |
|---|---|
| `created` | Order created, not yet attempted |
| `attempted` | Payment was attempted but failed |
| `paid` | Payment successful |

---

## 📱 React Native Implementation

```typescript
import RazorpayCheckout from 'react-native-razorpay';

// ============================================
// STEP 1: CREATE ORDER
// ============================================
const handlePayNow = async (paymentId: string) => {
  try {
    // Get order from backend
    const { data } = await api.post('/razorpay/create-order/payment', {
      paymentId,
    });

    const order = data.data;

    // ============================================
    // STEP 2: OPEN RAZORPAY CHECKOUT
    // ============================================
    const options = {
      description: order.description || 'Mahajan Payment',
      image: 'https://your-app-logo-url.png',
      currency: order.currency,
      key: order.keyId,                    // From backend response
      amount: order.amount,                // In paise
      name: 'Mahajan App',
      order_id: order.orderId,             // Razorpay order ID
      prefill: {
        name: currentUser.name,
        phone: currentUser.phone,
      },
      theme: { color: '#2563EB' },         // Your brand color
    };

    const result = await RazorpayCheckout.open(options);

    // ============================================
    // STEP 3: VERIFY ON BACKEND
    // ============================================
    const verifyResponse = await api.post('/razorpay/verify', {
      razorpay_order_id: result.razorpay_order_id,
      razorpay_payment_id: result.razorpay_payment_id,
      razorpay_signature: result.razorpay_signature,
    });

    if (verifyResponse.data.success) {
      // ✅ Payment confirmed! Show success
      Alert.alert('Payment Successful', 'Your payment has been confirmed');
      // Refresh payment status / ledger
    }

  } catch (error) {
    // Razorpay checkout was dismissed or payment failed
    if (error.code === 'PAYMENT_CANCELLED') {
      // User dismissed checkout — do nothing
    } else {
      Alert.alert('Payment Failed', error.description || 'Please try again');
    }
  }
};
```

---

## 🚛 Trip Creation — Mark as Paid/Pending

During trip creation, sender can optionally mark payment status:

```typescript
// Trip creation with "already paid" (cash/offline settlement)
const createTrip = await api.post('/trips', {
  sourceOrgId: 'clx...',
  destinationOrgId: 'clx...',
  truckNumber: 'MH04AB1234',
  driverPhone: '+919876543210',
  startPoint: 'Shimla APMC',
  endPoint: 'Delhi Azadpur Mandi',

  // ✅ Payment status during trip creation
  goodsPaymentStatus: 'PAID',       // or 'PENDING'
  goodsPaymentAmount: 150000,       // ₹1,50,000 (in rupees)
  goodsPaymentTag: 'ADVANCE',       // ADVANCE, PARTIAL, FINAL, DUE, OTHER
});
```

| `goodsPaymentStatus` | What happens |
|---|---|
| `'PAID'` | Payment record created as CONFIRMED, ledger updated immediately |
| `'PENDING'` | Payment record created as PENDING, receiver gets "Pay Now" option |
| *(not provided)* | No payment record created — handle later |

---

## 🔔 Payment States & UI

| Payment Status | UI State | Action Available |
|---|---|---|
| `PENDING` | "Payment Due ₹X" | Show **"Pay Now"** button (opens Razorpay) |
| `MARKED_AS_PAID` | "Marked as Paid" | Show **"Pay Now"** if want to use Razorpay instead |
| `CONFIRMED` | "✅ Paid" | No action needed — green badge |
| `DISPUTED` | "⚠️ Disputed" | Show dispute reason |
| `CANCELLED` | "Cancelled" | Greyed out |

### Suggested Trip Card Payment Section

```
┌────────────────────────────────────────┐
│ 🍎 Apple Shipment                      │
│ Shimla → Delhi Azadpur                 │
│                                        │
│ ₹1,50,000        Status: PENDING      │
│                                        │
│ ┌────────────────────────────────────┐ │
│ │      💳 Pay Now with Razorpay      │ │
│ └────────────────────────────────────┘ │
│                                        │
│ 💬 Or mark as paid manually            │
└────────────────────────────────────────┘
```

---

## ⚡ Payment Methods Enabled

| Method | Supported |
|---|---|
| UPI (GPay, PhonePe, etc.) | ✅ |
| Credit Card | ✅ |
| Debit Card | ✅ |
| Net Banking | ✅ |
| Bank Transfer (NEFT/RTGS) | ✅ |
| Wallets (Paytm, etc.) | ✅ |

All methods are enabled by default in Razorpay Checkout. You can customize which ones to show using the `method` option in checkout config.

---

## 🔁 Webhook (Server-Side Fallback)

The backend has a webhook endpoint at:
```
POST /api/v1/razorpay/webhook
```

This is configured in the Razorpay Dashboard (Settings → Webhooks). It acts as a **fallback** in case:
- The user's app crashes after payment but before verify call
- Network issues prevent the verify call from reaching the server

The webhook auto-confirms the payment with the same logic as the verify endpoint.

**You don't need to do anything for webhooks on the frontend** — it's server-to-server.

---

## 🔒 Security Notes

1. **Key ID** (`rzp_test_xxx`) is public — it's safe to use in frontend
2. **Key Secret** never leaves the backend — used only for signature verification
3. **Webhook Secret** is server-side only — verifies that webhooks really came from Razorpay
4. **Signature verification** ensures payment wasn't tampered with between Razorpay and your app
5. **Idempotency** — calling create-order twice for the same payment returns the same order (safe to retry)

---

## ❌ Error Handling

All endpoints return errors in this format:

```json
{
  "success": false,
  "message": "Error description here"
}
```

| HTTP Code | Error | When |
|---|---|---|
| `400` | `Razorpay is not configured` | Backend `.env` missing keys — tell backend dev |
| `400` | `Cannot create order for payment with status: CONFIRMED` | Payment already done |
| `400` | `Driver payment is already fully paid` | Driver already paid |
| `400` | `Payment verification failed — invalid signature` | Tampered data or wrong keys |
| `403` | `Only the debtor (payer) can initiate Razorpay payment` | Wrong user trying to pay |
| `403` | `Not authorized for this trip` | User not in trip's orgs |
| `404` | `Payment not found` | Invalid paymentId |
| `404` | `No driver payment configured for this trip` | Trip has no driver payment setup |

### React Native Error Handling Pattern

```typescript
try {
  const result = await RazorpayCheckout.open(options);
  // ... verify on backend
} catch (error: any) {
  if (error.code === 'PAYMENT_CANCELLED') {
    // User pressed back / dismissed — silent, no error toast
    return;
  }
  
  if (error.code === 'BAD_REQUEST_ERROR') {
    // Invalid card, insufficient funds, etc.
    Alert.alert('Payment Failed', error.description);
    return;
  }

  // Network error or unknown
  Alert.alert('Error', 'Something went wrong. Please try again.');
}
```

---

## 📱 Driver Payment — Full Example

```typescript
// Driver payment flow (Mahajan pays truck driver via Razorpay)
const handlePayDriver = async (tripId: string) => {
  // Step 1: Create order
  const { data } = await api.post('/razorpay/create-order/driver', { tripId });
  const order = data.data;

  // Step 2: Open checkout
  const result = await RazorpayCheckout.open({
    description: order.description,
    currency: order.currency,
    key: order.keyId,
    amount: order.amount,
    name: 'Mahajan App',
    order_id: order.orderId,
    prefill: { name: currentUser.name, phone: currentUser.phone },
    theme: { color: '#16A34A' },  // Green for driver payment
  });

  // Step 3: Verify
  const verifyRes = await api.post('/razorpay/verify', {
    razorpay_order_id: result.razorpay_order_id,
    razorpay_payment_id: result.razorpay_payment_id,
    razorpay_signature: result.razorpay_signature,
  });

  // verifyRes.data.data.status = 'PAID' | 'PARTIALLY_PAID'
  if (verifyRes.data.data.status === 'PAID') {
    Alert.alert('✅ Driver Paid', 'Full payment completed');
  } else {
    Alert.alert('⏳ Partial Payment', 'Driver payment partially recorded');
  }
};
```

---

## 💰 Manual Payment Still Works

Razorpay is **optional** — the existing manual payment flow is untouched:

| Flow | How |
|---|---|
| **Manual mark as paid** | `POST /api/v1/ledger/payments/:id/mark-paid` (existing) |
| **Cash payment** | Record via `POST /api/v1/ledger/payments` with `mode: "CASH"` |
| **Confirm/Dispute** | `POST /api/v1/ledger/payments/:id/confirm` or `/dispute` |

The frontend should show **both options**:
1. 💳 **Pay Now** (opens Razorpay — instant, auto-confirmed)
2. ✏️ **Mark as Paid** (manual — for cash, cheque, external UPI)

---

## 📋 .env Variables (Backend)

```env
RAZORPAY_KEY_ID=rzp_test_xxxxx
RAZORPAY_KEY_SECRET=your_secret_here
RAZORPAY_WEBHOOK_SECRET=  # Leave empty for testing — only needed in production
```
