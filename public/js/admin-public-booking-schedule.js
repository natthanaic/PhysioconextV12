// Admin Public Booking Schedule Settings
const CLINIC_ID = 1; // LANTAVAFIX

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    loadWorkingHours();
    loadSpecialHours();
    loadClosedDates();
    loadEvents();
});

// ========================================
// WORKING HOURS MANAGEMENT
// ========================================

async function loadWorkingHours() {
    try {
        const response = await fetch(`/api/admin/booking-schedule/working-hours?clinic_id=${CLINIC_ID}`);
        if (response.ok) {
            const hours = await response.json();
            displayWorkingHours(hours);
        } else {
            showAlert('Failed to load working hours', 'danger');
        }
    } catch (error) {
        console.error('Load working hours error:', error);
        showAlert('Error loading working hours', 'danger');
    }
}

function displayWorkingHours(hours) {
    const container = document.getElementById('working-hours-list');
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    container.innerHTML = days.map(day => {
        const dayData = hours.find(h => h.day_of_week === day) || {
            day_of_week: day,
            is_working: 1,
            start_time: '09:00:00',
            end_time: '20:00:00'
        };

        const isWorking = dayData.is_working === 1;

        return `
            <div class="col-md-6 col-lg-4">
                <div class="card day-card ${isWorking ? 'active' : 'inactive'}" data-day="${day}">
                    <div class="card-body">
                        <div class="form-check form-switch mb-3">
                            <input class="form-check-input" type="checkbox" id="is_working_${day}"
                                   ${isWorking ? 'checked' : ''} onchange="toggleDayWorking('${day}')">
                            <label class="form-check-label" for="is_working_${day}">
                                <strong>${day}</strong>
                            </label>
                        </div>
                        <div class="working-times" id="times_${day}" style="display: ${isWorking ? 'block' : 'none'}">
                            <div class="mb-2">
                                <label class="form-label small">Start Time</label>
                                <input type="time" class="form-control form-control-sm" id="start_time_${day}"
                                       value="${dayData.start_time ? dayData.start_time.substring(0, 5) : '09:00'}">
                            </div>
                            <div class="mb-2">
                                <label class="form-label small">End Time</label>
                                <input type="time" class="form-control form-control-sm" id="end_time_${day}"
                                       value="${dayData.end_time ? dayData.end_time.substring(0, 5) : '20:00'}">
                            </div>
                        </div>
                        <div class="closed-notice" id="closed_${day}" style="display: ${!isWorking ? 'block' : 'none'}">
                            <p class="text-muted mb-0"><i class="bi bi-x-circle"></i> Closed</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function toggleDayWorking(day) {
    const isChecked = document.getElementById(`is_working_${day}`).checked;
    const card = document.querySelector(`.day-card[data-day="${day}"]`);
    const timesDiv = document.getElementById(`times_${day}`);
    const closedDiv = document.getElementById(`closed_${day}`);

    if (isChecked) {
        card.classList.add('active');
        card.classList.remove('inactive');
        timesDiv.style.display = 'block';
        closedDiv.style.display = 'none';
    } else {
        card.classList.remove('active');
        card.classList.add('inactive');
        timesDiv.style.display = 'none';
        closedDiv.style.display = 'block';
    }
}

async function saveWorkingHours() {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const workingHours = [];

    days.forEach(day => {
        const isWorking = document.getElementById(`is_working_${day}`).checked;
        const startTime = document.getElementById(`start_time_${day}`).value + ':00';
        const endTime = document.getElementById(`end_time_${day}`).value + ':00';

        workingHours.push({
            day_of_week: day,
            is_working: isWorking ? 1 : 0,
            start_time: startTime,
            end_time: endTime
        });
    });

    try {
        const response = await fetch('/api/admin/booking-schedule/working-hours', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clinic_id: CLINIC_ID, working_hours: workingHours })
        });

        if (response.ok) {
            showAlert('Working hours saved successfully', 'success');
            loadWorkingHours();
        } else {
            const error = await response.json();
            showAlert(error.error || 'Failed to save working hours', 'danger');
        }
    } catch (error) {
        console.error('Save working hours error:', error);
        showAlert('Error saving working hours', 'danger');
    }
}

// ========================================
// CLOSED DATES MANAGEMENT
// ========================================

async function loadClosedDates() {
    try {
        const response = await fetch(`/api/admin/booking-schedule/closed-dates?clinic_id=${CLINIC_ID}`);
        if (response.ok) {
            const dates = await response.json();
            displayClosedDates(dates);
        } else {
            showAlert('Failed to load closed dates', 'danger');
        }
    } catch (error) {
        console.error('Load closed dates error:', error);
        showAlert('Error loading closed dates', 'danger');
    }
}

function displayClosedDates(dates) {
    const container = document.getElementById('closed-dates-list');

    if (dates.length === 0) {
        container.innerHTML = '<div class="alert alert-info">No closed dates configured</div>';
        return;
    }

    // Sort by date
    dates.sort((a, b) => new Date(a.closed_date) - new Date(b.closed_date));

    container.innerHTML = dates.map(date => `
        <div class="card mb-3">
            <div class="card-body">
                <div class="row align-items-center">
                    <div class="col-md-3">
                        <strong><i class="bi bi-calendar-x"></i> ${moment(date.closed_date).format('DD/MM/YYYY')}</strong>
                        ${date.is_recurring ? '<span class="badge bg-info ms-2">Yearly</span>' : ''}
                    </div>
                    <div class="col-md-6">
                        <p class="mb-0">${escapeHtml(date.reason)}</p>
                    </div>
                    <div class="col-md-3 text-end">
                        <button class="btn btn-sm btn-outline-primary" onclick="editClosedDate(${date.id})">
                            <i class="bi bi-pencil"></i> Edit
                        </button>
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteClosedDate(${date.id})">
                            <i class="bi bi-trash"></i> Delete
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

function toggleDateRange() {
    const isDateRange = document.getElementById('is_date_range').checked;
    const singleContainer = document.getElementById('single-date-container');
    const rangeContainer = document.getElementById('date-range-container');

    if (isDateRange) {
        singleContainer.style.display = 'none';
        rangeContainer.style.display = 'block';
        document.getElementById('closed_date').removeAttribute('required');
        document.getElementById('closed_start_date').setAttribute('required', 'required');
        document.getElementById('closed_end_date').setAttribute('required', 'required');
    } else {
        singleContainer.style.display = 'block';
        rangeContainer.style.display = 'none';
        document.getElementById('closed_date').setAttribute('required', 'required');
        document.getElementById('closed_start_date').removeAttribute('required');
        document.getElementById('closed_end_date').removeAttribute('required');
    }
}

function showClosedDateModal(dateId = null) {
    document.getElementById('closed_date_id').value = '';
    document.getElementById('closed_date').value = '';
    document.getElementById('closed_start_date').value = '';
    document.getElementById('closed_end_date').value = '';
    document.getElementById('closed_reason').value = '';
    document.getElementById('is_recurring').checked = false;
    document.getElementById('is_date_range').checked = false;
    toggleDateRange(); // Reset to single date mode

    if (dateId) {
        // Load existing date data
        loadClosedDateData(dateId);
    }

    const modal = new bootstrap.Modal(document.getElementById('closedDateModal'));
    modal.show();
}

async function loadClosedDateData(dateId) {
    try {
        const response = await fetch(`/api/admin/booking-schedule/closed-dates/${dateId}`);
        if (response.ok) {
            const date = await response.json();
            document.getElementById('closed_date_id').value = date.id;
            document.getElementById('closed_date').value = date.closed_date;
            document.getElementById('closed_reason').value = date.reason;
            document.getElementById('is_recurring').checked = date.is_recurring === 1;
        }
    } catch (error) {
        console.error('Load closed date error:', error);
    }
}

async function saveClosedDate() {
    const id = document.getElementById('closed_date_id').value;
    const reason = document.getElementById('closed_reason').value;
    const isRecurring = document.getElementById('is_recurring').checked;
    const isDateRange = document.getElementById('is_date_range').checked;

    let startDate, endDate;

    if (isDateRange) {
        startDate = document.getElementById('closed_start_date').value;
        endDate = document.getElementById('closed_end_date').value;

        if (!startDate || !endDate || !reason) {
            showAlert('Please fill in all required fields', 'warning');
            return;
        }

        if (new Date(endDate) < new Date(startDate)) {
            showAlert('End date must be after start date', 'warning');
            return;
        }
    } else {
        const singleDate = document.getElementById('closed_date').value;

        if (!singleDate || !reason) {
            showAlert('Please fill in all required fields', 'warning');
            return;
        }

        startDate = singleDate;
        endDate = singleDate;
    }

    const data = {
        clinic_id: CLINIC_ID,
        start_date: startDate,
        end_date: endDate,
        reason: reason,
        is_recurring: isRecurring ? 1 : 0
    };

    try {
        const url = id ? `/api/admin/booking-schedule/closed-dates/${id}` : '/api/admin/booking-schedule/closed-dates';
        const method = id ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            const result = await response.json();
            const message = isDateRange ?
                `Closed date range saved successfully (${result.datesCreated || 'multiple'} dates)` :
                'Closed date saved successfully';
            showAlert(message, 'success');
            bootstrap.Modal.getInstance(document.getElementById('closedDateModal')).hide();
            loadClosedDates();
        } else {
            const error = await response.json();
            showAlert(error.error || 'Failed to save closed date', 'danger');
        }
    } catch (error) {
        console.error('Save closed date error:', error);
        showAlert('Error saving closed date', 'danger');
    }
}

function editClosedDate(id) {
    showClosedDateModal(id);
}

async function deleteClosedDate(id) {
    if (!confirm('Are you sure you want to delete this closed date?')) {
        return;
    }

    try {
        const response = await fetch(`/api/admin/booking-schedule/closed-dates/${id}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            showAlert('Closed date deleted successfully', 'success');
            loadClosedDates();
        } else {
            const error = await response.json();
            showAlert(error.error || 'Failed to delete closed date', 'danger');
        }
    } catch (error) {
        console.error('Delete closed date error:', error);
        showAlert('Error deleting closed date', 'danger');
    }
}

// ========================================
// EVENTS MANAGEMENT
// ========================================

async function loadEvents() {
    try {
        const response = await fetch(`/api/admin/booking-schedule/events?clinic_id=${CLINIC_ID}`);
        if (response.ok) {
            const events = await response.json();
            displayEvents(events);
        } else {
            showAlert('Failed to load events', 'danger');
        }
    } catch (error) {
        console.error('Load events error:', error);
        showAlert('Error loading events', 'danger');
    }
}

function displayEvents(events) {
    const container = document.getElementById('events-list');

    if (events.length === 0) {
        container.innerHTML = '<div class="alert alert-info">No events configured</div>';
        return;
    }

    // Sort by date
    events.sort((a, b) => new Date(a.event_date) - new Date(b.event_date));

    container.innerHTML = events.map(event => {
        const statusClass = event.status.toLowerCase();
        const registrationCount = event.registration_count || 0;
        const maxParticipants = event.max_participants || 'Unlimited';
        const isFull = event.max_participants && registrationCount >= event.max_participants;

        return `
            <div class="card mb-3 event-card ${statusClass}">
                <div class="card-body">
                    <div class="row">
                        <div class="col-md-8">
                            <h5 class="mb-1">
                                <i class="bi bi-calendar-event"></i> ${escapeHtml(event.event_name)}
                                <span class="badge bg-${getStatusBadgeClass(event.status)} ms-2">${event.status}</span>
                                ${event.is_public ? '<span class="badge bg-success ms-1">Public</span>' : '<span class="badge bg-secondary ms-1">Private</span>'}
                            </h5>
                            <p class="mb-2 text-muted">
                                <i class="bi bi-calendar"></i> ${moment(event.event_date).format('DD/MM/YYYY')}
                                <i class="bi bi-clock ms-3"></i> ${event.start_time.substring(0, 5)} - ${event.end_time.substring(0, 5)}
                            </p>
                            <p class="mb-2">${escapeHtml(event.event_description || 'No description')}</p>
                            <p class="mb-0">
                                <i class="bi bi-people"></i> Registrations: <strong>${registrationCount} / ${maxParticipants}</strong>
                                ${isFull ? '<span class="badge bg-warning ms-2">FULL</span>' : ''}
                            </p>
                        </div>
                        <div class="col-md-4 text-end">
                            ${registrationCount > 0 ? `
                                <button class="btn btn-sm btn-info mb-2 w-100" onclick="viewEventRegistrations(${event.id})">
                                    <i class="bi bi-people"></i> View Registrations (${registrationCount})
                                </button>
                            ` : ''}
                            <button class="btn btn-sm btn-outline-primary mb-2 w-100" onclick="editEvent(${event.id})">
                                <i class="bi bi-pencil"></i> Edit
                            </button>
                            <button class="btn btn-sm btn-outline-danger w-100" onclick="deleteEvent(${event.id})">
                                <i class="bi bi-trash"></i> Delete
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function getStatusBadgeClass(status) {
    const classes = {
        'DRAFT': 'secondary',
        'PUBLISHED': 'success',
        'FULL': 'warning',
        'COMPLETED': 'info',
        'CANCELLED': 'danger'
    };
    return classes[status] || 'secondary';
}

function showEventModal(eventId = null) {
    document.getElementById('event_id').value = '';
    document.getElementById('event_date').value = '';
    document.getElementById('event_start_time').value = '09:00';
    document.getElementById('event_end_time').value = '12:00';
    document.getElementById('event_name').value = '';
    document.getElementById('event_description').value = '';
    document.getElementById('event_image_file').value = '';
    document.getElementById('event_image_path').value = '';
    document.getElementById('event_image_preview').style.display = 'none';
    document.getElementById('max_participants').value = '';
    document.getElementById('event_status').value = 'DRAFT';
    document.getElementById('is_public').checked = true;
    document.getElementById('registration_required').checked = true;

    if (eventId) {
        loadEventData(eventId);
    }

    // Setup image file change handler
    setupImagePreview();

    const modal = new bootstrap.Modal(document.getElementById('eventModal'));
    modal.show();
}

function setupImagePreview() {
    const fileInput = document.getElementById('event_image_file');
    fileInput.onchange = function(e) {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(event) {
                document.getElementById('preview_img').src = event.target.result;
                document.getElementById('event_image_preview').style.display = 'block';
            };
            reader.readAsDataURL(file);
        }
    };
}

function removeEventImage() {
    document.getElementById('event_image_file').value = '';
    document.getElementById('event_image_path').value = '';
    document.getElementById('event_image_preview').style.display = 'none';
}

async function loadEventData(eventId) {
    try {
        const response = await fetch(`/api/admin/booking-schedule/events/${eventId}`);
        if (response.ok) {
            const event = await response.json();
            document.getElementById('event_id').value = event.id;
            document.getElementById('event_date').value = event.event_date;
            document.getElementById('event_start_time').value = event.start_time.substring(0, 5);
            document.getElementById('event_end_time').value = event.end_time.substring(0, 5);
            document.getElementById('event_name').value = event.event_name;
            document.getElementById('event_description').value = event.event_description || '';
            document.getElementById('max_participants').value = event.max_participants || '';
            document.getElementById('event_status').value = event.status;
            document.getElementById('is_public').checked = event.is_public === 1;
            document.getElementById('registration_required').checked = event.registration_required === 1;

            // Load event image if exists
            if (event.event_image) {
                document.getElementById('event_image_path').value = event.event_image;
                document.getElementById('preview_img').src = event.event_image;
                document.getElementById('event_image_preview').style.display = 'block';
            }
        }
    } catch (error) {
        console.error('Load event error:', error);
    }
}

async function saveEvent() {
    const id = document.getElementById('event_id').value;
    const eventDate = document.getElementById('event_date').value;
    const startTime = document.getElementById('event_start_time').value + ':00';
    const endTime = document.getElementById('event_end_time').value + ':00';
    const eventName = document.getElementById('event_name').value;
    const description = document.getElementById('event_description').value;
    const maxParticipants = document.getElementById('max_participants').value;
    const status = document.getElementById('event_status').value;
    const isPublic = document.getElementById('is_public').checked;
    const registrationRequired = document.getElementById('registration_required').checked;

    if (!eventDate || !startTime || !endTime || !eventName) {
        showAlert('Please fill in all required fields', 'warning');
        return;
    }

    // Upload image if a new file is selected
    let imagePath = document.getElementById('event_image_path').value;
    const imageFile = document.getElementById('event_image_file').files[0];

    if (imageFile) {
        try {
            const formData = new FormData();
            formData.append('event_image', imageFile);

            const uploadResponse = await fetch('/api/admin/booking-schedule/event-image', {
                method: 'POST',
                body: formData
            });

            if (uploadResponse.ok) {
                const uploadResult = await uploadResponse.json();
                imagePath = uploadResult.imagePath;
            } else {
                showAlert('Failed to upload image', 'danger');
                return;
            }
        } catch (error) {
            console.error('Image upload error:', error);
            showAlert('Error uploading image', 'danger');
            return;
        }
    }

    const data = {
        clinic_id: CLINIC_ID,
        event_date: eventDate,
        start_time: startTime,
        end_time: endTime,
        event_name: eventName,
        event_description: description,
        event_image: imagePath || null,
        max_participants: maxParticipants || null,
        status: status,
        is_public: isPublic ? 1 : 0,
        registration_required: registrationRequired ? 1 : 0
    };

    try {
        const url = id ? `/api/admin/booking-schedule/events/${id}` : '/api/admin/booking-schedule/events';
        const method = id ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            showAlert('Event saved successfully', 'success');
            bootstrap.Modal.getInstance(document.getElementById('eventModal')).hide();
            loadEvents();
        } else {
            const error = await response.json();
            showAlert(error.error || 'Failed to save event', 'danger');
        }
    } catch (error) {
        console.error('Save event error:', error);
        showAlert('Error saving event', 'danger');
    }
}

function editEvent(id) {
    showEventModal(id);
}

async function deleteEvent(id) {
    if (!confirm('Are you sure you want to delete this event?')) {
        return;
    }

    try {
        const response = await fetch(`/api/admin/booking-schedule/events/${id}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            showAlert('Event deleted successfully', 'success');
            loadEvents();
        } else {
            const error = await response.json();
            showAlert(error.error || 'Failed to delete event', 'danger');
        }
    } catch (error) {
        console.error('Delete event error:', error);
        showAlert('Error deleting event', 'danger');
    }
}

async function viewEventRegistrations(eventId) {
    try {
        const response = await fetch(`/api/admin/booking-schedule/events/${eventId}/registrations`);
        if (response.ok) {
            const registrations = await response.json();
            displayEventRegistrations(registrations, eventId);
            const modal = new bootstrap.Modal(document.getElementById('eventRegistrationsModal'));
            modal.show();
        } else {
            showAlert('Failed to load registrations', 'danger');
        }
    } catch (error) {
        console.error('Load registrations error:', error);
        showAlert('Error loading registrations', 'danger');
    }
}

function displayEventRegistrations(registrations, eventId) {
    const container = document.getElementById('event-registrations-list');

    if (registrations.length === 0) {
        container.innerHTML = '<div class="alert alert-info">No registrations yet</div>';
        return;
    }

    container.innerHTML = `
        <div class="table-responsive">
            <table class="table table-striped">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Phone</th>
                        <th>Status</th>
                        <th>Registered At</th>
                    </tr>
                </thead>
                <tbody>
                    ${registrations.map(reg => `
                        <tr>
                            <td>${escapeHtml(reg.participant_name)}</td>
                            <td>${escapeHtml(reg.participant_email)}</td>
                            <td>${escapeHtml(reg.participant_phone || 'N/A')}</td>
                            <td><span class="badge bg-${getRegistrationStatusBadge(reg.status)}">${reg.status}</span></td>
                            <td>${moment(reg.registered_at).format('DD/MM/YYYY HH:mm')}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function getRegistrationStatusBadge(status) {
    const badges = {
        'REGISTERED': 'primary',
        'CONFIRMED': 'success',
        'CANCELLED': 'danger',
        'ATTENDED': 'info'
    };
    return badges[status] || 'secondary';
}

// ========================================
// SPECIAL OPENING HOURS MANAGEMENT
// ========================================

async function loadSpecialHours() {
    try {
        const response = await fetch(`/api/admin/booking-schedule/special-hours?clinic_id=${CLINIC_ID}`);
        if (response.ok) {
            const hours = await response.json();
            displaySpecialHours(hours);
        } else {
            showAlert('Failed to load special opening days', 'danger');
        }
    } catch (error) {
        console.error('Load special hours error:', error);
        showAlert('Error loading special opening days', 'danger');
    }
}

function displaySpecialHours(hours) {
    const container = document.getElementById('special-hours-list');

    if (hours.length === 0) {
        container.innerHTML = '<div class="alert alert-info">No special opening days configured</div>';
        return;
    }

    // Sort by date
    hours.sort((a, b) => new Date(a.special_date) - new Date(b.special_date));

    container.innerHTML = hours.map(h => `
        <div class="card mb-3">
            <div class="card-body">
                <div class="row align-items-center">
                    <div class="col-md-3">
                        <strong><i class="bi bi-calendar-plus"></i> ${moment(h.special_date).format('DD/MM/YYYY (dddd)')}</strong>
                    </div>
                    <div class="col-md-5">
                        ${h.is_open ?
                            `<span class="badge bg-success">Open</span> ${h.start_time.substring(0,5)} - ${h.end_time.substring(0,5)}` :
                            `<span class="badge bg-danger">Closed</span>`
                        }
                        ${h.reason ? `<br><small class="text-muted">${escapeHtml(h.reason)}</small>` : ''}
                    </div>
                    <div class="col-md-4 text-end">
                        <button class="btn btn-sm btn-outline-primary" onclick="editSpecialHours(${h.id})">
                            <i class="bi bi-pencil"></i> Edit
                        </button>
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteSpecialHours(${h.id})">
                            <i class="bi bi-trash"></i> Delete
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

function toggleSpecialHours() {
    const isOpen = document.getElementById('is_open').checked;
    const timeContainer = document.getElementById('special-hours-time-container');
    timeContainer.style.display = isOpen ? 'block' : 'none';
}

function showSpecialHoursModal(id = null) {
    document.getElementById('special_hours_id').value = '';
    document.getElementById('special_date').value = '';
    document.getElementById('is_open').checked = true;
    document.getElementById('special_start_time').value = '08:00';
    document.getElementById('special_end_time').value = '23:00';
    document.getElementById('special_reason').value = '';
    toggleSpecialHours();

    if (id) {
        loadSpecialHoursData(id);
    }

    const modal = new bootstrap.Modal(document.getElementById('specialHoursModal'));
    modal.show();
}

async function loadSpecialHoursData(id) {
    try {
        const response = await fetch(`/api/admin/booking-schedule/special-hours/${id}`);
        if (response.ok) {
            const h = await response.json();
            document.getElementById('special_hours_id').value = h.id;
            document.getElementById('special_date').value = h.special_date;
            document.getElementById('is_open').checked = h.is_open === 1;
            document.getElementById('special_start_time').value = h.start_time ? h.start_time.substring(0, 5) : '08:00';
            document.getElementById('special_end_time').value = h.end_time ? h.end_time.substring(0, 5) : '23:00';
            document.getElementById('special_reason').value = h.reason || '';
            toggleSpecialHours();
        }
    } catch (error) {
        console.error('Load special hours error:', error);
    }
}

async function saveSpecialHours() {
    const id = document.getElementById('special_hours_id').value;
    const specialDate = document.getElementById('special_date').value;
    const isOpen = document.getElementById('is_open').checked;
    const startTime = document.getElementById('special_start_time').value + ':00';
    const endTime = document.getElementById('special_end_time').value + ':00';
    const reason = document.getElementById('special_reason').value;

    if (!specialDate) {
        showAlert('Please select a date', 'warning');
        return;
    }

    if (isOpen && (!startTime || !endTime)) {
        showAlert('Please set opening and closing times', 'warning');
        return;
    }

    const data = {
        clinic_id: CLINIC_ID,
        special_date: specialDate,
        is_open: isOpen ? 1 : 0,
        start_time: isOpen ? startTime : null,
        end_time: isOpen ? endTime : null,
        reason: reason
    };

    try {
        const url = id ? `/api/admin/booking-schedule/special-hours/${id}` : '/api/admin/booking-schedule/special-hours';
        const method = id ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            showAlert('Special opening day saved successfully', 'success');
            bootstrap.Modal.getInstance(document.getElementById('specialHoursModal')).hide();
            loadSpecialHours();
        } else {
            const error = await response.json();
            showAlert(error.error || 'Failed to save special opening day', 'danger');
        }
    } catch (error) {
        console.error('Save special hours error:', error);
        showAlert('Error saving special opening day', 'danger');
    }
}

function editSpecialHours(id) {
    showSpecialHoursModal(id);
}

async function deleteSpecialHours(id) {
    if (!confirm('Are you sure you want to delete this special opening day?')) return;

    try {
        const response = await fetch(`/api/admin/booking-schedule/special-hours/${id}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            showAlert('Special opening day deleted successfully', 'success');
            loadSpecialHours();
        } else {
            showAlert('Failed to delete special opening day', 'danger');
        }
    } catch (error) {
        console.error('Delete special hours error:', error);
        showAlert('Error deleting special opening day', 'danger');
    }
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

function showAlert(message, type = 'info') {
    const alertHtml = `
        <div class="alert alert-${type} alert-dismissible fade show position-fixed top-0 start-50 translate-middle-x mt-3" style="z-index: 9999; max-width: 500px;">
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', alertHtml);
    setTimeout(() => {
        const alert = document.querySelector('.alert');
        if (alert) alert.remove();
    }, 5000);
}

function escapeHtml(unsafe) {
    if (unsafe === null || unsafe === undefined) return '';
    return String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
