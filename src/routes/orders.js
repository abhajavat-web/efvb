const express = require('express');
const router = express.Router();
const { Order, Product, User, DigitalLibrary } = require('../models');
const adminAuth = require('../middleware/adminAuth');
const { protect } = require('../middleware/auth');
const { createRazorpayOrder, verifyPaymentSignature } = require('../utils/razorpay');


// Get current user's orders
router.get('/my-orders', protect, async (req, res) => {
    try {
        const query = {
            $or: [
                { userId: req.user._id },
                { "customer.email": req.user.email }
            ]
        };
        const orders = await Order.find(query);
        // Sort manually if JsonAdapter doesn't support complex sorts
        const sortedOrders = orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json(sortedOrders);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching orders' });
    }
});

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
router.post('/razorpay', protect, async (req, res) => {
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
router.post('/verify', protect, async (req, res) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            checkoutData,
            customer: directCustomer,
            items: directItems
        } = req.body;

        // 1. Verify Signature
        const isValid = verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
        if (!isValid) {
            return res.status(400).json({ message: 'Invalid payment signature' });
        }

        // 2. Fulfill Order
        const user = await User.findOne({ email: req.user.email });
        if (!user) return res.status(404).json({ message: 'User not found' });

        // Flexible extraction of items and address
        let finalItems = [];
        let address = null;

        if (checkoutData) {
            finalItems = checkoutData.items || [];
            if (checkoutData.selectedAddressId) {
                address = user.savedAddresses.find(a => (a._id || a.id || '').toString() === checkoutData.selectedAddressId.toString());
            } else if (checkoutData.address) {
                address = checkoutData.address;
            }
        } else {
            finalItems = directItems || [];
            if (directCustomer) {
                address = {
                    fullName: directCustomer.name,
                    email: directCustomer.email,
                    phone: directCustomer.phone || user.phone || '0000000000',
                    house: directCustomer.address || '',
                    city: directCustomer.city || 'Unknown',
                    pincode: directCustomer.zip || directCustomer.pincode || '000000'
                };
            }
        }

        if (!address) return res.status(400).json({ message: 'Shipping address missing' });
        if (!finalItems || finalItems.length === 0) return res.status(400).json({ message: 'No items in order' });

        let totalAmount = 0;
        const orderItems = [];

        for (const item of finalItems) {
            // Find product to get latest price/stock
            const product = await Product.findById(item.id || item.productId);
            if (!product) {
                console.warn(`Product not found during verification: ${item.id || item.productId}`);
                continue;
            }

            totalAmount += product.price * item.quantity;
            orderItems.push({
                productId: product._id,
                title: product.title,
                type: product.type,
                price: product.price,
                quantity: item.quantity
            });
        }

        if (orderItems.length === 0) return res.status(400).json({ message: 'No valid products found in order' });

        const newOrder = await Order.create({
            orderId: 'ORD-' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 1000),
            userId: user._id,
            customer: {
                name: address.fullName || user.name,
                email: address.email || user.email,
                phone: address.phone || user.phone || '0000000000',
                address: address, // Store the full address object
                city: address.city || '',
                zip: address.pincode || address.zip || ''
            },
            items: orderItems,
            totalAmount: Math.round(totalAmount * 1.18), // Including 18% GST as per frontend calc
            paymentMethod: 'Razorpay',
            paymentStatus: 'Paid',
            status: 'Processing',
            razorpayOrderId: razorpay_order_id,
            razorpayPaymentId: razorpay_payment_id,
            razorpaySignature: razorpay_signature,
            timeline: [{ status: 'Paid', note: 'Payment verified via Razorpay' }]
        });

        // 3. Handle Digital Library Fulfillment
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
            let library = await DigitalLibrary.findOne({ userId: user._id.toString() });
            if (!library) {
                library = await DigitalLibrary.create({ userId: user._id.toString(), items: [] });
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

// Track Order (Public/User)
router.get('/track/:id', async (req, res) => {
    try {
        const order = await Order.findOne({ orderId: req.params.id }) || await Order.findById(req.params.id);
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }
        res.json(order);
    } catch (error) {
        res.status(500).json({ message: 'Error tracking order' });
    }
});

// --- NEW: TEST MODE DIGITAL PURCHASE ---
// Directly creates an order as PAID and Adds to Library
router.post('/test-digital', protect, async (req, res) => {
    try {
        const { productId, price, name, type } = req.body; // type should be 'EBOOK' or 'AUDIOBOOK'
        const user = await User.findById(req.user._id);

        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        // 1. Find Product
        // IMPORTANT: In JSON DB mode, IDs are strings like 'efv_v1_ebook'.
        // mongoose.Types.ObjectId.isValid() returns FALSE for these, so we CANNOT
        // use that check as a gate. Try findById for ALL productIds first.
        let product = null;

        // Step 1a: Try direct ID lookup (works for both string and ObjectId formats)
        product = await Product.findById(productId.toString());

        // Step 1b: If not found, try demoMap with simple string matching (JSON-safe)
        if (!product) {
            // Simple mapping: productId -> { type, titleFragment }
            const demoMap = {
                'efv_v1_ebook': { type: 'EBOOK', titleFragment: 'ORIGIN CODE' },
                'efv_v1_audiobook': { type: 'AUDIOBOOK', titleFragment: 'ORIGIN CODE' },
                'efv_v1_ebook_en': { type: 'EBOOK', titleFragment: 'THE ORIGIN CODE' },
                'efv_v1_audiobook_en': { type: 'AUDIOBOOK', titleFragment: 'THE ORIGIN CODE' },
                'efv_v2_ebook': { type: 'EBOOK', titleFragment: 'MINDOS' },
                'efv_v2_audiobook': { type: 'AUDIOBOOK', titleFragment: 'MINDOS' }
            };

            const spec = demoMap[productId];
            if (spec) {
                // JSON adapter supports regex in find(), use it
                product = await Product.findOne({
                    title: new RegExp(spec.titleFragment, 'i'),
                    type: spec.type
                });
            }
        }

        // Step 1c: Last resort - search by name sent from frontend
        if (!product && name) {
            product = await Product.findOne({ title: new RegExp(name.replace(/[™®]/g, '').trim(), 'i'), type: type });
        }

        if (!product) {
            console.error(`❌ Product not found for ID: ${productId}, name: ${name}, type: ${type}`);
            return res.status(404).json({ success: false, message: `Product not found: ${productId}` });
        }

        console.log(`✅ Product found: ${product.title} (${product.type}) ID: ${product._id}`);


        // 2. Create Order (Simulate Paid)
        const orderId = 'ORD-TEST-' + Date.now().toString().slice(-6);
        const newOrder = await Order.create({
            orderId: orderId,
            customer: {
                name: user.name,
                email: user.email,
                phone: user.phone || '0000000000',
                address: { street: 'Digital Purchase', city: 'Internet', zip: '000000' }
            },
            items: [{
                productId: product._id,
                title: product.title,
                type: product.type, // Ensure DB type is used (EBOOK/AUDIOBOOK)
                price: price || product.price,
                quantity: 1
            }],
            totalAmount: price || product.price,
            paymentMethod: 'DIGITAL_TEST',
            paymentStatus: 'Paid',
            status: 'Delivered', // Immediate delivery for digital
            paymentId: 'DIG-' + orderId,
            timeline: [{ status: 'Delivered', note: 'Digital Item Unlocked (Test Mode)' }]
        });

        // 3. Update User Profile (Add to purchasedProducts)
        // Check if `purchasedProducts` property exists (JsonAdapter compatibility)
        if (!user.purchasedProducts) {
            user.purchasedProducts = [];
            await user.save(); // Initialize array
        }

        // Mongoose `addToSet` doesn't exist on POJO returned by JsonAdapter
        // So we manually check and push
        const prodIdStr = product._id.toString();

        // If it's an array of strings (typical in JSON) or ObjectIds
        const isAlreadyPurchased = user.purchasedProducts.some(id => id.toString() === prodIdStr);

        if (!isAlreadyPurchased) {
            user.purchasedProducts.push(prodIdStr);
            await user.save();
        }

        // 4. Update Digital Library
        let library = await DigitalLibrary.findOne({ userId: user._id.toString() });

        if (!library) {
            // Create new library entry for this user
            library = await DigitalLibrary.create({
                userId: user._id.toString(),
                items: []
            });
        }

        const alreadyInLib = (library.items || []).some(i =>
            (i.productId || '').toString() === product._id.toString()
        );

        if (!alreadyInLib) {
            // Push new library item
            if (!library.items) library.items = [];
            library.items.push({
                productId: product._id.toString(),
                title: product.title,
                type: product.type === 'AUDIOBOOK' ? 'Audiobook' : 'E-Book',
                thumbnail: product.thumbnail || 'img/vol1-cover.png',
                filePath: product.filePath || '',
                purchasedAt: new Date().toISOString()
            });
            await library.save();
            console.log(`✅ Library updated for user ${user._id}: added ${product.title}`);
        } else {
            console.log(`ℹ️ Product already in library for user ${user._id}: ${product.title}`);
        }

        res.status(200).json({
            success: true,
            message: 'Test Purchase Successful',
            orderId: newOrder.orderId,
            libraryUpdated: true
        });

    } catch (error) {
        console.error("Test Digital Purchase Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Delete Order (Admin Only)
router.delete('/:id', adminAuth, async (req, res) => {
    try {
        const order = await Order.findByIdAndDelete(req.params.id) || await Order.findOneAndDelete({ orderId: req.params.id });
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }
        res.json({ message: 'Order deleted successfully' });
    } catch (error) {
        console.error('Delete Order Error:', error);
        res.status(500).json({ message: 'Error deleting order' });
    }
});

module.exports = router;
