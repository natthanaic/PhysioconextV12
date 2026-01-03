// LINE Patient Portal
let liffProfile = null;

// Initialize LIFF
document.addEventListener('DOMContentLoaded', async () => {
    try {
        showLoading(true);

        // Get LIFF ID from server
        const liffId = window.LIFF_ID || '';

        if (!liffId) {
            alert('LIFF ID not configured');
            showLoading(false);
            return;
        }

        console.log('Initializing LIFF with ID:', liffId);

        await liff.init({ liffId: liffId });

        if (!liff.isLoggedIn()) {
            liff.login();
            return;
        }

        // Get LINE profile
        liffProfile = await liff.getProfile();
        console.log('LINE Profile:', liffProfile);

        // Check if registered
        const checkResult = await checkRegistration(liffProfile.userId);

        if (!checkResult.registered) {
            // Not registered, redirect to registration
            window.location.href = '/line/register';
            return;
        }

        // Load all data
        await loadPatientData(liffProfile.userId);
        await loadPNCases(liffProfile.userId);
        await loadAppointments(liffProfile.userId);
        await loadBills(liffProfile.userId);

        showLoading(false);

    } catch (error) {
        console.error('LIFF initialization failed:', error);
        showLoading(false);
        alert('ไม่สามารถเชื่อมต่อกับ LINE ได้');
    }
});

// Check if user is registered
async function checkRegistration(lineUserId) {
    try {
        const response = await fetch(`/api/line/check-registration?line_user_id=${lineUserId}`);
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error checking registration:', error);
        return { registered: false };
    }
}

// Load patient data
async function loadPatientData(lineUserId) {
    try {
        const response = await fetch(`/api/line/my-info?line_user_id=${lineUserId}`);
        const data = await response.json();

        if (data.success) {
            displayPatientCard(data.patient);
        }
    } catch (error) {
        console.error('Error loading patient data:', error);
        document.getElementById('patientCard').innerHTML = `
            <div class="alert alert-danger">ไม่สามารถโหลดข้อมูลผู้ป่วยได้</div>
        `;
    }
}

// Display patient card
function displayPatientCard(patient) {
    const fullName = `${patient.first_name || ''} ${patient.last_name || ''}`.trim() || 'ไม่ระบุชื่อ';
    const hn = patient.hn || patient.pt_number || '-';
    const phone = patient.phone || '-';
    const email = patient.email || '-';
    const connectedDate = patient.line_connected_at
        ? new Date(patient.line_connected_at).toLocaleDateString('th-TH')
        : '-';

    const html = `
        <div class="patient-header">
            <img src="${liffProfile.pictureUrl || '/public/images/default-avatar.png'}"
                 class="patient-avatar" alt="Profile">
            <div class="patient-info flex-grow-1">
                <h4>${fullName}</h4>
                <span class="badge bg-success">ผู้ป่วยลงทะเบียน</span>
            </div>
        </div>
        <div class="patient-details">
            <div class="detail-item">
                <span class="detail-label">HN</span>
                <span class="detail-value">${hn}</span>
            </div>
            <div class="detail-item">
                <span class="detail-label">เบอร์โทร</span>
                <span class="detail-value">${phone}</span>
            </div>
            <div class="detail-item">
                <span class="detail-label">อีเมล</span>
                <span class="detail-value">${email}</span>
            </div>
            <div class="detail-item">
                <span class="detail-label">เชื่อมต่อ LINE</span>
                <span class="detail-value">${connectedDate}</span>
            </div>
        </div>
    `;

    document.getElementById('patientCard').innerHTML = html;
}

// Load PN Cases
async function loadPNCases(lineUserId) {
    try {
        const response = await fetch(`/api/line/my-pn-cases?line_user_id=${lineUserId}`);
        const data = await response.json();

        if (data.success) {
            displayPNCases(data.pn_cases);
        }
    } catch (error) {
        console.error('Error loading PN cases:', error);
        document.getElementById('pnCasesList').innerHTML = `
            <div class="alert alert-danger">ไม่สามารถโหลดข้อมูล PN Cases ได้</div>
        `;
    }
}

// Display PN Cases
function displayPNCases(pnCases) {
    const container = document.getElementById('pnCasesList');

    if (pnCases.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="bi bi-file-medical"></i>
                <p>ยังไม่มี PN Cases</p>
            </div>
        `;
        return;
    }

    const html = pnCases.map(pn => {
        const pnDate = new Date(pn.pn_date).toLocaleDateString('th-TH');
        return `
            <div class="list-item">
                <div class="list-item-header">
                    <div>
                        <div class="item-title">${pn.pn_type || 'PN Case'}</div>
                        <div class="item-date"><i class="bi bi-calendar3"></i> ${pnDate}</div>
                    </div>
                </div>
                <div class="item-content">
                    <strong>Chief Complaint:</strong> ${pn.chief_complaint || '-'}<br>
                    <strong>Diagnosis:</strong> ${pn.diagnosis || '-'}<br>
                    <strong>Treatment Plan:</strong> ${pn.treatment_plan || '-'}
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = html;
}

// Load Appointments
async function loadAppointments(lineUserId) {
    try {
        const response = await fetch(`/api/line/my-appointments?line_user_id=${lineUserId}`);
        const data = await response.json();

        if (data.success) {
            displayAppointments(data.appointments);
        }
    } catch (error) {
        console.error('Error loading appointments:', error);
        document.getElementById('appointmentsList').innerHTML = `
            <div class="alert alert-danger">ไม่สามารถโหลดข้อมูลนัดหมายได้</div>
        `;
    }
}

// Display Appointments
function displayAppointments(appointments) {
    const container = document.getElementById('appointmentsList');

    if (appointments.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="bi bi-calendar-x"></i>
                <p>ยังไม่มีนัดหมาย</p>
                <a href="/public-booking" class="btn btn-primary mt-2">
                    <i class="bi bi-plus-circle me-2"></i>จองนัดหมายใหม่
                </a>
            </div>
        `;
        return;
    }

    const html = appointments.map(apt => {
        const aptDate = new Date(apt.appointment_date).toLocaleDateString('th-TH');
        const statusClass = apt.status === 'confirmed' ? 'status-confirmed' :
                          apt.status === 'cancelled' ? 'status-cancelled' :
                          'status-pending';
        const statusText = apt.status === 'confirmed' ? 'ยืนยันแล้ว' :
                          apt.status === 'cancelled' ? 'ยกเลิก' :
                          'รอยืนยัน';

        return `
            <div class="list-item">
                <div class="list-item-header">
                    <div>
                        <div class="item-title">${apt.service_name || 'นัดหมาย'}</div>
                        <div class="item-date">
                            <i class="bi bi-calendar3"></i> ${aptDate}
                            <i class="bi bi-clock ms-2"></i> ${apt.appointment_time || '-'}
                        </div>
                    </div>
                    <span class="status-badge ${statusClass}">${statusText}</span>
                </div>
                ${apt.notes ? `<div class="item-content">${apt.notes}</div>` : ''}
            </div>
        `;
    }).join('');

    container.innerHTML = html;
}

// Load Bills
async function loadBills(lineUserId) {
    try {
        const response = await fetch(`/api/line/my-bills?line_user_id=${lineUserId}`);
        const data = await response.json();

        if (data.success) {
            displayBills(data.bills);
        }
    } catch (error) {
        console.error('Error loading bills:', error);
        document.getElementById('billsList').innerHTML = `
            <div class="alert alert-danger">ไม่สามารถโหลดข้อมูลบิลได้</div>
        `;
    }
}

// Display Bills
function displayBills(bills) {
    const container = document.getElementById('billsList');

    if (bills.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="bi bi-receipt"></i>
                <p>ยังไม่มีบิล</p>
            </div>
        `;
        return;
    }

    const html = bills.map(bill => {
        const billDate = new Date(bill.bill_date).toLocaleDateString('th-TH');
        const totalAmount = parseFloat(bill.total_amount || 0).toLocaleString('th-TH', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        const paidAmount = parseFloat(bill.paid_amount || 0).toLocaleString('th-TH', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        const statusClass = bill.status === 'paid' ? 'status-paid' : 'status-unpaid';
        const statusText = bill.status === 'paid' ? 'ชำระแล้ว' : 'ยังไม่ชำระ';

        return `
            <div class="list-item">
                <div class="list-item-header">
                    <div>
                        <div class="item-title">บิล #${bill.bill_number || bill.id}</div>
                        <div class="item-date"><i class="bi bi-calendar3"></i> ${billDate}</div>
                    </div>
                    <span class="status-badge ${statusClass}">${statusText}</span>
                </div>
                <div class="item-content">
                    <div class="d-flex justify-content-between mb-1">
                        <span>ยอดรวม:</span>
                        <strong>${totalAmount} บาท</strong>
                    </div>
                    <div class="d-flex justify-content-between">
                        <span>ชำระแล้ว:</span>
                        <strong class="text-success">${paidAmount} บาท</strong>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = html;
}

// Helper functions
function showLoading(show) {
    document.getElementById('loading').style.display = show ? 'flex' : 'none';
}
