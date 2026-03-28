# LifeBoat API Setup Guide
## Free & Low-Cost Services for MVP Launch

---

## 1. Stripe (Payment Processing) — FREE TO START

Stripe charges nothing until you make money. Perfect for MVP.

### Setup Steps:
1. Go to https://dashboard.stripe.com/register
2. Create account with your email
3. Complete business verification (can use personal info for sole proprietor)
4. Get your API keys from Dashboard → Developers → API Keys

### What You Need:
```env
STRIPE_SECRET_KEY=sk_test_...     # From dashboard
STRIPE_PUBLISHABLE_KEY=pk_test_... # For frontend
STRIPE_WEBHOOK_SECRET=whsec_...    # After setting up webhook
```

### Create Your Pro Plan Product:
1. Go to Products → Add Product
2. Name: "LifeBoat Pro"
3. Price: $5.00 / month (recurring)
4. Save and copy the Price ID (starts with `price_`)

### Set Up Webhook:
1. Developers → Webhooks → Add endpoint
2. URL: `https://your-server.com/webhook/stripe`
3. Events to listen for:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Copy the signing secret to `STRIPE_WEBHOOK_SECRET`

### Costs:
- Monthly fee: **$0**
- Per transaction: **2.9% + 30¢**
- Example: $5 subscription → you keep ~$4.55

---

## 2. SendGrid (Email) — 100 FREE EMAILS/DAY

Perfect for check-in notifications and heir alerts.

### Setup Steps:
1. Go to https://signup.sendgrid.com/
2. Create free account
3. Verify your email
4. Go to Settings → API Keys → Create API Key
5. Give it "Full Access" and copy the key

### What You Need:
```env
SENDGRID_API_KEY=SG.xxxxxxxxxxxxx
SENDGRID_FROM_EMAIL=notifications@lifeboat.app
```

### Verify Sender:
1. Settings → Sender Authentication
2. Either verify a single sender OR
3. Set up domain authentication (recommended for deliverability)

### Free Tier Limits:
- **100 emails/day forever**
- That's ~3,000/month
- More than enough for beta testing

### If You Need More:
- Essentials: $19.95/mo for 50,000 emails
- But start free — you probably won't hit 100/day for months

---

## 3. Twilio (SMS & Calls) — PAY AS YOU GO

No monthly minimum. Only pay when Pro users trigger notifications.

### Setup Steps:
1. Go to https://www.twilio.com/try-twilio
2. Create account and verify phone
3. You get **$15 free credit** to start
4. Go to Console → Account → API Keys

### What You Need:
```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1234567890  # Buy a number (~$1/mo)
```

### Buy a Phone Number:
1. Console → Phone Numbers → Buy a Number
2. Choose one with SMS + Voice capabilities
3. Cost: ~$1/month

### Per-Message Costs:
| Service | Cost |
|---------|------|
| SMS (US) | $0.0079 per message |
| SMS (International) | $0.05-0.15 |
| Voice calls | $0.013/min outbound |

### Example Monthly Cost:
- 100 Pro users
- 2 SMS/month each on average
- Cost: 200 × $0.0079 = **$1.58/month**

---

## 4. Server Hosting — FREE OPTIONS

### Option A: Railway (Recommended for MVP)
- **Free tier**: 500 hours/month + $5 credit
- Easy deployment from GitHub
- https://railway.app

### Option B: Render
- **Free tier**: 750 hours/month
- Spins down after inactivity (cold starts)
- https://render.com

### Option C: Fly.io
- **Free tier**: 3 shared VMs
- Good for always-on services
- https://fly.io

### Option D: Your Own VPS (Later)
- DigitalOcean: $4/month
- Linode: $5/month
- Hetzner: €3.79/month

---

## 5. Database — FREE OPTIONS

Your current backend uses in-memory storage. For production:

### Option A: Supabase (PostgreSQL)
- **Free tier**: 500MB database, 2GB bandwidth
- Built-in auth (could replace your custom auth)
- https://supabase.com

### Option B: PlanetScale (MySQL)
- **Free tier**: 5GB storage, 1B row reads/mo
- Generous limits
- https://planetscale.com

### Option C: MongoDB Atlas
- **Free tier**: 512MB storage
- Good for document storage
- https://mongodb.com/atlas

---

## Complete .env File Template

```env
# Server
PORT=3001
NODE_ENV=production

# JWT (generate a random string)
JWT_SECRET=generate-a-256-bit-random-string-here

# Stripe
STRIPE_SECRET_KEY=sk_live_xxxxx
STRIPE_PRICE_ID=price_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx

# SendGrid
SENDGRID_API_KEY=SG.xxxxx
SENDGRID_FROM_EMAIL=notifications@lifeboat.app

# Twilio (optional - only for Pro SMS/calls)
TWILIO_ACCOUNT_SID=ACxxxxx
TWILIO_AUTH_TOKEN=xxxxx
TWILIO_PHONE_NUMBER=+1234567890

# Frontend URL (your extension ID)
FRONTEND_URL=chrome-extension://your-extension-id-here
```

---

## Cost Summary for MVP Launch

| Service | Monthly Cost | Notes |
|---------|--------------|-------|
| Stripe | $0 | Only % per transaction |
| SendGrid | $0 | 100/day free tier |
| Twilio | ~$1 | Phone number |
| Hosting | $0-5 | Free tier or cheap VPS |
| Database | $0 | Free tier |
| **Total** | **$0-6/month** | Before any revenue |

### Break-Even Math:
- First Pro subscriber at $5/month
- Stripe takes ~$0.45
- You net ~$4.55
- One subscriber covers your costs

---

## Setup Order (Do This)

### Week 1: Extension Only (No Backend)
1. ✅ Publish to Chrome Web Store
2. ✅ Extension works fully offline (local storage)
3. ✅ Users can use free tier without any backend

### Week 2: Add Stripe
1. Set up Stripe account
2. Create Pro product/price
3. Deploy backend with auth
4. Enable upgrade flow

### Week 3: Add Notifications  
1. Set up SendGrid for emails
2. Test email notifications
3. (Optional) Add Twilio for SMS

### Week 4+: Iterate
1. Add database for persistence
2. Improve based on user feedback
3. Scale as needed

---

## Security Reminders

1. **Never commit .env files to Git**
2. **Use test keys (sk_test_) until launch**
3. **Generate a strong JWT_SECRET**:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
4. **Set up CORS properly** — only allow your extension origin
5. **Enable Stripe webhook signature verification** — already in code
