-- =====================================================
-- Migration: Add nationality column to patients table
-- =====================================================
-- Adds nationality field to support international patients
-- and display country flags in the UI
--
-- Date: 2026-01-07
-- =====================================================

-- Add nationality column to patients table
ALTER TABLE patients
ADD COLUMN nationality VARCHAR(3) DEFAULT NULL COMMENT 'ISO 3166-1 alpha-3 country code (e.g., THA, USA, GBR)'
AFTER passport_no;

-- Add index for faster filtering
ALTER TABLE patients
ADD INDEX idx_patient_nationality (nationality);

-- Display confirmation
SELECT
    '✓ Nationality column added successfully' AS migration_result,
    'Use ISO 3166-1 alpha-3 codes (THA, USA, GBR, etc.)' AS note;

-- =====================================================
-- NOTES:
-- =====================================================
-- 1. nationality uses ISO 3166-1 alpha-3 codes (3-letter codes)
-- 2. Examples: THA (Thailand), USA (United States), GBR (United Kingdom)
-- 3. NULL for Thai patients with National ID (default Thai)
-- 4. Required for patients with passport numbers
-- =====================================================
