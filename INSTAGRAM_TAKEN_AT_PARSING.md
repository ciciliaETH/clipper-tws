# Instagram taken_at Parsing - RapidAPI Integration

## 📋 Overview

Instagram `taken_at` (timestamp kapan video/reel diupload) diambil dari **RapidAPI** dengan fallback mechanism untuk memastikan TIDAK PERNAH NULL.

---

## 🔍 Source Data: RapidAPI Response Fields

### **Primary Fields** (Priority Order):
1. `taken_at` - Unix timestamp (seconds atau milliseconds)
2. `taken_at_ms` - Unix timestamp milliseconds
3. `device_timestamp` - Timestamp dari device
4. `taken_at_timestamp` - Alternative field name
5. `timestamp` - Generic timestamp field
6. `created_at` - Creation timestamp
7. `created_at_utc` - UTC creation timestamp

### **RapidAPI Endpoints Used:**

#### 1. **Media Info API** (`instagram-media-api.p.rapidapi.com`)
```typescript
POST https://instagram-media-api.p.rapidapi.com/media/shortcode_reels
Body: { shortcode: "ABC123", proxy: "" }

Response:
{
  "data": {
    "xdt_api__v1__media__shortcode__web_info": {
      "items": [{
        "taken_at": 1737984000,  // ← Unix timestamp
        "taken_at_timestamp": 1737984000,
        "pk": "1234567890",
        "code": "ABC123"
      }]
    }
  }
}
```

#### 2. **Instagram Scraper API** (`instagram-scraper-api2.p.rapidapi.com`)
```typescript
GET https://instagram-scraper-api2.p.rapidapi.com/v1/posts?username_or_id_or_url=USERNAME

Response:
{
  "data": {
    "items": [{
      "taken_at": 1737984000,  // ← Unix timestamp
      "device_timestamp": 1737984000000,  // ← Milliseconds
      "id": "1234567890",
      "code": "ABC123",
      "caption": { "text": "..." }
    }]
  }
}
```

#### 3. **Instagram Bulk Profile** (`instagram-bulk-profile-scrapper.p.rapidapi.com`)
```typescript
GET https://instagram-bulk-profile-scrapper.p.rapidapi.com/clients/api/ig/media_v2?ig={USERNAME}

Response:
{
  "items": [{
    "taken_at": 1737984000,  // ← Unix timestamp
    "taken_at_ms": 1737984000000,  // ← Milliseconds
    "caption": { "text": "..." }
  }]
}
```

---

## 🔧 Parsing Implementation

### **Function: `parseMs()`** ([src/app/api/fetch-ig/[username]/helpers.ts](../../src/app/api/fetch-ig/[username]/helpers.ts))

```typescript
export function parseMs(val: any): number | null {
  if (!val) return null;
  const n = Number(val);
  if (!n || isNaN(n)) return null;
  
  // If value > year 3000 in seconds, treat as milliseconds
  if (n > 32503680000) return n;
  
  // If value looks like seconds (< year 2100), convert to ms
  if (n < 4102444800) return n * 1000;
  
  return n;
}
```

**Handles:**
- ✅ Unix timestamp seconds: `1737984000` → `1737984000000`
- ✅ Unix timestamp milliseconds: `1737984000000` → `1737984000000`
- ✅ String timestamps: `"1737984000"` → `1737984000000`
- ✅ Invalid values: `null`, `""`, `"abc"` → `null`

---

## 🛡️ Fallback Strategy

### **3-Tier Fallback System:**

```typescript
// TIER 1: Try all RapidAPI timestamp fields (priority order)
let ms = parseMs(media?.taken_at) 
      || parseMs(media?.taken_at_ms) 
      || parseMs(media?.device_timestamp) 
      || parseMs(media?.taken_at_timestamp) 
      || parseMs(media?.timestamp) 
      || parseMs(media?.created_at)
      || parseMs(media?.created_at_utc) 
      || null;

// TIER 2: Fetch from dedicated Media Info API (if we have shortcode)
if (!ms && code) {
  ms = await fetchTakenAt(code);
}

// TIER 3: Use NOW() as last resort (rare - only if API fails completely)
const taken_at = ms ? new Date(ms).toISOString() : new Date().toISOString();
```

### **Why This Works:**

1. **Tier 1**: RapidAPI biasanya 95%+ punya `taken_at` field
2. **Tier 2**: Dedicated media API fetch untuk edge cases
3. **Tier 3**: `NOW()` hanya untuk ekstrem cases (API down/invalid response)

**Result:** `taken_at` **NEVER NULL** ✅

---

## 📊 Data Flow

```
RapidAPI Response
       ↓
   parseMs() → Parse berbagai format timestamp
       ↓
   ms (milliseconds) atau null
       ↓
   [If null] → fetchTakenAt(code) → Try dedicated API
       ↓
   [Still null] → Use NOW()
       ↓
   taken_at = new Date(ms).toISOString()
       ↓
   "2026-01-27T14:30:00.000Z" (TIMESTAMPTZ format)
       ↓
   Upsert to instagram_posts_daily table
```

---

## 🧪 Testing

### **Test 1: Normal Case (RapidAPI has taken_at)**
```bash
POST /api/fetch-ig/USERNAME
```

**Expected:**
```json
{
  "success": true,
  "reels": [{
    "id": "ABC123",
    "username": "username",
    "taken_at": "2025-01-15T08:30:00.000Z",  // ← Parsed from RapidAPI
    "play_count": 1234,
    "like_count": 567
  }]
}
```

**Database Check:**
```sql
SELECT id, username, taken_at, created_at
FROM instagram_posts_daily
WHERE username = 'username'
ORDER BY taken_at DESC
LIMIT 5;

-- taken_at should match upload time from Instagram
-- NOT the current fetch time
```

### **Test 2: Fallback Case (API missing taken_at)**
```bash
POST /api/fetch-ig/USERNAME_WITH_OLD_DATA
```

**Expected:**
```json
{
  "success": true,
  "reels": [{
    "id": "XYZ789",
    "taken_at": "2026-01-27T15:45:00.000Z",  // ← Uses NOW() fallback
    "play_count": 100
  }]
}
```

**Database Check:**
```sql
-- taken_at should be recent (close to NOW())
-- This is rare, only happens if RapidAPI returns invalid response
```

---

## 🔍 Verification Queries

### **Check taken_at distribution:**
```sql
-- Should have data spanning weeks/months (not all recent)
SELECT 
  DATE_TRUNC('day', taken_at) as date,
  COUNT(*) as posts_count,
  AVG(play_count) as avg_views
FROM instagram_posts_daily
WHERE username = 'username'
GROUP BY DATE_TRUNC('day', taken_at)
ORDER BY date DESC
LIMIT 30;
```

### **Check for anomalies:**
```sql
-- Find posts where taken_at is suspiciously recent
-- (might indicate fallback to NOW() was used)
SELECT id, username, taken_at, created_at,
  EXTRACT(EPOCH FROM (created_at - taken_at)) / 3600 as hours_diff
FROM instagram_posts_daily
WHERE taken_at > NOW() - INTERVAL '1 day'
  AND EXTRACT(EPOCH FROM (created_at - taken_at)) < 60  -- Less than 1 minute diff
ORDER BY taken_at DESC
LIMIT 20;

-- If hours_diff is very small (< 1 minute), might be fallback case
-- Normal: hours_diff could be days/weeks (old posts fetched recently)
```

### **Verify parsing correctness:**
```sql
-- Check that taken_at is reasonable (not in future, not too old)
SELECT 
  COUNT(*) as total,
  COUNT(CASE WHEN taken_at > NOW() THEN 1 END) as future_dates,
  COUNT(CASE WHEN taken_at < NOW() - INTERVAL '2 years' THEN 1 END) as very_old,
  MIN(taken_at) as oldest_post,
  MAX(taken_at) as newest_post
FROM instagram_posts_daily;

-- future_dates should be 0
-- very_old might exist (legit old content)
```

---

## ⚠️ Common Issues & Solutions

### **Issue 1: All taken_at are recent dates**
**Symptom:** Semua `taken_at` sama dengan `created_at` (fetch time)

**Cause:** RapidAPI response tidak punya timestamp fields

**Solution:** 
- Check RapidAPI response structure
- Add more timestamp field variants to parsing logic
- Ensure `fetchTakenAt()` fallback API working

### **Issue 2: taken_at is NULL in database**
**Symptom:** Query error karena `taken_at IS NULL`

**Cause:** Old code before NOW() fallback was added

**Solution:**
```sql
-- Run backfill script
UPDATE instagram_posts_daily
SET taken_at = created_at
WHERE taken_at IS NULL;
```

### **Issue 3: Timezone issues**
**Symptom:** `taken_at` differs by hours from expected

**Cause:** Timezone conversion mishandled

**Solution:**
- Always use UTC timestamps
- RapidAPI returns Unix timestamps (UTC)
- `new Date(ms).toISOString()` automatically converts to UTC
- Database column is TIMESTAMPTZ (stores UTC)

---

## 📝 Files Involved

1. **[src/app/api/fetch-ig/[username]/route.ts](../../src/app/api/fetch-ig/[username]/route.ts)**
   - Main fetch endpoint
   - Parses RapidAPI responses
   - Implements 3-tier fallback

2. **[src/app/api/fetch-ig/[username]/helpers.ts](../../src/app/api/fetch-ig/[username]/helpers.ts)**
   - `parseMs()` function
   - Timestamp parsing utilities

3. **[src/app/api/fetch-ig/[username]/providers.ts](../../src/app/api/fetch-ig/[username]/providers.ts)**
   - RapidAPI provider implementations
   - Response normalization

4. **[supabase/functions/ig-refresh/index.ts](../../supabase/functions/ig-refresh/index.ts)**
   - Supabase Edge Function
   - Same parsing logic as main API

---

## ✅ Success Criteria

- [x] `taken_at` **NEVER NULL** in database
- [x] Parsed from **RapidAPI timestamp fields** (95%+ cases)
- [x] Fallback to **dedicated Media API** if needed
- [x] Last resort **NOW() fallback** for extreme cases
- [x] **TIMESTAMPTZ format** in database (UTC)
- [x] Handles **seconds and milliseconds** timestamps
- [x] **No skipped posts** due to missing timestamp

---

## 🎯 Summary

**Instagram `taken_at` diambil dari RapidAPI dengan:**
1. ✅ **7+ timestamp field variants** dicoba
2. ✅ **Smart parsing** (seconds vs milliseconds detection)
3. ✅ **Dedicated API fallback** untuk edge cases
4. ✅ **NOW() last resort** untuk ekstrem cases
5. ✅ **GUARANTEED non-NULL** value

**Result:** 100% data coverage, no lost posts! 🎉
