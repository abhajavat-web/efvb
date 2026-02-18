const fs = require('fs');
const path = require('path');

class JsonDB {
    constructor(filename) {
        this.filepath = path.join(__dirname, '..', 'data', filename);
        this.init();
    }

    init() {
        // Ensure data directory exists
        const dataDir = path.dirname(this.filepath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        // Create file if it doesn't exist
        if (!fs.existsSync(this.filepath)) {
            this.write([]);
        }
    }

    read() {
        try {
            const data = fs.readFileSync(this.filepath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.error(`Error reading ${this.filepath}:`, error);
            return [];
        }
    }

    write(data) {
        try {
            fs.writeFileSync(this.filepath, JSON.stringify(data, null, 2));
            console.log(`💾 JSON DB WRITE SUCCESS: ${path.basename(this.filepath)} (${data.length} items)`);
            return true;
        } catch (error) {
            console.error(`Error writing to ${this.filepath}:`, error);
            return false;
        }
    }

    // CRUD Operations
    getAll() {
        return this.read();
    }

    getById(id) {
        const data = this.read();
        return data.find(item => item._id === id || item.id === id);
    }

    create(item) {
        const data = this.read();
        // Generate simple ID if not provided
        if (!item._id && !item.id) {
            item._id = Date.now().toString(36) + Math.random().toString(36).substr(2);
        }
        item.createdAt = new Date().toISOString();
        item.updatedAt = new Date().toISOString();

        data.push(item);
        this.write(data);
        return item;
    }

    update(id, updates) {
        const data = this.read();
        const index = data.findIndex(item => item._id === id || item.id === id);

        if (index !== -1) {
            data[index] = { ...data[index], ...updates, updatedAt: new Date().toISOString() };
            this.write(data);
            return data[index];
        }
        return null;
    }

    delete(id) {
        const data = this.read();
        const filteredData = data.filter(item => item._id !== id && item.id !== id);

        if (data.length !== filteredData.length) {
            this.write(filteredData);
            return true;
        }
        return false;
    }
}

module.exports = JsonDB;
