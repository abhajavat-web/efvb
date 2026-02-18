const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { User, Purchase, Product, UserProgress, DigitalLibrary } = require('../models');


// Get user's digital library
router.get('/my-library', protect, async (req, res) => {
    try {
        let libraryData = await DigitalLibrary.findOne({ userId: req.user._id });
        let rawItems = libraryData ? (libraryData.items || []) : [];

        // Helper to sync an item with latest product data
        const syncItemWithProduct = async (item) => {
            try {
                const productId = item.productId || item._id || item.id;
                const product = await Product.findById(productId);
                if (product) {
                    return {
                        productId: product._id,
                        title: product.title,
                        type: product.type === 'AUDIOBOOK' ? 'Audiobook' : 'E-Book',
                        thumbnail: product.thumbnail || item.thumbnail,
                        filePath: product.filePath || item.filePath,
                        purchasedAt: item.purchasedAt || item.createdAt || new Date(),
                        progress: item.progress || 0
                    };
                }
                return item;
            } catch (err) {
                return item;
            }
        };

        // --- NEW: Demo/JSON Fallback ---
        let demoItems = [];
        if (process.env.USE_JSON_DB === 'true' || rawItems.length === 0) {
            try {
                const JsonDB = require('../utils/jsonDB');
                const demoUsersDB = new JsonDB('demo_users.json');
                const demoUser = demoUsersDB.getById(req.user.email);

                if (demoUser && demoUser.library) {
                    demoItems = demoUser.library;
                }
            } catch (err) {
                console.error('Demo fallback error:', err);
            }
        }

        // Merge and process all items
        const allItems = [...rawItems, ...demoItems];

        // Use a Map to deduplicate by productId while syncing
        const libraryMap = new Map();
        for (const item of allItems) {
            const synced = await syncItemWithProduct(item);
            const id = synced.productId?.toString();
            if (id && !libraryMap.has(id)) {
                libraryMap.set(id, synced);
            }
        }

        let library = Array.from(libraryMap.values());

        // Fallback: If library is still empty, sync from purchases (Legacy Support)
        if (library.length === 0) {
            const purchases = await Purchase.find({ userId: req.user._id }).populate('productId');
            const legacyItems = purchases.map(p => {
                const product = p.productId;
                if (!product || (product.type !== 'EBOOK' && product.type !== 'AUDIOBOOK')) return null;
                return {
                    productId: product._id,
                    title: product.title,
                    type: product.type === 'AUDIOBOOK' ? 'Audiobook' : 'E-Book',
                    thumbnail: product.thumbnail,
                    filePath: product.filePath,
                    purchasedAt: p.purchaseDate
                };
            }).filter(i => i !== null);

            if (legacyItems.length > 0) {
                const newLibrary = new DigitalLibrary({
                    userId: req.user._id,
                    items: legacyItems
                });
                await newLibrary.save();
                return res.json(legacyItems);
            }
        }

        // Sort by purchasedAt descending (Latest First)
        library.sort((a, b) => new Date(b.purchasedAt || 0) - new Date(a.purchasedAt || 0));

        res.json(library);
    } catch (error) {
        console.error('Error fetching library:', error);
        res.status(500).json({ message: 'Error fetching library' });
    }
});

// Save Progress
router.post('/progress', protect, async (req, res) => {
    try {
        const { productId, progress, total } = req.body;
        const userId = req.user._id;

        const updatedProgress = await UserProgress.findOneAndUpdate(
            { userId, productId },
            { progress, total, lastUpdated: Date.now() },
            { upsert: true, new: true }
        );

        res.json(updatedProgress);
    } catch (error) {
        console.error('Error saving progress:', error);
        res.status(500).json({ message: 'Error saving progress' });
    }
});

// Get Progress
router.get('/progress/:productId', protect, async (req, res) => {
    try {
        const userId = req.user._id;
        const productId = req.params.productId;

        const progress = await UserProgress.findOne({ userId, productId });

        res.json(progress || { progress: 0, total: 0 });
    } catch (error) {
        console.error('Error fetching progress:', error);
        res.status(500).json({ message: 'Error fetching progress' });
    }
});

module.exports = router;
