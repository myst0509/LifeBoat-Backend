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
    version: '5.0.0',
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

// Email verification tokens
const verificationTokens = new Map();
const pendingUsers = new Map();

// Generate verification code (6 digits)
function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Send verification email via SendGrid
async function sendVerificationEmail(email, code, name) {
  if (!process.env.SENDGRID_API_KEY) {
    console.log('[Email] SendGrid not configured, verification code:', code);
    return true; // Allow signup to proceed for testing
  }
  
  const sgMail = require('@sendgrid/mail');
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  
  const msg = {
    to: email,
    from: process.env.SENDGRID_FROM_EMAIL || 'noreply@lifeboat.app',
    subject: 'Verify your LifeBoat account',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #6366f1; margin: 0;">LifeBoat</h1>
          <p style="color: #666; margin-top: 5px;">Digital Estate Planning</p>
        </div>
        <div style="background: #f8f9fa; border-radius: 12px; padding: 30px; text-align: center;">
          <h2 style="margin-top: 0; color: #333;">Welcome, ${name}!</h2>
          <p style="color: #666; font-size: 16px;">Enter this code to verify your email:</p>
          <div style="background: #fff; border: 2px solid #6366f1; border-radius: 8px; padding: 20px; margin: 20px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #6366f1;">${code}</span>
          </div>
          <p style="color: #999; font-size: 14px;">This code expires in 10 minutes.</p>
        </div>
        <p style="color: #999; font-size: 12px; text-align: center; margin-top: 30px;">
          If you didn't create a LifeBoat account, you can ignore this email.
        </p>
      </div>
    `
  };
  
  try {
    await sgMail.send(msg);
    console.log('[Email] Verification email sent to:', email);
    return true;
  } catch (error) {
    console.error('[Email] Failed to send verification:', error.message);
    return false;
  }
}

// Signup - Step 1: Send verification code
app.post('/auth/signup', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }
    
    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    
    if (users.has(email)) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    
    // Check if there's already a pending verification
    const existing = pendingUsers.get(email);
    if (existing && Date.now() - existing.createdAt < 60000) {
      return res.status(400).json({ error: 'Verification code already sent. Please check your email or wait 1 minute to resend.' });
    }
    
    // Generate verification code
    const code = generateVerificationCode();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
    
    // Store pending user
    pendingUsers.set(email, {
      email,
      password,
      name,
      code,
      expiresAt,
      createdAt: Date.now()
    });
    
    // Send verification email
    const sent = await sendVerificationEmail(email, code, name);
    
    if (!sent && process.env.SENDGRID_API_KEY) {
      return res.status(500).json({ error: 'Failed to send verification email. Please try again.' });
    }
    
    console.log('[Auth] Verification code sent to:', email);
    
    res.json({
      success: true,
      message: 'Verification code sent to your email',
      requiresVerification: true
    });
    
  } catch (error) {
    console.error('[Auth] Signup error:', error);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// Signup - Step 2: Verify code and create account
app.post('/auth/verify', async (req, res) => {
  try {
    const { email, code } = req.body;
    
    if (!email || !code) {
      return res.status(400).json({ error: 'Email and verification code are required' });
    }
    
    const pending = pendingUsers.get(email);
    
    if (!pending) {
      return res.status(400).json({ error: 'No pending verification found. Please sign up again.' });
    }
    
    if (Date.now() > pending.expiresAt) {
      pendingUsers.delete(email);
      return res.status(400).json({ error: 'Verification code expired. Please sign up again.' });
    }
    
    if (pending.code !== code.toString().trim()) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }
    
    // Code is valid, create the user
    const user = {
      id: 'user_' + Date.now(),
      email: pending.email,
      name: pending.name,
      verified: true,
      createdAt: new Date().toISOString()
    };
    
    users.set(email, { ...user, password: pending.password });
    pendingUsers.delete(email);
    
    const token = generateToken();
    sessions.set(token, user);
    
    console.log('[Auth] User verified and created:', email);
    
    res.json({
      token,
      user,
      subscription: { tier: 'free', status: 'active' }
    });
    
  } catch (error) {
    console.error('[Auth] Verify error:', error);
    res.status(500).json({ error: 'Failed to verify account' });
  }
});

// Resend verification code
app.post('/auth/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    const pending = pendingUsers.get(email);
    
    if (!pending) {
      return res.status(400).json({ error: 'No pending verification found. Please sign up again.' });
    }
    
    // Rate limit: 1 minute between resends
    if (Date.now() - pending.createdAt < 60000) {
      const waitTime = Math.ceil((60000 - (Date.now() - pending.createdAt)) / 1000);
      return res.status(400).json({ error: `Please wait ${waitTime} seconds before requesting another code` });
    }
    
    // Generate new code
    const code = generateVerificationCode();
    pending.code = code;
    pending.expiresAt = Date.now() + 10 * 60 * 1000;
    pending.createdAt = Date.now();
    
    pendingUsers.set(email, pending);
    
    // Send new verification email
    const sent = await sendVerificationEmail(email, code, pending.name);
    
    if (!sent && process.env.SENDGRID_API_KEY) {
      return res.status(500).json({ error: 'Failed to send verification email. Please try again.' });
    }
    
    res.json({ success: true, message: 'New verification code sent' });
    
  } catch (error) {
    console.error('[Auth] Resend error:', error);
    res.status(500).json({ error: 'Failed to resend verification code' });
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

app.post('/api/notify', async (req, res) => {
  console.log('[Notify] Received notification request');
  
  const { type, recipient, deceasedName, accountCount, subscriptionCount, monthlyCharges, portalUrl } = req.body;
  
  if (type === 'heir' && recipient && recipient.email) {
    // Send heir notification email
    if (!process.env.SENDGRID_API_KEY) {
      console.log('[Notify] SendGrid not configured, would send heir notification to:', recipient.email);
      return res.json({ success: true, message: 'Notification logged (email not configured)' });
    }
    
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    
    const msg = {
      to: recipient.email,
      from: process.env.SENDGRID_FROM_EMAIL || 'noreply@lifeboat.app',
      subject: `${deceasedName} has designated you as their digital heir`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background: #fafbfc;">
          <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); border-radius: 16px; padding: 40px; color: white; text-align: center; margin-bottom: 24px;">
            <h1 style="margin: 0 0 8px 0; font-size: 24px;">LifeBoat</h1>
            <p style="margin: 0; opacity: 0.9; font-size: 14px;">Digital Estate Planning</p>
          </div>
          
          <div style="background: white; border-radius: 16px; padding: 32px; border: 1px solid #e2e8f0;">
            <p style="font-size: 16px; color: #1a1a2e; margin: 0 0 16px 0;">
              Dear ${recipient.name || 'Friend'},
            </p>
            
            <p style="font-size: 16px; color: #1a1a2e; margin: 0 0 24px 0; line-height: 1.7;">
              We're reaching out because <strong>${deceasedName}</strong> designated you as a digital heir through LifeBoat. After an extended period of inactivity and multiple contact attempts, we need your help managing their digital accounts.
            </p>
            
            <div style="background: #f8fafc; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
              <h3 style="margin: 0 0 16px 0; font-size: 16px; color: #1a1a2e;">What's waiting for you:</h3>
              <div style="display: flex; gap: 16px; flex-wrap: wrap;">
                <div style="flex: 1; min-width: 120px;">
                  <div style="font-size: 28px; font-weight: 700; color: #6366f1;">${accountCount || 0}</div>
                  <div style="font-size: 13px; color: #64748b;">Total Accounts</div>
                </div>
                ${subscriptionCount ? `
                <div style="flex: 1; min-width: 120px;">
                  <div style="font-size: 28px; font-weight: 700; color: #ef4444;">${subscriptionCount}</div>
                  <div style="font-size: 13px; color: #64748b;">Active Subscriptions</div>
                </div>
                ` : ''}
                ${monthlyCharges ? `
                <div style="flex: 1; min-width: 120px;">
                  <div style="font-size: 28px; font-weight: 700; color: #ef4444;">$${monthlyCharges.toFixed(2)}</div>
                  <div style="font-size: 13px; color: #64748b;">Monthly Charges</div>
                </div>
                ` : ''}
              </div>
            </div>
            
            ${subscriptionCount ? `
            <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 16px; margin-bottom: 24px;">
              <p style="margin: 0; color: #dc2626; font-size: 14px;">
                <strong>⚠️ Urgent:</strong> There are ${subscriptionCount} subscription(s) that may still be charging. We recommend handling these first.
              </p>
            </div>
            ` : ''}
            
            <p style="font-size: 16px; color: #1a1a2e; margin: 0 0 24px 0; line-height: 1.7;">
              ${deceasedName} left you login credentials for many of these accounts, along with specific instructions for each one. Our portal will guide you through the process step by step.
            </p>
            
            <div style="text-align: center; margin: 32px 0;">
              <a href="${portalUrl || '#'}" style="display: inline-block; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 16px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
                Access Your Heir Portal →
              </a>
            </div>
            
            <p style="font-size: 14px; color: #64748b; margin: 24px 0 0 0; line-height: 1.7;">
              Take your time with this process. There's no rush. The portal will help you prioritize what needs attention first and guide you through each account.
            </p>
          </div>
          
          <p style="font-size: 12px; color: #94a3b8; text-align: center; margin-top: 24px;">
            You're receiving this because ${deceasedName} designated you as a digital heir.<br>
            If you believe this was sent in error, please contact us.
          </p>
        </div>
      `
    };
    
    try {
      await sgMail.send(msg);
      console.log('[Notify] Heir notification sent to:', recipient.email);
      return res.json({ success: true, message: 'Heir notification sent' });
    } catch (error) {
      console.error('[Notify] Failed to send heir notification:', error.message);
      return res.status(500).json({ success: false, error: 'Failed to send notification' });
    }
  }
  
  res.json({ success: true, message: 'Notification logged' });
});

// ============================================================================
// VAULT ROUTES (Zero-Knowledge Encrypted Storage)
// ============================================================================

// Store encrypted vaults (server only sees encrypted blobs)
const encryptedVaults = new Map();

// Middleware to verify auth token
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const token = authHeader.split(' ')[1];
  const session = sessions.get(token);
  
  if (!session) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  
  req.userId = session.email;
  req.session = session;
  next();
}

// Sync encrypted vault to cloud (Pro feature)
app.post('/vault/sync', requireAuth, (req, res) => {
  const { vault, accounts, salt, timestamp } = req.body;
  
  // Validate user has Pro subscription
  const user = users.get(req.userId);
  if (!user || user.tier !== 'pro') {
    return res.status(403).json({ error: 'Cloud sync requires Pro subscription' });
  }
  
  // Store encrypted data (we cannot read this)
  encryptedVaults.set(req.userId, {
    vault,       // Encrypted vault blob
    accounts,    // Encrypted accounts blob
    salt,        // Salt for key derivation (safe to store)
    timestamp,
    updatedAt: Date.now()
  });
  
  console.log(`[Vault] Synced encrypted vault for ${req.userId} (${vault ? vault.length : 0} bytes)`);
  
  res.json({ 
    success: true, 
    message: 'Vault synced (encrypted)',
    timestamp: Date.now()
  });
});

// Restore encrypted vault from cloud
app.get('/vault/restore', requireAuth, (req, res) => {
  const user = users.get(req.userId);
  if (!user || user.tier !== 'pro') {
    return res.status(403).json({ error: 'Cloud restore requires Pro subscription' });
  }
  
  const vaultData = encryptedVaults.get(req.userId);
  
  if (!vaultData) {
    return res.status(404).json({ error: 'No vault backup found' });
  }
  
  // Return encrypted blobs (client will decrypt)
  res.json({
    vault: vaultData.vault,
    accounts: vaultData.accounts,
    salt: vaultData.salt,
    verificationHash: user.verificationHash,
    timestamp: vaultData.timestamp
  });
});

// Store verification hash (for password verification without storing password)
app.post('/vault/setup', requireAuth, (req, res) => {
  const { salt, verificationHash } = req.body;
  
  // Update user with vault setup data
  const user = users.get(req.userId);
  if (user) {
    user.salt = salt;
    user.verificationHash = verificationHash;
    user.vaultSetupAt = Date.now();
    users.set(req.userId, user);
  }
  
  console.log(`[Vault] Setup complete for ${req.userId}`);
  
  res.json({ success: true });
});

// Get vault metadata (for checking if vault exists on server)
app.get('/vault/status', requireAuth, (req, res) => {
  const user = users.get(req.userId);
  const vaultData = encryptedVaults.get(req.userId);
  
  res.json({
    hasVault: !!user?.verificationHash,
    hasCloudBackup: !!vaultData,
    lastSync: vaultData?.updatedAt || null,
    tier: user?.tier || 'free'
  });
});

// ============================================================================
// PLAID INTEGRATION ROUTES
// ============================================================================

// Plaid setup - requires PLAID_CLIENT_ID and PLAID_SECRET env vars
let plaidClient = null;

function initPlaid() {
  if (plaidClient) return plaidClient;
  
  if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
    console.warn('⚠️  Plaid credentials not configured');
    return null;
  }
  
  const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
  
  const configuration = new Configuration({
    basePath: PlaidEnvironments[process.env.PLAID_ENV || 'sandbox'],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
        'PLAID-SECRET': process.env.PLAID_SECRET,
      },
    },
  });
  
  plaidClient = new PlaidApi(configuration);
  return plaidClient;
}

// Store Plaid access tokens per user (in production, use a database)
const plaidAccessTokens = new Map();
const plaidItems = new Map();

// Plaid Link Page (serves HTML that loads Plaid Link)
// This is needed because MV3 extensions can't load remote scripts
app.get('/plaid/link', async (req, res) => {
  const { token } = req.query;
  
  if (!token) {
    return res.status(400).send('Missing token');
  }
  
  // Verify token and get user
  const sessionData = sessions.get(token);
  if (!sessionData) {
    return res.status(401).send('Invalid or expired token');
  }
  
  try {
    const client = initPlaid();
    if (!client) {
      return res.status(503).send('Plaid not configured');
    }
    
    // Create link token
    const response = await client.linkTokenCreate({
      user: {
        client_user_id: sessionData.id,
      },
      client_name: 'LifeBoat',
      products: ['transactions'],
      country_codes: ['US'],
      language: 'en',
    });
    
    const linkToken = response.data.link_token;
    
    // Serve HTML page with Plaid Link
    res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Connect Bank - LifeBoat</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #0f0f12 0%, #1a1a2e 100%);
      color: #fff;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      text-align: center;
      max-width: 400px;
    }
    .logo {
      font-size: 48px;
      margin-bottom: 16px;
    }
    h1 {
      font-size: 24px;
      margin-bottom: 8px;
    }
    p {
      color: rgba(255,255,255,0.6);
      margin-bottom: 24px;
    }
    .status {
      padding: 16px;
      border-radius: 12px;
      background: rgba(255,255,255,0.05);
      margin-top: 20px;
    }
    .status.success {
      background: rgba(52, 211, 153, 0.1);
      border: 1px solid rgba(52, 211, 153, 0.3);
      color: #34d399;
    }
    .status.error {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #ef4444;
    }
    .spinner {
      width: 40px;
      height: 40px;
      border: 3px solid rgba(255,255,255,0.1);
      border-top-color: #6366f1;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 16px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">🚤</div>
    <h1>Connect Your Bank</h1>
    <p>Securely link your bank account to detect subscriptions</p>
    <div class="spinner"></div>
    <div id="status" class="status">Opening Plaid Link...</div>
  </div>
  
  <script>
    const userToken = '${token}';
    
    const handler = Plaid.create({
      token: '${linkToken}',
      onSuccess: async (publicToken, metadata) => {
        document.getElementById('status').className = 'status';
        document.getElementById('status').textContent = 'Connecting account...';
        
        try {
          // Exchange token via our API
          const response = await fetch('/plaid/exchange-token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + userToken
            },
            body: JSON.stringify({
              public_token: publicToken,
              institution: metadata.institution,
              accounts: metadata.accounts
            })
          });
          
          if (response.ok) {
            document.getElementById('status').className = 'status success';
            document.getElementById('status').textContent = '✓ Bank connected successfully!';
            
            // Notify parent window (extension)
            if (window.opener) {
              window.opener.postMessage({
                type: 'PLAID_LINK_SUCCESS',
                success: true,
                data: metadata
              }, '*');
            }
            
            setTimeout(() => window.close(), 1500);
          } else {
            throw new Error('Failed to connect');
          }
        } catch (err) {
          document.getElementById('status').className = 'status error';
          document.getElementById('status').textContent = 'Failed to connect. Please try again.';
        }
      },
      onExit: (err, metadata) => {
        if (err) {
          document.getElementById('status').className = 'status error';
          document.getElementById('status').textContent = 'Connection cancelled or failed.';
        }
        
        // Notify parent window
        if (window.opener) {
          window.opener.postMessage({
            type: 'PLAID_LINK_EXIT',
            error: err,
            data: metadata
          }, '*');
        }
        
        setTimeout(() => window.close(), 1000);
      }
    });
    
    // Auto-open Plaid Link
    handler.open();
  </script>
</body>
</html>
    `);
  } catch (error) {
    console.error('[Plaid] Link page error:', error);
    res.status(500).send('Failed to initialize Plaid Link');
  }
});

// Create Link Token (API endpoint)
app.post('/plaid/create-link-token', requireAuth, async (req, res) => {
  try {
    const client = initPlaid();
    if (!client) {
      return res.status(503).json({ error: 'Plaid not configured' });
    }
    
    const response = await client.linkTokenCreate({
      user: {
        client_user_id: req.userId,
      },
      client_name: 'LifeBoat',
      products: ['transactions'],
      country_codes: ['US'],
      language: 'en',
    });
    
    res.json({ link_token: response.data.link_token });
  } catch (error) {
    console.error('[Plaid] Link token error:', error);
    res.status(500).json({ error: 'Failed to create link token' });
  }
});

// Exchange Public Token for Access Token
app.post('/plaid/exchange-token', requireAuth, async (req, res) => {
  try {
    const client = initPlaid();
    if (!client) {
      return res.status(503).json({ error: 'Plaid not configured' });
    }
    
    const { public_token, institution, accounts } = req.body;
    
    const response = await client.itemPublicTokenExchange({
      public_token: public_token,
    });
    
    const accessToken = response.data.access_token;
    const itemId = response.data.item_id;
    
    // Store access token for user
    let userTokens = plaidAccessTokens.get(req.userId) || [];
    userTokens.push({
      accessToken,
      itemId,
      institution,
      accounts,
      createdAt: Date.now()
    });
    plaidAccessTokens.set(req.userId, userTokens);
    
    // Store item info
    plaidItems.set(itemId, {
      userId: req.userId,
      accessToken,
      institution
    });
    
    console.log(`[Plaid] Token exchanged for user ${req.userId}, item ${itemId}`);
    
    res.json({ 
      success: true, 
      item_id: itemId,
      institution: institution?.name 
    });
  } catch (error) {
    console.error('[Plaid] Token exchange error:', error);
    res.status(500).json({ error: 'Failed to exchange token' });
  }
});

// Get Subscriptions (Recurring Transactions)
app.get('/plaid/subscriptions', requireAuth, async (req, res) => {
  try {
    const client = initPlaid();
    if (!client) {
      return res.status(503).json({ error: 'Plaid not configured' });
    }
    
    const userTokens = plaidAccessTokens.get(req.userId) || [];
    
    if (userTokens.length === 0) {
      return res.json({ subscriptions: [], message: 'No connected accounts' });
    }
    
    let allSubscriptions = [];
    
    for (const tokenInfo of userTokens) {
      try {
        // Get recurring transactions
        const response = await client.transactionsRecurringGet({
          access_token: tokenInfo.accessToken,
        });
        
        const inflows = response.data.inflow_streams || [];
        const outflows = response.data.outflow_streams || [];
        
        // Process outflows (these are subscriptions/recurring payments)
        for (const stream of outflows) {
          allSubscriptions.push({
            id: stream.stream_id,
            merchant_name: stream.merchant_name || stream.description,
            description: stream.description,
            amount: Math.abs(stream.average_amount?.amount || stream.last_amount?.amount || 0),
            frequency: stream.frequency,
            category: stream.category?.[0] || 'Other',
            last_date: stream.last_date,
            next_date: stream.predicted_next_date,
            is_active: stream.is_active,
            institution: tokenInfo.institution?.name,
            account_id: stream.account_id
          });
        }
      } catch (itemError) {
        console.error(`[Plaid] Error fetching subscriptions for item:`, itemError.message);
      }
    }
    
    // Sort by amount descending
    allSubscriptions.sort((a, b) => b.amount - a.amount);
    
    res.json({ 
      subscriptions: allSubscriptions,
      count: allSubscriptions.length,
      total_monthly: allSubscriptions.reduce((sum, s) => {
        if (s.frequency === 'MONTHLY') return sum + s.amount;
        if (s.frequency === 'WEEKLY') return sum + (s.amount * 4.33);
        if (s.frequency === 'ANNUALLY') return sum + (s.amount / 12);
        return sum + s.amount;
      }, 0)
    });
  } catch (error) {
    console.error('[Plaid] Subscriptions error:', error);
    res.status(500).json({ error: 'Failed to fetch subscriptions' });
  }
});

// Get All Transactions (for detailed view)
app.get('/plaid/transactions', requireAuth, async (req, res) => {
  try {
    const client = initPlaid();
    if (!client) {
      return res.status(503).json({ error: 'Plaid not configured' });
    }
    
    const userTokens = plaidAccessTokens.get(req.userId) || [];
    
    if (userTokens.length === 0) {
      return res.json({ transactions: [] });
    }
    
    let allTransactions = [];
    
    // Get transactions from last 30 days
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    for (const tokenInfo of userTokens) {
      try {
        const response = await client.transactionsGet({
          access_token: tokenInfo.accessToken,
          start_date: startDate,
          end_date: endDate,
        });
        
        allTransactions = allTransactions.concat(response.data.transactions);
      } catch (itemError) {
        console.error(`[Plaid] Error fetching transactions:`, itemError.message);
      }
    }
    
    res.json({ 
      transactions: allTransactions,
      count: allTransactions.length 
    });
  } catch (error) {
    console.error('[Plaid] Transactions error:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// Disconnect a Plaid Item
app.post('/plaid/disconnect', requireAuth, async (req, res) => {
  try {
    const client = initPlaid();
    if (!client) {
      return res.status(503).json({ error: 'Plaid not configured' });
    }
    
    const { item_id } = req.body;
    const itemInfo = plaidItems.get(item_id);
    
    if (!itemInfo || itemInfo.userId !== req.userId) {
      return res.status(404).json({ error: 'Item not found' });
    }
    
    // Remove from Plaid
    await client.itemRemove({
      access_token: itemInfo.accessToken,
    });
    
    // Remove from local storage
    plaidItems.delete(item_id);
    
    let userTokens = plaidAccessTokens.get(req.userId) || [];
    userTokens = userTokens.filter(t => t.itemId !== item_id);
    plaidAccessTokens.set(req.userId, userTokens);
    
    console.log(`[Plaid] Disconnected item ${item_id} for user ${req.userId}`);
    
    res.json({ success: true });
  } catch (error) {
    console.error('[Plaid] Disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect account' });
  }
});

// Refresh Plaid Data
app.post('/plaid/refresh', requireAuth, async (req, res) => {
  try {
    const client = initPlaid();
    if (!client) {
      return res.status(503).json({ error: 'Plaid not configured' });
    }
    
    const userTokens = plaidAccessTokens.get(req.userId) || [];
    
    for (const tokenInfo of userTokens) {
      try {
        await client.transactionsRefresh({
          access_token: tokenInfo.accessToken,
        });
      } catch (itemError) {
        console.error(`[Plaid] Refresh error for item:`, itemError.message);
      }
    }
    
    res.json({ success: true, message: 'Refresh initiated' });
  } catch (error) {
    console.error('[Plaid] Refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh' });
  }
});

// Get Connected Accounts
app.get('/plaid/accounts', requireAuth, async (req, res) => {
  try {
    const userTokens = plaidAccessTokens.get(req.userId) || [];
    
    const accounts = userTokens.map(t => ({
      item_id: t.itemId,
      institution: t.institution,
      accounts: t.accounts,
      connected_at: t.createdAt
    }));
    
    res.json({ accounts });
  } catch (error) {
    console.error('[Plaid] Accounts error:', error);
    res.status(500).json({ error: 'Failed to get accounts' });
  }
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
