// LINE LIFF Registration Flow
let liffProfile = null;
let currentPatient = null;  // Store verified patient data
let currentPhone = null;
let currentEmail = null;
let resendCountdown = 60;
let countdownInterval = null;

// Initialize LIFF
document.addEventListener('DOMContentLoaded', async () => {
    try {
        showLoading(true);

        // Get LIFF ID from server
        const liffId = window.LIFF_ID || '';

        if (!liffId) {
            showAlert('danger', 'LIFF ID ยังไม่ได้ตั้งค่า กรุณาติดต่อผู้ดูแลระบบ<br>LIFF ID not configured. Please contact administrator.');
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

        // Check if already registered
        const checkResult = await checkLineRegistration(liffProfile.userId);

        if (checkResult.registered) {
            // Already registered - redirect immediately to portal
            window.location.href = '/line/portal';
            return;
        }

        showLoading(false);

    } catch (error) {
        console.error('LIFF initialization failed:', error);
        showAlert('danger', 'ไม่สามารถเชื่อมต่อกับ LINE ได้<br>กรุณาลองใหม่อีกครั้ง');
        showLoading(false);
    }
});

// Check if LINE ID is already registered
async function checkLineRegistration(lineUserId) {
    try {
        const response = await fetch(`/api/line/check-registration?line_user_id=${lineUserId}`);
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error checking registration:', error);
        return { registered: false };
    }
}

// Step navigation
function goToStep(stepNumber) {
    // Hide all steps
    document.querySelectorAll('.step').forEach(step => {
        step.classList.remove('active');
    });

    // Show target step
    document.getElementById(`step${stepNumber}`).classList.add('active');
}

// ========================================
// STEP 1: Terms Acceptance
// ========================================
document.getElementById('acceptTerms').addEventListener('change', function() {
    document.getElementById('btnAcceptTerms').disabled = !this.checked;
});

document.getElementById('btnAcceptTerms').addEventListener('click', function() {
    goToStep(2);
});

// ========================================
// STEP 2: PID/Passport Verification
// ========================================

// PID/Passport input validation
document.getElementById('pidPassport').addEventListener('input', function() {
    // Remove spaces and special characters
    this.value = this.value.replace(/[^a-zA-Z0-9]/g, '');

    // Enable button if at least 5 characters (minimum for passport)
    const isValid = this.value.length >= 5;
    document.getElementById('btnVerifyPID').disabled = !isValid;
});

// Verify PID/Passport
document.getElementById('btnVerifyPID').addEventListener('click', async function() {
    const pidPassport = document.getElementById('pidPassport').value.trim();

    if (pidPassport.length < 5) {
        showAlert('warning', 'กรุณากรอกเลขบัตรประชาชนหรือหมายเลขพาสปอร์ต');
        return;
    }

    try {
        showLoading(true);

        const response = await fetch('/api/line/verify-pid', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                pid_passport: pidPassport
            })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            // Store patient data
            currentPatient = data.patient;

            // Display patient data in Step 3
            displayPatientData(data.patient);

            // Pre-fill phone and email
            document.getElementById('phoneNumber').value = data.patient.phone || '';
            document.getElementById('emailAddress').value = data.patient.email || '';

            // Validate phone to enable Send OTP button
            validatePhoneForOTP();

            // Go to Step 3
            showAlert('success', 'พบข้อมูลผู้ป่วยในระบบ กรุณาตรวจสอบและยืนยันข้อมูล');
            goToStep(3);
        } else {
            showAlert('danger', data.error || 'ไม่พบข้อมูลผู้ป่วยในระบบ กรุณาลงทะเบียนที่คลินิกก่อน');
        }

    } catch (error) {
        console.error('Error verifying PID:', error);
        showAlert('danger', 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
    } finally {
        showLoading(false);
    }
});

// Display patient data in Step 3
function displayPatientData(patient) {
    const fullName = `${patient.first_name || ''} ${patient.last_name || ''}`.trim() || 'ไม่ระบุชื่อ';
    const hn = patient.hn || patient.pt_number || '-';
    const gender = patient.gender === 'M' ? 'ชาย' : patient.gender === 'F' ? 'หญิง' : '-';
    const dob = patient.date_of_birth
        ? new Date(patient.date_of_birth).toLocaleDateString('th-TH')
        : '-';

    const html = `
        <div style="background: #f8f9fa; padding: 1rem; border-radius: 10px; border: 1px solid #dee2e6;">
            <h6 class="mb-2"><i class="bi bi-person-check-fill text-success"></i> ข้อมูลผู้ป่วย</h6>
            <div style="display: grid; grid-template-columns: auto 1fr; gap: 0.5rem; font-size: 0.9rem;">
                <strong>ชื่อ-นามสกุล:</strong>
                <span>${fullName}</span>

                <strong>HN:</strong>
                <span>${hn}</span>

                <strong>เพศ:</strong>
                <span>${gender}</span>

                <strong>วันเกิด:</strong>
                <span>${dob}</span>
            </div>
            <div class="alert alert-info mt-2 mb-0" style="font-size: 0.85rem; padding: 0.5rem;">
                <i class="bi bi-info-circle"></i> ตรวจสอบข้อมูลให้ถูกต้อง และอัพเดทเบอร์โทรศัพท์/อีเมลด้านล่างหากไม่ถูกต้อง
            </div>
        </div>
    `;

    document.getElementById('patientDataCard').innerHTML = html;
}

// ========================================
// STEP 3: Confirm Patient Data & Phone Number
// ========================================

// Phone number validation for Step 3
document.getElementById('phoneNumber').addEventListener('input', function() {
    // Only allow numbers
    this.value = this.value.replace(/[^0-9]/g, '');
    validatePhoneForOTP();
});

// Email validation (optional)
document.getElementById('emailAddress').addEventListener('input', function() {
    validatePhoneForOTP();
});

function validatePhoneForOTP() {
    const phone = document.getElementById('phoneNumber').value;
    const isValid = /^0[0-9]{9}$/.test(phone);
    document.getElementById('btnSendOTP').disabled = !isValid;
}

// Send OTP
document.getElementById('btnSendOTP').addEventListener('click', async function() {
    const phone = document.getElementById('phoneNumber').value;
    const email = document.getElementById('emailAddress').value.trim();

    if (!/^0[0-9]{9}$/.test(phone)) {
        showAlert('warning', 'กรุณากรอกหมายเลขโทรศัพท์ให้ถูกต้อง (10 หลัก)');
        return;
    }

    if (!currentPatient) {
        showAlert('danger', 'ไม่พบข้อมูลผู้ป่วย กรุณาเริ่มต้นใหม่');
        return;
    }

    if (!liffProfile) {
        showAlert('danger', 'ไม่พบข้อมูล LINE Profile กรุณาลองใหม่อีกครั้ง');
        return;
    }

    try {
        showLoading(true);

        const response = await fetch('/api/line/send-otp', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                phone: phone,
                email: email || null,
                patient_id: currentPatient.id,
                line_user_id: liffProfile.userId,
                line_display_name: liffProfile.displayName,
                line_picture_url: liffProfile.pictureUrl
            })
        });

        const data = await response.json();

        if (response.ok) {
            currentPhone = phone;
            currentEmail = email;
            document.getElementById('displayPhone').textContent = phone;
            showAlert('success', 'ส่งรหัส OTP ไปยังหมายเลขโทรศัพท์ของคุณแล้ว');
            goToStep(4);
            startCountdown();
        } else {
            showAlert('danger', data.error || 'ไม่สามารถส่ง OTP ได้');
        }

    } catch (error) {
        console.error('Error sending OTP:', error);
        showAlert('danger', 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
    } finally {
        showLoading(false);
    }
});

// ========================================
// STEP 4: OTP Verification
// ========================================

// OTP input handling
const otpInputs = document.querySelectorAll('.otp-digit');

otpInputs.forEach((input, index) => {
    input.addEventListener('input', function(e) {
        // Only allow numbers
        this.value = this.value.replace(/[^0-9]/g, '');

        // Auto-focus next input
        if (this.value.length === 1 && index < otpInputs.length - 1) {
            otpInputs[index + 1].focus();
        }

        // Check if all digits filled
        const allFilled = Array.from(otpInputs).every(input => input.value.length === 1);
        document.getElementById('btnVerifyOTP').disabled = !allFilled;
    });

    // Handle backspace
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Backspace' && this.value === '' && index > 0) {
            otpInputs[index - 1].focus();
        }
    });

    // Handle paste
    input.addEventListener('paste', function(e) {
        e.preventDefault();
        const pastedData = e.clipboardData.getData('text').replace(/[^0-9]/g, '');

        if (pastedData.length === 6) {
            pastedData.split('').forEach((digit, i) => {
                if (otpInputs[i]) {
                    otpInputs[i].value = digit;
                }
            });
            document.getElementById('btnVerifyOTP').disabled = false;
        }
    });
});

// Verify OTP
document.getElementById('btnVerifyOTP').addEventListener('click', async function() {
    const otp = Array.from(otpInputs).map(input => input.value).join('');

    if (otp.length !== 6) {
        showAlert('warning', 'กรุณากรอกรหัส OTP ให้ครบ 6 หลัก');
        return;
    }

    if (!currentPatient) {
        showAlert('danger', 'ไม่พบข้อมูลผู้ป่วย');
        return;
    }

    if (!liffProfile) {
        showAlert('danger', 'ไม่พบข้อมูล LINE Profile');
        return;
    }

    try {
        showLoading(true);

        const response = await fetch('/api/line/verify-otp', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                phone: currentPhone,
                email: currentEmail || null,
                otp_code: otp,
                patient_id: currentPatient.id,
                line_user_id: liffProfile.userId,
                line_display_name: liffProfile.displayName,
                line_picture_url: liffProfile.pictureUrl
            })
        });

        const data = await response.json();

        if (response.ok) {
            goToStep(5);  // Show success step

            if (countdownInterval) {
                clearInterval(countdownInterval);
            }

            // Redirect to portal after 2 seconds
            setTimeout(() => {
                window.location.href = '/line/portal';
            }, 2000);
        } else {
            showAlert('danger', data.error || 'รหัส OTP ไม่ถูกต้อง');
            // Clear OTP inputs
            otpInputs.forEach(input => input.value = '');
            otpInputs[0].focus();
        }

    } catch (error) {
        console.error('Error verifying OTP:', error);
        showAlert('danger', 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
    } finally {
        showLoading(false);
    }
});

// Resend OTP - go back to Step 3 (phone confirmation)
document.getElementById('btnResendOTP').addEventListener('click', function() {
    if (this.disabled) return;

    // Clear OTP inputs
    otpInputs.forEach(input => input.value = '');
    otpInputs[0].focus();

    // Clear countdown
    if (countdownInterval) {
        clearInterval(countdownInterval);
    }

    // Go back to phone/email confirmation
    goToStep(3);
});

// Countdown timer
function startCountdown() {
    resendCountdown = 60;
    document.getElementById('btnResendOTP').disabled = true;
    document.getElementById('countdown').textContent = resendCountdown;

    countdownInterval = setInterval(() => {
        resendCountdown--;
        document.getElementById('countdown').textContent = resendCountdown;

        if (resendCountdown <= 0) {
            clearInterval(countdownInterval);
            document.getElementById('btnResendOTP').disabled = false;
            document.getElementById('btnResendOTP').textContent = 'ส่งรหัส OTP อีกครั้ง';
        }
    }, 1000);
}

// Helper functions
function showLoading(show) {
    document.getElementById('loading').style.display = show ? 'block' : 'none';
}

function showAlert(type, message) {
    const alertContainer = document.getElementById('alertContainer');
    const alertHTML = `
        <div class="alert alert-${type} alert-dismissible fade show" role="alert">
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>
    `;
    alertContainer.innerHTML = alertHTML;

    // Auto-dismiss after 5 seconds
    setTimeout(() => {
        const alert = alertContainer.querySelector('.alert');
        if (alert) {
            alert.classList.remove('show');
            setTimeout(() => alertContainer.innerHTML = '', 300);
        }
    }, 5000);
}
