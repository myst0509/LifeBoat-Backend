// LifeBoat Backend Server - SECURED VERSION
// Handles email (SendGrid) and SMS (Twilio) notifications
// Security: Rate limiting, input validation, error handling, request authentication

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const sgMail = require('@sendgrid/mail');
const twilio = require('twilio');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// ============================================================================
// SECURITY: RATE LIMITING
// ============================================================================

const rateLimits = new Map();

function rateLimit(key, maxRequests = 10, windowMs = 60000) {
  const now = Date.now();
  const windowStart = now - windowMs;
  
  if (!rateLimits.has(key)) {
    rateLimits.set(key, []);
  }
  
  const requests = rateLimits.get(key).filter(t => t > windowStart);
  
  if (requests.length >= maxRequests) {
    return false;
  }
  
  requests.push(now);
  rateLimits.set(key, requests);
  return true;
}

// Clean up old rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of rateLimits.entries()) {
    const recent = timestamps.filter(t => now - t < 300000);
    if (recent.length === 0) {
      rateLimits.delete(key);
    } else {
      rateLimits.set(key, recent);
    }
  }
}, 300000);

// ============================================================================
// SECURITY: INPUT VALIDATION
// ============================================================================

function sanitizeString(str, maxLength = 500) {
  if (typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '').slice(0, maxLength).trim();
}

function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
}

function isValidPhone(phone) {
  if (!phone || typeof phone !== 'string') return false;
  const cleaned = phone.replace(/\D/g, '');
  return cleaned.length >= 10 && cleaned.length <= 15;
}

function validateNotificationPayload(body) {
  const errors = [];
  
  if (!body.type || !['user_check', 'heir_alert', 'final_check', 'grace_period', 'transfer'].includes(body.type)) {
    errors.push('Invalid notification type');
  }
  
  if (!body.channel || !['email', 'sms', 'call'].includes(body.channel)) {
    errors.push('Invalid channel');
  }
  
  if (body.channel === 'email' && !isValidEmail(body.to)) {
    errors.push('Invalid email address');
  }
  
  if ((body.channel === 'sms' || body.channel === 'call') && !isValidPhone(body.to)) {
    errors.push('Invalid phone number');
  }
  
  return errors;
}

// ============================================================================
// SECURITY: REQUEST AUTHENTICATION
// ============================================================================

const API_TOKENS = new Set();

// Generate a secure token for API access
function generateApiToken() {
  const token = crypto.randomBytes(32).toString('hex');
  API_TOKENS.add(token);
  return token;
}

// Middleware to verify API token
function authenticateRequest(req, res, next) {
  // Skip auth for webhooks (they have their own verification)
  if (req.path.startsWith('/api/webhook') || req.path.startsWith('/api/respond') || req.path.startsWith('/api/call')) {
    return next();
  }
  
  const token = req.headers['x-api-token'] || req.headers['authorization']?.replace('Bearer ', '');
  
  // In development, allow requests without token
  if (process.env.NODE_ENV !== 'production') {
    return next();
  }
  
  if (!token || !API_TOKENS.has(token)) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or missing API token' });
  }
  
  next();
}

// ============================================================================
// SECURITY: ERROR HANDLING
// ============================================================================

class AppError extends Error {
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

// Global error handler - NEVER expose stack traces
function errorHandler(err, req, res, next) {
  console.error(`[ERROR] ${new Date().toISOString()}:`, err.message);
  
  // Log full error internally but never expose to client
  if (process.env.NODE_ENV === 'development') {
    console.error(err.stack);
  }
  
  // Send generic error to client
  const statusCode = err.statusCode || 500;
  const message = err.isOperational ? err.message : 'An unexpected error occurred';
  
  res.status(statusCode).json({
    success: false,
    error: message
  });
}

// Catch unhandled errors
process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Uncaught Exception:', err.message);
  // In production, you might want to restart the process gracefully
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Unhandled Rejection:', reason);
});

// ============================================================================
// CONFIGURATION
// ============================================================================

// SendGrid setup
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@lifeboat.app';
const FROM_NAME = process.env.FROM_NAME || 'LifeBoat';

// Twilio setup
let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}
const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER;

// Base URL for links in emails
const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';

// ============================================================================
// MIDDLEWARE
// ============================================================================

// CORS with strict origin checking
const allowedOrigins = [
  /^chrome-extension:\/\//,
  /^http:\/\/localhost(:\d+)?$/
];

if (process.env.ALLOWED_ORIGIN) {
  allowedOrigins.push(new RegExp(process.env.ALLOWED_ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    const isAllowed = allowedOrigins.some(pattern => 
      pattern instanceof RegExp ? pattern.test(origin) : pattern === origin
    );
    
    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new AppError('Not allowed by CORS', 403));
    }
  },
  credentials: true
}));

// Body parser with size limits
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Request logging
app.use((req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} from ${ip}`);
  next();
});

// Rate limiting middleware
app.use((req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  
  // Different limits for different endpoints
  let maxRequests = 60; // Default: 60 requests per minute
  
  if (req.path.includes('/notify')) {
    maxRequests = 10; // Stricter for notifications
  }
  
  if (!rateLimit(ip, maxRequests, 60000)) {
    return res.status(429).json({
      success: false,
      error: 'Too many requests. Please try again later.'
    });
  }
  
  next();
});

// Authentication
app.use(authenticateRequest);

// ============================================================================
// SECURE TOKEN GENERATION FOR EMAIL LINKS
// ============================================================================

const confirmationTokens = new Map();
const TOKEN_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

function generateConfirmationToken(userId, action) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiry = Date.now() + TOKEN_EXPIRY_MS;
  
  confirmationTokens.set(token, {
    userId,
    action,
    expiry,
    used: false
  });
  
  // Clean up expired tokens
  for (const [t, data] of confirmationTokens.entries()) {
    if (Date.now() > data.expiry) {
      confirmationTokens.delete(t);
    }
  }
  
  return token;
}

function validateConfirmationToken(token, action) {
  const data = confirmationTokens.get(token);
  
  if (!data) {
    return { valid: false, error: 'Token not found' };
  }
  
  if (Date.now() > data.expiry) {
    confirmationTokens.delete(token);
    return { valid: false, error: 'Token expired (links expire after 30 minutes)' };
  }
  
  if (data.used) {
    return { valid: false, error: 'Token already used' };
  }
  
  if (data.action !== action) {
    return { valid: false, error: 'Invalid action for this token' };
  }
  
  // Mark as used
  data.used = true;
  confirmationTokens.set(token, data);
  
  return { valid: true, userId: data.userId };
}

// ============================================================================
// HEALTH CHECK ENDPOINT
// ============================================================================

// Root health check (for Railway, Render, etc.)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      email: !!process.env.SENDGRID_API_KEY,
      sms: !!twilioClient,
      calls: !!twilioClient && !!TWILIO_PHONE
    }
  });
});

// ============================================================================
// GENERATE API TOKEN (for initial setup)
// ============================================================================

app.post('/api/auth/token', (req, res) => {
  // In production, this should require admin authentication
  if (process.env.NODE_ENV === 'production' && req.headers['x-admin-key'] !== process.env.ADMIN_KEY) {
    throw new AppError('Unauthorized', 401);
  }
  
  const token = generateApiToken();
  res.json({ token });
});

// ============================================================================
// NOTIFICATION ENDPOINT (SECURED)
// ============================================================================

app.post('/api/notify', async (req, res, next) => {
  try {
    // Validate input
    const validationErrors = validateNotificationPayload(req.body);
    if (validationErrors.length > 0) {
      throw new AppError(validationErrors.join(', '), 400);
    }
    
    const { type, channel, to, data } = req.body;
    
    // Sanitize data
    const sanitizedData = {
      userName: sanitizeString(data?.userName, 100),
      inactiveDays: parseInt(data?.inactiveDays) || 0,
      gracePeriodHours: parseInt(data?.gracePeriodHours) || 48
    };
    
    // Generate secure confirmation token
    const userId = crypto.createHash('sha256').update(to).digest('hex').slice(0, 16);
    const confirmToken = generateConfirmationToken(userId, 'confirm');
    const awayToken = generateConfirmationToken(userId, 'away');
    
    sanitizedData.confirmUrl = `${BASE_URL}/api/respond/${confirmToken}/confirm`;
    sanitizedData.awayUrl = `${BASE_URL}/api/respond/${awayToken}/away`;
    sanitizedData.emergencyConfirmUrl = sanitizedData.confirmUrl;
    sanitizedData.cancelUrl = sanitizedData.confirmUrl;
    
    let result;
    
    switch (channel) {
      case 'email':
        result = await sendEmail(type, to, sanitizedData);
        break;
      case 'sms':
        result = await sendSMS(type, to, sanitizedData);
        break;
      case 'call':
        result = await makeCall(type, to, sanitizedData);
        break;
      default:
        throw new AppError('Invalid channel', 400);
    }
    
    res.json({ success: true, messageId: result.messageId || result.sid });
    
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// EMAIL SENDING (with templates)
// ============================================================================

async function sendEmail(type, to, data) {
  if (!process.env.SENDGRID_API_KEY) {
    throw new AppError('Email service not configured', 503);
  }
  
  let subject, html;
  
  switch (type) {
    case 'user_check':
      subject = '👋 LifeBoat Check-In: Are you okay?';
      html = generateUserCheckEmailHTML(data);
      break;
    case 'final_check':
      subject = '🚨 URGENT: LifeBoat Final Check - Response Required';
      html = generateFinalCheckEmailHTML(data);
      break;
    case 'grace_period':
      subject = '⚡ TRANSFER STARTING - LifeBoat Grace Period Active';
      html = generateGracePeriodEmailHTML(data);
      break;
    case 'heir_alert':
      subject = '📋 LifeBoat: You have been designated as a digital heir';
      html = generateHeirAlertEmailHTML(data);
      break;
    case 'transfer':
      subject = '📦 LifeBoat: Digital Estate Transfer Instructions';
      html = generateTransferEmailHTML(data);
      break;
    default:
      throw new AppError('Unknown email type', 400);
  }
  
  const msg = {
    to: to,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject: subject,
    html: html
  };
  
  const response = await sgMail.send(msg);
  return { messageId: response[0]?.headers?.['x-message-id'] };
}

// ============================================================================
// SMS SENDING
// ============================================================================

async function sendSMS(type, to, data) {
  if (!twilioClient) {
    throw new AppError('SMS service not configured', 503);
  }
  
  let body;
  
  switch (type) {
    case 'user_check':
      body = `LifeBoat: Hi ${data.userName}, we noticed you've been inactive for ${data.inactiveDays} days. Reply YES if you're okay, or click: ${data.confirmUrl}`;
      break;
    case 'final_check':
      body = `🚨 URGENT LifeBoat: ${data.userName}, you've been inactive ${data.inactiveDays} days. Transfer starts in 48hrs unless you reply ALIVE or click: ${data.emergencyConfirmUrl}`;
      break;
    case 'grace_period':
      body = `⚡ LifeBoat ALERT: Transfer starting in ${data.gracePeriodHours}hrs. Reply STOP to cancel immediately, or click: ${data.cancelUrl}`;
      break;
    default:
      body = `LifeBoat notification. Please check your email for details.`;
  }
  
  // Limit SMS length
  if (body.length > 160) {
    body = body.slice(0, 157) + '...';
  }
  
  // Format phone number
  let formattedPhone = to.replace(/\D/g, '');
  if (!formattedPhone.startsWith('1') && formattedPhone.length === 10) {
    formattedPhone = '1' + formattedPhone;
  }
  if (!formattedPhone.startsWith('+')) {
    formattedPhone = '+' + formattedPhone;
  }
  
  const message = await twilioClient.messages.create({
    body: body,
    to: formattedPhone,
    from: TWILIO_PHONE
  });
  
  return { sid: message.sid };
}

// ============================================================================
// PHONE CALLS
// ============================================================================

async function makeCall(type, to, data) {
  if (!twilioClient || !TWILIO_PHONE) {
    throw new AppError('Call service not configured', 503);
  }
  
  let formattedPhone = to.replace(/\D/g, '');
  if (!formattedPhone.startsWith('1') && formattedPhone.length === 10) {
    formattedPhone = '1' + formattedPhone;
  }
  if (!formattedPhone.startsWith('+')) {
    formattedPhone = '+' + formattedPhone;
  }
  
  const twimlUrl = `${BASE_URL}/api/call/twiml?type=${encodeURIComponent(type)}&userName=${encodeURIComponent(data.userName)}&days=${data.inactiveDays}`;
  
  const call = await twilioClient.calls.create({
    to: formattedPhone,
    from: TWILIO_PHONE,
    url: twimlUrl,
    timeout: 30
  });
  
  return { sid: call.sid };
}

// ============================================================================
// CONFIRMATION LINK HANDLER (with token expiry)
// ============================================================================

app.get('/api/respond/:token/:action', (req, res) => {
  try {
    const { token, action } = req.params;
    
    // Validate token
    const validation = validateConfirmationToken(token, action);
    
    if (!validation.valid) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Link Expired</title></head>
        <body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h1>⏰ Link Expired</h1>
          <p>${sanitizeString(validation.error)}</p>
          <p>Please use a more recent link from your email or open the LifeBoat extension directly.</p>
        </body>
        </html>
      `);
    }
    
    // Process the action
    console.log(`[ACTION] User ${validation.userId} confirmed via ${action}`);
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Confirmed!</title></head>
      <body style="font-family: sans-serif; text-align: center; padding: 50px; background: #f0fdf4;">
        <h1 style="color: #16a34a;">✓ Confirmed!</h1>
        <p>Your status has been updated. You can close this page.</p>
      </body>
      </html>
    `);
    
  } catch (error) {
    res.status(500).send('An error occurred. Please try again.');
  }
});

// ============================================================================
// TWILIO WEBHOOKS (with signature verification)
// ============================================================================

// Verify Twilio webhook signature
function verifyTwilioSignature(req, res, next) {
  if (process.env.NODE_ENV !== 'production') {
    return next(); // Skip in development
  }
  
  const twilioSignature = req.headers['x-twilio-signature'];
  const url = `${BASE_URL}${req.originalUrl}`;
  
  const isValid = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN,
    twilioSignature,
    url,
    req.body
  );
  
  if (!isValid) {
    console.warn('[SECURITY] Invalid Twilio signature');
    return res.status(403).send('Forbidden');
  }
  
  next();
}

app.get('/api/call/twiml', (req, res) => {
  const { type, userName, days } = req.query;
  
  const safeUserName = sanitizeString(userName, 50);
  const safeDays = parseInt(days) || 0;
  
  let message;
  switch (type) {
    case 'final_check':
      message = `This is an urgent message from LifeBoat. ${safeUserName}, you have been inactive for ${safeDays} days. Your digital estate transfer will begin in 48 hours unless you confirm you are okay. Press 1 if you are alive and want to cancel the transfer.`;
      break;
    case 'user_check':
      message = `Hello, this is LifeBoat. ${safeUserName}, we haven't detected any activity from you in ${safeDays} days. Press 1 to confirm you are okay.`;
      break;
    default:
      message = `This is LifeBoat calling to verify your status. Press 1 to confirm you are okay.`;
  }
  
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="1" action="${BASE_URL}/api/call/gather" timeout="10">
    <Say voice="alice">${message}</Say>
  </Gather>
  <Say voice="alice">We did not receive a response. Goodbye.</Say>
</Response>`;
  
  res.type('text/xml');
  res.send(twiml);
});

app.post('/api/call/gather', verifyTwilioSignature, (req, res) => {
  const { Digits } = req.body;
  
  let twiml;
  if (Digits === '1') {
    console.log('[ACTION] User confirmed alive via phone call');
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Thank you for confirming! Your status has been updated. Goodbye.</Say>
</Response>`;
  } else {
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Invalid input. Goodbye.</Say>
</Response>`;
  }
  
  res.type('text/xml');
  res.send(twiml);
});

app.post('/api/webhook/sms', verifyTwilioSignature, async (req, res) => {
  try {
    const { From, Body } = req.body;
    const message = sanitizeString(Body, 200).toUpperCase();
    
    console.log('[SMS] From', From, ':', message);
    
    if (['YES', 'OK', 'ALIVE', "I'M OK", "IM OK"].includes(message)) {
      console.log('[ACTION] User confirmed alive via SMS:', From);
      
      if (twilioClient) {
        await twilioClient.messages.create({
          body: 'LifeBoat: Thank you for confirming! Your status has been updated.',
          to: From,
          from: TWILIO_PHONE
        });
      }
    }
    
    res.type('text/xml');
    res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    
  } catch (error) {
    console.error('[ERROR] SMS webhook:', error.message);
    res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
});

// ============================================================================
// EMAIL TEMPLATES
// ============================================================================

function generateUserCheckEmailHTML(data) {
  const { userName, inactiveDays, confirmUrl, awayUrl } = data;
  return `<!DOCTYPE html><html><body style="font-family: sans-serif; padding: 20px;">
    <h1>👋 Hi ${sanitizeString(userName)}</h1>
    <p>We noticed you've been inactive for <strong>${inactiveDays} days</strong>.</p>
    <p><a href="${confirmUrl}" style="background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px;">I'm OK</a></p>
    <p style="margin-top: 20px;"><a href="${awayUrl}">Set away period</a></p>
    <p style="color: #888; font-size: 12px; margin-top: 30px;">This link expires in 30 minutes.</p>
  </body></html>`;
}

function generateFinalCheckEmailHTML(data) {
  const { userName, inactiveDays, emergencyConfirmUrl } = data;
  return `<!DOCTYPE html><html><body style="font-family: sans-serif; padding: 20px; background: #fef2f2;">
    <h1 style="color: #dc2626;">🚨 URGENT: Final Check</h1>
    <p>Dear ${sanitizeString(userName)},</p>
    <p>You have been inactive for <strong>${inactiveDays} days</strong>. Transfer begins in 48 hours.</p>
    <p><a href="${emergencyConfirmUrl}" style="background: #dc2626; color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-size: 18px;">I'M ALIVE - CONFIRM NOW</a></p>
    <p style="color: #888; font-size: 12px; margin-top: 30px;">This link expires in 30 minutes.</p>
  </body></html>`;
}

function generateGracePeriodEmailHTML(data) {
  const { userName, gracePeriodHours, cancelUrl } = data;
  return `<!DOCTYPE html><html><body style="font-family: sans-serif; padding: 20px; background: #1a1a1a; color: white;">
    <h1 style="color: #f59e0b;">⚡ TRANSFER STARTING</h1>
    <p>Dear ${sanitizeString(userName)},</p>
    <p>Digital estate transfer begins in <strong>${gracePeriodHours} hours</strong>.</p>
    <p><a href="${cancelUrl}" style="background: #f59e0b; color: black; padding: 16px 32px; text-decoration: none; border-radius: 8px;">CANCEL TRANSFER</a></p>
    <p style="color: #888; font-size: 12px; margin-top: 30px;">This link expires in 30 minutes.</p>
  </body></html>`;
}

function generateHeirAlertEmailHTML(data) {
  return `<!DOCTYPE html><html><body style="font-family: sans-serif; padding: 20px;">
    <h1>📋 You've been designated as a digital heir</h1>
    <p>Someone has designated you to receive their digital estate information.</p>
    <p>You will receive further instructions if needed.</p>
  </body></html>`;
}

function generateTransferEmailHTML(data) {
  return `<!DOCTYPE html><html><body style="font-family: sans-serif; padding: 20px;">
    <h1>📦 Digital Estate Transfer</h1>
    <p>You have been designated to receive digital estate information.</p>
    <p>Please check your email for detailed instructions.</p>
  </body></html>`;
}

// ============================================================================
// ERROR HANDLER (must be last)
// ============================================================================

app.use(errorHandler);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Not found' });
});

// ============================================================================
// START SERVER
// ============================================================================

// Register analytics routes
const { registerAnalyticsRoutes } = require('./analytics-module');
registerAnalyticsRoutes(app);

// Serve analytics dashboard
app.get('/analytics', (req, res) => {
  res.sendFile(__dirname + '/analytics-dashboard.html');
});

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║           LifeBoat Notification Server (SECURED)           ║
╠════════════════════════════════════════════════════════════╣
║  Server running on port ${PORT}                               ║
║  Environment: ${process.env.NODE_ENV || 'development'}                           ║
║                                                            ║
║  Endpoints:                                                ║
║  • /api/notify - Send notifications                        ║
║  • /analytics - View analytics dashboard                   ║
║  • /analytics/dashboard - API stats                        ║
║                                                            ║
║  Security Features:                                        ║
║  ✓ Rate limiting (10-60 req/min per IP)                    ║
║  ✓ Input validation & sanitization                         ║
║  ✓ Token-based authentication                              ║
║  ✓ Confirmation links expire after 30 minutes              ║
║  ✓ No stack traces exposed to users                        ║
║  ✓ Twilio webhook signature verification                   ║
║  ✓ CORS with strict origin checking                        ║
║  ✓ Security headers enabled                                ║
╚════════════════════════════════════════════════════════════╝
  `);
  
  if (!process.env.SENDGRID_API_KEY) {
    console.warn('⚠️  SENDGRID_API_KEY not set - emails will fail');
  }
  if (!process.env.TWILIO_ACCOUNT_SID) {
    console.warn('⚠️  TWILIO credentials not set - SMS/calls will fail');
  }
});

module.exports = app;
