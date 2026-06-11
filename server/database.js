const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const dbPath = path.resolve(__dirname, process.env.DATABASE_PATH || './database.sqlite');

// Create database file if not exists
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Failed to connect to SQLite database:', err.message);
    } else {
        console.log('📦 Connected to SQLite database at:', dbPath);
        initDb();
    }
});

function initDb() {
    db.serialize(() => {
        // Users table
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Licenses table (1-to-1 with user)
        db.run(`CREATE TABLE IF NOT EXISTS licenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER UNIQUE NOT NULL,
            status TEXT DEFAULT 'free_trial', -- 'free_trial', 'active', 'expired'
            type TEXT DEFAULT 'free',          -- 'free', 'hourly', 'daily', 'monthly', '3_months', '6_months', 'yearly'
            free_queries_left INTEGER DEFAULT 5,
            paid_minutes_left INTEGER DEFAULT 0,
            expires_at DATETIME,
            last_sync_time DATETIME DEFAULT CURRENT_TIMESTAMP,
            device_id TEXT,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )`);

        // Transactions table
        db.run(`CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            order_id TEXT UNIQUE NOT NULL,
            payment_id TEXT,
            amount INTEGER NOT NULL, -- in Paise (e.g., 3000 Rs = 300000 Paise)
            plan TEXT NOT NULL,
            status TEXT DEFAULT 'pending', -- 'pending', 'completed', 'failed'
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )`);

        console.log('✅ SQLite Database Tables Initialized');
    });
}

// Helper methods wrapped in Promises
const dbUtils = {
    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    },
    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    },
    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, changes: this.changes });
            });
        });
    },
    // Run transactions manually
    transaction(fn) {
        return new Promise((resolve, reject) => {
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                fn()
                    .then((res) => {
                        db.run('COMMIT');
                        resolve(res);
                    })
                    .catch((err) => {
                        db.run('ROLLBACK');
                        reject(err);
                    });
            });
        });
    }
};

module.exports = dbUtils;
