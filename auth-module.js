// LifeBoat Backend - Auth & Subscription Module
// Add this to your server.js or import as a module

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
}

function sanitizeString(str, maxLength = 500) {
  if (typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '').slice(0, maxLength).trim();
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = '30d';
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID; // Your Pro plan price ID
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || 'chrome-extension://your-extension-id';

// ============================================================================
// IN-MEMORY STORAGE (Replace with database in production)
// ============================================================================

const users = new Map();
const sessions = new Map();
const subscriptions = new Map();
const backups = new Map();

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function generateUserId() {
  return 'user_' + crypto.randomBytes(16).toString('hex');
}

function generateToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

// Authentication middleware
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  const token = authHeader.substring(7);
  const payload = verifyToken(token);
  
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  
  const user = users.get(payload.userId);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }
  
  req.user = user;
  req.userId = payload.userId;
  next();
}

function getUserSubscription(userId) {
  const sub = subscriptions.get(userId);
  if (!sub) {
    return { tier: 'free', status: 'active' };
  }
  return sub;
}

// ============================================================================
// AUTH ROUTES
// ============================================================================

// POST /auth/signup
async function handleSignup(req, res) {
  try {
    const { email, password, name } = req.body;
    
    // Validate input
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!name || name.trim().length < 1) {
      return res.status(400).json({ error: 'Name is required' });
    }
    
    // Check if email already exists
    for (const [id, user] of users.entries()) {
      if (user.email.toLowerCase() === email.toLowerCase()) {
        return res.status(400).json({ error: 'Email already registered' });
      }
    }
    
    // Create user
    const userId = generateUserId();
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const user = {
      id: userId,
      email: email.toLowerCase(),
      name: sanitizeString(name, 100),
      password: hashedPassword,
      createdAt: new Date().toISOString()
    };
    
    users.set(userId, user);
    
    // Create Stripe customer
    try {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId }
      });
      user.stripeCustomerId = customer.id;
    } catch (stripeError) {
      console.error('[Stripe] Failed to create customer:', stripeError);
    }
    
    // Generate token
    const token = generateToken(userId);
    
    res.json({
      token,
      user: {
        id: userId,
        email: user.email,
        name: user.name
      },
      subscription: getUserSubscription(userId)
    });
  } catch (error) {
    console.error('[Auth] Signup error:', error);
    res.status(500).json({ error: 'Failed to create account' });
  }
}

// POST /auth/login
async function handleLogin(req, res) {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    // Find user by email
    let foundUser = null;
    let foundUserId = null;
    
    for (const [id, user] of users.entries()) {
      if (user.email.toLowerCase() === email.toLowerCase()) {
        foundUser = user;
        foundUserId = id;
        break;
      }
    }
    
    if (!foundUser) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    // Check password
    const validPassword = await bcrypt.compare(password, foundUser.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    // Generate token
    const token = generateToken(foundUserId);
    
    res.json({
      token,
      user: {
        id: foundUserId,
        email: foundUser.email,
        name: foundUser.name
      },
      subscription: getUserSubscription(foundUserId)
    });
  } catch (error) {
    console.error('[Auth] Login error:', error);
    res.status(500).json({ error: 'Failed to log in' });
  }
}

// POST /auth/google
async function handleGoogleAuth(req, res) {
  try {
    const { googleToken } = req.body;
    
    if (!googleToken) {
      return res.status(400).json({ error: 'Google token is required' });
    }
    
    // Verify Google token and get user info
    const googleResponse = await fetch(
      `https://www.googleapis.com/oauth2/v3/userinfo?access_token=${googleToken}`
    );
    
    if (!googleResponse.ok) {
      return res.status(401).json({ error: 'Invalid Google token' });
    }
    
    const googleUser = await googleResponse.json();
    
    // Find or create user
    let foundUser = null;
    let foundUserId = null;
    
    for (const [id, user] of users.entries()) {
      if (user.email.toLowerCase() === googleUser.email.toLowerCase()) {
        foundUser = user;
        foundUserId = id;
        break;
      }
    }
    
    if (!foundUser) {
      // Create new user
      foundUserId = generateUserId();
      foundUser = {
        id: foundUserId,
        email: googleUser.email.toLowerCase(),
        name: googleUser.name || googleUser.email.split('@')[0],
        googleId: googleUser.sub,
        createdAt: new Date().toISOString()
      };
      users.set(foundUserId, foundUser);
      
      // Create Stripe customer
      try {
        const customer = await stripe.customers.create({
          email: foundUser.email,
          name: foundUser.name,
          metadata: { userId: foundUserId }
        });
        foundUser.stripeCustomerId = customer.id;
      } catch (stripeError) {
        console.error('[Stripe] Failed to create customer:', stripeError);
      }
    }
    
    // Generate token
    const token = generateToken(foundUserId);
    
    res.json({
      token,
      user: {
        id: foundUserId,
        email: foundUser.email,
        name: foundUser.name
      },
      subscription: getUserSubscription(foundUserId)
    });
  } catch (error) {
    console.error('[Auth] Google auth error:', error);
    res.status(500).json({ error: 'Failed to authenticate with Google' });
  }
}

// POST /auth/logout
function handleLogout(req, res) {
  // With JWT, logout is handled client-side by deleting the token
  res.json({ success: true });
}

// ============================================================================
// SUBSCRIPTION ROUTES
// ============================================================================

// GET /subscription/status
function handleSubscriptionStatus(req, res) {
  const subscription = getUserSubscription(req.userId);
  res.json({ subscription });
}

// POST /subscription/create-checkout
async function handleCreateCheckout(req, res) {
  try {
    const user = req.user;
    
    if (!user.stripeCustomerId) {
      // Create Stripe customer if doesn't exist
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId: req.userId }
      });
      user.stripeCustomerId = customer.id;
    }
    
    const session = await stripe.checkout.sessions.create({
      customer: user.stripeCustomerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price: STRIPE_PRICE_ID,
        quantity: 1
      }],
      success_url: `${FRONTEND_URL}/dashboard.html?checkout=success`,
      cancel_url: `${FRONTEND_URL}/pricing.html?checkout=cancelled`,
      metadata: {
        userId: req.userId
      }
    });
    
    res.json({ checkoutUrl: session.url });
  } catch (error) {
    console.error('[Stripe] Checkout error:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
}

// POST /subscription/create-portal
async function handleCreatePortal(req, res) {
  try {
    const user = req.user;
    
    if (!user.stripeCustomerId) {
      return res.status(400).json({ error: 'No subscription found' });
    }
    
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${FRONTEND_URL}/dashboard.html`
    });
    
    res.json({ portalUrl: session.url });
  } catch (error) {
    console.error('[Stripe] Portal error:', error);
    res.status(500).json({ error: 'Failed to create portal session' });
  }
}

// POST /webhook/stripe (Stripe webhook handler)
async function handleStripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[Stripe] Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const userId = session.metadata?.userId;
      
      if (userId) {
        subscriptions.set(userId, {
          tier: 'pro',
          status: 'active',
          stripeSubscriptionId: session.subscription,
          currentPeriodEnd: null
        });
        console.log(`[Stripe] User ${userId} upgraded to Pro`);
      }
      break;
    }
    
    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      const userId = findUserByStripeCustomer(subscription.customer);
      
      if (userId) {
        const status = subscription.status === 'active' ? 'active' : 'inactive';
        subscriptions.set(userId, {
          tier: status === 'active' ? 'pro' : 'free',
          status,
          stripeSubscriptionId: subscription.id,
          currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString()
        });
        console.log(`[Stripe] User ${userId} subscription updated: ${status}`);
      }
      break;
    }
    
    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const userId = findUserByStripeCustomer(subscription.customer);
      
      if (userId) {
        subscriptions.set(userId, {
          tier: 'free',
          status: 'cancelled'
        });
        console.log(`[Stripe] User ${userId} subscription cancelled`);
      }
      break;
    }
  }
  
  res.json({ received: true });
}

function findUserByStripeCustomer(customerId) {
  for (const [id, user] of users.entries()) {
    if (user.stripeCustomerId === customerId) {
      return id;
    }
  }
  return null;
}

// ============================================================================
// CLOUD BACKUP ROUTES
// ============================================================================

// POST /sync/backup
async function handleBackup(req, res) {
  try {
    const subscription = getUserSubscription(req.userId);
    
    if (subscription.tier !== 'pro') {
      return res.status(403).json({ error: 'Cloud backup is a Pro feature' });
    }
    
    const { data } = req.body;
    
    if (!data) {
      return res.status(400).json({ error: 'No data provided' });
    }
    
    // Store backup (in production, encrypt and store in database)
    backups.set(req.userId, {
      data,
      timestamp: new Date().toISOString()
    });
    
    res.json({ success: true, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('[Backup] Error:', error);
    res.status(500).json({ error: 'Failed to save backup' });
  }
}

// GET /sync/restore
async function handleRestore(req, res) {
  try {
    const subscription = getUserSubscription(req.userId);
    
    if (subscription.tier !== 'pro') {
      return res.status(403).json({ error: 'Cloud backup is a Pro feature' });
    }
    
    const backup = backups.get(req.userId);
    
    if (!backup) {
      return res.json({ backup: null });
    }
    
    res.json({ backup: backup.data, timestamp: backup.timestamp });
  } catch (error) {
    console.error('[Restore] Error:', error);
    res.status(500).json({ error: 'Failed to restore backup' });
  }
}

// ============================================================================
// ROUTE REGISTRATION
// ============================================================================

function registerAuthRoutes(app, express) {
  // Auth routes (no auth required)
  app.post('/auth/signup', handleSignup);
  app.post('/auth/login', handleLogin);
  app.post('/auth/google', handleGoogleAuth);
  app.post('/auth/logout', authMiddleware, handleLogout);
  
  // Subscription routes (auth required)
  app.get('/subscription/status', authMiddleware, handleSubscriptionStatus);
  app.post('/subscription/create-checkout', authMiddleware, handleCreateCheckout);
  app.post('/subscription/create-portal', authMiddleware, handleCreatePortal);
  
  // Cloud backup routes (auth required)
  app.post('/sync/backup', authMiddleware, handleBackup);
  app.get('/sync/restore', authMiddleware, handleRestore);
  
  // Stripe webhook (special handling for raw body)
  // Note: This must be registered BEFORE the json body parser for the webhook route
  app.post('/webhook/stripe', 
    express.raw({ type: 'application/json' }),
    (req, res, next) => {
      req.rawBody = req.body;
      next();
    },
    handleStripeWebhook
  );
}

module.exports = {
  registerAuthRoutes,
  authMiddleware,
  getUserSubscription
};
