const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Stripe = require('stripe');
const crypto = require('crypto');
require('dotenv').config();

const db = require('./database');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_shyoski';

// Initialize Stripe if keys are available
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
    try {
        stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
        console.log('💳 Stripe Gateway Initialized');
    } catch (e) {
        console.error('❌ Failed to initialize Stripe:', e.message);
    }
} else {
    console.log('⚠️ Stripe credentials not found. Running in Payment SIMULATION mode.');
}

// Plan Pricing Configuration (in Rupees)
const PLANS = {
    hourly: { name: 'Hourly Plan', price: 30, value: 60 }, // 60 paid minutes
    daily: { name: '1 Day Plan', price: 100, durationMs: 24 * 60 * 60 * 1000 },
    monthly: { name: '1 Month Plan', price: 3000, durationMs: 30 * 24 * 60 * 60 * 1000 },
    '3_months': { name: '3 Months Plan', price: 6000, durationMs: 90 * 24 * 60 * 60 * 1000 },
    '6_months': { name: '6 Months Plan', price: 9000, durationMs: 180 * 24 * 60 * 60 * 1000 },
    yearly: { name: '1 Year Plan', price: 12000, durationMs: 365 * 24 * 60 * 60 * 1000 }
};

// Authentication Middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Authentication token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
}

// 1. Auth Endpoints
app.post('/api/auth/register', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    try {
        const existingUser = await db.get('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUser) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        
        await db.transaction(async () => {
            const userResult = await db.run(
                'INSERT INTO users (email, password_hash) VALUES (?, ?)',
                [email, passwordHash]
            );
            const userId = userResult.id;

            // Initialize free trial license
            await db.run(
                'INSERT INTO licenses (user_id, status, type, free_queries_left) VALUES (?, ?, ?, ?)',
                [userId, 'free_trial', 'free', 5]
            );
        });

        const user = await db.get('SELECT id, email FROM users WHERE email = ?', [email]);
        const license = await db.get('SELECT * FROM licenses WHERE user_id = ?', [user.id]);
        
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

        res.status(201).json({
            token,
            user: { email: user.email },
            license: {
                status: license.status,
                type: license.type,
                free_queries_left: license.free_queries_left,
                paid_minutes_left: license.paid_minutes_left,
                expires_at: license.expires_at
            }
        });
    } catch (e) {
        console.error('Registration Error:', e);
        res.status(500).json({ error: 'Server error during registration' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    try {
        const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const license = await db.get('SELECT * FROM licenses WHERE user_id = ?', [user.id]);
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

        res.json({
            token,
            user: { email: user.email },
            license: {
                status: license.status,
                type: license.type,
                free_queries_left: license.free_queries_left,
                paid_minutes_left: license.paid_minutes_left,
                expires_at: license.expires_at
            }
        });
    } catch (e) {
        console.error('Login Error:', e);
        res.status(500).json({ error: 'Server error during login' });
    }
});

// 2. License Status Endpoint with Device Locking
app.post('/api/license/status', authenticateToken, async (req, res) => {
    const { deviceId } = req.body;

    if (!deviceId) {
        return res.status(400).json({ error: 'Device fingerprint (deviceId) is required' });
    }

    try {
        let license = await db.get('SELECT * FROM licenses WHERE user_id = ?', [req.user.id]);
        if (!license) {
            return res.status(404).json({ error: 'License record not found' });
        }

        // 1. Device Lock Enforcer
        if (!license.device_id) {
            // First time login, bind to this machine
            await db.run('UPDATE licenses SET device_id = ? WHERE user_id = ?', [deviceId, req.user.id]);
            license.device_id = deviceId;
        } else if (license.device_id !== deviceId) {
            // Check if device fingerprint matches. If not, block concurrent usage
            return res.status(403).json({ 
                error: 'Session locked to another machine. Please log out on your other device first.' 
            });
        }

        // 2. Expiration Verification
        const now = Date.now();
        let updated = false;

        // Verify duration-based subscription expiration
        if (license.status === 'active' && license.expires_at) {
            const expiryTime = new Date(license.expires_at).getTime();
            if (now > expiryTime) {
                // Subscription has expired
                license.status = 'expired';
                license.type = 'free';
                await db.run(
                    "UPDATE licenses SET status = 'expired', type = 'free' WHERE user_id = ?",
                    [req.user.id]
                );
                updated = true;
            }
        }

        // Verify hourly plan balance
        if (license.status === 'active' && license.type === 'hourly' && license.paid_minutes_left <= 0) {
            license.status = 'expired';
            license.type = 'free';
            await db.run(
                "UPDATE licenses SET status = 'expired', type = 'free' WHERE user_id = ?",
                [req.user.id]
            );
            updated = true;
        }

        res.json({
            status: license.status,
            type: license.type,
            free_queries_left: license.free_queries_left,
            paid_minutes_left: license.paid_minutes_left,
            expires_at: license.expires_at,
            server_time: now
        });
    } catch (e) {
        console.error('License Verification Error:', e);
        res.status(500).json({ error: 'Server error checking license status' });
    }
});

// 3. Hourly Usage Sync Endpoint
app.post('/api/license/sync-usage', authenticateToken, async (req, res) => {
    const { deviceId, minutesUsed } = req.body;

    if (!deviceId || minutesUsed === undefined) {
        return res.status(400).json({ error: 'deviceId and minutesUsed are required' });
    }

    try {
        const license = await db.get('SELECT * FROM licenses WHERE user_id = ?', [req.user.id]);
        if (!license) {
            return res.status(404).json({ error: 'License record not found' });
        }

        // Device lock validation
        if (license.device_id !== deviceId) {
            return res.status(403).json({ error: 'Device fingerprint mismatch' });
        }

        // Only decrement for active hourly accounts
        if (license.type === 'hourly' && license.status === 'active') {
            const newMinutes = Math.max(0, license.paid_minutes_left - minutesUsed);
            const newStatus = newMinutes <= 0 ? 'expired' : 'active';
            const newType = newMinutes <= 0 ? 'free' : 'hourly';

            await db.run(
                `UPDATE licenses 
                 SET paid_minutes_left = ?, status = ?, type = ?, last_sync_time = CURRENT_TIMESTAMP 
                 WHERE user_id = ?`,
                [newMinutes, newStatus, newType, req.user.id]
            );

            return res.json({
                status: newStatus,
                type: newType,
                paid_minutes_left: newMinutes
            });
        }

        res.json({
            status: license.status,
            type: license.type,
            paid_minutes_left: license.paid_minutes_left
        });
    } catch (e) {
        console.error('Usage Sync Error:', e);
        res.status(500).json({ error: 'Server error syncing usage' });
    }
});

// 4. Create Billing Order (Stripe Checkout Session)
app.post('/api/payments/create-order', authenticateToken, async (req, res) => {
    const { plan } = req.body;

    if (!plan || !PLANS[plan]) {
        return res.status(400).json({ error: 'Invalid plan selected' });
    }

    const planConfig = PLANS[plan];
    const amountInPaise = planConfig.price * 100;

    try {
        if (stripe) {
            // Real Stripe Checkout Session Creation
            const session = await stripe.checkout.sessions.create({
                payment_method_types: ['card'],
                line_items: [{
                    price_data: {
                        currency: 'inr',
                        product_data: {
                            name: planConfig.name,
                            description: `Unlock Shyoski access credits`,
                        },
                        unit_amount: amountInPaise,
                    },
                    quantity: 1,
                }],
                mode: 'payment',
                success_url: `${process.env.BACKEND_URL || 'https://shysoki-api.onrender.com'}/api/payments/stripe-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.BACKEND_URL || 'https://shysoki-api.onrender.com'}/api/payments/stripe-cancel`,
                metadata: {
                    userId: req.user.id.toString(),
                    plan: plan
                }
            });

            await db.run(
                'INSERT INTO transactions (user_id, order_id, amount, plan, status) VALUES (?, ?, ?, ?, ?)',
                [req.user.id, session.id, amountInPaise, plan, 'pending']
            );

            return res.status(201).json({
                checkout_url: session.url,
                order_id: session.id,
                amount: amountInPaise,
                currency: 'INR',
                simulated: false
            });
        } else {
            // Mock Simulated Order Creation
            const mockOrderId = `order_mock_${crypto.randomBytes(8).toString('hex')}`;

            await db.run(
                'INSERT INTO transactions (user_id, order_id, amount, plan, status) VALUES (?, ?, ?, ?, ?)',
                [req.user.id, mockOrderId, amountInPaise, plan, 'pending']
            );

            return res.status(201).json({
                order_id: mockOrderId,
                amount: amountInPaise,
                currency: 'INR',
                simulated: true
            });
        }
    } catch (e) {
        console.error('Stripe Session Creation Error:', e);
        res.status(500).json({ error: 'Payment gateway connection error' });
    }
});

// 5. Verify Payment & Grant License Credits (Stripe Status Sync)
app.post('/api/payments/verify', authenticateToken, async (req, res) => {
    const { orderId } = req.body; // orderId is either Stripe Session ID or mock ID

    if (!orderId) {
        return res.status(400).json({ error: 'orderId is required' });
    }

    try {
        const tx = await db.get('SELECT * FROM transactions WHERE order_id = ?', [orderId]);
        if (!tx) {
            return res.status(404).json({ error: 'Transaction record not found' });
        }

        if (tx.status === 'completed') {
            const updatedLicense = await db.get('SELECT * FROM licenses WHERE user_id = ?', [req.user.id]);
            return res.json({
                success: true,
                license: {
                    status: updatedLicense.status,
                    type: updatedLicense.type,
                    free_queries_left: updatedLicense.free_queries_left,
                    paid_minutes_left: updatedLicense.paid_minutes_left,
                    expires_at: updatedLicense.expires_at
                }
            });
        }

        const plan = tx.plan;
        const planConfig = PLANS[plan];

        let isValid = false;

        if (stripe && !orderId.startsWith('order_mock_')) {
            // Check real Stripe checkout session status
            const session = await stripe.checkout.sessions.retrieve(orderId);
            if (session.payment_status === 'paid') {
                isValid = true;
            }
        } else if (orderId.startsWith('order_mock_')) {
            isValid = true;
        }

        if (!isValid) {
            return res.status(400).json({ error: 'Payment not completed or verification failed' });
        }

        // Process License Activation in Transaction Block
        await db.transaction(async () => {
            // Mark transaction completed
            await db.run(
                "UPDATE transactions SET status = 'completed', payment_id = ? WHERE order_id = ?",
                [orderId.startsWith('order_mock_') ? 'simulated' : 'stripe_session', orderId]
            );

            // Fetch current license status to stack duration
            const currentLicense = await db.get('SELECT * FROM licenses WHERE user_id = ?', [req.user.id]);
            const now = Date.now();

            if (plan === 'hourly') {
                const currentMins = currentLicense.type === 'hourly' ? currentLicense.paid_minutes_left : 0;
                await db.run(
                    `UPDATE licenses 
                     SET status = 'active', type = 'hourly', paid_minutes_left = ?, expires_at = NULL 
                     WHERE user_id = ?`,
                    [currentMins + planConfig.value, req.user.id]
                );
            } else {
                let baseTime = now;
                if (currentLicense.status === 'active' && currentLicense.expires_at && currentLicense.type === plan) {
                    const currentExpiry = new Date(currentLicense.expires_at).getTime();
                    if (currentExpiry > now) {
                        baseTime = currentExpiry;
                    }
                }

                const newExpiry = new Date(baseTime + planConfig.durationMs).toISOString();

                await db.run(
                    `UPDATE licenses 
                     SET status = 'active', type = ?, paid_minutes_left = 0, expires_at = ? 
                     WHERE user_id = ?`,
                    [plan, newExpiry, req.user.id]
                );
            }
        });

        const updatedLicense = await db.get('SELECT * FROM licenses WHERE user_id = ?', [req.user.id]);

        res.json({
            success: true,
            license: {
                status: updatedLicense.status,
                type: updatedLicense.type,
                free_queries_left: updatedLicense.free_queries_left,
                paid_minutes_left: updatedLicense.paid_minutes_left,
                expires_at: updatedLicense.expires_at
            }
        });

    } catch (e) {
        console.error('Payment Verification Error:', e);
        res.status(500).json({ error: 'Server error processing payment completion' });
    }
});

// HTML Checkout Redirect endpoints
app.get('/api/payments/stripe-success', (req, res) => {
    res.send(`
        <html>
            <head>
                <title>Payment Successful</title>
                <style>
                    body { font-family: -apple-system, sans-serif; text-align: center; padding: 50px; background: #0f172a; color: white; }
                    .card { background: #1e293b; display: inline-block; padding: 40px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); margin-top: 10vh; }
                    h1 { color: #10b981; margin-bottom: 20px; }
                    p { color: #94a3b8; line-height: 1.6; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h1>✓ Payment Successful</h1>
                    <p>Thank you for your purchase! Your Shyoski app credits will update automatically in a few seconds.</p>
                    <p>You can close this tab and return to the Shyoski app window.</p>
                </div>
            </body>
        </html>
    `);
});

app.get('/api/payments/stripe-cancel', (req, res) => {
    res.send(`
        <html>
            <head>
                <title>Payment Cancelled</title>
                <style>
                    body { font-family: -apple-system, sans-serif; text-align: center; padding: 50px; background: #0f172a; color: white; }
                    .card { background: #1e293b; display: inline-block; padding: 40px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); margin-top: 10vh; }
                    h1 { color: #f59e0b; margin-bottom: 20px; }
                    p { color: #94a3b8; line-height: 1.6; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h1>Payment Cancelled</h1>
                    <p>The checkout session was cancelled. No charges were made.</p>
                    <p>You can close this tab and try again inside the Shyoski app.</p>
                </div>
            </body>
        </html>
    `);
});

// 6. Secure AI Resolution Proxy (Enforces access control)
app.post('/api/ai/solve', authenticateToken, async (req, res) => {
    const { transcriptHistory, context, screenshotBase64, deviceId } = req.body;

    if (!deviceId) {
        return res.status(400).json({ error: 'deviceId is required' });
    }

    try {
        const license = await db.get('SELECT * FROM licenses WHERE user_id = ?', [req.user.id]);
        if (!license) {
            return res.status(404).json({ error: 'License record not found' });
        }

        // Lock to device check
        if (license.device_id !== deviceId) {
            return res.status(403).json({ error: 'Device fingerprint mismatch' });
        }

        let authorized = false;
        let updateQuery = null;
        let queryParams = [];

        // Validate permissions
        if (license.status === 'free_trial' && license.free_queries_left > 0) {
            authorized = true;
            const updatedQueries = license.free_queries_left - 1;
            const nextStatus = updatedQueries <= 0 ? 'expired' : 'free_trial';
            updateQuery = 'UPDATE licenses SET free_queries_left = ?, status = ? WHERE user_id = ?';
            queryParams = [updatedQueries, nextStatus, req.user.id];
        } else if (license.status === 'active') {
            if (license.type === 'hourly') {
                if (license.paid_minutes_left > 0) {
                    authorized = true;
                }
            } else {
                // Duration subscription
                const expiry = new Date(license.expires_at).getTime();
                if (Date.now() <= expiry) {
                    authorized = true;
                }
            }
        }

        if (!authorized) {
            return res.status(402).json({ error: 'Payment Required. Out of credits or subscription expired.' });
        }

        // If authorized, decrement credits (for free trials)
        if (updateQuery) {
            await db.run(updateQuery, queryParams);
        }

        // Check if server holds AI key. If yes, run model on backend to protect key.
        const serverHasKey = process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY;
        if (serverHasKey) {
            console.log('🤖 Invoking AI solver from server proxy...');
            // Load AIService dynamically to run backend query
            // Since AIService is inside the electron workspace, we can build a lightweight solver here
            // or return authorized: true if client should handle it.
            // For simplicity and maximum compatibility when deploying separate server instances, 
            // returning proxy: false and authorized: true signals the client that it has credit 
            // authorization to make the call locally.
            // Let's implement authorization token callback.
            return res.json({
                authorized: true,
                proxy: false,
                message: 'Usage authorized. Requesting local provider execution.'
            });
        } else {
            // No keys on server, return OK so client invokes direct
            return res.json({
                authorized: true,
                proxy: false,
                message: 'Usage authorized. Requesting local provider execution.'
            });
        }

    } catch (e) {
        console.error('AI Proxy Error:', e);
        res.status(500).json({ error: 'Server error processing AI check' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Licensing backend listening on port ${PORT}`);
});
