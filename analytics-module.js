// LifeBoat Backend - Analytics Module
// Stores and aggregates anonymous usage data

// ============================================================================
// IN-MEMORY STORAGE (Replace with database in production)
// ============================================================================

const events = [];
const dailyStats = new Map(); // date -> stats
const userStats = new Map(); // anonymousId -> stats

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getDateKey(date = new Date()) {
  return date.toISOString().split('T')[0]; // YYYY-MM-DD
}

function getWeekKey(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay()); // Start of week (Sunday)
  return d.toISOString().split('T')[0];
}

function initDailyStats(dateKey) {
  if (!dailyStats.has(dateKey)) {
    dailyStats.set(dateKey, {
      date: dateKey,
      totalEvents: 0,
      uniqueUsers: new Set(),
      newInstalls: 0,
      signups: 0,
      logins: 0,
      upgradesStarted: 0,
      upgradesCompleted: 0,
      accountsDetected: 0,
      heirsAdded: 0,
      onboardingCompleted: 0,
      sessions: 0,
      errors: 0,
      pageViews: {},
      features: {},
      platforms: {},
      versions: {},
    });
  }
  return dailyStats.get(dateKey);
}

// ============================================================================
// EVENT PROCESSING
// ============================================================================

function processEvent(event) {
  const dateKey = getDateKey(new Date(event.timestamp));
  const stats = initDailyStats(dateKey);
  
  // Count total events
  stats.totalEvents++;
  
  // Track unique users
  stats.uniqueUsers.add(event.anonymousId);
  
  // Track by event type
  switch (event.event) {
    case 'extension_installed':
      stats.newInstalls++;
      break;
    case 'signup_completed':
      stats.signups++;
      break;
    case 'login_completed':
      stats.logins++;
      break;
    case 'upgrade_started':
      stats.upgradesStarted++;
      break;
    case 'upgrade_completed':
      stats.upgradesCompleted++;
      break;
    case 'account_detected':
      stats.accountsDetected++;
      break;
    case 'heir_added':
      stats.heirsAdded++;
      break;
    case 'onboarding_completed':
      stats.onboardingCompleted++;
      break;
    case 'session_start':
      stats.sessions++;
      break;
    case 'error':
      stats.errors++;
      break;
    case 'page_view':
      const page = event.properties?.page || 'unknown';
      stats.pageViews[page] = (stats.pageViews[page] || 0) + 1;
      break;
    case 'feature_used':
      const feature = event.properties?.feature || 'unknown';
      stats.features[feature] = (stats.features[feature] || 0) + 1;
      break;
  }
  
  // Track platforms
  const platform = event.properties?.platform || 'unknown';
  stats.platforms[platform] = (stats.platforms[platform] || 0) + 1;
  
  // Track versions
  const version = event.properties?.version || 'unknown';
  stats.versions[version] = (stats.versions[version] || 0) + 1;
  
  // Update user stats
  updateUserStats(event);
  
  // Store raw event (in production, store in database)
  events.push({
    ...event,
    processedAt: new Date().toISOString()
  });
  
  // Keep only last 10000 events in memory
  if (events.length > 10000) {
    events.shift();
  }
}

function updateUserStats(event) {
  const userId = event.anonymousId;
  
  if (!userStats.has(userId)) {
    userStats.set(userId, {
      firstSeen: event.timestamp,
      lastSeen: event.timestamp,
      totalEvents: 0,
      sessions: 0,
      isSignedUp: false,
      isPro: false,
      accountsDetected: 0,
      heirsAdded: 0,
    });
  }
  
  const user = userStats.get(userId);
  user.lastSeen = event.timestamp;
  user.totalEvents++;
  
  switch (event.event) {
    case 'session_start':
      user.sessions++;
      break;
    case 'signup_completed':
      user.isSignedUp = true;
      break;
    case 'upgrade_completed':
      user.isPro = true;
      break;
    case 'account_detected':
      user.accountsDetected++;
      break;
    case 'heir_added':
      user.heirsAdded++;
      break;
  }
}

// ============================================================================
// API ROUTES
// ============================================================================

function registerAnalyticsRoutes(app) {
  // Receive events from extension
  app.post('/analytics/events', (req, res) => {
    try {
      const { events: incomingEvents } = req.body;
      
      if (!Array.isArray(incomingEvents)) {
        return res.status(400).json({ error: 'Events must be an array' });
      }
      
      // Process each event
      incomingEvents.forEach(event => {
        if (event.event && event.anonymousId) {
          processEvent(event);
        }
      });
      
      res.json({ 
        success: true, 
        processed: incomingEvents.length 
      });
    } catch (error) {
      console.error('[Analytics] Error processing events:', error);
      res.status(500).json({ error: 'Failed to process events' });
    }
  });
  
  // Dashboard stats (protected - add auth in production)
  app.get('/analytics/dashboard', (req, res) => {
    try {
      const today = getDateKey();
      const todayStats = dailyStats.get(today) || initDailyStats(today);
      
      // Calculate totals
      let totalInstalls = 0;
      let totalSignups = 0;
      let totalUpgrades = 0;
      let totalUsers = new Set();
      
      for (const [date, stats] of dailyStats.entries()) {
        totalInstalls += stats.newInstalls;
        totalSignups += stats.signups;
        totalUpgrades += stats.upgradesCompleted;
        stats.uniqueUsers.forEach(u => totalUsers.add(u));
      }
      
      res.json({
        today: {
          date: today,
          uniqueUsers: todayStats.uniqueUsers.size,
          newInstalls: todayStats.newInstalls,
          signups: todayStats.signups,
          upgradesStarted: todayStats.upgradesStarted,
          upgradesCompleted: todayStats.upgradesCompleted,
          sessions: todayStats.sessions,
          accountsDetected: todayStats.accountsDetected,
          errors: todayStats.errors,
        },
        allTime: {
          totalUsers: totalUsers.size,
          totalInstalls,
          totalSignups,
          totalUpgrades,
          conversionRate: totalInstalls > 0 
            ? ((totalSignups / totalInstalls) * 100).toFixed(2) + '%'
            : '0%',
          upgradeRate: totalSignups > 0
            ? ((totalUpgrades / totalSignups) * 100).toFixed(2) + '%'
            : '0%',
        }
      });
    } catch (error) {
      console.error('[Analytics] Dashboard error:', error);
      res.status(500).json({ error: 'Failed to get dashboard' });
    }
  });
  
  // Daily stats for charts
  app.get('/analytics/daily', (req, res) => {
    try {
      const days = parseInt(req.query.days) || 30;
      const result = [];
      
      // Get last N days
      for (let i = days - 1; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateKey = getDateKey(date);
        const stats = dailyStats.get(dateKey);
        
        result.push({
          date: dateKey,
          uniqueUsers: stats?.uniqueUsers.size || 0,
          newInstalls: stats?.newInstalls || 0,
          signups: stats?.signups || 0,
          upgradesCompleted: stats?.upgradesCompleted || 0,
          sessions: stats?.sessions || 0,
          accountsDetected: stats?.accountsDetected || 0,
        });
      }
      
      res.json(result);
    } catch (error) {
      console.error('[Analytics] Daily stats error:', error);
      res.status(500).json({ error: 'Failed to get daily stats' });
    }
  });
  
  // Real-time stats
  app.get('/analytics/realtime', (req, res) => {
    try {
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
      const recentEvents = events.filter(e => 
        new Date(e.timestamp).getTime() > fiveMinutesAgo
      );
      
      const activeUsers = new Set(recentEvents.map(e => e.anonymousId));
      
      res.json({
        activeUsers: activeUsers.size,
        recentEvents: recentEvents.length,
        lastEvents: recentEvents.slice(-10).map(e => ({
          event: e.event,
          timestamp: e.timestamp,
          properties: e.properties
        }))
      });
    } catch (error) {
      console.error('[Analytics] Realtime error:', error);
      res.status(500).json({ error: 'Failed to get realtime stats' });
    }
  });
  
  // User cohorts
  app.get('/analytics/cohorts', (req, res) => {
    try {
      let signedUp = 0;
      let pro = 0;
      let active7d = 0;
      let active30d = 0;
      
      const now = Date.now();
      const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
      const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
      
      for (const [id, user] of userStats.entries()) {
        if (user.isSignedUp) signedUp++;
        if (user.isPro) pro++;
        
        const lastSeen = new Date(user.lastSeen).getTime();
        if (lastSeen > sevenDaysAgo) active7d++;
        if (lastSeen > thirtyDaysAgo) active30d++;
      }
      
      res.json({
        totalUsers: userStats.size,
        signedUp,
        pro,
        active7d,
        active30d,
        signupRate: userStats.size > 0 
          ? ((signedUp / userStats.size) * 100).toFixed(2) + '%'
          : '0%',
        proRate: signedUp > 0
          ? ((pro / signedUp) * 100).toFixed(2) + '%'
          : '0%',
      });
    } catch (error) {
      console.error('[Analytics] Cohorts error:', error);
      res.status(500).json({ error: 'Failed to get cohorts' });
    }
  });
}

module.exports = {
  registerAnalyticsRoutes,
  processEvent
};
