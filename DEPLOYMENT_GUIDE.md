# LifeBoat Backend Deployment Guide

## Overview

This guide walks you through deploying the LifeBoat backend server, which handles:
- User authentication & accounts
- Stripe payments (Pro subscriptions)
- Email notifications (SendGrid)
- SMS/Call notifications (Twilio)
- Analytics tracking

## Prerequisites

Before deploying, you'll need accounts (all have free tiers):

| Service | Purpose | Free Tier |
|---------|---------|-----------|
| [Railway](https://railway.app) or [Render](https://render.com) | Hosting | $5/mo credit or 750 hrs/mo |
| [Stripe](https://stripe.com) | Payments | Free (2.9% + 30¢ per transaction) |
| [SendGrid](https://sendgrid.com) | Emails | 100 emails/day |
| [Twilio](https://twilio.com) | SMS/Calls | ~$1/mo for phone number |

---

## Option 1: Deploy to Railway (Recommended)

Railway is the easiest option with automatic deployments from GitHub.

### Step 1: Push to GitHub

```bash
# In the lifeboat-backend folder
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/lifeboat-backend.git
git push -u origin main
```

### Step 2: Deploy on Railway

1. Go to [railway.app](https://railway.app) and sign in with GitHub
2. Click "New Project" → "Deploy from GitHub repo"
3. Select your `lifeboat-backend` repository
4. Railway will auto-detect Node.js and deploy

### Step 3: Add Environment Variables

In Railway dashboard → Your Project → Variables tab, add:

```
NODE_ENV=production
JWT_SECRET=<generate with: openssl rand -hex 32>
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...
SENDGRID_API_KEY=SG....
SENDGRID_FROM_EMAIL=notifications@yourdomain.com
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1...
```

### Step 4: Get Your URL

Railway gives you a URL like: `https://lifeboat-backend-production.up.railway.app`

---

## Option 2: Deploy to Render

### Step 1: Push to GitHub (same as above)

### Step 2: Deploy on Render

1. Go to [render.com](https://render.com) and sign in
2. Click "New" → "Web Service"
3. Connect your GitHub repo
4. Configure:
   - **Name**: lifeboat-backend
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
5. Add environment variables (same as Railway)
6. Click "Create Web Service"

**Note**: Render free tier sleeps after 15 minutes of inactivity. First request after sleep takes ~30 seconds.

---

## Setting Up External Services

### Stripe Setup

1. Create account at [stripe.com](https://stripe.com)
2. Go to Dashboard → Developers → API Keys
3. Copy the **Secret key** (starts with `sk_live_` or `sk_test_`)
4. Create a product:
   - Products → Add Product
   - Name: "LifeBoat Pro"
   - Price: $5/month, recurring
   - Copy the **Price ID** (starts with `price_`)
5. Set up webhook:
   - Developers → Webhooks → Add endpoint
   - URL: `https://your-backend-url.com/webhook/stripe`
   - Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Copy the **Webhook signing secret** (starts with `whsec_`)

### SendGrid Setup

1. Create account at [sendgrid.com](https://sendgrid.com)
2. Settings → API Keys → Create API Key
3. Give it "Full Access" or at minimum "Mail Send"
4. Copy the API key (starts with `SG.`)
5. Verify a sender:
   - Settings → Sender Authentication
   - Either verify a single sender email OR set up domain authentication

### Twilio Setup (Optional - for SMS/Calls)

1. Create account at [twilio.com](https://twilio.com)
2. From Console dashboard, copy:
   - Account SID (starts with `AC`)
   - Auth Token
3. Buy a phone number (~$1/month):
   - Phone Numbers → Buy a Number
   - Get one with SMS and Voice capabilities
4. Copy the phone number (e.g., `+14155551234`)

---

## Update Extension to Use Backend

After deploying, update the extension to point to your backend:

### 1. Update `tiers.js`

```javascript
// Change this line:
const API_BASE_URL = 'https://api.lifeboat.app';

// To your Railway/Render URL:
const API_BASE_URL = 'https://your-backend-url.railway.app';
```

### 2. Update `background.js`

```javascript
// Change this line:
const NOTIFICATION_SERVER = 'http://localhost:3001';

// To your deployed URL:
const NOTIFICATION_SERVER = 'https://your-backend-url.railway.app';
```

### 3. Repackage and Upload

```bash
cd lifeboat-extension
zip -r ../lifeboat-extension.zip .
```

Then upload to Chrome Web Store.

---

## Custom Domain (Optional)

For a professional look, use a custom domain like `api.lifeboat.app`:

### Railway
1. Settings → Domains → Add Custom Domain
2. Add CNAME record: `api.lifeboat.app` → `your-app.up.railway.app`

### Render
1. Settings → Custom Domain
2. Add CNAME record as instructed

---

## Testing Your Deployment

### Health Check
```bash
curl https://your-backend-url.com/health
# Should return: {"status":"ok","timestamp":"..."}
```

### Full Health Check
```bash
curl https://your-backend-url.com/api/health
# Shows which services are configured
```

### Test Signup
```bash
curl -X POST https://your-backend-url.com/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"testpass123","name":"Test User"}'
```

---

## Costs Summary

| Service | Monthly Cost |
|---------|-------------|
| Railway/Render | $0-5 |
| Stripe | $0 + 2.9% per transaction |
| SendGrid | $0 (100 emails/day) |
| Twilio | ~$1 (phone number) |
| **Total** | **~$1-6/month** |

---

## Troubleshooting

### "Failed to fetch" in extension
- Check that `API_BASE_URL` in `tiers.js` matches your deployed URL
- Ensure CORS is allowing your extension ID

### Stripe webhooks not working
- Verify webhook URL is correct
- Check webhook signing secret matches
- Look at Stripe Dashboard → Webhooks → Recent events for errors

### Emails not sending
- Verify SendGrid API key is correct
- Check sender email is verified
- Look at SendGrid Activity Feed for bounces

### SMS not sending
- Verify Twilio credentials
- Check phone number has SMS capability
- Ensure you're not in trial mode (or have verified recipient)

---

## Production Checklist

- [ ] Backend deployed and healthy
- [ ] Environment variables set
- [ ] Stripe product/price created
- [ ] Stripe webhook configured
- [ ] SendGrid sender verified
- [ ] Twilio phone number purchased (if using SMS)
- [ ] Extension updated with backend URL
- [ ] Tested signup/login flow
- [ ] Tested Stripe checkout
- [ ] CORS configured for extension ID

---

## Need Help?

- Railway Docs: https://docs.railway.app
- Render Docs: https://render.com/docs
- Stripe Docs: https://stripe.com/docs
- SendGrid Docs: https://docs.sendgrid.com
