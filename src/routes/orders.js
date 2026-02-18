const express = require('express');
const router = express.Router();
const { Order, Product, User, DigitalLibrary } = require('../models');
const adminAuth = require('../middleware/adminAuth');
const { createRazorpayOrder, verifyPaymentSignature } = require('../utils/razorpay');

// Get all orders (Admin Only)
router.get('/', adminAuth, async (req, res) => {
    try {
        const orders = await Order.find().sort({ createdAt: -1 });
        res.json(orders);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching orders' });
    }
});

// Place new order (Public)
router.post('/', async (req, res) => {
    try {
        const { customer, items, paymentMethod } = req.body;

        if (!customer || !items || items.length === 0) {
            return res.status(400).json({ message: 'Invalid order data' });
        }

        let totalAmount = 0;
        const orderItems = [];

        for (const item of items) {
            const product = await Product.findById(item.productId);
            if (!product) continue;

            // Check stock for physical items
            if (product.type === 'HARDCOVER' || product.type === 'PAPERBACK') {
                if (product.stock < item.quantity) {
                    return res.status(400).json({ message: `Insufficient stock for ${product.title}` });
                }
                // Decrease stock
                await Product.findByIdAndUpdate(product._id, { $inc: { stock: -item.quantity } });
            }

            const price = product.price * (1 - (product.discount || 0) / 100);
            totalAmount += price * item.quantity;

            orderItems.push({
                productId: product._id,
                title: product.title,
                type: product.type,
                price: price,
                quantity: item.quantity
            });
        }

        const newOrder = await Order.create({
            orderId: 'ORD-' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 1000),
            customer,
            items: orderItems,
            totalAmount: Math.round(totalAmount),
            paymentMethod: paymentMethod || 'COD',
            timeline: [{ status: 'Pending', note: 'Order placed successfully' }]
        });

        res.status(201).json(newOrder);

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error placing order' });
    }
});

// Create Razorpay Order
router.post('/razorpay', async (req, res) => {
    try {
        const { amount, currency } = req.body;
        if (!amount) return res.status(400).json({ message: 'Amount is required' });

        const rzpOrder = await createRazorpayOrder(amount, currency || 'INR');
        res.json(rzpOrder);
    } catch (error) {
        res.status(500).json({ message: 'Failed to create Razorpay order' });
    }
});

// Verify Payment and Finalize Order
router.post('/verify', async (req, res) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            customer,
            items
        } = req.body;

        // 1. Verify Signature
        const isValid = verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
        if (!isValid) {
            return res.status(400).json({ message: 'Invalid payment signature' });
        }

        // 2. Fulfill Order (Same logic as manual order but with payment success)
        let totalAmount = 0;
        const orderItems = [];

        for (const item of items) {
            const product = await Product.findById(item.productId);
            if (!product) continue;

            const price = product.price * (1 - (product.discount || 0) / 100);
            totalAmount += price * item.quantity;

            orderItems.push({
                productId: product._id,
                title: product.title,
                type: product.type,
                price: price,
                quantity: item.quantity
            });

            // If E-Book or Audiobook, we'll need to sync library later in frontend 
            // but backend can also handle it if user is logged in.
            // For now, we rely on the frontend checkoutOrder logic to sync.
        }

        const newOrder = await Order.create({
            orderId: 'ORD-' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 1000),
            customer,
            items: orderItems,
            totalAmount: Math.round(totalAmount),
            paymentMethod: 'Razorpay',
            paymentStatus: 'Paid',
            status: 'Processing',
            razorpayOrderId: razorpay_order_id,
            razorpayPaymentId: razorpay_payment_id,
            razorpaySignature: razorpay_signature,
            timeline: [{ status: 'Paid', note: 'Payment verified via Razorpay' }]
        });

        // 3. Handle Digital Library Fulfillment
        const user = await User.findOne({ email: customer.email });
        if (user) {
            const digitalItems = [];
            for (const item of orderItems) {
                if (item.type === 'EBOOK' || item.type === 'AUDIOBOOK') {
                    const product = await Product.findById(item.productId);
                    if (product) {
                        digitalItems.push({
                            productId: product._id,
                            title: product.title,
                            type: product.type === 'AUDIOBOOK' ? 'Audiobook' : 'E-Book',
                            thumbnail: product.thumbnail,
                            filePath: product.filePath,
                            purchasedAt: new Date()
                        });
                    }
                }
            }

            if (digitalItems.length > 0) {
                let library = await DigitalLibrary.findOne({ userId: user._id });
                if (!library) {
                    library = new DigitalLibrary({ userId: user._id, items: [] });
                }

                // Add only if not already owned
                digitalItems.forEach(di => {
                    if (!library.items.some(li => li.productId.toString() === di.productId.toString())) {
                        library.items.push(di);
                    }
                });

                await library.save();
                console.log(`✅ Digital items added to library for user: ${user.email}`);
            }
        }

        res.status(201).json({
            success: true,
            order: newOrder,
            message: 'Payment verified and order placed'
        });

    } catch (error) {
        console.error('Verification Error:', error);
        res.status(500).json({ message: 'Payment verification failed' });
    }
});

// Update Order Status (Admin Only)
router.put('/:id/status', adminAuth, async (req, res) => {
    try {
        const { status, note } = req.body;
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        order.status = status;
        order.timeline.push({ status, note: note || `Status updated to ${status}` });
        await order.save();

        res.json(order);
    } catch (error) {
        res.status(500).json({ message: 'Error updating status' });
    }
});

// Track Order (Public)
router.get('/track/:id', async (req, res) => {
    try {
        const order = await Order.findOne({ orderId: req.params.id });
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }
        res.json(order);
    } catch (error) {
        res.status(500).json({ message: 'Error tracking order' });
    }
});

module.exports = router;
