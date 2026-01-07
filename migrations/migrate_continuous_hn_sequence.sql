-- =====================================================
-- Migration: Convert PTHN from yearly reset to continuous sequence
-- =====================================================
-- This migration converts the HN generation from resetting each year
-- to using a continuous global sequence across all years.
--
-- Before: PT250001, PT250002, ... PT250127, then PT260001 (resets)
-- After:  PT250001, PT250002, ... PT250127, PT260128, PT260129 (continuous)
--
-- Date: 2026-01-07
-- =====================================================

-- Step 1: Find the maximum sequence number across all years
SET @max_sequence = (SELECT COALESCE(MAX(last_sequence), 0) FROM pthn_sequence WHERE year != 0);

-- Step 2: Insert or update the global sequence record (year = 0)
INSERT INTO pthn_sequence (year, last_sequence, created_at)
VALUES (0, @max_sequence, NOW())
ON DUPLICATE KEY UPDATE
    last_sequence = @max_sequence,
    updated_at = NOW();

-- Step 3: Verify the migration
SELECT
    CONCAT('Global sequence initialized at: ', last_sequence) AS migration_result,
    CONCAT('Next HN will be: PT', LPAD(YEAR(NOW()) % 100, 2, '0'), LPAD(last_sequence + 1, 4, '0')) AS next_hn
FROM pthn_sequence
WHERE year = 0;

-- =====================================================
-- NOTES:
-- =====================================================
-- 1. Old year-based records (year = 25, 26, etc.) are kept for historical reference
-- 2. The new system uses year = 0 as the global sequence identifier
-- 3. Sequence continues from the highest value across all previous years
-- 4. HN format remains PTYYXXXX but XXXX never resets
-- =====================================================
