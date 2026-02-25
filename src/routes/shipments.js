const express = require('express');
const router = express.Router();
const { Shipment, Order } = require('../models');
const adminAuth = require('../middleware/adminAuth');

const nimbusPostService = require('../services/nimbusPostService');
const { protect } = require('../middleware/auth');

// Get all shipments (Admin Only)
router.get('/', adminAuth, async (req, res) => {
    try {
        const shipments = await Shipment.find().sort({ createdAt: -1 });
        res.json(shipments);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching shipments' });
    }
});

/**
 * @route   GET /api/shipments/track/:awb
 * @desc    Track a shipment with NimbusPost (LIVE DATA)
 * @access  Private (Logged in users only)
 */
router.get('/track/:awb', protect, async (req, res) => {
    try {
        const { awb } = req.params;
        if (!awb || awb === 'undefined') {
            return res.status(400).json({ status: false, message: 'Invalid AWB number' });
        }

        const trackingData = await nimbusPostService.trackShipment(awb);
        res.json(trackingData);
    } catch (error) {
        console.error('Nimbus Tracking Route Error:', error.message);
        res.status(500).json({ status: false, message: 'Unable to fetch live tracking. Please try later.' });
    }
});

// Update shipment status
router.put('/:id', adminAuth, async (req, res) => {
    try {
        const shipment = await Shipment.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
        res.json(shipment);
    } catch (error) {
        res.status(400).json({ message: 'Error updating shipment' });
    }
});

/**
 * @route   POST /api/shipments/create
 * @desc    Create a shipment for an order (NimbusPost)
 * @access  Admin Only
 */
router.post('/create', adminAuth, async (req, res) => {
    try {
        const { orderId } = req.body;
        const order = await Order.findById(orderId).populate('items.productId');

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        // Prepare NimbusPost Payload
        const payload = {
            order_number: order.orderId,
            shipping_address: {
                first_name: order.customer.name.split(' ')[0],
                last_name: order.customer.name.split(' ').slice(1).join(' ') || '.',
                email: order.customer.email,
                phone: order.customer.phone || '0000000000',
                address: order.customer.address || '',
                city: order.customer.city || 'Unknown',
                state: order.customer.state || 'Unknown',
                pincode: order.customer.zip || '000000',
                country: 'India'
            },
            billing_address: {
                first_name: order.customer.name.split(' ')[0],
                last_name: order.customer.name.split(' ').slice(1).join(' ') || '.',
                email: order.customer.email,
                phone: order.customer.phone || '0000000000',
                address: order.customer.address || '',
                city: order.customer.city || 'Unknown',
                state: order.customer.state || 'Unknown',
                pincode: order.customer.zip || '000000',
                country: 'India'
            },
            order_items: order.items.map(item => ({
                name: item.title,
                qty: item.quantity,
                price: item.price,
                sku: item.productId?.title || item.title
            })),
            payment_method: order.paymentMethod.toLowerCase() === 'cod' ? 'cod' : 'prepaid',
            total_amount: order.totalAmount,
            weight: order.items.reduce((sum, item) => sum + (item.productId?.weight || 500) * item.quantity, 0),
            length: 10,
            breadth: 10,
            height: 10
        };

        const result = await nimbusPostService.createShipment(payload);

        if (result.status && result.data) {
            // Create shipment record
            const newShipment = await Shipment.create({
                orderId: order._id,
                shipmentId: result.data.shipment_id || '',
                awbNumber: result.data.awb_number || '',
                courierName: result.data.courier_name || 'NimbusPost',
                shippingStatus: 'Processing',
                trackingLink: result.data.tracking_url || ''
            });

            // Update Order
            order.status = 'Processing';
            order.shipmentId = newShipment.shipmentId;
            order.timeline.push({ status: 'Processing', note: 'Shipment created via NimbusPost' });
            await order.save();

            res.json({ success: true, shipment: newShipment });
        } else {
            res.status(400).json({ message: result.message || 'NimbusPost shipment creation failed' });
        }
    } catch (error) {
        console.error('Create Shipment Error:', error);
        res.status(500).json({ message: error.message || 'Server error during shipment creation' });
    }
});

module.exports = router;
