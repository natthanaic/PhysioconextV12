const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
const querystring = require('querystring');

// Helper function to get Thaibulk SMS credentials from database
async function getThaibulkCredentials(db) {
    try {
        const [settings] = await db.execute(
            `SELECT setting_value FROM notification_settings
             WHERE setting_type = 'sms' LIMIT 1`
        );

        if (settings.length === 0) {
            console.error('No SMS settings found in database');
            return null;
        }

        const smsSettings = JSON.parse(settings[0].setting_value);

        // Map the settings to Thaibulk credentials
        const credentials = {
            apiKey: smsSettings.api_key || smsSettings.apiKey,
            apiSecret: smsSettings.api_secret || smsSettings.apiSecret,
            sender: smsSettings.sender || 'PhysioCon',
            smsType: smsSettings.smsType || 'standard'
        };

        return credentials;
    } catch (error) {
        console.error('Error fetching Thaibulk credentials:', error);
        return null;
    }
}

// GET /api/line/check-registration - Check if LINE ID is already registered
router.get('/check-registration', async (req, res) => {
    try {
        const { line_user_id } = req.query;

        if (!line_user_id) {
            return res.status(400).json({ error: 'LINE User ID is required' });
        }

        const db = req.app.locals.db;

        // Check if LINE User ID exists in patients table
        const [patients] = await db.execute(
            'SELECT id, first_name, last_name, phone, line_display_name FROM patients WHERE line_user_id = ?',
            [line_user_id]
        );

        if (patients.length > 0) {
            return res.json({
                registered: true,
                patient: {
                    id: patients[0].id,
                    name: `${patients[0].first_name} ${patients[0].last_name}`,
                    phone: patients[0].phone,
                    line_display_name: patients[0].line_display_name
                }
            });
        }

        res.json({ registered: false });

    } catch (error) {
        console.error('Error checking LINE registration:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/line/verify-pid - Verify patient by PID or Passport
router.post('/verify-pid', async (req, res) => {
    try {
        const { pid_passport } = req.body;

        if (!pid_passport) {
            return res.status(400).json({ error: 'PID or Passport is required' });
        }

        const db = req.app.locals.db;

        // Search for patient by PID or Passport (check both pid and passport_no fields)
        const [patients] = await db.execute(
            `SELECT id, hn, pt_number, first_name, last_name, phone, email,
             pid, passport_no, dob as date_of_birth, gender,
             line_user_id, line_display_name, line_picture_url
             FROM patients
             WHERE pid = ? OR passport_no = ?
             LIMIT 1`,
            [pid_passport, pid_passport]
        );

        if (patients.length === 0) {
            return res.status(404).json({
                error: 'ไม่พบข้อมูลผู้ป่วยในระบบ',
                message: 'Patient not found. Please register at the clinic first.'
            });
        }

        const patient = patients[0];

        // Check if this patient is already linked to a LINE account
        if (patient.line_user_id) {
            return res.status(400).json({
                error: 'บัตรประชาชน/พาสปอร์ตนี้ถูกเชื่อมต่อกับ LINE ID อื่นแล้ว',
                message: 'This PID/Passport is already linked to another LINE account.'
            });
        }

        // Return patient data for confirmation
        res.json({
            success: true,
            patient: {
                id: patient.id,
                hn: patient.hn || patient.pt_number,
                first_name: patient.first_name,
                last_name: patient.last_name,
                phone: patient.phone,
                email: patient.email,
                date_of_birth: patient.date_of_birth,
                gender: patient.gender
            }
        });

    } catch (error) {
        console.error('Error verifying PID:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/line/send-otp - Send OTP via Thaibulk SMS
router.post('/send-otp', async (req, res) => {
    try {
        const { phone, patient_id, line_user_id, line_display_name, line_picture_url } = req.body;

        // Validate input
        if (!phone || !line_user_id || !patient_id) {
            return res.status(400).json({ error: 'Phone, Patient ID, and LINE User ID are required' });
        }

        // Validate phone format (Thai mobile: 0XXXXXXXXX)
        if (!/^0[0-9]{9}$/.test(phone)) {
            return res.status(400).json({ error: 'Invalid phone number format' });
        }

        const db = req.app.locals.db;

        // Verify that patient exists and is not already linked to another LINE account
        const [patients] = await db.execute(
            'SELECT id, line_user_id FROM patients WHERE id = ?',
            [patient_id]
        );

        if (patients.length === 0) {
            return res.status(404).json({ error: 'Patient not found' });
        }

        if (patients[0].line_user_id && patients[0].line_user_id !== line_user_id) {
            return res.status(400).json({
                error: 'ผู้ป่วยนี้ถูกเชื่อมต่อกับ LINE ID อื่นแล้ว'
            });
        }

        // Generate 6-digit OTP
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

        // Calculate expiration (5 minutes from now)
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

        // Delete old OTP records for this LINE user
        await db.execute(
            'DELETE FROM line_otp_verifications WHERE line_user_id = ?',
            [line_user_id]
        );

        // Insert new OTP record with patient_id stored in phone field temporarily
        // (We'll use patient_id:phone format to store both)
        const otpData = `${patient_id}:${phone}`;
        await db.execute(
            `INSERT INTO line_otp_verifications
            (phone, otp_code, line_user_id, expires_at)
            VALUES (?, ?, ?, ?)`,
            [otpData, otpCode, line_user_id, expiresAt]
        );

        // Get Thaibulk credentials from database
        const credentials = await getThaibulkCredentials(db);

        console.log('📱 SMS Credentials Check:', {
            hasCredentials: !!credentials,
            hasApiKey: credentials ? !!credentials.apiKey : false,
            hasApiSecret: credentials ? !!credentials.apiSecret : false,
            hasSender: credentials ? !!credentials.sender : false
        });

        if (!credentials || !credentials.apiKey || !credentials.apiSecret) {
            console.error('❌ SMS credentials missing or incomplete');
            return res.status(500).json({
                error: 'ไม่พบการตั้งค่า SMS กรุณาติดต่อผู้ดูแลระบบ',
                debug: process.env.NODE_ENV === 'development' ? 'SMS credentials not configured' : undefined
            });
        }

        // Send SMS via Thaibulk
        console.log('📤 Sending OTP SMS to:', phone);
        const smsResult = await sendSMSViaThaibulk(phone, otpCode, credentials);

        console.log('📬 SMS Result:', {
            success: smsResult.success,
            error: smsResult.error || 'none'
        });

        if (!smsResult.success) {
            console.error('❌ SMS sending failed:', smsResult.error);
            return res.status(500).json({
                error: 'ไม่สามารถส่ง SMS ได้ กรุณาลองใหม่อีกครั้ง',
                errorDetails: smsResult.error,
                debugInfo: {
                    phone: phone,
                    hasCredentials: !!credentials,
                    timestamp: new Date().toISOString()
                }
            });
        }

        res.json({
            success: true,
            message: 'OTP sent successfully',
            expires_in_minutes: 5
        });

    } catch (error) {
        console.error('Error sending OTP:', error);
        res.status(500).json({
            error: 'Internal server error',
            errorDetails: error.message,
            stack: error.stack
        });
    }
});

// POST /api/line/verify-otp - Verify OTP and link LINE account
router.post('/verify-otp', async (req, res) => {
    try {
        const { patient_id, otp_code, line_user_id, line_display_name, line_picture_url, phone, email } = req.body;

        // Validate input
        if (!patient_id || !otp_code || !line_user_id || !phone) {
            return res.status(400).json({ error: 'Patient ID, OTP code, phone, and LINE User ID are required' });
        }

        const db = req.app.locals.db;

        // Get OTP record for this LINE user
        const [otpRecords] = await db.execute(
            `SELECT * FROM line_otp_verifications
            WHERE line_user_id = ? AND is_verified = 0
            ORDER BY created_at DESC LIMIT 1`,
            [line_user_id]
        );

        if (otpRecords.length === 0) {
            return res.status(400).json({ error: 'ไม่พบรหัส OTP กรุณาขอรหัสใหม่' });
        }

        const otpRecord = otpRecords[0];

        // Parse patient_id and phone from stored OTP data
        const otpData = otpRecord.phone.split(':');
        const storedPatientId = otpData[0];
        const storedPhone = otpData[1];

        // Verify that the patient_id matches
        if (storedPatientId !== patient_id.toString()) {
            return res.status(400).json({ error: 'ข้อมูลผู้ป่วยไม่ตรงกัน' });
        }

        // Check if OTP is expired
        if (new Date() > new Date(otpRecord.expires_at)) {
            return res.status(400).json({ error: 'รหัส OTP หมดอายุแล้ว กรุณาขอรหัสใหม่' });
        }

        // Check attempts (max 5)
        if (otpRecord.attempts >= 5) {
            return res.status(400).json({ error: 'ความพยายามเกินกำหนด กรุณาขอรหัส OTP ใหม่' });
        }

        // Verify OTP code
        if (otpRecord.otp_code !== otp_code) {
            // Increment attempts
            await db.execute(
                'UPDATE line_otp_verifications SET attempts = attempts + 1 WHERE id = ?',
                [otpRecord.id]
            );

            return res.status(400).json({
                error: 'รหัส OTP ไม่ถูกต้อง',
                attempts_left: 5 - (otpRecord.attempts + 1)
            });
        }

        // OTP is valid - mark as verified
        await db.execute(
            'UPDATE line_otp_verifications SET is_verified = 1, verified_at = NOW() WHERE id = ?',
            [otpRecord.id]
        );

        // Get the specific patient by ID
        const [patients] = await db.execute(
            'SELECT * FROM patients WHERE id = ? LIMIT 1',
            [patient_id]
        );

        if (patients.length === 0) {
            return res.status(404).json({
                error: 'ไม่พบข้อมูลผู้ป่วย',
                message: 'Patient not found'
            });
        }

        // Patient exists - update LINE info
        const patient = patients[0];

        // Check if this patient is already linked to another LINE account
        if (patient.line_user_id && patient.line_user_id !== line_user_id) {
            return res.status(400).json({
                error: 'ผู้ป่วยนี้ถูกเชื่อมต่อกับ LINE ID อื่นแล้ว'
            });
        }

        // Update patient with LINE info, phone, and email
        await db.execute(
            `UPDATE patients SET
            line_user_id = ?,
            line_display_name = ?,
            line_picture_url = ?,
            line_connected_at = NOW(),
            phone = ?,
            email = ?
            WHERE id = ?`,
            [line_user_id, line_display_name, line_picture_url, phone, email || null, patient.id]
        );

        res.json({
            success: true,
            message: 'LINE account linked successfully',
            patient: {
                id: patient.id,
                name: `${patient.first_name} ${patient.last_name}`,
                phone: patient.phone
            }
        });

    } catch (error) {
        console.error('Error verifying OTP:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Helper function to send SMS via Thaibulk
async function sendSMSViaThaibulk(phone, otpCode, credentials) {
    try {
        const message = `รหัส OTP ของคุณคือ: ${otpCode}\nรหัสนี้จะหมดอายุใน 5 นาที\n- PhysioConext`;

        console.log('Sending SMS with credentials:', {
            apiKey: credentials.apiKey ? 'SET' : 'MISSING',
            apiSecret: credentials.apiSecret ? 'SET' : 'MISSING',
            sender: credentials.sender,
            smsType: credentials.smsType
        });

        // Create Basic Auth header (apiKey:apiSecret in base64)
        const authString = Buffer.from(`${credentials.apiKey}:${credentials.apiSecret}`).toString('base64');

        // Thaibulk API endpoint (v2 with hyphen)
        const url = 'https://api-v2.thaibulksms.com/sms';

        // Send as form-encoded data, not JSON
        const response = await axios.post(
            url,
            querystring.stringify({
                msisdn: phone,
                message: message,
                sender: credentials.sender || 'PhysioCon',
                force: credentials.smsType || 'standard'  // Use configured type (corporate/standard)
            }),
            {
                headers: {
                    'accept': 'application/json',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${authString}`
                }
            }
        );

        console.log('Thaibulk SMS Response:', response.data);

        // Success if no error code
        if (response.data && response.data.code === undefined) {
            return { success: true, data: response.data };
        } else if (response.data && response.data.code) {
            console.error('Thaibulk SMS Error:', response.data);
            return { success: false, error: response.data.description || 'SMS API error' };
        } else {
            return { success: true, data: response.data };
        }

    } catch (error) {
        console.error('Error sending SMS via Thaibulk:', error.message);
        if (error.response) {
            console.error('Thaibulk API Error Response:', error.response.data);
        }
        return { success: false, error: error.message };
    }
}

// GET /api/line/my-info - Get patient info by LINE User ID
router.get('/my-info', async (req, res) => {
    try {
        const { line_user_id } = req.query;

        if (!line_user_id) {
            return res.status(400).json({ error: 'LINE User ID is required' });
        }

        const db = req.app.locals.db;

        const [patients] = await db.execute(
            `SELECT id, hn, pt_number, first_name, last_name, phone, email,
            line_display_name, line_picture_url, line_connected_at
            FROM patients WHERE line_user_id = ?`,
            [line_user_id]
        );

        if (patients.length === 0) {
            return res.status(404).json({ error: 'Patient not found' });
        }

        res.json({
            success: true,
            patient: patients[0]
        });

    } catch (error) {
        console.error('Error getting patient info:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/line/my-pn-cases - Get patient's PN cases
router.get('/my-pn-cases', async (req, res) => {
    try {
        const { line_user_id } = req.query;

        if (!line_user_id) {
            return res.status(400).json({ error: 'LINE User ID is required' });
        }

        const db = req.app.locals.db;

        // Get patient ID first
        const [patients] = await db.execute(
            'SELECT id FROM patients WHERE line_user_id = ?',
            [line_user_id]
        );

        if (patients.length === 0) {
            return res.status(404).json({ error: 'Patient not found' });
        }

        const patientId = patients[0].id;

        // Get PN cases
        const [pnCases] = await db.execute(
            `SELECT id, pn_type, pn_date, chief_complaint, diagnosis,
            treatment_plan, created_at, updated_at
            FROM pn_cases
            WHERE patient_id = ?
            ORDER BY pn_date DESC, created_at DESC`,
            [patientId]
        );

        res.json({
            success: true,
            pn_cases: pnCases
        });

    } catch (error) {
        console.error('Error getting PN cases:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/line/my-appointments - Get patient's appointments
router.get('/my-appointments', async (req, res) => {
    try {
        const { line_user_id } = req.query;

        if (!line_user_id) {
            return res.status(400).json({ error: 'LINE User ID is required' });
        }

        const db = req.app.locals.db;

        // Get patient ID first
        const [patients] = await db.execute(
            'SELECT id FROM patients WHERE line_user_id = ?',
            [line_user_id]
        );

        if (patients.length === 0) {
            return res.status(404).json({ error: 'Patient not found' });
        }

        const patientId = patients[0].id;

        // Get appointments
        const [appointments] = await db.execute(
            `SELECT a.id, a.appointment_date, a.appointment_time, a.status,
            a.notes, a.created_at,
            s.name as service_name,
            u.first_name as pt_first_name, u.last_name as pt_last_name
            FROM appointments a
            LEFT JOIN services s ON a.service_id = s.id
            LEFT JOIN users u ON a.pt_id = u.id
            WHERE a.patient_id = ?
            ORDER BY a.appointment_date DESC, a.appointment_time DESC`,
            [patientId]
        );

        res.json({
            success: true,
            appointments: appointments
        });

    } catch (error) {
        console.error('Error getting appointments:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/line/my-bills - Get patient's bills
router.get('/my-bills', async (req, res) => {
    try {
        const { line_user_id } = req.query;

        if (!line_user_id) {
            return res.status(400).json({ error: 'LINE User ID is required' });
        }

        const db = req.app.locals.db;

        // Get patient ID first
        const [patients] = await db.execute(
            'SELECT id FROM patients WHERE line_user_id = ?',
            [line_user_id]
        );

        if (patients.length === 0) {
            return res.status(404).json({ error: 'Patient not found' });
        }

        const patientId = patients[0].id;

        // Get bills
        const [bills] = await db.execute(
            `SELECT id, bill_number, bill_date, total_amount, paid_amount,
            status, payment_method, payment_date, created_at
            FROM bills
            WHERE patient_id = ?
            ORDER BY bill_date DESC, created_at DESC`,
            [patientId]
        );

        res.json({
            success: true,
            bills: bills
        });

    } catch (error) {
        console.error('Error getting bills:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/line/test-sms - Test SMS settings (for debugging)
router.get('/test-sms', async (req, res) => {
    try {
        const db = req.app.locals.db;

        // Test 1: Check if SMS settings exist
        const [settings] = await db.execute(
            `SELECT setting_value FROM notification_settings WHERE setting_type = 'sms' LIMIT 1`
        );

        const diagnostics = {
            timestamp: new Date().toISOString(),
            tests: []
        };

        // Test 1: SMS Settings exist?
        if (settings.length === 0) {
            diagnostics.tests.push({
                name: 'SMS Settings Exist',
                status: 'FAIL',
                message: 'No SMS settings found in database',
                fix: 'Go to Admin > Notification Settings > SMS tab and save your settings'
            });
            return res.json(diagnostics);
        }

        diagnostics.tests.push({
            name: 'SMS Settings Exist',
            status: 'PASS',
            message: 'SMS settings found in database'
        });

        // Test 2: Parse SMS settings
        let smsSettings;
        try {
            smsSettings = JSON.parse(settings[0].setting_value);
            diagnostics.tests.push({
                name: 'Parse SMS Settings',
                status: 'PASS',
                message: 'SMS settings JSON parsed successfully'
            });
        } catch (e) {
            diagnostics.tests.push({
                name: 'Parse SMS Settings',
                status: 'FAIL',
                message: 'Failed to parse SMS settings JSON: ' + e.message,
                fix: 'Re-save your SMS settings from admin panel'
            });
            return res.json(diagnostics);
        }

        // Test 3: Check credentials
        const credentials = await getThaibulkCredentials(db);

        if (!credentials) {
            diagnostics.tests.push({
                name: 'Get Thaibulk Credentials',
                status: 'FAIL',
                message: 'Failed to get Thaibulk credentials',
                fix: 'Check SMS settings in admin panel'
            });
            return res.json(diagnostics);
        }

        diagnostics.tests.push({
            name: 'Get Thaibulk Credentials',
            status: 'PASS',
            message: 'Credentials retrieved successfully',
            details: {
                hasApiKey: !!credentials.apiKey,
                hasApiSecret: !!credentials.apiSecret,
                sender: credentials.sender || 'NOT SET',
                apiKeyLength: credentials.apiKey ? credentials.apiKey.length : 0,
                apiSecretLength: credentials.apiSecret ? credentials.apiSecret.length : 0
            }
        });

        // Test 4: Check required fields
        const missingFields = [];
        if (!credentials.apiKey) missingFields.push('apiKey');
        if (!credentials.apiSecret) missingFields.push('apiSecret');

        if (missingFields.length > 0) {
            diagnostics.tests.push({
                name: 'Validate Required Fields',
                status: 'FAIL',
                message: 'Missing required fields: ' + missingFields.join(', '),
                fix: 'Go to Admin > Notification Settings > SMS tab and fill in all fields'
            });
        } else {
            diagnostics.tests.push({
                name: 'Validate Required Fields',
                status: 'PASS',
                message: 'All required fields present'
            });
        }

        // Test 5: Check modules
        try {
            const testAuth = Buffer.from(`${credentials.apiKey}:${credentials.apiSecret}`).toString('base64');
            diagnostics.tests.push({
                name: 'Module Availability',
                status: 'PASS',
                message: 'axios, querystring, and Buffer modules available'
            });
        } catch (e) {
            diagnostics.tests.push({
                name: 'Module Availability',
                status: 'FAIL',
                message: 'Module error: ' + e.message
            });
        }

        // Summary
        const failCount = diagnostics.tests.filter(t => t.status === 'FAIL').length;
        diagnostics.summary = {
            total: diagnostics.tests.length,
            passed: diagnostics.tests.length - failCount,
            failed: failCount,
            overallStatus: failCount === 0 ? 'READY' : 'NOT READY'
        };

        res.json(diagnostics);

    } catch (error) {
        res.status(500).json({
            error: 'Test failed',
            message: error.message,
            stack: error.stack
        });
    }
});

// GET /api/line/test-send-sms?phone=0630804644 - Actually send a test SMS
router.get('/test-send-sms', async (req, res) => {
    try {
        const { phone } = req.query;

        if (!phone) {
            return res.json({
                error: 'Please provide phone number',
                example: '/api/line/test-send-sms?phone=0630804644'
            });
        }

        const db = req.app.locals.db;

        // Get credentials
        const credentials = await getThaibulkCredentials(db);

        if (!credentials || !credentials.apiKey || !credentials.apiSecret) {
            return res.json({
                success: false,
                error: 'SMS credentials not configured',
                credentials: {
                    hasApiKey: !!credentials?.apiKey,
                    hasApiSecret: !!credentials?.apiSecret
                }
            });
        }

        // Try to send actual SMS
        const testOTP = '123456';
        const result = await sendSMSViaThaibulk(phone, testOTP, credentials);

        res.json({
            success: result.success,
            phone: phone,
            testOTP: testOTP,
            credentials: {
                apiKeyLength: credentials.apiKey.length,
                apiSecretLength: credentials.apiSecret.length,
                sender: credentials.sender
            },
            thaibulkResponse: result.data || result.error,
            rawResult: result
        });

    } catch (error) {
        res.status(500).json({
            error: 'Test failed',
            message: error.message,
            stack: error.stack
        });
    }
});

module.exports = router;
