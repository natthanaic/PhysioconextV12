const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// Define where to save the temporary file
// We store it in 'public' so it persists between requests but is easy to access if needed
const TEMP_FILE = path.join(__dirname, '../public/latest_card.json');

// 1. RECEIVE DATA (POST) - From Local Reader
router.post('/thai_card', (req, res) => {
    try {
        const data = req.body;
        
        if (!data || Object.keys(data).length === 0) {
            return res.status(400).json({ message: "No data provided" });
        }

        // Add timestamp for freshness check
        data.timestamp = Date.now() / 1000; 

        // Save to JSON file
        fs.writeFileSync(TEMP_FILE, JSON.stringify(data));
        
        console.log(`[THAI-CARD] Data received for: ${data.th_fname || 'Unknown'}`);
        res.json({ message: "Saved successfully" });
    } catch (err) {
        console.error("[THAI-CARD] Error saving data:", err);
        res.status(500).json({ message: "Server error" });
    }
});

// 2. SEND DATA (GET) - To Browser (register.ejs)
router.get('/thai_card', (req, res) => {
    try {
        if (fs.existsSync(TEMP_FILE)) {
            const content = fs.readFileSync(TEMP_FILE, 'utf-8');
            const data = JSON.parse(content);
            
            // Optional: Only return if data is less than 30 seconds old
            const age = (Date.now() / 1000) - data.timestamp;
            if (age < 30) {
                res.json(data);
            } else {
                res.json({ status: "waiting", message: "Data too old" });
            }
        } else {
            res.json({ status: "waiting" });
        }
    } catch (err) {
        console.error("[THAI-CARD] Read error:", err);
        res.json({ status: "waiting" });
    }
});

module.exports = router;