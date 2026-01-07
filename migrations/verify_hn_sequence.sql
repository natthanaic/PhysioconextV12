-- =====================================================
-- Verify HN Sequence Migration
-- =====================================================
-- Run this to check if the migration worked correctly
-- =====================================================

-- Check the global sequence record
SELECT
    year,
    last_sequence,
    created_at,
    updated_at,
    CONCAT('Next HN will be: PT',
           LPAD(YEAR(NOW()) % 100, 2, '0'),
           LPAD(last_sequence + 1, 4, '0')) AS next_hn_formatted
FROM pthn_sequence
WHERE year = 0;

-- Show all sequence records for reference
SELECT * FROM pthn_sequence ORDER BY year;

-- Show last 5 patients with their HNs
SELECT id, hn, pt_number, CONCAT(first_name, ' ', last_name) as patient_name, created_at
FROM patients
ORDER BY id DESC
LIMIT 5;
