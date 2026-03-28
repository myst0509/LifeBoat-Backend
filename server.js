// LifeBoat Backend Server - Railway Compatible
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// IMPORTANT: Railway sets PORT automatically
const PORT = process.env.PORT || 3001;

// Stripe setup
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

// Middleware
app.use(cors());
app.use(express.json());

// Health check - THIS IS CRITICAL FOR RAILWAY
app.get('/health', (req, res) => {
  console.log('[LifeBoat] Health check hit');
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    port: PORT,
    services: {
      email: !!process.env.SENDGRID_API_KEY,
      sms: !!process.env.TWILIO_ACCOUNT_SID
    }
  });
});

// Root route
app.get('/', (req, res) => {
  res.json({ 
    message: 'LifeBoat API is running!',
    version: '4.1.0',
    health: '/health'
  });
});

// ============================================================================
// AUTH ROUTES (simplified for now)
// ============================================================================

const users = new Map();
const sessions = new Map();

// Generate simple token
function generateToken() {
  return 'tok_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// Signup
app.post('/auth/signup', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }
    
    if (users.has(email)) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    
    const user = {
      id: 'user_' + Date.now(),
      email,
      name,
      createdAt: new Date().toISOString()
    };
    
    users.set(email, { ...user, password });
    
    const token = generateToken();
    sessions.set(token, user);
    
    res.json({
      token,
      user,
      subscription: { tier: 'free', status: 'active' }
    });
  } catch (error) {
    console.error('[Auth] Signup error:', error);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// Login
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    const userData = users.get(email);
    
    if (!userData || userData.password !== password) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    const { password: _, ...user } = userData;
    const token = generateToken();
    sessions.set(token, user);
    
    res.json({
      token,
      user,
      subscription: { tier: 'free', status: 'active' }
    });
  } catch (error) {
    console.error('[Auth] Login error:', error);
    res.status(500).json({ error: 'Failed to log in' });
  }
});

// Google OAuth (placeholder)
app.post('/auth/google', async (req, res) => {
  try {
    const { token: googleToken } = req.body;
    
    // In production, verify with Google
    // For now, create a demo user
    const user = {
      id: 'google_' + Date.now(),
      email: 'user@gmail.com',
      name: 'Google User',
      createdAt: new Date().toISOString()
    };
    
    const token = generateToken();
    sessions.set(token, user);
    
    res.json({
      token,
      user,
      subscription: { tier: 'free', status: 'active' }
    });
  } catch (error) {
    console.error('[Auth] Google auth error:', error);
    res.status(500).json({ error: 'Failed to authenticate with Google' });
  }
});

// Logout
app.post('/auth/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    sessions.delete(token);
  }
  res.json({ success: true });
});

// ============================================================================
// SUBSCRIPTION ROUTES (with Stripe)
// ============================================================================

// Store user subscriptions (in production, use a database)
const subscriptions = new Map();

app.get('/subscription/status', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = sessions.get(token);
  
  if (!user) {
    return res.json({ tier: 'free', status: 'active' });
  }
  
  const sub = subscriptions.get(user.email);
  if (sub && sub.tier === 'pro') {
    return res.json({ tier: 'pro', status: 'active', expiresAt: sub.expiresAt });
  }
  
  res.json({ tier: 'free', status: 'active' });
});

app.post('/subscription/create-checkout', async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({ error: 'Stripe not configured' });
    }
    
    const token = req.headers.authorization?.replace('Bearer ', '');
    const user = sessions.get(token);
    
    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const priceId = process.env.STRIPE_PRICE_ID;
    if (!priceId) {
      return res.status(500).json({ error: 'Stripe price not configured' });
    }
    
    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      customer_email: user.email,
      success_url: req.body.successUrl || 'https://lifeboat.app/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: req.body.cancelUrl || 'https://lifeboat.app/cancel',
      metadata: {
        userId: user.id,
        userEmail: user.email
      }
    });
    
    console.log('[Stripe] Checkout session created:', session.id);
    res.json({ url: session.url, sessionId: session.id });
    
  } catch (error) {
    console.error('[Stripe] Checkout error:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

app.post('/subscription/create-portal', async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({ error: 'Stripe not configured' });
    }
    
    const token = req.headers.authorization?.replace('Bearer ', '');
    const user = sessions.get(token);
    
    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    // Find customer by email
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    
    if (customers.data.length === 0) {
      return res.status(404).json({ error: 'No subscription found' });
    }
    
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customers.data[0].id,
      return_url: req.body.returnUrl || 'https://lifeboat.app/dashboard',
    });
    
    res.json({ url: portalSession.url });
    
  } catch (error) {
    console.error('[Stripe] Portal error:', error);
    res.status(500).json({ error: 'Failed to create portal session' });
  }
});

// Stripe webhook to handle successful payments
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) {
    return res.status(500).send('Stripe not configured');
  }
  
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  let event;
  
  try {
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      // For testing without webhook signature
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error('[Stripe] Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  
  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      console.log('[Stripe] Payment successful for:', session.customer_email);
      
      // Upgrade user to Pro
      subscriptions.set(session.customer_email, {
        tier: 'pro',
        status: 'active',
        stripeCustomerId: session.customer,
        stripeSubscriptionId: session.subscription,
        createdAt: new Date().toISOString()
      });
      break;
      
    case 'customer.subscription.deleted':
      const subscription = event.data.object;
      console.log('[Stripe] Subscription cancelled:', subscription.id);
      
      // Find and downgrade user
      for (const [email, sub] of subscriptions.entries()) {
        if (sub.stripeSubscriptionId === subscription.id) {
          subscriptions.delete(email);
          break;
        }
      }
      break;
      
    default:
      console.log('[Stripe] Unhandled event type:', event.type);
  }
  
  res.json({ received: true });
});

// ============================================================================
// NOTIFICATION ROUTES (placeholder)
// ============================================================================

app.post('/api/notify', (req, res) => {
  console.log('[Notify] Received notification request:', req.body);
  res.json({ success: true, message: 'Notification logged (email not configured)' });
});

// ============================================================================
// ANALYTICS ROUTES
// ============================================================================

app.post('/analytics/events', (req, res) => {
  console.log('[Analytics] Events received:', req.body);
  res.json({ success: true });
});

app.get('/analytics/dashboard', (req, res) => {
  res.json({
    totalUsers: users.size,
    activeSessions: sessions.size,
    timestamp: new Date().toISOString()
  });
});

// ============================================================================
// START SERVER - MUST BE AT THE END
// ============================================================================

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           LifeBoat Backend Server Started!                 ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log(`║  Port: ${PORT}                                                ║`);
  console.log(`║  Environment: ${process.env.NODE_ENV || 'development'}                            ║`);
  console.log('║                                                            ║');
  console.log('║  Endpoints:                                                ║');
  console.log('║  • GET  /health - Health check                             ║');
  console.log('║  • POST /auth/signup - Create account                      ║');
  console.log('║  • POST /auth/login - Log in                               ║');
  console.log('║  • POST /api/notify - Send notification                    ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  
  if (!process.env.SENDGRID_API_KEY) {
    console.warn('⚠️  SENDGRID_API_KEY not set - emails disabled');
  }
  if (!process.env.TWILIO_ACCOUNT_SID) {
    console.warn('⚠️  TWILIO credentials not set - SMS/calls disabled');
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    console.warn('⚠️  STRIPE_SECRET_KEY not set - payments disabled');
  }
});
