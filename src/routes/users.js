const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { User, Product } = require('../models');
const { protect } = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');

// --- PROFILE & DASHBOARD ---

// Get User Profile (with addresses, wishlist, notifications)
// Get User Profile (with addresses, wishlist, notifications)
router.get('/profile', protect, async (req, res) => {
    try {
        // Simple, clean fetch
        const user = await User.findById(req.user._id);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Create a copy to modify for response
        // JsonAdapter objects don't have toObject(), they are just objects.
        const userObj = { ...user };
        delete userObj.password;

        res.json(userObj);

    } catch (error) {
        console.error('Error fetching profile:', error);
        res.status(500).json({ message: 'Error fetching profile', error: error.message });
    }
});

// Update Profile
router.put('/profile', protect, async (req, res) => {
    try {
        const { name, phone } = req.body;
        const user = await User.findById(req.user._id);
        if (user) {
            user.name = name || user.name;
            user.phone = phone || user.phone;
            await user.save();
            res.json({ message: 'Profile updated successfully', user: { name: user.name, email: user.email } });
        } else {
            res.status(404).json({ message: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Error updating profile' });
    }
});

// --- ADDRESS BOOK ---

// Add Address
router.post('/address', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user.savedAddresses) user.savedAddresses = [];

        if (req.body.isDefault) {
            user.savedAddresses.forEach(a => a.isDefault = false);
        }
        // Ensure ID for JSON DB mode
        if (!req.body._id && !req.body.id) {
            req.body._id = 'addr_' + Date.now().toString(36) + Math.random().toString(36).substr(2);
        }
        user.savedAddresses.push(req.body);
        await user.save();
        res.status(201).json(user.savedAddresses);
    } catch (error) {
        res.status(500).json({ message: 'Error adding address' });
    }
});

// Update Address
router.put('/address/:id', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user.savedAddresses) return res.status(404).json({ message: 'No addresses found' });

        const addrIndex = user.savedAddresses.findIndex(a => (a._id || a.id || '').toString() === req.params.id);
        if (addrIndex === -1) return res.status(404).json({ message: 'Address not found' });

        if (req.body.isDefault) {
            user.savedAddresses.forEach(a => a.isDefault = false);
        }
        const existingAddr = user.savedAddresses[addrIndex];
        const addrData = typeof existingAddr.toObject === 'function' ? existingAddr.toObject() : existingAddr;
        user.savedAddresses[addrIndex] = { ...addrData, ...req.body };
        await user.save();
        res.json(user.savedAddresses);
    } catch (error) {
        res.status(500).json({ message: 'Error updating address' });
    }
});

// Delete Address
router.delete('/address/:id', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user.savedAddresses) return res.json([]);

        user.savedAddresses = user.savedAddresses.filter(a => (a._id || a.id || '').toString() !== req.params.id);
        await user.save();
        res.json(user.savedAddresses);
    } catch (error) {
        res.status(500).json({ message: 'Error deleting address' });
    }
});

// --- WISHLIST ---

// Toggle Wishlist Item
router.post('/wishlist/toggle', protect, async (req, res) => {
    try {
        const { productId } = req.body;
        const user = await User.findById(req.user._id);
        const index = user.wishlist.indexOf(productId);
        if (index > -1) {
            user.wishlist.splice(index, 1);
            await user.save();
            res.json({ message: 'Removed from wishlist', wishlist: user.wishlist });
        } else {
            user.wishlist.push(productId);
            await user.save();
            res.json({ message: 'Added to wishlist', wishlist: user.wishlist });
        }
    } catch (error) {
        res.status(500).json({ message: 'Error toggling wishlist' });
    }
});

// --- NOTIFICATIONS ---

// Get Notifications
router.get('/notifications', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('notifications');
        res.json(user.notifications.sort((a, b) => b.createdAt - a.createdAt));
    } catch (error) {
        res.status(500).json({ message: 'Error fetching notifications' });
    }
});

// Mark Notification as Read
router.put('/notifications/:id/read', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        const note = user.notifications.find(n => (n._id || n.id).toString() === req.params.id);
        if (note) {
            note.isRead = true;
            await user.save();
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: 'Error updating notification' });
    }
});

// Mark All Notifications as Read
router.put('/notifications/read-all', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        user.notifications.forEach(n => n.isRead = true);
        await user.save();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: 'Error updating notifications' });
    }
});

// --- SECURITY ---

// Change Password
router.post('/change-password', protect, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const user = await User.findById(req.user._id);

        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) return res.status(400).json({ message: 'Incorrect current password' });

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);
        await user.save();

        res.json({ message: 'Password updated successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error changing password' });
    }
});

// --- ADMIN ROUTES ---

// Get all users (Admin Only)
router.get('/', adminAuth, async (req, res) => {
    try {
        const users = await User.find({ role: 'user' }).select('-password');
        res.json(users);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching users' });
    }
});

module.exports = router;
