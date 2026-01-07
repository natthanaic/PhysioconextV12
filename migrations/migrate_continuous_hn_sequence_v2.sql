-- =====================================================
-- Migration: Convert PTHN from yearly reset to continuous sequence (V2)
-- =====================================================
-- This migration reads the ACTUAL max sequence from patients table
-- to ensure accurate continuation of HN numbering
--
-- Date: 2026-01-07
-- =====================================================

-- Step 1: Find the maximum sequence number from ACTUAL patient HNs
-- Extract the last 4 digits from HN format PTYYXXXX (e.g., PT260131 -> 131)
SET @max_sequence = (
    SELECT COALESCE(MAX(CAST(SUBSTRING(hn, 5) AS UNSIGNED)), 0)
    FROM patients
    WHERE hn LIKE 'PT%'
    AND LENGTH(hn) = 8
    AND SUBSTRING(hn, 5) REGEXP '^[0-9]+$'
);

-- Step 2: Display what we found
SELECT
    @max_sequence AS current_max_sequence,
    CONCAT('Next HN will be: PT', LPAD(YEAR(NOW()) % 100, 2, '0'), LPAD(@max_sequence + 1, 4, '0')) AS next_hn_preview;

-- Step 3: Insert or update the global sequence record (year = 0)
INSERT INTO pthn_sequence (year, last_sequence, created_at)
VALUES (0, @max_sequence, NOW())
ON DUPLICATE KEY UPDATE
    last_sequence = @max_sequence,
    updated_at = NOW();

-- Step 4: Verify the migration
SELECT
    CONCAT('✓ Global sequence initialized at: ', last_sequence) AS migration_result,
    CONCAT('✓ Next HN will be: PT', LPAD(YEAR(NOW()) % 100, 2, '0'), LPAD(last_sequence + 1, 4, '0')) AS next_hn
FROM pthn_sequence
WHERE year = 0;

-- =====================================================
-- NOTES:
-- =====================================================
-- 1. This reads the actual max HN from patients table (not pthn_sequence)
-- 2. Example: If last HN is PT260131, next will be PT260132
-- 3. Old year-based records (year = 25, 26, etc.) are kept for historical reference
-- 4. The new system uses year = 0 as the global sequence identifier
-- 5. Sequence continues forever and never resets
-- =====================================================
