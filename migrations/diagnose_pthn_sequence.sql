-- =====================================================
-- PTHN Sequence Diagnostic Script
-- =====================================================
-- Run this to diagnose PTHN sequence continuation issues
-- =====================================================

-- Check 1: Show all sequence records
SELECT '=== ALL SEQUENCE RECORDS ===' AS '';
SELECT
    year,
    last_sequence,
    CONCAT('PT', LPAD(year, 2, '0'), LPAD(last_sequence, 4, '0')) AS last_hn_format,
    CONCAT('PT', LPAD(YEAR(NOW()) % 100, 2, '0'), LPAD(last_sequence + 1, 4, '0')) AS next_hn_format,
    created_at,
    updated_at
FROM pthn_sequence
ORDER BY year;

-- Check 2: Look for global sequence record (year = 0)
SELECT '\n=== GLOBAL SEQUENCE (year = 0) ===' AS '';
SELECT
    CASE
        WHEN COUNT(*) = 0 THEN '❌ MISSING - Global sequence record (year=0) not found!'
        ELSE '✓ FOUND'
    END AS status,
    COALESCE(MAX(last_sequence), 0) AS current_sequence,
    CONCAT('PT', LPAD(YEAR(NOW()) % 100, 2, '0'), LPAD(COALESCE(MAX(last_sequence), 0) + 1, 4, '0')) AS next_hn
FROM pthn_sequence
WHERE year = 0;

-- Check 3: Show actual max HN from patients table
SELECT '\n=== ACTUAL MAX HN FROM PATIENTS ===' AS '';
SELECT
    MAX(hn) AS last_hn,
    COALESCE(MAX(CAST(SUBSTRING(hn, 5) AS UNSIGNED)), 0) AS last_sequence_number
FROM patients
WHERE hn LIKE 'PT%'
AND LENGTH(hn) = 8
AND SUBSTRING(hn, 5) REGEXP '^[0-9]+$';

-- Check 4: Show last 10 patients with their HNs
SELECT '\n=== LAST 10 PATIENTS ===' AS '';
SELECT
    id,
    hn,
    CONCAT(first_name, ' ', last_name) AS patient_name,
    created_at
FROM patients
ORDER BY id DESC
LIMIT 10;

-- Check 5: Comparison and recommendation
SELECT '\n=== DIAGNOSIS ===' AS '';
SELECT
    CASE
        WHEN (SELECT COUNT(*) FROM pthn_sequence WHERE year = 0) = 0
        THEN 'ISSUE: Global sequence record is missing. Run migrate_continuous_hn_sequence_v2.sql'
        WHEN (SELECT last_sequence FROM pthn_sequence WHERE year = 0)
             < (SELECT COALESCE(MAX(CAST(SUBSTRING(hn, 5) AS UNSIGNED)), 0) FROM patients WHERE hn LIKE 'PT%' AND LENGTH(hn) = 8)
        THEN CONCAT('ISSUE: Global sequence (', (SELECT last_sequence FROM pthn_sequence WHERE year = 0), ') is behind actual max (', (SELECT COALESCE(MAX(CAST(SUBSTRING(hn, 5) AS UNSIGNED)), 0) FROM patients WHERE hn LIKE 'PT%' AND LENGTH(hn) = 8), '). Re-run migrate_continuous_hn_sequence_v2.sql')
        ELSE CONCAT('✓ OK: Sequence is correct at ', (SELECT last_sequence FROM pthn_sequence WHERE year = 0))
    END AS diagnosis;

-- =====================================================
-- QUICK FIX (if needed):
-- =====================================================
-- If the global sequence is missing or wrong, run this:
--
-- SET @max_seq = (SELECT COALESCE(MAX(CAST(SUBSTRING(hn, 5) AS UNSIGNED)), 0) FROM patients WHERE hn LIKE 'PT%' AND LENGTH(hn) = 8);
-- INSERT INTO pthn_sequence (year, last_sequence, created_at) VALUES (0, @max_seq, NOW()) ON DUPLICATE KEY UPDATE last_sequence = @max_seq, updated_at = NOW();
-- SELECT CONCAT('✓ Fixed! Next HN will be: PT', LPAD(YEAR(NOW()) % 100, 2, '0'), LPAD(@max_seq + 1, 4, '0')) AS result;
-- =====================================================
