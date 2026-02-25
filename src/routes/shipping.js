const express = require('express');
const router = express.Router();
const nimbusPostService = require('../services/nimbusPostService');
const { protect } = require('../middleware/auth');

/**
 * @route   GET /api/shipping/track/:awb
 * @desc    Track a shipment with NimbusPost
 * @access  Private (Logged in users only)
 */
router.get('/track/:awb', protect, async (req, res) => {
    try {
        const { awb } = req.params;
        if (!awb) {
            return res.status(400).json({ status: false, message: 'AWB number is required' });
        }

        const trackingData = await nimbusPostService.trackShipment(awb);
        res.json(trackingData);
    } catch (error) {
        console.error('Shipping Route Error:', error.message);
        res.status(500).json({ status: false, message: error.message || 'Error tracking shipment' });
    }
});

/**
 * @route   POST /api/shipping/login (Admin/Internal only toggle)
 * @desc    Get fresh token from Nimbus
 */
router.post('/login', protect, async (req, res) => {
    try {
        const token = await nimbusPostService.login();
        res.json({ status: true, message: 'LoggedIn Successfully', token });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
});

module.exports = router;
