// Temporary migration endpoint - REMOVE AFTER USE
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../utils/auth-helpers');

// POST /api/run-google-migration (ADMIN only)
router.post('/run-google-migration', authenticateToken, async (req, res) => {
    try {
        // Only allow ADMIN to run migrations
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Only ADMIN can run migrations' });
        }

        const db = req.app.locals.db;
        const results = [];

        // Add Google OAuth columns
        try {
            await db.execute(`
                ALTER TABLE users
                ADD COLUMN google_id VARCHAR(255) DEFAULT NULL COMMENT 'Google account ID',
                ADD COLUMN google_email VARCHAR(255) DEFAULT NULL COMMENT 'Email from Google account',
                ADD COLUMN google_name VARCHAR(255) DEFAULT NULL COMMENT 'Name from Google account',
                ADD COLUMN google_picture TEXT DEFAULT NULL COMMENT 'Profile picture URL from Google',
                ADD COLUMN google_connected_at TIMESTAMP NULL DEFAULT NULL COMMENT 'When Google account was connected'
            `);
            results.push('✅ Added Google OAuth columns');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME') {
                results.push('ℹ️  Google OAuth columns already exist');
            } else {
                throw err;
            }
        }

        // Create unique index on google_id
        try {
            await db.execute('CREATE UNIQUE INDEX idx_google_id ON users(google_id)');
            results.push('✅ Created unique index on google_id');
        } catch (err) {
            if (err.code === 'ER_DUP_KEYNAME') {
                results.push('ℹ️  Index idx_google_id already exists');
            } else {
                throw err;
            }
        }

        // Create index on google_email
        try {
            await db.execute('CREATE INDEX idx_google_email ON users(google_email)');
            results.push('✅ Created index on google_email');
        } catch (err) {
            if (err.code === 'ER_DUP_KEYNAME') {
                results.push('ℹ️  Index idx_google_email already exists');
            } else {
                throw err;
            }
        }

        // Verify columns exist
        const [columns] = await db.execute("SHOW COLUMNS FROM users LIKE 'google_%'");

        res.json({
            success: true,
            message: 'Google OAuth migration completed',
            results: results,
            columns: columns.map(col => col.Field)
        });

    } catch (error) {
        console.error('Migration error:', error);
        res.status(500).json({
            error: 'Migration failed',
            message: error.message,
            code: error.code
        });
    }
});

// POST /api/run-booking-schedule-migration (ADMIN only)
router.post('/run-booking-schedule-migration', authenticateToken, async (req, res) => {
    try {
        // Only allow ADMIN to run migrations
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Only ADMIN can run migrations' });
        }

        const db = req.app.locals.db;
        const results = [];

        // Create booking_working_hours table
        try {
            await db.execute(`
                CREATE TABLE IF NOT EXISTS booking_working_hours (
                    id INT(11) NOT NULL AUTO_INCREMENT,
                    clinic_id INT(11) NOT NULL,
                    day_of_week ENUM('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday') NOT NULL,
                    is_working TINYINT(1) NOT NULL DEFAULT 1,
                    start_time TIME DEFAULT '09:00:00',
                    end_time TIME DEFAULT '20:00:00',
                    created_by INT(11) NOT NULL,
                    updated_by INT(11) DEFAULT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (id),
                    UNIQUE KEY clinic_day (clinic_id, day_of_week),
                    KEY fk_working_hours_clinic (clinic_id),
                    KEY fk_working_hours_creator (created_by),
                    KEY fk_working_hours_updater (updated_by),
                    CONSTRAINT fk_working_hours_clinic FOREIGN KEY (clinic_id) REFERENCES clinics (id) ON DELETE CASCADE,
                    CONSTRAINT fk_working_hours_creator FOREIGN KEY (created_by) REFERENCES users (id),
                    CONSTRAINT fk_working_hours_updater FOREIGN KEY (updated_by) REFERENCES users (id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            results.push('✅ Created booking_working_hours table');
        } catch (err) {
            if (err.code === 'ER_TABLE_EXISTS_ERROR') {
                results.push('ℹ️  booking_working_hours table already exists');
            } else {
                throw err;
            }
        }

        // Create booking_closed_dates table
        try {
            await db.execute(`
                CREATE TABLE IF NOT EXISTS booking_closed_dates (
                    id INT(11) NOT NULL AUTO_INCREMENT,
                    clinic_id INT(11) NOT NULL,
                    closed_date DATE NOT NULL,
                    reason VARCHAR(255) NOT NULL,
                    is_recurring TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'If true, repeats every year',
                    created_by INT(11) NOT NULL,
                    updated_by INT(11) DEFAULT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (id),
                    KEY idx_clinic_date (clinic_id, closed_date),
                    KEY fk_closed_dates_clinic (clinic_id),
                    KEY fk_closed_dates_creator (created_by),
                    KEY fk_closed_dates_updater (updated_by),
                    CONSTRAINT fk_closed_dates_clinic FOREIGN KEY (clinic_id) REFERENCES clinics (id) ON DELETE CASCADE,
                    CONSTRAINT fk_closed_dates_creator FOREIGN KEY (created_by) REFERENCES users (id),
                    CONSTRAINT fk_closed_dates_updater FOREIGN KEY (updated_by) REFERENCES users (id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            results.push('✅ Created booking_closed_dates table');
        } catch (err) {
            if (err.code === 'ER_TABLE_EXISTS_ERROR') {
                results.push('ℹ️  booking_closed_dates table already exists');
            } else {
                throw err;
            }
        }

        // Create booking_events table
        try {
            await db.execute(`
                CREATE TABLE IF NOT EXISTS booking_events (
                    id INT(11) NOT NULL AUTO_INCREMENT,
                    clinic_id INT(11) NOT NULL,
                    start_date DATE NOT NULL COMMENT 'Event start date',
                    end_date DATE NOT NULL COMMENT 'Event end date (same as start_date for single-day events)',
                    start_time TIME NOT NULL,
                    end_time TIME NOT NULL,
                    event_name VARCHAR(255) NOT NULL,
                    event_description TEXT DEFAULT NULL,
                    event_images TEXT DEFAULT NULL COMMENT 'JSON array of image paths',
                    price DECIMAL(10,2) DEFAULT 0.00 COMMENT 'Event price (0 = free)',
                    max_participants INT(11) DEFAULT NULL COMMENT 'NULL = unlimited',
                    is_public TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'Show on public booking page',
                    registration_required TINYINT(1) NOT NULL DEFAULT 1,
                    status ENUM('DRAFT', 'PUBLISHED', 'FULL', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
                    created_by INT(11) NOT NULL,
                    updated_by INT(11) DEFAULT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (id),
                    KEY idx_clinic_dates (clinic_id, start_date, end_date),
                    KEY idx_status (status),
                    KEY fk_events_clinic (clinic_id),
                    KEY fk_events_creator (created_by),
                    KEY fk_events_updater (updated_by),
                    CONSTRAINT fk_events_clinic FOREIGN KEY (clinic_id) REFERENCES clinics (id) ON DELETE CASCADE,
                    CONSTRAINT fk_events_creator FOREIGN KEY (created_by) REFERENCES users (id),
                    CONSTRAINT fk_events_updater FOREIGN KEY (updated_by) REFERENCES users (id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            results.push('✅ Created booking_events table');
        } catch (err) {
            if (err.code === 'ER_TABLE_EXISTS_ERROR') {
                results.push('ℹ️  booking_events table already exists');
                // Try to add new columns if table exists
                const alterStatements = [
                    { sql: 'ALTER TABLE booking_events ADD COLUMN end_date DATE DEFAULT NULL COMMENT "Event end date"', name: 'end_date' },
                    { sql: 'ALTER TABLE booking_events ADD COLUMN event_images TEXT DEFAULT NULL COMMENT "JSON array of image paths"', name: 'event_images' },
                    { sql: 'ALTER TABLE booking_events ADD COLUMN price DECIMAL(10,2) DEFAULT 0.00 COMMENT "Event price (0 = free)"', name: 'price' },
                    { sql: 'ALTER TABLE booking_events CHANGE COLUMN event_date start_date DATE NOT NULL COMMENT "Event start date"', name: 'start_date (rename from event_date)' }
                ];

                for (const stmt of alterStatements) {
                    try {
                        await db.execute(stmt.sql);
                        results.push(`✅ Added ${stmt.name} column`);
                    } catch (alterErr) {
                        if (alterErr.code === 'ER_DUP_FIELDNAME' || alterErr.code === 'ER_BAD_FIELD_ERROR') {
                            results.push(`ℹ️  ${stmt.name} column already exists or not needed`);
                        } else {
                            console.log(`Warning: Could not alter ${stmt.name}:`, alterErr.message);
                        }
                    }
                }
            } else {
                throw err;
            }
        }

        // Create booking_event_registrations table
        try {
            await db.execute(`
                CREATE TABLE IF NOT EXISTS booking_event_registrations (
                    id INT(11) NOT NULL AUTO_INCREMENT,
                    event_id INT(11) NOT NULL,
                    participant_name VARCHAR(255) NOT NULL,
                    participant_email VARCHAR(255) NOT NULL,
                    participant_phone VARCHAR(20) DEFAULT NULL,
                    notes TEXT DEFAULT NULL,
                    status ENUM('REGISTERED', 'CONFIRMED', 'CANCELLED', 'ATTENDED') NOT NULL DEFAULT 'REGISTERED',
                    client_ip_address VARCHAR(45) DEFAULT NULL,
                    registered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (id),
                    KEY idx_event_id (event_id),
                    KEY idx_email (participant_email),
                    CONSTRAINT fk_event_registrations_event FOREIGN KEY (event_id) REFERENCES booking_events (id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            results.push('✅ Created booking_event_registrations table');
        } catch (err) {
            if (err.code === 'ER_TABLE_EXISTS_ERROR') {
                results.push('ℹ️  booking_event_registrations table already exists');
            } else {
                throw err;
            }
        }

        // Create booking_special_hours table (for overriding default schedule on specific dates)
        try {
            await db.execute(`
                CREATE TABLE IF NOT EXISTS booking_special_hours (
                    id INT(11) NOT NULL AUTO_INCREMENT,
                    clinic_id INT(11) NOT NULL,
                    special_date DATE NOT NULL COMMENT 'Specific date to override default schedule',
                    is_open TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = Open with custom hours, 0 = Closed',
                    start_time TIME DEFAULT NULL COMMENT 'Custom opening time',
                    end_time TIME DEFAULT NULL COMMENT 'Custom closing time',
                    reason VARCHAR(255) DEFAULT NULL COMMENT 'Reason for special hours',
                    created_by INT(11) NOT NULL,
                    updated_by INT(11) DEFAULT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (id),
                    UNIQUE KEY clinic_date (clinic_id, special_date),
                    KEY idx_clinic_date (clinic_id, special_date),
                    KEY fk_special_hours_clinic (clinic_id),
                    KEY fk_special_hours_creator (created_by),
                    KEY fk_special_hours_updater (updated_by),
                    CONSTRAINT fk_special_hours_clinic FOREIGN KEY (clinic_id) REFERENCES clinics (id) ON DELETE CASCADE,
                    CONSTRAINT fk_special_hours_creator FOREIGN KEY (created_by) REFERENCES users (id),
                    CONSTRAINT fk_special_hours_updater FOREIGN KEY (updated_by) REFERENCES users (id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            results.push('✅ Created booking_special_hours table');
        } catch (err) {
            if (err.code === 'ER_TABLE_EXISTS_ERROR') {
                results.push('ℹ️  booking_special_hours table already exists');
            } else {
                throw err;
            }
        }

        // Insert default working hours for clinic 1
        try {
            await db.execute(`
                INSERT IGNORE INTO booking_working_hours (clinic_id, day_of_week, is_working, start_time, end_time, created_by) VALUES
                (1, 'Monday', 1, '09:00:00', '20:00:00', 1),
                (1, 'Tuesday', 1, '09:00:00', '20:00:00', 1),
                (1, 'Wednesday', 1, '09:00:00', '20:00:00', 1),
                (1, 'Thursday', 1, '09:00:00', '20:00:00', 1),
                (1, 'Friday', 1, '09:00:00', '20:00:00', 1),
                (1, 'Saturday', 1, '09:00:00', '20:00:00', 1),
                (1, 'Sunday', 0, '09:00:00', '20:00:00', 1)
            `);
            results.push('✅ Inserted default working hours for clinic 1');
        } catch (err) {
            results.push(`ℹ️  Default working hours may already exist: ${err.message}`);
        }

        res.json({
            success: true,
            message: 'Booking schedule migration completed successfully',
            results: results
        });

    } catch (error) {
        console.error('Booking schedule migration error:', error);
        res.status(500).json({
            error: 'Migration failed',
            message: error.message,
            code: error.code,
            sqlMessage: error.sqlMessage
        });
    }
});

// POST /api/run-line-integration-migration (ADMIN only)
router.post('/run-line-integration-migration', authenticateToken, async (req, res) => {
    try {
        // Only allow ADMIN to run migrations
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Only ADMIN can run migrations' });
        }

        const db = req.app.locals.db;
        const results = [];

        // Add LINE user_id column to patients table
        try {
            await db.execute(`
                ALTER TABLE patients
                ADD COLUMN line_user_id VARCHAR(255) DEFAULT NULL COMMENT 'LINE User ID for LINE OA integration',
                ADD COLUMN line_display_name VARCHAR(255) DEFAULT NULL COMMENT 'LINE display name',
                ADD COLUMN line_picture_url TEXT DEFAULT NULL COMMENT 'LINE profile picture URL',
                ADD COLUMN line_connected_at TIMESTAMP NULL DEFAULT NULL COMMENT 'When LINE was connected'
            `);
            results.push('✅ Added LINE integration columns to patients table');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME') {
                results.push('ℹ️  LINE integration columns already exist in patients table');
            } else {
                throw err;
            }
        }

        // Create unique index on line_user_id
        try {
            await db.execute('CREATE UNIQUE INDEX idx_line_user_id ON patients(line_user_id)');
            results.push('✅ Created unique index on line_user_id');
        } catch (err) {
            if (err.code === 'ER_DUP_KEYNAME') {
                results.push('ℹ️  Index idx_line_user_id already exists');
            } else {
                throw err;
            }
        }

        // Create OTP verification table
        try {
            await db.execute(`
                CREATE TABLE IF NOT EXISTS line_otp_verifications (
                    id INT(11) NOT NULL AUTO_INCREMENT,
                    phone VARCHAR(20) NOT NULL COMMENT 'Phone number for OTP',
                    otp_code VARCHAR(6) NOT NULL COMMENT '6-digit OTP code',
                    line_user_id VARCHAR(255) NOT NULL COMMENT 'LINE User ID from LIFF',
                    is_verified TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Whether OTP was verified',
                    verified_at TIMESTAMP NULL DEFAULT NULL COMMENT 'When OTP was verified',
                    expires_at TIMESTAMP NOT NULL COMMENT 'OTP expiration time',
                    attempts INT(11) NOT NULL DEFAULT 0 COMMENT 'Number of verification attempts',
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (id),
                    KEY idx_phone_line (phone, line_user_id),
                    KEY idx_expires (expires_at),
                    KEY idx_line_user (line_user_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            results.push('✅ Created line_otp_verifications table');
        } catch (err) {
            if (err.code === 'ER_TABLE_EXISTS_ERROR') {
                results.push('ℹ️  line_otp_verifications table already exists');
            } else {
                throw err;
            }
        }

        // Verify columns exist
        const [columns] = await db.execute("SHOW COLUMNS FROM patients LIKE 'line_%'");

        res.json({
            success: true,
            message: 'LINE integration migration completed successfully',
            results: results,
            columns: columns.map(col => col.Field)
        });

    } catch (error) {
        console.error('LINE migration error:', error);
        res.status(500).json({
            error: 'Migration failed',
            message: error.message,
            code: error.code,
            sqlMessage: error.sqlMessage
        });
    }
});

module.exports = router;
