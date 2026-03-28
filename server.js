// LifeBoat Backend Server - Railway Compatible
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// IMPORTANT: Railway sets PORT automatically
const PORT = process.env.PORT || 3001;

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
// SUBSCRIPTION ROUTES (placeholder)
// ============================================================================

app.get('/subscription/status', (req, res) => {
  res.json({ tier: 'free', status: 'active' });
});

app.post('/subscription/create-checkout', (req, res) => {
  // In production, create Stripe checkout session
  res.json({ 
    url: 'https://checkout.stripe.com/placeholder',
    message: 'Stripe not configured yet'
  });
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
