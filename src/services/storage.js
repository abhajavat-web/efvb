const fs = require('fs');
const path = require('path');

/**
 * Getting a stream for a private file.
 * In production, this would interface with AWS S3 or similar.
 */
const getFileStream = (filePath) => {
    // Base storage is EFV-Backend/src
    const uploadStore = path.join(__dirname, '../');
    const fullPath = path.resolve(uploadStore, filePath);

    if (!fullPath.startsWith(path.resolve(uploadStore))) {
        throw new Error('Unauthorized storage access attempt');
    }

    if (!fs.existsSync(fullPath)) {
        throw new Error('Content file not found');
    }

    return fs.createReadStream(fullPath);
};

module.exports = { getFileStream };
