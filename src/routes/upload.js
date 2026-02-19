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
            cb(null, path.join(rootDir, 'src/uploads/ebooks'));
        } else if (file.fieldname === 'audio') {
            cb(null, path.join(rootDir, 'src/uploads/audios'));
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
            const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];
            if (allowedExts.includes(ext) || mime.startsWith('image/')) {
                return cb(null, true);
            }
        } else if (file.fieldname === 'ebook') {
            // Highly permissive document and ebook formats
            const allowedExts = [
                '.pdf', '.epub', '.mobi', '.doc', '.docx', '.txt',
                '.rtf', '.odt', '.html', '.htm', '.azw', '.azw3',
                '.fb2', '.djvu', '.prc', '.pages'
            ];
            if (allowedExts.includes(ext) ||
                mime.includes('pdf') ||
                mime.includes('word') ||
                mime.includes('text') ||
                mime.includes('epub') ||
                mime.includes('mobi') ||
                mime.includes('html') ||
                mime.includes('document') || // Generic for many office docs
                mime.startsWith('application/octet-stream') ||
                mime.startsWith('application/x-')) { // Catch many specialized ebook mime types
                return cb(null, true);
            }
        } else if (file.fieldname === 'audio') {
            // Highly permissive audio and video containers (since video as audio is common)
            const allowedExts = [
                '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg',
                '.wma', '.alac', '.opus', '.aiff', '.amr', '.ape',
                '.mp4', '.mpeg', '.mpg', '.m4v', '.webm', '.mkv', '.avi'
            ];
            if (allowedExts.includes(ext) ||
                mime.startsWith('audio/') ||
                mime.startsWith('video/') ||
                mime === 'application/octet-stream') { // Some systems send mp3 as application/octet-stream
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

        if (files.cover) responseIds.coverPath = `uploads/covers/${files.cover[0].filename}`;
        if (files.ebook) responseIds.ebookPath = `uploads/ebooks/${files.ebook[0].filename}`;
        if (files.audio) responseIds.audioPath = `uploads/audios/${files.audio[0].filename}`;

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
