const express = require('express');
const router = express.Router();
const { protect, validatePurchase } = require('../middleware/auth');
const { getFileStream } = require('../services/storage');
const { Product } = require('../models');

const fs = require('fs');
const path = require('path');

const getMimeType = (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    const map = {
        '.pdf': 'application/pdf',
        '.epub': 'application/epub+zip',
        '.mp3': 'audio/mpeg',
        '.mpeg': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.aac': 'audio/aac',
        '.m4a': 'audio/mp4',
        '.mp4': 'audio/mp4', // Common for audiobooks in mp4 container
        '.m4v': 'video/mp4',
        '.ogg': 'audio/ogg',
        '.flac': 'audio/flac',
        '.txt': 'text/plain',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.html': 'text/html'
    };
    return map[ext] || 'application/octet-stream';
};

// Secure E-Book Streaming
router.get('/ebook/:productId', protect, validatePurchase, async (req, res) => {
    try {
        const product = await Product.findById(req.params.productId);
        if (!product || product.type !== 'EBOOK') {
            return res.status(404).json({ message: 'E-Book not found' });
        }

        const uploadStore = path.join(__dirname, '../'); // Points to EFV-Backend/src
        const fullPath = path.resolve(uploadStore, product.filePath);

        if (!fs.existsSync(fullPath)) return res.status(404).json({ message: 'File not found' });

        res.setHeader('Content-Type', getMimeType(product.filePath));
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Cache-Control', 'no-store');

        fs.createReadStream(fullPath).pipe(res);
    } catch (error) {
        res.status(500).json({ message: 'Streaming error' });
    }
});

// Secure Audiobook Streaming
router.get('/audio/:productId', protect, validatePurchase, async (req, res) => {
    try {
        const product = await Product.findById(req.params.productId);
        if (!product || product.type !== 'AUDIOBOOK') {
            return res.status(404).json({ message: 'Audiobook not found' });
        }

        const uploadStore = path.join(__dirname, '../'); // Points to EFV-Backend/src
        const fullPath = path.resolve(uploadStore, product.filePath);

        if (!fs.existsSync(fullPath)) return res.status(404).json({ message: 'Audio file not found' });

        const stat = fs.statSync(fullPath);
        const fileSize = stat.size;
        const range = req.headers.range;
        const mimeType = getMimeType(product.filePath);

        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunksize = (end - start) + 1;
            const file = fs.createReadStream(fullPath, { start, end });

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': mimeType,
                'Cache-Control': 'no-store'
            });
            file.pipe(res);
        } else {
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': mimeType,
                'Cache-Control': 'no-store'
            });
            fs.createReadStream(fullPath).pipe(res);
        }
    } catch (error) {
        res.status(500).json({ message: 'Audio streaming error' });
    }
});

module.exports = router;
