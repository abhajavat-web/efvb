const express = require('express');
const router = express.Router();
const { Product, DigitalLibrary } = require('../models');
const adminAuth = require('../middleware/adminAuth');

// Get all products (Public)
router.get('/', async (req, res) => {
    try {
        const products = await Product.find();
        res.json(products);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching products' });
    }
});

// Get single product (Public)
router.get('/:id', async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }
        res.json(product);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching product' });
    }
});

// Create Product (Admin Only)
router.post('/', adminAuth, async (req, res) => {
    try {
        const {
            title, author, price, discountPrice, type, filePath,
            description, thumbnail, gallery, stock, discount,
            category, language, volume, weight, length, breadth, height, duration
        } = req.body;

        if (!title || !price || !type) {
            return res.status(400).json({ message: 'Title, Price, and Type are required' });
        }

        const product = await Product.create({
            title, author, price, discountPrice, type, filePath,
            description, thumbnail, gallery, stock, discount,
            category, language, volume, weight, length, breadth, height, duration
        });

        console.log('📝 Created Product to DB:', product._id);

        // Automatically add to admin's library if it's a digital product
        if (type === 'EBOOK' || type === 'AUDIOBOOK') {
            try {
                let library = await DigitalLibrary.findOne({ userId: req.user._id });
                if (!library) {
                    library = new DigitalLibrary({ userId: req.user._id, items: [] });
                }

                // Check if already in library
                const exists = library.items.some(item => item.productId.toString() === product._id.toString());
                if (!exists) {
                    library.items.push({
                        productId: product._id,
                        title: product.title,
                        type: product.type === 'AUDIOBOOK' ? 'Audiobook' : 'E-Book',
                        thumbnail: product.thumbnail,
                        filePath: product.filePath,
                        purchasedAt: new Date()
                    });
                    await library.save();
                }
            } catch (libErr) {
                console.error('Error adding to admin library:', libErr);
            }
        }

        res.status(201).json(product);
    } catch (error) {
        console.error('Create product error:', error);
        res.status(500).json({ message: 'Error creating product' });
    }
});

// Update Product (Admin Only)
router.put('/:id', adminAuth, async (req, res) => {
    try {
        const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }

        // GLOBAL SYNC: Update this product in EVERY user's digital library
        if (product.type === 'EBOOK' || product.type === 'AUDIOBOOK') {
            try {
                const syncResult = await DigitalLibrary.updateMany(
                    { "items.productId": product._id },
                    {
                        $set: {
                            "items.$.title": product.title,
                            "items.$.thumbnail": product.thumbnail,
                            "items.$.filePath": product.filePath,
                            "items.$.type": product.type === 'AUDIOBOOK' ? 'Audiobook' : 'E-Book'
                        }
                    }
                );
                console.log(`🌐 Global Library Sync: Updated ${syncResult.modifiedCount} users for product ${product._id}`);
            } catch (syncErr) {
                console.error('❌ Global library sync error:', syncErr);
            }
        }

        console.log('📝 Updated Product in DB:', product._id);
        res.json(product);
    } catch (error) {
        res.status(500).json({ message: 'Error updating product' });
    }
});

// Delete Product (Admin Only)
router.delete('/:id', adminAuth, async (req, res) => {
    try {
        const product = await Product.findByIdAndDelete(req.params.id);
        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }
        res.json({ message: 'Product deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting product' });
    }
});

module.exports = router;
