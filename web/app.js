// Configuration: Autodetect backend environment
const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:'
    ? 'http://localhost:5005'
    : 'https://shysoki-api.onrender.com';

// Local Storage Session Keys
const TOKEN_KEY = 'shyoski_user_token';
const EMAIL_KEY = 'shyoski_user_email';

// Google OAuth Global State
let googleClientId = null;
let googleTokenClient = null;


// State Helper
function getToken() {
    return localStorage.getItem(TOKEN_KEY);
}

function getEmail() {
    return localStorage.getItem(EMAIL_KEY);
}

// Fetch Google Client ID and initialize Google Identity Services client
async function initGoogleOAuth() {
    try {
        const res = await fetch(`${API_URL}/api/auth/google/client-id`);
        if (res.ok) {
            const data = await res.json();
            if (data.clientId) {
                googleClientId = data.clientId;
                // Wait until google.accounts exists (it might be loaded async)
                const checkGoogle = setInterval(() => {
                    if (window.google && window.google.accounts) {
                        clearInterval(checkGoogle);
                        googleTokenClient = google.accounts.oauth2.initTokenClient({
                            client_id: googleClientId,
                            scope: 'email profile openid',
                            callback: async (tokenResponse) => {
                                if (tokenResponse && tokenResponse.access_token) {
                                    await handleGoogleLoginSuccess({ accessToken: tokenResponse.access_token });
                                }
                            }
                        });
                        console.log('🛡️ Real Google OAuth initialized with Client ID');
                    }
                }, 100);
            }
        }
    } catch (e) {
        console.warn('Could not initialize Real Google OAuth (falling back to Mock Mode):', e);
    }
}
initGoogleOAuth();

// -------------------------------------------------------------
// LANDING PAGE & MODAL CONTROLLER
// -------------------------------------------------------------
const authModal = document.getElementById('auth-modal');
const btnLoginTrigger = document.getElementById('btn-login-trigger');
const btnModalClose = document.getElementById('btn-modal-close');
const authForm = document.getElementById('auth-form');
const authEmailInput = document.getElementById('auth-email');
const authPasswordInput = document.getElementById('auth-password');
const authResetEmailInput = document.getElementById('auth-reset-email');
const authErrorMsg = document.getElementById('auth-error-msg');
const authSubmitBtn = document.getElementById('btn-auth-submit');
const authToggleLink = document.getElementById('auth-toggle-link');
const authTogglePrompt = document.getElementById('auth-toggle-prompt');
const authModalTitle = document.getElementById('auth-modal-title');
const navDashboardLink = document.getElementById('nav-dashboard-link');

// Forgot Password / Google elements
const authForgotLink = document.getElementById('auth-forgot-link');
const authGoogleBlock = document.getElementById('auth-google-block');
const btnGoogleSignin = document.getElementById('btn-google-signin');
const authLoginFields = document.getElementById('auth-login-fields');
const authForgotFields = document.getElementById('auth-forgot-fields');
const authToggleContainer = document.getElementById('auth-toggle-container');
const authBackContainer = document.getElementById('auth-back-container');
const authBackLink = document.getElementById('auth-back-link');

let currentAuthMode = 'signin'; // 'signin', 'signup', or 'forgot'

if (btnLoginTrigger) {
    // Check if user is logged in already and adjust header nav button
    if (getToken()) {
        btnLoginTrigger.style.display = 'none';
        if (navDashboardLink) navDashboardLink.style.display = 'inline-flex';
    }

    btnLoginTrigger.onclick = () => {
        if (getToken()) {
            window.location.href = 'dashboard.html';
        } else {
            openAuthModal();
        }
    };
}

if (btnModalClose) {
    btnModalClose.onclick = closeAuthModal;
}

// Toggle links between Sign In / Sign Up
if (authToggleLink) {
    authToggleLink.onclick = (e) => {
        e.preventDefault();
        if (currentAuthMode === 'signin') {
            setAuthMode('signup');
        } else {
            setAuthMode('signin');
        }
    };
}

// Toggle links to Forgot Password
if (authForgotLink) {
    authForgotLink.onclick = (e) => {
        e.preventDefault();
        setAuthMode('forgot');
    };
}

// Toggle back to Sign In
if (authBackLink) {
    authBackLink.onclick = (e) => {
        e.preventDefault();
        setAuthMode('signin');
    };
}

function setAuthMode(mode) {
    currentAuthMode = mode;
    authErrorMsg.style.display = 'none';

    if (mode === 'signin') {
        authModalTitle.innerText = 'Sign In';
        authTogglePrompt.innerText = "Don't have an account?";
        authToggleLink.innerText = 'Sign Up';
        authSubmitBtn.innerText = 'Sign In';
        
        // Show/Hide Fields
        authLoginFields.style.display = 'block';
        authForgotFields.style.display = 'none';
        authGoogleBlock.style.display = 'block';
        authToggleContainer.style.display = 'block';
        authBackContainer.style.display = 'none';

        // Set inputs required status
        authEmailInput.required = true;
        authPasswordInput.required = true;
        if (authResetEmailInput) authResetEmailInput.required = false;
    } else if (mode === 'signup') {
        authModalTitle.innerText = 'Create Account';
        authTogglePrompt.innerText = 'Already have an account?';
        authToggleLink.innerText = 'Sign In';
        authSubmitBtn.innerText = 'Sign Up';

        // Show/Hide Fields
        authLoginFields.style.display = 'block';
        authForgotFields.style.display = 'none';
        authGoogleBlock.style.display = 'block';
        authToggleContainer.style.display = 'block';
        authBackContainer.style.display = 'none';

        // Set inputs required status
        authEmailInput.required = true;
        authPasswordInput.required = true;
        if (authResetEmailInput) authResetEmailInput.required = false;
    } else if (mode === 'forgot') {
        authModalTitle.innerText = 'Reset Password';
        authSubmitBtn.innerText = 'Send Recovery Link';

        // Show/Hide Fields
        authLoginFields.style.display = 'none';
        authForgotFields.style.display = 'block';
        authGoogleBlock.style.display = 'none';
        authToggleContainer.style.display = 'none';
        authBackContainer.style.display = 'block';

        // Set inputs required status
        authEmailInput.required = false;
        authPasswordInput.required = false;
        if (authResetEmailInput) authResetEmailInput.required = true;
    }
}

function openAuthModal() {
    if (authModal) {
        setAuthMode('signin');
        authModal.classList.add('active');
    }
}

function closeAuthModal() {
    if (authModal) {
        authModal.classList.remove('active');
    }
}

// -------------------------------------------------------------
// GOOGLE SIGN-IN INTERACTIVE MOCK POPUP
// -------------------------------------------------------------
// Helper to complete Google login after success (mock or real)
async function handleGoogleLoginSuccess(payload) {
    showToast('Verifying Google credentials...', 'var(--accent-blue)');
    try {
        const res = await fetch(`${API_URL}/api/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || 'Google Authentication failed');
        }

        // Save Google user session
        localStorage.setItem(TOKEN_KEY, data.token);
        localStorage.setItem(EMAIL_KEY, data.user.email);

        showToast('Google Sign-In Successful!', 'var(--success)');
        closeAuthModal();
        window.location.href = 'dashboard.html';
    } catch (err) {
        alert("Google Authentication Error: " + err.message);
    }
}

if (btnGoogleSignin) {
    btnGoogleSignin.onclick = () => {
        if (googleTokenClient) {
            googleTokenClient.requestAccessToken();
            return;
        }

        // Fallback: interactive mock popup
        const width = 500;
        const height = 580;
        const left = (window.screen.width - width) / 2;
        const top = (window.screen.height - height) / 2;
        
        const popup = window.open("", "GoogleSignIn", `width=${width},height=${height},left=${left},top=${top}`);
        if (!popup) {
            alert("Please allow popups to sign in with Google.");
            return;
        }

        popup.document.write(`
            <html>
                <head>
                    <title>Sign in with Google</title>
                    <style>
                        body { font-family: -apple-system, sans-serif; background: #faf9f5; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; color: #1e293b; }
                        .card { background: #ffffff; border: 1px solid rgba(184,144,71,0.15); border-radius: 16px; padding: 2.5rem; width: 100%; max-width: 350px; box-shadow: 0 10px 25px rgba(0,0,0,0.05); text-align: center; }
                        input { width: 100%; padding: 0.75rem; border: 1px solid #e2e8f0; border-radius: 8px; margin: 1.25rem 0; font-size: 0.95rem; box-sizing: border-box; }
                        button { width: 100%; padding: 0.75rem; background: #4285f4; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
                        button:hover { background: #357ae8; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <svg width="40" height="40" viewBox="0 0 24 24" style="margin-bottom:1rem;"><path fill="#ea4335" d="M12 5.04c1.65 0 3.13.57 4.3 1.69l3.22-3.22C17.56 1.63 14.97 1 12 1 7.37 1 3.4 3.73 1.58 7.72l3.81 2.95C6.28 7.35 8.9 5.04 12 5.04z"/><path fill="#4285f4" d="M23.49 12.27c0-.81-.07-1.59-.2-2.35H12v4.51h6.46c-.29 1.48-1.14 2.73-2.43 3.56l3.77 2.92c2.2-2.03 3.49-5.02 3.49-8.64z"/><path fill="#34a853" d="M12 23c2.97 0 5.46-1.09 7.28-2.95l-3.77-2.92c-1.04.7-2.38 1.12-3.51 1.12-3.1 0-5.72-2.31-6.61-5.63l-3.81 2.95C3.4 20.27 7.37 23 12 23z"/><path fill="#fbbc05" d="M5.39 12.62a7.1 7.1 0 0 1 0-4.24l-3.81-2.95A11.96 11.96 0 0 0 1 12c0 2.45.74 4.74 2.01 6.66l3.81-2.95a7.1 7.1 0 0 1-.43-3.09z"/></svg>
                        <h2 style="font-size:1.25rem; margin-bottom: 0.25rem;">Sign in with Google</h2>
                        <p style="color:#64748b; font-size:0.85rem; margin:0;">to continue to Shyoski App</p>
                        <input type="email" id="google-email" value="googleuser@gmail.com" required>
                        <button id="btn-google-auth">Continue</button>
                    </div>
                    <script>
                        document.getElementById('btn-google-auth').onclick = function() {
                            const email = document.getElementById('google-email').value;
                            if (email) {
                                window.opener.postMessage({ type: 'google-login-success', email: email }, '*');
                                setTimeout(() => {
                                    window.close();
                                }, 100);
                            }
                        };
                    </script>
                </body>
            </html>
        `);
    };
}

// Message Listener for Google Sign-in Popup Completion (Mock fallback flow)
window.addEventListener('message', async (event) => {
    if (event.data && event.data.type === 'google-login-success') {
        const email = event.data.email;
        await handleGoogleLoginSuccess({ email });
    }
});

// Handle Auth Form Submission (Login, Register, and Forgot Password)
if (authForm) {
    authForm.onsubmit = async (e) => {
        e.preventDefault();
        authErrorMsg.style.display = 'none';
        authSubmitBtn.disabled = true;
        authSubmitBtn.innerText = 'Processing...';

        // 1. Forgot Password Submission
        if (currentAuthMode === 'forgot') {
            const email = authResetEmailInput.value;
            try {
                const res = await fetch(`${API_URL}/api/auth/forgot-password`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email })
                });

                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data.error || 'Failed to send recovery request');
                }

                // Show success feedback
                alert('Success: ' + data.message + '\n(For testing: Check Render/server logs to retrieve the recovery link!)');
                setAuthMode('signin');
            } catch (err) {
                authErrorMsg.innerText = err.message;
                authErrorMsg.style.display = 'block';
            } finally {
                authSubmitBtn.disabled = false;
                authSubmitBtn.innerText = 'Send Recovery Link';
            }
            return;
        }

        // 2. Standard Login / Register Submission
        const email = authEmailInput.value;
        const password = authPasswordInput.value;
        const endpoint = currentAuthMode === 'signin' ? '/api/auth/login' : '/api/auth/register';

        try {
            const res = await fetch(`${API_URL}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const data = await res.json();
            
            if (!res.ok) {
                throw new Error(data.error || 'Authentication failed');
            }

            // Save session
            localStorage.setItem(TOKEN_KEY, data.token);
            localStorage.setItem(EMAIL_KEY, data.user.email);

            closeAuthModal();
            window.location.href = 'dashboard.html';
        } catch (err) {
            authErrorMsg.innerText = err.message;
            authErrorMsg.style.display = 'block';
            authSubmitBtn.disabled = false;
            authSubmitBtn.innerText = currentAuthMode === 'signin' ? 'Sign In' : 'Sign Up';
        }
    };
}

// -------------------------------------------------------------
// USER PORTAL DASHBOARD CONTROLLER
// -------------------------------------------------------------
const userEmailSpan = document.getElementById('user-email');
const btnLogout = document.getElementById('btn-logout');
const licenseStatusVal = document.getElementById('license-status-val');
const licenseTypeVal = document.getElementById('license-type');
const licenseMinutesVal = document.getElementById('license-minutes');
const licenseQueriesVal = document.getElementById('license-queries');
const licenseExpiryVal = document.getElementById('license-expiry');
const feedbackMsg = document.getElementById('feedback-msg');

// Redirect from dashboard to home page if not authenticated
if (window.location.pathname.endsWith('dashboard.html')) {
    if (!getToken()) {
        window.location.href = 'index.html';
    } else {
        initDashboard();
    }
}

function initDashboard() {
    if (userEmailSpan) {
        userEmailSpan.innerText = getEmail();
    }
    syncLicenseState();
}

if (btnLogout) {
    btnLogout.onclick = () => {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(EMAIL_KEY);
        window.location.href = 'index.html';
    };
}

async function syncLicenseState() {
    const token = getToken();
    try {
        const res = await fetch(`${API_URL}/api/license/status`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ deviceId: 'web_dashboard' }) // Bypass single-device restriction on browser
        });

        if (!res.ok) {
            if (res.status === 401 || res.status === 403) {
                // Token invalid or expired, log out
                btnLogout.click();
                return;
            }
            throw new Error('Could not sync license status.');
        }

        const data = await res.json();
        updateDashboardUI(data);
    } catch (err) {
        showToast(err.message, 'var(--danger)');
    }
}

function updateDashboardUI(license) {
    if (!licenseStatusVal) return;

    // 1. Status Indicator
    licenseStatusVal.innerText = license.status.toUpperCase().replace('_', ' ');
    licenseStatusVal.className = 'license-status-val'; // Reset

    if (license.status === 'active') {
        licenseStatusVal.classList.add('active');
    } else if (license.status === 'expired') {
        licenseStatusVal.classList.add('expired');
    } else {
        licenseStatusVal.classList.add('trial');
    }

    // 2. Metrics
    licenseTypeVal.innerText = license.type.toUpperCase();
    licenseMinutesVal.innerText = `${Math.ceil(license.paid_minutes_left)} mins`;
    licenseQueriesVal.innerText = license.free_queries_left;

    // 3. Expiration Text
    if (license.expires_at) {
        const expiryDate = new Date(license.expires_at);
        licenseExpiryVal.innerText = expiryDate.toLocaleString();
    } else {
        licenseExpiryVal.innerText = license.type === 'hourly' ? 'No Expiry (Minutes Pool)' : 'Never';
    }
}

// -------------------------------------------------------------
// PLAN PURCHASING CONTROLLER
// -------------------------------------------------------------
document.querySelectorAll('.btn-plan-buy, .btn-dashboard-buy').forEach(btn => {
    btn.onclick = async () => {
        // Redirect to login modal if not authenticated on landing page
        if (!getToken()) {
            openAuthModal();
            return;
        }

        const plan = btn.getAttribute('data-plan');
        const originalText = btn.innerText;
        btn.disabled = true;
        btn.innerText = 'Connecting...';

        try {
            const token = getToken();
            const res = await fetch(`${API_URL}/api/payments/create-order`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ plan })
            });

            const orderData = await res.json();
            
            if (!res.ok) {
                throw new Error(orderData.error || 'Failed to create payment order');
            }

            btn.disabled = false;
            btn.innerText = originalText;

            if (orderData.simulated) {
                showToast(`Simulation checkout complete! Verifying...`, 'var(--warning)');
                
                // Instantly verify mock orders
                const verifyRes = await fetch(`${API_URL}/api/payments/verify`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        orderId: orderData.order_id,
                        paymentId: 'pay_simulated_web'
                    })
                });

                const verifyData = await verifyRes.json();
                if (verifyRes.ok && verifyData.success) {
                    showToast(`Successfully upgraded to ${plan.toUpperCase()}! (Sandbox Simulation)`, 'var(--success)');
                    if (window.location.pathname.endsWith('dashboard.html')) {
                        syncLicenseState();
                    } else {
                        window.location.href = 'dashboard.html';
                    }
                } else {
                    throw new Error(verifyData.error || 'Verification failed');
                }
            } else {
                // Trigger real Razorpay web SDK payment popover
                const options = {
                    key: orderData.key_id,
                    amount: orderData.amount,
                    currency: orderData.currency,
                    name: "Shyoski",
                    description: `Purchase ${plan.toUpperCase()} Subscription`,
                    order_id: orderData.order_id,
                    handler: async function (response) {
                        showToast('Payment successful. Verifying session...', 'var(--accent-glow)');
                        
                        try {
                            const verifyRes = await fetch(`${API_URL}/api/payments/verify`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${token}`
                                },
                                body: JSON.stringify({
                                    orderId: orderData.order_id,
                                    paymentId: response.razorpay_payment_id,
                                    signature: response.razorpay_signature
                                })
                            });

                            const verifyData = await verifyRes.json();
                            if (verifyRes.ok && verifyData.success) {
                                showToast('Payment verified! Pass activated.', 'var(--success)');
                                if (window.location.pathname.endsWith('dashboard.html')) {
                                    syncLicenseState();
                                } else {
                                    window.location.href = 'dashboard.html';
                                }
                            } else {
                                showToast(`Verification failed: ${verifyData.error}`, 'var(--danger)');
                            }
                        } catch (err) {
                            showToast('Verification failed due to connectivity issues.', 'var(--danger)');
                        }
                    },
                    prefill: {
                        email: getEmail()
                    },
                    theme: {
                        color: "#3b82f6"
                    }
                };

                const rzp = new Razorpay(options);
                rzp.open();
            }
        } catch (err) {
            showToast(err.message, 'var(--danger)');
            btn.disabled = false;
            btn.innerText = originalText;
        }
    };
});

// Helper to show visual toast alert
function showToast(msg, color) {
    if (!feedbackMsg) return;
    feedbackMsg.innerText = msg;
    feedbackMsg.style.background = color;
    feedbackMsg.style.color = '#ffffff';
    feedbackMsg.style.display = 'block';
    setTimeout(() => {
        feedbackMsg.style.display = 'none';
    }, 4500);
}
