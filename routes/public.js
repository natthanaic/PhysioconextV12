// routes/public.js - Public-facing booking routes (no authentication required)
const express = require('express');
const router = express.Router();

// ========================================
// HELPER FUNCTIONS
// ========================================

/**
 * Get client IP address from request
 * Handles proxy headers and direct connections
 */
const getClientIP = (req) => {
    return req.headers['x-forwarded-for']?.split(',')[0].trim() ||
           req.headers['x-real-ip'] ||
           req.connection.remoteAddress ||
           req.socket.remoteAddress ||
           req.ip;
};

/**
 * Create a Google Calendar event for an appointment
 * @param {Object} db - Database connection
 * @param {Object} appointmentData - Appointment details
 * @returns {string|null} Calendar event ID or null
 */
const createGoogleCalendarEvent = async (db, appointmentData) => {
    try {
        // Get Google Calendar settings
        const [settings] = await db.execute(`
            SELECT setting_value FROM notification_settings WHERE setting_type = 'google_calendar' LIMIT 1
        `);

        if (settings.length === 0) {
            console.log('Google Calendar: No settings configured');
            return null;
        }

        const calendarConfig = JSON.parse(settings[0].setting_value);

        // Check if Google Calendar is enabled
        if (!calendarConfig.enabled || calendarConfig.enabled === '0') {
            console.log('Google Calendar: Service is disabled');
            return null;
        }

        // Validate required settings
        if (!calendarConfig.serviceAccountEmail || !calendarConfig.privateKey || !calendarConfig.calendarId) {
            console.error('Google Calendar: Missing required configuration');
            return null;
        }

        // Validate private key format
        const privateKey = calendarConfig.privateKey.trim();
        if (!privateKey.includes('-----BEGIN PRIVATE KEY-----') || !privateKey.includes('-----END PRIVATE KEY-----')) {
            console.error('Google Calendar: Invalid private key format');
            return null;
        }

        // Import Google Calendar API
        const { google } = require('googleapis');

        // Process the private key - replace literal \n with actual newlines and trim
        let processedKey = privateKey;
        if (privateKey.includes('\\n')) {
            processedKey = privateKey.replace(/\\n/g, '\n');
        }
        processedKey = processedKey.trim();

        // Create JWT client with optional domain-wide delegation (for Google Workspace)
        const jwtClient = new google.auth.JWT(
            calendarConfig.serviceAccountEmail,
            null,
            processedKey,
            ['https://www.googleapis.com/auth/calendar'],
            calendarConfig.impersonateUser || null  // Subject for domain-wide delegation (Google Workspace)
        );

        // Log if using domain-wide delegation
        if (calendarConfig.impersonateUser) {
            console.log('🏢 Using Google Workspace Domain-wide Delegation');
            console.log('   Impersonating user:', calendarConfig.impersonateUser);
        } else {
            console.log('👤 Using regular service account (no impersonation)');
        }

        // Authorize
        await jwtClient.authorize();

        const calendar = google.calendar({ version: 'v3', auth: jwtClient });

        // Prepare event data
        const eventStartTime = new Date(`${appointmentData.appointment_date}T${appointmentData.start_time}`);
        const eventEndTime = new Date(`${appointmentData.appointment_date}T${appointmentData.end_time}`);

        const patientName = appointmentData.patient_name || appointmentData.walk_in_name || 'Walk-in Patient';
        const ptName = appointmentData.pt_name || 'PT';
        const clinicName = appointmentData.clinic_name || '';

        const event = {
            summary: `Appointment: ${patientName}`,
            description: `Patient: ${patientName}\nPhysiotherapist: ${ptName}\nClinic: ${clinicName}\n${appointmentData.reason ? `Reason: ${appointmentData.reason}` : ''}`,
            location: clinicName,
            start: {
                dateTime: eventStartTime.toISOString(),
                timeZone: calendarConfig.timeZone || 'Asia/Bangkok',
            },
            end: {
                dateTime: eventEndTime.toISOString(),
                timeZone: calendarConfig.timeZone || 'Asia/Bangkok',
            },
            attendees: [],
            reminders: {
                useDefault: false,
                overrides: [
                    { method: 'popup', minutes: 30 },
                    { method: 'email', minutes: 1440 }, // 24 hours before
                ],
            },
            // Prevent guests (patients) from modifying the event
            guestsCanModify: false,
            guestsCanInviteOthers: false,
            guestsCanSeeOtherGuests: false,
        };

        // Add patient email if available and if sending invites is enabled
        // Handle both integer and string for sendInvites
        const isSendInvitesEnabled = calendarConfig.sendInvites === 1 || calendarConfig.sendInvites === '1';

        if (isSendInvitesEnabled && appointmentData.patient_email) {
            event.attendees.push({
                email: appointmentData.patient_email,
                displayName: patientName,
                responseStatus: 'needsAction'
            });
        }

        // Add clinic email if available
        if (isSendInvitesEnabled && appointmentData.clinic_email) {
            event.attendees.push({
                email: appointmentData.clinic_email,
                displayName: clinicName,
                responseStatus: 'needsAction'
            });
        }

        // Create event
        const result = await calendar.events.insert({
            calendarId: calendarConfig.calendarId,
            resource: event,
            sendUpdates: isSendInvitesEnabled ? 'all' : 'none',  // Send invites to attendees
        });

        console.log(`✅ Google Calendar event created: ${result.data.id}`);
        if (isSendInvitesEnabled) {
            console.log('📧 Invitation emails sent to attendees');
        }
        return result.data.id;

    } catch (error) {
        console.error('Google Calendar error:', error.message);
        return null;
    }
};

/**
 * Delete a Google Calendar event
 * @param {Object} db - Database connection
 * @param {string} eventId - Calendar event ID to delete
 * @returns {boolean} True if deletion was successful
 */
const deleteGoogleCalendarEvent = async (db, eventId) => {
    try {
        if (!eventId) return false;

        const [settings] = await db.execute(`
            SELECT setting_value FROM notification_settings WHERE setting_type = 'google_calendar' LIMIT 1
        `);

        if (settings.length === 0) return false;

        const calendarConfig = JSON.parse(settings[0].setting_value);
        if (!calendarConfig.enabled || calendarConfig.enabled === '0') return false;

        if (!calendarConfig.privateKey) return false;

        // Process the private key
        const privateKey = calendarConfig.privateKey.trim();
        let processedKey = privateKey;
        if (privateKey.includes('\\n')) {
            processedKey = privateKey.replace(/\\n/g, '\n');
        }
        processedKey = processedKey.trim();

        const { google } = require('googleapis');
        const jwtClient = new google.auth.JWT(
            calendarConfig.serviceAccountEmail,
            null,
            processedKey,
            ['https://www.googleapis.com/auth/calendar'],
            calendarConfig.impersonateUser || null  // Subject for domain-wide delegation
        );

        await jwtClient.authorize();
        const calendar = google.calendar({ version: 'v3', auth: jwtClient });

        // Handle both integer and string for sendInvites
        const isSendInvitesEnabled = calendarConfig.sendInvites === 1 || calendarConfig.sendInvites === '1';

        await calendar.events.delete({
            calendarId: calendarConfig.calendarId,
            eventId: eventId,
            sendUpdates: isSendInvitesEnabled ? 'all' : 'none',  // Send cancellation email to attendees
        });

        console.log(`✅ Google Calendar event deleted: ${eventId}`);
        if (isSendInvitesEnabled) {
            console.log('📧 Cancellation email sent to attendees');
        }
        return true;

    } catch (error) {
        console.error('Google Calendar delete error:', error.message);
        return false;
    }
};

// ========================================
// PUBLIC BOOKING API ROUTES
// (No Authentication Required)
// ========================================

/**
 * GET /api/public/clinics
 * Get list of active clinics for booking
 */
router.get('/clinics', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const [clinics] = await db.execute(`
            SELECT id, code, name, address, phone, email
            FROM clinics
            WHERE active = 1
            ORDER BY name
        `);
        res.json(clinics);
    } catch (error) {
        console.error('Get public clinics error:', error);
        res.status(500).json({ error: 'Failed to load clinics' });
    }
});

/**
 * GET /api/public/debug-appointments
 * Get all appointments for testing/debugging
 * Query params: clinic_id (optional, defaults to 1)
 */
router.get('/debug-appointments', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { clinic_id } = req.query;
        const clinicIdToUse = clinic_id || 1;

        console.log('DEBUG: Querying appointments for clinic_id:', clinicIdToUse);

        // Get appointments
        const [appointments] = await db.execute(`
            SELECT
                a.id,
                a.appointment_date,
                a.start_time,
                a.end_time,
                a.booking_type,
                a.status,
                a.walk_in_name,
                CONCAT(p.first_name, ' ', p.last_name) as patient_name,
                a.clinic_id,
                a.created_at
            FROM appointments a
            LEFT JOIN patients p ON a.patient_id = p.id
            WHERE a.clinic_id = ?
            AND a.appointment_date >= CURDATE()
            ORDER BY a.appointment_date, a.start_time
            LIMIT 50
        `, [clinicIdToUse]);

        // Get summary stats
        const [stats] = await db.execute(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status IN ('SCHEDULED', 'CONFIRMED', 'IN_PROGRESS') THEN 1 ELSE 0 END) as active,
                SUM(CASE WHEN booking_type = 'WALK_IN' THEN 1 ELSE 0 END) as walk_in,
                SUM(CASE WHEN booking_type = 'OLD_PATIENT' THEN 1 ELSE 0 END) as old_patient
            FROM appointments
            WHERE clinic_id = ?
            AND appointment_date >= CURDATE()
        `, [clinicIdToUse]);

        console.log('DEBUG: Found appointments:', appointments.length);

        res.json({
            clinic_id: clinicIdToUse,
            count: appointments.length,
            stats: stats[0],
            appointments: appointments,
            sample_date_formats: appointments.slice(0, 3).map(a => ({
                date: a.appointment_date,
                date_type: typeof a.appointment_date,
                date_instanceof: a.appointment_date instanceof Date,
                start_time: a.start_time,
                time_type: typeof a.start_time
            }))
        });
    } catch (error) {
        console.error('Debug appointments error:', error);
        res.status(500).json({ error: error.message, stack: error.stack });
    }
});

/**
 * GET /api/public/booking-calendar
 * Get booking counts per date for calendar display
 * Query params: clinic_id, start_date, end_date (all required)
 */
router.get('/booking-calendar', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { clinic_id, start_date, end_date } = req.query;

        if (!clinic_id || !start_date || !end_date) {
            return res.status(400).json({ error: 'clinic_id, start_date, and end_date are required' });
        }

        console.log('Querying booking calendar:', { clinic_id, start_date, end_date });

        // Get booking counts per date
        const [bookingCounts] = await db.execute(`
            SELECT
                appointment_date,
                COUNT(*) as total_bookings,
                SUM(CASE WHEN booking_type = 'WALK_IN' THEN 1 ELSE 0 END) as walk_in_count,
                SUM(CASE WHEN booking_type = 'OLD_PATIENT' THEN 1 ELSE 0 END) as patient_count
            FROM appointments
            WHERE clinic_id = ?
            AND appointment_date BETWEEN ? AND ?
            AND status != 'CANCELLED'
            GROUP BY appointment_date
            ORDER BY appointment_date
        `, [clinic_id, start_date, end_date]);

        console.log('Raw booking counts from DB:', bookingCounts.length, 'dates');

        // Convert to object for easier lookup
        const bookingsByDate = {};
        bookingCounts.forEach(row => {
            // Format date as YYYY-MM-DD string consistently
            let dateStr;
            if (row.appointment_date instanceof Date) {
                // MySQL returns Date object - format to YYYY-MM-DD
                const year = row.appointment_date.getFullYear();
                const month = String(row.appointment_date.getMonth() + 1).padStart(2, '0');
                const day = String(row.appointment_date.getDate()).padStart(2, '0');
                dateStr = `${year}-${month}-${day}`;
            } else {
                // If string, ensure it's YYYY-MM-DD format (remove time if present)
                dateStr = String(row.appointment_date).split('T')[0].split(' ')[0].trim();
            }

            bookingsByDate[dateStr] = {
                total: parseInt(row.total_bookings),
                walkIn: parseInt(row.walk_in_count),
                patient: parseInt(row.patient_count)
            };

            console.log(`Added booking for ${dateStr}:`, bookingsByDate[dateStr]);
        });

        console.log('Booking calendar date keys:', Object.keys(bookingsByDate)); // Debug log
        res.json(bookingsByDate);
    } catch (error) {
        console.error('Get booking calendar error:', error);
        res.status(500).json({ error: 'Failed to load booking calendar' });
    }
});

/**
 * GET /api/public/time-slots
 * Get available time slots for a specific date
 * Query params: clinic_id, date (both required)
 */
router.get('/time-slots', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { clinic_id, date } = req.query;

        if (!clinic_id || !date) {
            return res.status(400).json({ error: 'clinic_id and date are required' });
        }

        // Get day of week for the selected date
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const selectedDate = new Date(date + 'T00:00:00');
        const dayOfWeek = dayNames[selectedDate.getDay()];

        console.log(`Selected date: ${date}, Day: ${dayOfWeek}`);

        // PRIORITY 1: Check for special hours for this specific date first
        const [specialHours] = await db.execute(`
            SELECT is_open, start_time, end_time
            FROM booking_special_hours
            WHERE clinic_id = ? AND special_date = ?
        `, [clinic_id, date]);

        let isWorking, startTime, endTime;

        if (specialHours.length > 0) {
            // Special hours override default working hours
            console.log(`Using special hours for ${date}:`, specialHours[0]);
            isWorking = specialHours[0].is_open === 1;
            startTime = specialHours[0].start_time;
            endTime = specialHours[0].end_time;

            if (!isWorking) {
                console.log(`Clinic is closed on ${date} (special day)`);
                return res.json([]); // Return empty array if closed
            }
        } else {
            // PRIORITY 2: Use default working hours for this day of week
            const [workingHours] = await db.execute(`
                SELECT is_working, start_time, end_time
                FROM booking_working_hours
                WHERE clinic_id = ? AND day_of_week = ?
            `, [clinic_id, dayOfWeek]);

            // Check if clinic is working on this day
            if (workingHours.length === 0 || workingHours[0].is_working === 0) {
                console.log(`Clinic is not working on ${dayOfWeek}`);
                return res.json([]); // Return empty array if not working
            }

            isWorking = true;
            startTime = workingHours[0].start_time;
            endTime = workingHours[0].end_time;
        }

        console.log(`Working hours for ${date}: ${startTime} - ${endTime}`);

        // Check if date is closed
        const [closedDates] = await db.execute(`
            SELECT reason
            FROM booking_closed_dates
            WHERE clinic_id = ?
            AND (
                (is_recurring = 0 AND closed_date = ?)
                OR (is_recurring = 1 AND DATE_FORMAT(closed_date, '%m-%d') = DATE_FORMAT(?, '%m-%d'))
            )
        `, [clinic_id, date, date]);

        if (closedDates.length > 0) {
            console.log(`Clinic is closed on ${date}: ${closedDates[0].reason}`);
            return res.json([]); // Return empty array if closed
        }

        // Parse working hours
        const [startHour, startMin] = startTime.split(':').map(Number);
        const [endHour, endMin] = endTime.split(':').map(Number);

        // Convert to minutes for easier calculation
        const workingStartMinutes = startHour * 60 + startMin;
        const workingEndMinutes = endHour * 60 + endMin;

        // Generate time slots (30-minute intervals within working hours)
        const slots = [];
        const now = new Date();
        const todayDate = now.toISOString().split('T')[0]; // YYYY-MM-DD format
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const isToday = date === todayDate;

        console.log(`Generating slots from ${startTime} to ${endTime}`);

        // Generate 30-minute slots within working hours
        for (let slotStartMinutes = workingStartMinutes; slotStartMinutes < workingEndMinutes; slotStartMinutes += 30) {
            const slotEndMinutes = slotStartMinutes + 30;

            // Skip if slot end time exceeds working hours
            if (slotEndMinutes > workingEndMinutes) {
                break;
            }

            const startHour = Math.floor(slotStartMinutes / 60);
            const startMinute = slotStartMinutes % 60;
            const endHour = Math.floor(slotEndMinutes / 60);
            const endMinute = slotEndMinutes % 60;

            const startTime = `${startHour.toString().padStart(2, '0')}:${startMinute.toString().padStart(2, '0')}:00`;
            const endTime = `${endHour.toString().padStart(2, '0')}:${endMinute.toString().padStart(2, '0')}:00`;

            // Skip past time slots if booking for today
            if (isToday) {
                const currentMinutes = currentHour * 60 + currentMinute;

                // Skip if the slot has already passed
                if (slotEndMinutes <= currentMinutes) {
                    console.log(`Skipping past slot: ${startTime} - ${endTime} (current time: ${currentHour}:${currentMinute})`);
                    continue;
                }
            }

            slots.push({ start_time: startTime, end_time: endTime });
        }

        // Check which slots are already booked
        const [bookedSlots] = await db.execute(`
            SELECT a.start_time, a.end_time, a.id, a.walk_in_name,
                   CONCAT(COALESCE(p.first_name, ''), ' ', COALESCE(p.last_name, '')) as patient_name
            FROM appointments a
            LEFT JOIN patients p ON a.patient_id = p.id
            WHERE a.clinic_id = ?
            AND a.appointment_date = ?
            AND a.status != 'CANCELLED'
        `, [clinic_id, date]);

        console.log(`\n========== TIME SLOTS DEBUG for ${date} ==========`);
        console.log('Clinic ID:', clinic_id);
        console.log('Total booked appointments:', bookedSlots.length);

        if (bookedSlots.length > 0) {
            console.log('\nBooked appointments from DB:');
            bookedSlots.forEach((booking, idx) => {
                console.log(`  ${idx + 1}. ID:${booking.id} | ${booking.walk_in_name || booking.patient_name}`);
                console.log(`     Start: "${booking.start_time}" (type: ${typeof booking.start_time})`);
                console.log(`     End: "${booking.end_time}" (type: ${typeof booking.end_time})`);
            });
        }

        console.log('\nGenerated time slots:');
        slots.forEach((slot, idx) => {
            console.log(`  ${idx + 1}. "${slot.start_time}" - "${slot.end_time}"`);
        });

        // Mark slots as available or not
        const availableSlots = slots.map((slot, slotIdx) => {
            console.log(`\nChecking slot ${slotIdx + 1}: ${slot.start_time} - ${slot.end_time}`);

            const isBooked = bookedSlots.some((booked, bookIdx) => {
                // Normalize time strings (MySQL might return Buffer or different format)
                const bookedStart = String(booked.start_time).trim();
                const bookedEnd = String(booked.end_time).trim();
                const slotStart = slot.start_time;
                const slotEnd = slot.end_time;

                const bookingName = booked.walk_in_name || booked.patient_name || 'Unknown';
                console.log(`  vs booking ${bookIdx + 1}: "${bookedStart}" - "${bookedEnd}" (${bookingName})`);

                // Check for TIME OVERLAP instead of exact match
                // A slot overlaps with a booking if:
                // - Slot starts before booking ends AND
                // - Slot ends after booking starts
                // Example: Appointment 13:00-15:00 overlaps with:
                //   - Slot 13:00-14:00 (13:00 < 15:00 AND 14:00 > 13:00) ✓
                //   - Slot 14:00-15:00 (14:00 < 15:00 AND 15:00 > 13:00) ✓
                //   - Slot 15:00-16:00 (15:00 < 15:00) ✗ No overlap
                const overlap = slotStart < bookedEnd && slotEnd > bookedStart;

                console.log(`    Overlap? "${slotStart}" < "${bookedEnd}" = ${slotStart < bookedEnd}`);
                console.log(`             "${slotEnd}" > "${bookedStart}" = ${slotEnd > bookedStart}`);
                console.log(`    → ${overlap ? 'YES - BOOKED!' : 'NO - Available'}`);

                return overlap;
            });

            console.log(`  Final: ${isBooked ? '✗ BOOKED' : '✓ AVAILABLE'}`);

            return {
                ...slot,
                available: !isBooked
            };
        });

        console.log('\n========== SUMMARY ==========');
        availableSlots.forEach((slot, idx) => {
            console.log(`${idx + 1}. ${slot.start_time}-${slot.end_time}: ${slot.available ? '✓ AVAILABLE' : '✗ BOOKED'}`);
        });
        console.log('============================\n');

        res.json(availableSlots);
    } catch (error) {
        console.error('Get time slots error:', error);
        console.error('Error message:', error.message);
        console.error('Stack trace:', error.stack);
        res.status(500).json({
            error: 'Failed to load time slots',
            message: error.message,
            details: process.env.NODE_ENV !== 'production' ? error.stack : undefined
        });
    }
});

/**
 * GET /api/public/my-bookings
 * Get user's walk-in bookings by IP address
 */
router.get('/my-bookings', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const clientIP = getClientIP(req);

        const [bookings] = await db.execute(`
            SELECT
                a.*,
                c.name as clinic_name,
                c.code as clinic_code
            FROM appointments a
            LEFT JOIN clinics c ON a.clinic_id = c.id
            WHERE a.client_ip_address = ?
            AND a.booking_type = 'WALK_IN'
            AND a.status NOT IN ('COMPLETED', 'NO_SHOW')
            ORDER BY a.appointment_date DESC, a.start_time DESC
            LIMIT 10
        `, [clientIP]);

        res.json(bookings);
    } catch (error) {
        console.error('Get my bookings error:', error);
        res.status(500).json({ error: 'Failed to load bookings' });
    }
});

/**
 * POST /api/public/book-appointment
 * Book a new walk-in appointment
 * Body: { walk_in_name, walk_in_email, clinic_id, appointment_date, start_time, end_time, reason }
 */
router.post('/book-appointment', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const clientIP = getClientIP(req);
        const {
            walk_in_name,
            walk_in_email,
            clinic_id,
            appointment_date,
            start_time,
            end_time,
            reason
        } = req.body;

        console.log('Booking request:', { walk_in_name, walk_in_email, clinic_id, appointment_date, start_time, end_time, reason });
        console.log('Client IP:', clientIP);

        // Validation
        if (!walk_in_name || !walk_in_email || !clinic_id || !appointment_date || !start_time || !end_time) {
            console.log('Validation failed - missing fields');
            return res.status(400).json({ error: 'All fields are required' });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(walk_in_email)) {
            console.log('Validation failed - invalid email format');
            return res.status(400).json({ error: 'Invalid email address format' });
        }

        console.log('Validation passed, checking for overlaps...');

        // Check if slot overlaps with existing appointments (not just exact match)
        // Overlap formula: existing.start_time < new.end_time AND existing.end_time > new.start_time
        const [existing] = await db.execute(`
            SELECT id, start_time, end_time FROM appointments
            WHERE clinic_id = ?
            AND appointment_date = ?
            AND status IN ('SCHEDULED', 'CONFIRMED', 'IN_PROGRESS')
            AND start_time < ?
            AND end_time > ?
        `, [clinic_id, appointment_date, end_time, start_time]);

        if (existing.length > 0) {
            console.log('Slot overlap detected:', existing);
            return res.status(400).json({ error: 'This time slot overlaps with an existing appointment' });
        }

        console.log('No overlaps found. Creating appointment...');
        console.log('INSERT values:', [walk_in_name, walk_in_email, clinic_id, appointment_date, start_time, end_time, reason, clientIP]);

        // Create walk-in appointment (created_by = 1 for public bookings - admin user)
        // Walk-in bookings now have email for calendar invites
        const [result] = await db.execute(`
            INSERT INTO appointments (
                walk_in_name, walk_in_email, booking_type, clinic_id,
                appointment_date, start_time, end_time, status,
                reason, client_ip_address, created_by
            ) VALUES (?, ?, 'WALK_IN', ?, ?, ?, ?, 'SCHEDULED', ?, ?, 1)
        `, [walk_in_name, walk_in_email, clinic_id, appointment_date, start_time, end_time, reason, clientIP]);

        console.log('Appointment created successfully:', result.insertId);

        // Initialize response data
        let calendarEventId = null;
        let emailSent = false;

        // Create Google Calendar Event
        // Walk-in bookings now include email for sending calendar invites to visitors and clinic
        try {
            // Fetch appointment details with PT and clinic info for calendar event
            const [appointmentDetails] = await db.execute(`
                SELECT a.*,
                       u.first_name as pt_first_name, u.last_name as pt_last_name,
                       c.name as clinic_name, c.email as clinic_email
                FROM appointments a
                LEFT JOIN users u ON a.pt_id = u.id
                LEFT JOIN clinics c ON a.clinic_id = c.id
                WHERE a.id = ?
            `, [result.insertId]);

            if (appointmentDetails.length > 0) {
                const apt = appointmentDetails[0];

                // Prepare calendar data with walk-in email and clinic email
                const calendarData = {
                    appointment_id: result.insertId,
                    appointment_date: appointment_date,
                    start_time: start_time,
                    end_time: end_time,
                    patient_name: walk_in_name,
                    walk_in_name: walk_in_name,
                    patient_email: walk_in_email, // Send calendar invite to walk-in visitor
                    clinic_email: apt.clinic_email, // Send calendar invite to clinic
                    pt_name: apt.pt_id ? `${apt.pt_first_name} ${apt.pt_last_name}` : 'Unassigned PT',
                    clinic_name: apt.clinic_name || 'Unknown Clinic',
                    reason: reason || 'Walk-in appointment'
                };

                console.log('Creating Google Calendar event for walk-in with email invites to:', walk_in_email, 'and clinic:', apt.clinic_email);
                calendarEventId = await createGoogleCalendarEvent(db, calendarData);

                if (calendarEventId) {
                    // Store calendar event ID in database
                    await db.execute(
                        'UPDATE appointments SET calendar_event_id = ? WHERE id = ?',
                        [calendarEventId, result.insertId]
                    );
                    console.log('✅ Google Calendar event created:', calendarEventId);
                } else {
                    console.log('⚠️ Google Calendar event not created (disabled or error)');
                }
            }
        } catch (calendarError) {
            console.error('❌ Failed to create Google Calendar event:', calendarError);
            // Don't fail the request - appointment is already created
        }

        // Send LINE notification for new appointment
        try {
            const { sendLINENotification } = require('../utils/notifications');
            const moment = require('moment');

            const notificationMessage = `New Appointment Booked\n\nAppointment ID: ${result.insertId}\nPatient: ${walk_in_name}\nEmail: ${walk_in_email}\nDate: ${moment(appointment_date).format('DD/MM/YYYY')}\nTime: ${start_time} - ${end_time}\nReason: ${reason || 'N/A'}`;

            await sendLINENotification(db, 'newAppointment', notificationMessage);
            console.log('✅ LINE notification sent for new appointment');
        } catch (lineError) {
            console.error('❌ Failed to send LINE notification:', lineError);
            // Don't fail the request if notification fails
        }

        // Note: Walk-ins don't receive confirmation emails
        // Only OLD_PATIENT appointments (created by staff) will get emails from patients table

        res.json({
            success: true,
            appointment_id: result.insertId,
            message: 'Appointment booked successfully',
            calendar_event_id: calendarEventId,
            email_sent: emailSent
        });
    } catch (error) {
        console.error('Book appointment error:', error);
        console.error('Error message:', error.message);
        console.error('Error code:', error.code);
        console.error('SQL State:', error.sqlState);
        console.error('SQL Message:', error.sqlMessage);
        console.error('Full error:', JSON.stringify(error, null, 2));
        res.status(500).json({
            error: 'Failed to book appointment',
            message: error.message,
            sqlMessage: error.sqlMessage,
            code: error.code,
            sqlState: error.sqlState
        });
    }
});

/**
 * POST /api/public/cancel-appointment/:id
 * Cancel a walk-in appointment by IP verification
 * Params: id (appointment ID)
 */
router.post('/cancel-appointment/:id', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const clientIP = getClientIP(req);
        const appointmentId = req.params.id;

        // Verify this appointment belongs to this IP
        const [appointment] = await db.execute(`
            SELECT * FROM appointments
            WHERE id = ?
            AND client_ip_address = ?
            AND booking_type = 'WALK_IN'
        `, [appointmentId, clientIP]);

        if (appointment.length === 0) {
            return res.status(404).json({ error: 'Appointment not found or does not belong to you' });
        }

        if (!['SCHEDULED', 'CONFIRMED'].includes(appointment[0].status)) {
            return res.status(400).json({ error: 'Cannot cancel this appointment' });
        }

        // Cancel appointment
        await db.execute(`
            UPDATE appointments
            SET status = 'CANCELLED',
                cancellation_reason = 'Cancelled by walk-in user',
                cancelled_at = NOW()
            WHERE id = ?
        `, [appointmentId]);

        // Delete Google Calendar event
        try {
            if (appointment[0].calendar_event_id) {
                const deleted = await deleteGoogleCalendarEvent(db, appointment[0].calendar_event_id);
                if (deleted) {
                    // Clear calendar_event_id from database
                    await db.execute(
                        'UPDATE appointments SET calendar_event_id = NULL WHERE id = ?',
                        [appointmentId]
                    );
                }
            }
        } catch (calendarError) {
            console.error('Failed to delete Google Calendar event:', calendarError);
            // Don't fail the request if calendar deletion fails
        }

        res.json({ success: true, message: 'Appointment cancelled successfully' });
    } catch (error) {
        console.error('Cancel appointment error:', error);
        res.status(500).json({ error: 'Failed to cancel appointment' });
    }
});

// ========================================
// AI ENDPOINTS (PUBLIC - For Booking Page)
// ========================================

/**
 * POST /api/public/ai/analyze-symptoms
 * Analyze patient symptoms and suggest pain zone with recommended duration
 * Body: { symptoms: string, duration: string (optional) }
 */
router.post('/ai/analyze-symptoms', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { symptoms, duration } = req.body;

        if (!symptoms || symptoms.trim().length === 0) {
            return res.status(400).json({ error: 'Symptoms are required' });
        }

        // Get AI settings
        const [settings] = await db.execute(`
            SELECT setting_value FROM notification_settings WHERE setting_type = 'gemini_ai' LIMIT 1
        `);

        if (settings.length === 0) {
            return res.status(503).json({ error: 'AI service not configured' });
        }

        const aiConfig = JSON.parse(settings[0].setting_value);

        if (!aiConfig.enabled) {
            return res.status(503).json({ error: 'AI service is currently disabled' });
        }

        if (!aiConfig.features?.symptomAnalysis) {
            return res.status(503).json({ error: 'Symptom analysis feature is disabled' });
        }

        if (!aiConfig.apiKey) {
            return res.status(503).json({ error: 'AI service not properly configured' });
        }

        // Call Gemini API
        const axios = require('axios');
        const durationInfo = duration ? `\nSymptom duration: ${duration}` : '';
        const prompt = `Act as a physiotherapy receptionist. Analyze the following:
Symptoms: "${symptoms}"${durationInfo}

Based on the symptoms${duration ? ' and duration' : ''}, determine:
1. Pain zone - Map to exactly ONE of: ["neck", "shoulder", "back", "knee", "hip", "ankle", "elbow", "other"]
2. Recommended treatment duration based on these rules:
   - If symptoms less than 3 days: 60 minutes (initial assessment)
   - If symptoms 1 week to 3 months: 90 minutes (standard treatment)
   - If symptoms more than 3 months (chronic): 120 minutes (comprehensive treatment)
   - If duration unknown or unclear: 30 minutes (quick consultation)

Return ONLY a valid JSON object (no markdown, no code blocks):
{
  "category": "exact_zone_name",
  "reason": "Brief 1-sentence explanation",
  "recommendedDuration": 60,
  "durationReason": "Brief reason for duration choice"
}

Example: {"category": "back", "reason": "Lower back pain suggests lumbar strain", "recommendedDuration": 90, "durationReason": "Chronic condition requires comprehensive treatment"}`;

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${aiConfig.model}:generateContent?key=${aiConfig.apiKey}`;

        const response = await axios.post(url, {
            contents: [{
                parts: [{ text: prompt }]
            }]
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000 // 10 second timeout
        });

        const aiResponse = response.data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!aiResponse) {
            throw new Error('No response from AI');
        }

        // Clean up response (remove markdown code blocks if present)
        const cleanedResponse = aiResponse.replace(/```json|```/g, '').trim();

        // Parse JSON response
        const result = JSON.parse(cleanedResponse);

        // Validate response format
        if (!result.category || !result.reason || !result.recommendedDuration) {
            throw new Error('Invalid AI response format');
        }

        // Ensure recommendedDuration is a valid value (30, 60, 90, or 120)
        const validDurations = [30, 60, 90, 120];
        if (!validDurations.includes(result.recommendedDuration)) {
            result.recommendedDuration = 60; // Default to 60 if invalid
        }

        res.json(result);
    } catch (error) {
        console.error('AI symptom analysis error:', error);

        let errorMessage = 'Failed to analyze symptoms';
        if (error.response?.data?.error?.message) {
            errorMessage = error.response.data.error.message;
        } else if (error.message) {
            errorMessage = error.message;
        }

        res.status(500).json({ error: errorMessage });
    }
});

/**
 * POST /api/public/ai/recommend-date
 * Recommend best appointment date based on user preference
 * Body: { userInput: string, availableDates: array }
 */
router.post('/ai/recommend-date', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { userInput, availableDates } = req.body;

        if (!userInput || userInput.trim().length === 0) {
            return res.status(400).json({ error: 'User input is required' });
        }

        if (!availableDates || availableDates.length === 0) {
            return res.status(400).json({ error: 'No available dates found' });
        }

        // Get AI settings
        const [settings] = await db.execute(`
            SELECT setting_value FROM notification_settings WHERE setting_type = 'gemini_ai' LIMIT 1
        `);

        if (settings.length === 0) {
            return res.status(503).json({ error: 'AI service not configured' });
        }

        const aiConfig = JSON.parse(settings[0].setting_value);

        if (!aiConfig.enabled) {
            return res.status(503).json({ error: 'AI service is currently disabled' });
        }

        if (!aiConfig.apiKey) {
            return res.status(503).json({ error: 'AI service not properly configured' });
        }

        // Call Gemini API
        const axios = require('axios');
        const moment = require('moment');
        const today = moment().format('YYYY-MM-DD');

        const datesFormatted = availableDates.map(d =>
            `${d.date} (${d.dayName})`
        ).join(', ');

        const prompt = `Act as a smart booking assistant for a physiotherapy clinic. Today is ${today}.

User request: "${userInput}"

Available dates with appointments: ${datesFormatted}

Based on the user's preference, recommend the BEST date from the available dates. Consider:
- If they mention "next week", pick dates 7-14 days from today
- If they mention "this week", pick dates within 7 days from today
- If they mention "this month", pick any date in the current month
- If they mention a specific timeframe like "after I get back from Koh Lanta" or travel plans, estimate reasonable dates (usually 1-2 weeks ahead)
- If they say "as soon as possible", pick the earliest available date
- If they mention specific days like "Monday" or "weekend", prioritize those days

Return ONLY a valid JSON object (no markdown, no code blocks):
{
  "recommendedDate": "YYYY-MM-DD",
  "reason": "Brief 1-2 sentence explanation of why this date was chosen"
}

Example: {"recommendedDate": "2024-12-15", "reason": "This Monday falls within next week as requested and has good availability"}`;

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${aiConfig.model}:generateContent?key=${aiConfig.apiKey}`;

        const response = await axios.post(url, {
            contents: [{
                parts: [{ text: prompt }]
            }]
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000 // 10 second timeout
        });

        const aiResponse = response.data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!aiResponse) {
            throw new Error('No response from AI');
        }

        // Clean up response (remove markdown code blocks if present)
        const cleanedResponse = aiResponse.replace(/```json|```/g, '').trim();

        // Parse JSON response
        const result = JSON.parse(cleanedResponse);

        // Validate response format
        if (!result.recommendedDate || !result.reason) {
            throw new Error('Invalid AI response format');
        }

        // Validate that recommended date is in available dates
        const isValidDate = availableDates.some(d => d.date === result.recommendedDate);
        if (!isValidDate) {
            // If AI picked invalid date, default to first available
            result.recommendedDate = availableDates[0].date;
            result.reason = "Selected the earliest available date for you";
        }

        res.json(result);
    } catch (error) {
        console.error('AI date recommendation error:', error);

        let errorMessage = 'Failed to recommend date';
        if (error.response?.data?.error?.message) {
            errorMessage = error.response.data.error.message;
        } else if (error.message) {
            errorMessage = error.message;
        }

        res.status(500).json({ error: errorMessage });
    }
});

/**
 * POST /api/public/ai/complete-booking
 * Complete AI booking - analyze symptoms, find best date/time, recommend treatment
 * Body: { symptoms: string, duration: string, datePreference: string, availableDates: array }
 */
router.post('/ai/complete-booking', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { symptoms, duration, datePreference, availableDates } = req.body;

        if (!symptoms || symptoms.trim().length === 0) {
            return res.status(400).json({ error: 'Symptoms are required' });
        }

        if (!availableDates || availableDates.length === 0) {
            return res.status(400).json({ error: 'No available dates found' });
        }

        // Get AI settings
        const [settings] = await db.execute(`
            SELECT setting_value FROM notification_settings WHERE setting_type = 'gemini_ai' LIMIT 1
        `);

        if (settings.length === 0) {
            return res.status(503).json({ error: 'AI service not configured' });
        }

        const aiConfig = JSON.parse(settings[0].setting_value);

        if (!aiConfig.enabled) {
            return res.status(503).json({ error: 'AI service is currently disabled' });
        }

        if (!aiConfig.apiKey) {
            return res.status(503).json({ error: 'AI service not properly configured' });
        }

        // Call Gemini API
        const axios = require('axios');
        const moment = require('moment');
        const today = moment().format('YYYY-MM-DD');

        // Format available dates with time slots for AI
        const datesFormatted = availableDates.map(d => {
            const slotsFormatted = d.slots.map(s => `${s.time} (${s.consecutiveMinutes}min available)`).join(', ');
            return `${d.date} (${d.dayName}): ${slotsFormatted}`;
        }).join('\n');

        const durationInfo = duration ? `\nSymptom duration: ${duration}` : '';

        const prompt = `Act as an intelligent physiotherapy booking assistant. Today is ${today}.

PATIENT INFORMATION:
Symptoms: "${symptoms}"${durationInfo}
Preferred timing: "${datePreference}"

AVAILABLE APPOINTMENTS:
${datesFormatted}

TASK: Analyze and recommend the COMPLETE booking:

1. SYMPTOM ANALYSIS:
   - Identify pain zone: ["neck", "shoulder", "back", "knee", "hip", "ankle", "elbow", "other"]
   - Determine treatment duration based on:
     * < 3 days: 60 minutes
     * 1 week - 3 months: 90 minutes
     * > 3 months: 120 minutes
     * Unknown: 30 minutes

2. DATE & TIME SELECTION:
   - Match date preference (e.g., "next week" = 7-14 days, "as soon as possible" = earliest, "after Koh Lanta" = ~2 weeks)
   - Select time slot that has ENOUGH consecutive minutes for the recommended treatment
   - Prioritize earlier times in the day if multiple options

3. VALIDATION:
   - Ensure selected time slot has >= required treatment duration
   - If no perfect match, select closest available

Return ONLY valid JSON (no markdown):
{
  "painZone": "exact_zone_name",
  "treatmentDuration": 60,
  "symptomReason": "Brief reason for zone/duration",
  "recommendedDate": "YYYY-MM-DD",
  "recommendedTime": "HH:MM:SS",
  "explanation": "1-2 sentences explaining why this date/time is best"
}

Example: {"painZone": "back", "treatmentDuration": 90, "symptomReason": "Chronic lower back pain requires comprehensive treatment", "recommendedDate": "2024-12-10", "recommendedTime": "09:00:00", "explanation": "Selected Tuesday morning which matches your 'next week' preference and has 120 minutes available"}`;

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${aiConfig.model}:generateContent?key=${aiConfig.apiKey}`;

        const response = await axios.post(url, {
            contents: [{
                parts: [{ text: prompt }]
            }]
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 15000 // 15 second timeout for complex analysis
        });

        const aiResponse = response.data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!aiResponse) {
            throw new Error('No response from AI');
        }

        // Clean up response (remove markdown code blocks if present)
        const cleanedResponse = aiResponse.replace(/```json|```/g, '').trim();

        // Parse JSON response
        const result = JSON.parse(cleanedResponse);

        // Validate response format
        if (!result.painZone || !result.treatmentDuration || !result.recommendedDate || !result.recommendedTime) {
            throw new Error('Invalid AI response format');
        }

        // Validate treatment duration
        const validDurations = [30, 60, 90, 120];
        if (!validDurations.includes(result.treatmentDuration)) {
            result.treatmentDuration = 60;
        }

        // Generate multiple appointment options for user to choose from
        const appointmentOptions = [];

        // Find all dates that have adequate time slots for the recommended treatment
        for (const dateOption of availableDates) {
            const adequateSlots = dateOption.slots.filter(s => s.consecutiveMinutes >= result.treatmentDuration);

            if (adequateSlots.length > 0) {
                // Add up to 2 time slots per date (morning and afternoon options)
                const morningSlot = adequateSlots.find(s => {
                    const hour = parseInt(s.time.split(':')[0]);
                    return hour < 12;
                });
                const afternoonSlot = adequateSlots.find(s => {
                    const hour = parseInt(s.time.split(':')[0]);
                    return hour >= 12;
                });

                if (morningSlot) {
                    appointmentOptions.push({
                        date: dateOption.date,
                        dayName: dateOption.dayName,
                        time: morningSlot.time,
                        availableMinutes: morningSlot.consecutiveMinutes,
                        timeOfDay: 'Morning'
                    });
                }

                if (afternoonSlot) {
                    appointmentOptions.push({
                        date: dateOption.date,
                        dayName: dateOption.dayName,
                        time: afternoonSlot.time,
                        availableMinutes: afternoonSlot.consecutiveMinutes,
                        timeOfDay: 'Afternoon'
                    });
                }
            }

            // Limit to top 5 options
            if (appointmentOptions.length >= 5) break;
        }

        // If no adequate slots found, add any available slots
        if (appointmentOptions.length === 0) {
            for (const dateOption of availableDates.slice(0, 3)) {
                if (dateOption.slots.length > 0) {
                    appointmentOptions.push({
                        date: dateOption.date,
                        dayName: dateOption.dayName,
                        time: dateOption.slots[0].time,
                        availableMinutes: dateOption.slots[0].consecutiveMinutes,
                        timeOfDay: parseInt(dateOption.slots[0].time.split(':')[0]) < 12 ? 'Morning' : 'Afternoon'
                    });
                }
            }
        }

        // Set the primary recommendation (first option or AI's choice if valid)
        const primaryOption = appointmentOptions.find(opt =>
            opt.date === result.recommendedDate && opt.time === result.recommendedTime
        ) || appointmentOptions[0];

        res.json({
            painZone: result.painZone,
            treatmentDuration: result.treatmentDuration,
            symptomReason: result.symptomReason,
            explanation: result.explanation,
            primaryRecommendation: primaryOption,
            allOptions: appointmentOptions
        });
    } catch (error) {
        console.error('Complete AI booking error:', error);

        let errorMessage = 'Failed to complete AI booking';
        if (error.response?.data?.error?.message) {
            errorMessage = error.response.data.error.message;
        } else if (error.message) {
            errorMessage = error.message;
        }

        res.status(500).json({ error: errorMessage });
    }
});

/**
 * POST /api/public/ai/polish-notes
 * Polish and improve appointment notes
 * Body: { notes: string }
 */
router.post('/ai/polish-notes', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { notes } = req.body;

        if (!notes || notes.trim().length === 0) {
            return res.status(400).json({ error: 'Notes are required' });
        }

        // Get AI settings
        const [settings] = await db.execute(`
            SELECT setting_value FROM notification_settings WHERE setting_type = 'gemini_ai' LIMIT 1
        `);

        if (settings.length === 0) {
            return res.status(503).json({ error: 'AI service not configured' });
        }

        const aiConfig = JSON.parse(settings[0].setting_value);

        if (!aiConfig.enabled) {
            return res.status(503).json({ error: 'AI service is currently disabled' });
        }

        if (!aiConfig.features?.notePolish) {
            return res.status(503).json({ error: 'Note polishing feature is disabled' });
        }

        if (!aiConfig.apiKey) {
            return res.status(503).json({ error: 'AI service not properly configured' });
        }

        // Call Gemini API
        const axios = require('axios');
        const prompt = `Rewrite this physiotherapy appointment note to be professional, concise, and medically appropriate: "${notes}".

Rules:
- Keep it brief (1-2 sentences)
- Use professional medical terminology where appropriate
- Focus on the main concern
- Return ONLY the improved text, no explanations or quotes`;

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${aiConfig.model}:generateContent?key=${aiConfig.apiKey}`;

        const response = await axios.post(url, {
            contents: [{
                parts: [{ text: prompt }]
            }]
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000 // 10 second timeout
        });

        const aiResponse = response.data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!aiResponse) {
            throw new Error('No response from AI');
        }

        res.json({ polishedNotes: aiResponse.trim() });
    } catch (error) {
        console.error('AI note polishing error:', error);

        let errorMessage = 'Failed to polish notes';
        if (error.response?.data?.error?.message) {
            errorMessage = error.response.data.error.message;
        } else if (error.message) {
            errorMessage = error.message;
        }

        res.status(500).json({ error: errorMessage });
    }
});

// ========================================
// PUBLIC BOOKING SCHEDULE & EVENTS
// ========================================

/**
 * GET /api/public/working-hours
 * Get working hours for a clinic
 */
router.get('/working-hours', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { clinic_id } = req.query;

        if (!clinic_id) {
            return res.status(400).json({ error: 'clinic_id is required' });
        }

        const [hours] = await db.execute(`
            SELECT day_of_week, is_working, start_time, end_time
            FROM booking_working_hours
            WHERE clinic_id = ?
            ORDER BY FIELD(day_of_week, 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')
        `, [clinic_id]);

        res.json(hours);
    } catch (error) {
        console.error('Get working hours error:', error);
        res.status(500).json({ error: 'Failed to load working hours' });
    }
});

/**
 * GET /api/public/closed-dates
 * Get closed dates for a clinic
 */
router.get('/closed-dates', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { clinic_id, start_date, end_date } = req.query;

        if (!clinic_id) {
            return res.status(400).json({ error: 'clinic_id is required' });
        }

        // Get closed dates, including recurring dates
        const [dates] = await db.execute(`
            SELECT closed_date, reason, is_recurring
            FROM booking_closed_dates
            WHERE clinic_id = ?
            ${start_date && end_date ? 'AND closed_date BETWEEN ? AND ?' : ''}
            ORDER BY closed_date ASC
        `, start_date && end_date ? [clinic_id, start_date, end_date] : [clinic_id]);

        res.json(dates);
    } catch (error) {
        console.error('Get closed dates error:', error);
        res.status(500).json({ error: 'Failed to load closed dates' });
    }
});

/**
 * GET /api/public/special-hours
 * Get special opening hours for a clinic
 */
router.get('/special-hours', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { clinic_id, start_date, end_date } = req.query;

        if (!clinic_id) {
            return res.status(400).json({ error: 'clinic_id is required' });
        }

        // Get special hours within date range
        const [hours] = await db.execute(`
            SELECT special_date, is_open, start_time, end_time, reason
            FROM booking_special_hours
            WHERE clinic_id = ?
            ${start_date && end_date ? 'AND special_date BETWEEN ? AND ?' : ''}
            ORDER BY special_date ASC
        `, start_date && end_date ? [clinic_id, start_date, end_date] : [clinic_id]);

        res.json(hours);
    } catch (error) {
        console.error('Get special hours error:', error);
        res.status(500).json({ error: 'Failed to load special hours' });
    }
});

/**
 * GET /api/public/events
 * Get published public events for a clinic
 */
router.get('/events', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { clinic_id, date } = req.query;

        if (!clinic_id) {
            return res.status(400).json({ error: 'clinic_id is required' });
        }

        let query = `
            SELECT e.*,
                   (SELECT COUNT(*) FROM booking_event_registrations WHERE event_id = e.id) as registration_count
            FROM booking_events e
            WHERE e.clinic_id = ?
            AND e.is_public = 1
            AND e.status = 'PUBLISHED'
        `;
        let params = [clinic_id];

        if (date) {
            // Get events that include this specific date (within date range)
            query += ` AND ? BETWEEN e.start_date AND e.end_date`;
            params.push(date);
        } else {
            // Get all upcoming events
            query += ` AND e.end_date >= CURDATE()`;
        }

        query += ` ORDER BY e.start_date ASC, e.start_time ASC`;

        const [events] = await db.execute(query, params);

        res.json(events);
    } catch (error) {
        console.error('Get public events error:', error);
        res.status(500).json({ error: 'Failed to load events' });
    }
});

/**
 * GET /api/public/events/:id
 * Get specific event details
 */
router.get('/events/:id', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const { id } = req.params;

        const [events] = await db.execute(`
            SELECT e.*,
                   (SELECT COUNT(*) FROM booking_event_registrations WHERE event_id = e.id) as registration_count
            FROM booking_events e
            WHERE e.id = ?
            AND e.is_public = 1
            AND e.status IN ('PUBLISHED', 'FULL')
        `, [id]);

        if (events.length === 0) {
            return res.status(404).json({ error: 'Event not found' });
        }

        res.json(events[0]);
    } catch (error) {
        console.error('Get event details error:', error);
        res.status(500).json({ error: 'Failed to load event details' });
    }
});

/**
 * POST /api/public/events/:id/register
 * Register for an event
 */
router.post('/events/:id/register', async (req, res) => {
    try {
        const db = req.app.locals.db;
        const clientIP = getClientIP(req);
        const { id } = req.params;
        const { participant_name, participant_email, participant_phone, notes } = req.body;

        if (!participant_name || !participant_email) {
            return res.status(400).json({ error: 'Name and email are required' });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(participant_email)) {
            return res.status(400).json({ error: 'Invalid email address format' });
        }

        // Check if event exists and is available
        const [events] = await db.execute(`
            SELECT e.*,
                   (SELECT COUNT(*) FROM booking_event_registrations WHERE event_id = e.id) as registration_count
            FROM booking_events e
            WHERE e.id = ?
            AND e.is_public = 1
            AND e.status = 'PUBLISHED'
        `, [id]);

        if (events.length === 0) {
            return res.status(404).json({ error: 'Event not found or not available for registration' });
        }

        const event = events[0];

        // Check if event is full
        if (event.max_participants && event.registration_count >= event.max_participants) {
            return res.status(400).json({ error: 'Event is full' });
        }

        // Check if already registered
        const [existing] = await db.execute(`
            SELECT id FROM booking_event_registrations
            WHERE event_id = ? AND participant_email = ?
        `, [id, participant_email]);

        if (existing.length > 0) {
            return res.status(400).json({ error: 'You have already registered for this event' });
        }

        // Register for event
        const [result] = await db.execute(`
            INSERT INTO booking_event_registrations
            (event_id, participant_name, participant_email, participant_phone, notes, client_ip_address, status)
            VALUES (?, ?, ?, ?, ?, ?, 'REGISTERED')
        `, [id, participant_name, participant_email, participant_phone, notes, clientIP]);

        // Update event status to FULL if max participants reached
        const newCount = event.registration_count + 1;
        if (event.max_participants && newCount >= event.max_participants) {
            await db.execute('UPDATE booking_events SET status = ? WHERE id = ?', ['FULL', id]);
        }

        res.json({
            success: true,
            message: 'Successfully registered for event',
            registration_id: result.insertId
        });
    } catch (error) {
        console.error('Event registration error:', error);
        res.status(500).json({ error: 'Failed to register for event' });
    }
});

// Export the router
module.exports = router;