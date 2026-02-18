const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const adminAuth = require('../middleware/adminAuth');

// Configure storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const rootDir = path.join(__dirname, '../../');
        if (file.fieldname === 'cover') {
            cb(null, path.join(rootDir, 'src/uploads/covers'));
        } else if (file.fieldname === 'ebook') {
            cb(null, path.join(rootDir, 'private-storage/ebooks'));
        } else if (file.fieldname === 'audio') {
            cb(null, path.join(rootDir, 'private-storage/audiobooks'));
        } else {
            cb({ message: 'Invalid field name' }, false);
        }
    },
    filename: function (req, file, cb) {
        // Sanitize original name (remove spaces and special chars)
        const safeName = file.originalname.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + '-' + safeName);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
    fileFilter: function (req, file, cb) {
        const ext = path.extname(file.originalname).toLowerCase();
        const mime = file.mimetype.toLowerCase();

        if (file.fieldname === 'cover') {
            const allowedExts = ['.jpg', '.jpeg', '.png', '.webp'];
            if (allowedExts.includes(ext) || mime.startsWith('image/')) {
                return cb(null, true);
            }
        } else if (file.fieldname === 'ebook') {
            // Expanded for all document types: pdf, docx, epub, mobi, txt, html, etc.
            const allowedExts = ['.pdf', '.doc', '.docx', '.txt', '.epub', '.mobi', '.html', '.rtf', '.odt'];
            if (allowedExts.includes(ext) ||
                mime.includes('pdf') ||
                mime.includes('word') ||
                mime.includes('text') ||
                mime.includes('epub') ||
                mime.includes('mobi') ||
                mime.includes('html') ||
                mime.startsWith('application/octet-stream')) { // Fallback for some obscure ebook formats
                return cb(null, true);
            }
        } else if (file.fieldname === 'audio') {
            // Expanded for all audio types: mp3, wav, aac, flac, m4a, ogg, etc. + common video containers
            const allowedExts = ['.mp3', '.mpeg', '.mp4', '.wav', '.aac', '.ogg', '.m4a', '.flac', '.wma', '.alac', '.opus'];
            if (allowedExts.includes(ext) || mime.startsWith('audio/') || mime.startsWith('video/')) {
                return cb(null, true);
            }
        }

        cb(new Error(`Invalid file type for ${file.fieldname}: ${ext} (${mime})`));
    }
});

// Upload route
router.post('/', adminAuth, upload.fields([
    { name: 'cover', maxCount: 1 },
    { name: 'ebook', maxCount: 1 },
    { name: 'audio', maxCount: 1 }
]), (req, res) => {
    try {
        const files = req.files;
        const responseIds = {};

        if (files.cover) responseIds.coverPath = `src/uploads/covers/${files.cover[0].filename}`;
        if (files.ebook) responseIds.ebookPath = `ebooks/${files.ebook[0].filename}`;
        if (files.audio) responseIds.audioPath = `audiobooks/${files.audio[0].filename}`;

        console.log('✅ File Upload Success:', responseIds);

        res.json({
            message: 'Files uploaded successfully',
            paths: responseIds
        });
    } catch (error) {
        console.error('❌ Upload error:', error);
        res.status(500).json({ message: 'File upload failed' });
    }
});

module.exports = router;
