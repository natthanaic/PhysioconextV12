// Patients Page JavaScript
let currentPage = 1;

/**
 * Load clinics into dropdown
 */
async function loadClinics() {
    try {
        const response = await apiGet('/api/clinics');

        if (response) {
            const select = document.getElementById('filterClinic');

            response.forEach(clinic => {
                const option = document.createElement('option');
                option.value = clinic.id;
                option.textContent = escapeHtml(clinic.name);
                select.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Error loading clinics:', error);
    }
}

/**
 * Load patients with pagination and filters
 * @param {number} page - Page number
 */
async function loadPatients(page = 1) {
    try {
        currentPage = page;
        const params = new URLSearchParams({
            page: page,
            limit: 12
        });

        const searchHN = document.getElementById('searchHN').value;
        const searchName = document.getElementById('searchName').value;
        const clinicId = document.getElementById('filterClinic').value;

        if (searchHN || searchName) {
            params.append('search', searchHN || searchName);
        }
        if (clinicId) {
            params.append('clinic_id', clinicId);
        }

        const data = await apiGet(`/api/patients?${params}`);

        if (data) {
            displayPatients(data.patients);
            displayPagination(data.pagination);
        }
    } catch (error) {
        console.error('Error loading patients:', error);
        showAlert('Failed to load patients', 'danger');
    }
}

/**
 * Get country flag emoji from ISO 3166-1 alpha-3 code
 * @param {string} countryCode - ISO 3-letter country code (e.g., THA, USA, GBR)
 * @returns {string} Flag emoji
 */
function getCountryFlag(countryCode) {
    if (!countryCode) return '🇹🇭'; // Default Thai flag

    // Map ISO alpha-3 to alpha-2 for flag emoji
    const codeMap = {
        'THA': 'TH', 'USA': 'US', 'GBR': 'GB', 'CHN': 'CN', 'JPN': 'JP',
        'KOR': 'KR', 'SGP': 'SG', 'MYS': 'MY', 'IDN': 'ID', 'VNM': 'VN',
        'PHL': 'PH', 'IND': 'IN', 'AUS': 'AU', 'NZL': 'NZ', 'CAN': 'CA',
        'FRA': 'FR', 'DEU': 'DE', 'ITA': 'IT', 'ESP': 'ES', 'RUS': 'RU',
        'BRA': 'BR', 'MEX': 'MX', 'ARG': 'AR', 'ZAF': 'ZA', 'EGY': 'EG',
        'SAU': 'SA', 'ARE': 'AE', 'QAT': 'QA', 'KWT': 'KW', 'BHR': 'BH',
        'NLD': 'NL', 'BEL': 'BE', 'CHE': 'CH', 'AUT': 'AT', 'SWE': 'SE',
        'NOR': 'NO', 'DNK': 'DK', 'FIN': 'FI', 'POL': 'PL', 'CZE': 'CZ',
        'HUN': 'HU', 'PRT': 'PT', 'GRC': 'GR', 'TUR': 'TR', 'ISR': 'IL'
    };

    const alpha2 = codeMap[countryCode.toUpperCase()];
    if (!alpha2) return '🌐'; // Generic globe for unknown

    // Convert alpha-2 to flag emoji (regional indicator symbols)
    return String.fromCodePoint(...[...alpha2].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

/**
 * Display patients in grid
 * @param {Array} patients - Array of patient objects
 */
function displayPatients(patients) {
    const grid = document.getElementById('patientsGrid');

    if (patients.length === 0) {
        grid.innerHTML = `
            <div class="col-12 text-center">
                <p class="text-muted">No patients found</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = patients.map(patient => {
        // Get country flag emoji
        const flag = patient.nationality ? getCountryFlag(patient.nationality) : '🇹🇭';

        // Format gender badge (no icons, just text)
        const genderBadge = patient.gender
            ? `<span class="badge bg-light text-secondary border me-1" style="font-size: 0.7rem;">${patient.gender === 'M' ? 'Male' : patient.gender === 'F' ? 'Female' : 'Other'}</span>`
            : '';

        return `
        <div class="col-md-6 col-lg-4 mb-3">
            <div class="card patient-card h-100" onclick="viewPatient(${patient.id})">
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-start mb-2">
                        <h5 class="card-title mb-0">${flag} ${escapeHtml(patient.first_name)} ${escapeHtml(patient.last_name)}</h5>
                        <span class="badge bg-primary">${escapeHtml(patient.hn)}</span>
                    </div>
                    <div class="mb-2">
                        ${genderBadge}
                    </div>
                    <p class="card-text">
                        <small class="text-muted">
                            <i class="bi bi-calendar me-1"></i>DOB: ${formatDate(patient.dob)}<br>
                            <i class="bi bi-building me-1"></i>${escapeHtml(patient.clinic_name)}<br>
                            <i class="bi bi-file-medical me-1"></i>${truncateText(escapeHtml(patient.diagnosis), 50)}
                        </small>
                    </p>
                    <div class="d-flex justify-content-between">
                        <button class="btn btn-sm btn-outline-primary" onclick="event.stopPropagation(); viewPatient(${patient.id})">
                            <i class="bi bi-eye"></i> View
                        </button>
                        <button class="btn btn-sm btn-outline-success" onclick="event.stopPropagation(); createPN(${patient.id})">
                            <i class="bi bi-plus-circle"></i> PN
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    }).join('');
}

/**
 * Display pagination controls
 * @param {Object} pagination - Pagination object with page and pages
 */
function displayPagination(pagination) {
    const paginationEl = document.getElementById('pagination');
    const { page, pages } = pagination;

    if (pages <= 1) {
        paginationEl.innerHTML = '';
        return;
    }

    let html = '';

    // Previous button
    html += `
        <li class="page-item ${page === 1 ? 'disabled' : ''}">
            <a class="page-link" href="#" onclick="loadPatients(${page - 1}); return false;" aria-label="Previous">
                Previous
            </a>
        </li>
    `;

    // Page numbers
    for (let i = 1; i <= Math.min(pages, 5); i++) {
        html += `
            <li class="page-item ${i === page ? 'active' : ''}">
                <a class="page-link" href="#" onclick="loadPatients(${i}); return false;">${i}</a>
            </li>
        `;
    }

    // Next button
    html += `
        <li class="page-item ${page === pages ? 'disabled' : ''}">
            <a class="page-link" href="#" onclick="loadPatients(${page + 1}); return false;" aria-label="Next">
                Next
            </a>
        </li>
    `;

    paginationEl.innerHTML = html;
}

/**
 * Search patients
 */
function searchPatients() {
    loadPatients(1);
}

/**
 * View patient detail page
 * @param {number} id - Patient ID
 */
function viewPatient(id) {
    window.location.href = `/patient/${id}`;
}

/**
 * Create PN case for patient
 * @param {number} patientId - Patient ID
 */
function createPN(patientId) {
    window.location.href = `/patient/${patientId}#create-pn`;
}

/**
 * Download CSV template
 */
function downloadCSVTemplate() {
    window.location.href = `/api/patients/csv/template?token=${token}`;
}

/**
 * Show import modal
 */
function showImportModal() {
    const modal = new bootstrap.Modal(document.getElementById('importCSVModal'));
    // Reset form
    document.getElementById('csvFileInput').value = '';
    document.getElementById('import-results').innerHTML = '';
    document.getElementById('import-progress').classList.add('d-none');
    modal.show();
}

/**
 * Upload and import CSV file
 */
async function uploadCSV() {
    const fileInput = document.getElementById('csvFileInput');
    const file = fileInput.files[0];

    if (!file) {
        showAlert('Please select a CSV file to upload', 'warning');
        return;
    }

    if (!file.name.endsWith('.csv')) {
        showAlert('Please select a valid CSV file', 'warning');
        return;
    }

    const formData = new FormData();
    formData.append('file', file);

    const progressDiv = document.getElementById('import-progress');
    const resultsDiv = document.getElementById('import-results');
    const uploadBtn = document.getElementById('btn-upload');

    try {
        // Show progress
        progressDiv.classList.remove('d-none');
        uploadBtn.disabled = true;
        resultsDiv.innerHTML = '';
        const response = await fetch('/api/patients/csv/import', {
            method: 'POST',
            headers: {
            },
            body: formData
        });

        const result = await response.json();

        // Hide progress
        progressDiv.classList.add('d-none');
        uploadBtn.disabled = false;

        if (response.ok) {
            // Show success results
            resultsDiv.innerHTML = `
                <div class="alert alert-success">
                    <h6><i class="bi bi-check-circle me-2"></i>Import Successful!</h6>
                    <p class="mb-1"><strong>Total processed:</strong> ${result.total}</p>
                    <p class="mb-1"><strong>Successfully imported:</strong> ${result.success}</p>
                    ${result.failed > 0 ? `<p class="mb-0"><strong>Failed:</strong> ${result.failed}</p>` : ''}
                </div>
            `;

            if (result.errors && result.errors.length > 0) {
                resultsDiv.innerHTML += `
                    <div class="alert alert-warning">
                        <h6>Errors:</h6>
                        <ul class="mb-0">
                            ${result.errors.map(err => `<li>Row ${err.row}: ${escapeHtml(err.error)}</li>`).join('')}
                        </ul>
                    </div>
                `;
            }

            // Reload patients list
            if (result.success > 0) {
                setTimeout(() => {
                    loadPatients();
                    bootstrap.Modal.getInstance(document.getElementById('importCSVModal')).hide();
                }, 2000);
            }
        } else {
            resultsDiv.innerHTML = `
                <div class="alert alert-danger">
                    <i class="bi bi-exclamation-triangle me-2"></i>${escapeHtml(result.error || 'Import failed')}
                </div>
            `;
        }
    } catch (error) {
        console.error('Upload error:', error);
        progressDiv.classList.add('d-none');
        uploadBtn.disabled = false;
        resultsDiv.innerHTML = `
            <div class="alert alert-danger">
                <i class="bi bi-exclamation-triangle me-2"></i>Network error. Please try again.
            </div>
        `;
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    loadClinics();
    loadPatients();

    // Search on enter key
    document.getElementById('searchHN').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchPatients();
    });
    document.getElementById('searchName').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchPatients();
    });
});