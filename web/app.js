// Configuration: Autodetect backend environment
const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:5005'
    : 'https://shysoki-api.onrender.com';

// Local Storage Session Keys
const TOKEN_KEY = 'shyoski_user_token';
const EMAIL_KEY = 'shyoski_user_email';

// State Helper
function getToken() {
    return localStorage.getItem(TOKEN_KEY);
}

function getEmail() {
    return localStorage.getItem(EMAIL_KEY);
}

// -------------------------------------------------------------
// LANDING PAGE & MODAL CONTROLLER
// -------------------------------------------------------------
const authModal = document.getElementById('auth-modal');
const btnLoginTrigger = document.getElementById('btn-login-trigger');
const btnModalClose = document.getElementById('btn-modal-close');
const authForm = document.getElementById('auth-form');
const authEmailInput = document.getElementById('auth-email');
const authPasswordInput = document.getElementById('auth-password');
const authErrorMsg = document.getElementById('auth-error-msg');
const authSubmitBtn = document.getElementById('btn-auth-submit');
const authToggleLink = document.getElementById('auth-toggle-link');
const authTogglePrompt = document.getElementById('auth-toggle-prompt');
const authModalTitle = document.getElementById('auth-modal-title');
const navDashboardLink = document.getElementById('nav-dashboard-link');

let currentAuthMode = 'signin'; // 'signin' or 'signup'

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

if (authToggleLink) {
    authToggleLink.onclick = (e) => {
        e.preventDefault();
        if (currentAuthMode === 'signin') {
            currentAuthMode = 'signup';
            authModalTitle.innerText = 'Create Account';
            authTogglePrompt.innerText = 'Already have an account?';
            authToggleLink.innerText = 'Sign In';
            authSubmitBtn.innerText = 'Sign Up';
        } else {
            currentAuthMode = 'signin';
            authModalTitle.innerText = 'Sign In';
            authTogglePrompt.innerText = "Don't have an account?";
            authToggleLink.innerText = 'Sign Up';
            authSubmitBtn.innerText = 'Sign In';
        }
    };
}

function openAuthModal() {
    if (authModal) {
        authErrorMsg.style.display = 'none';
        authModal.classList.add('active');
    }
}

function closeAuthModal() {
    if (authModal) {
        authModal.classList.remove('active');
    }
}

// Handle Auth Form Submission
if (authForm) {
    authForm.onsubmit = async (e) => {
        e.preventDefault();
        authErrorMsg.style.display = 'none';
        authSubmitBtn.disabled = true;
        authSubmitBtn.innerText = 'Processing...';

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
