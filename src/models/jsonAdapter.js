const JsonDB = require('../utils/jsonDB');

/**
 * Enhanced JSON Model Adapter to mimic Mongoose behavior.
 * Returns a Query-like object for chaining (.populate, .sort, etc.)
 */
class JsonModel {
    static _attachSave(obj, dbInstance) {
        if (!obj) return null;
        if (Array.isArray(obj)) {
            return obj.map(item => JsonModel._attachSave(item, dbInstance));
        }

        Object.defineProperty(obj, 'save', {
            value: async function () {
                const id = this._id || this.id;
                if (id) {
                    return dbInstance.update(id, this);
                } else {
                    const created = dbInstance.create(this);
                    Object.assign(this, created);
                    return this;
                }
            },
            enumerable: false,
            writable: true,
            configurable: true
        });
        return obj;
    }

    static createModel(filename) {
        const db = new JsonDB(filename);

        class Query {
            constructor(results) {
                this.results = results;
            }
            populate() { return this; }
            sort() { return this; }
            limit() { return this; }
            select() { return this; }
            skip() { return this; }
            lean() { return this; }
            async exec() { return this.results; }
            // Support thenable (await query)
            then(resolve, reject) {
                return Promise.resolve(this.results).then(resolve, reject);
            }
        }

        return class ModelInstance {
            constructor(data = {}) {
                Object.assign(this, data);
                JsonModel._attachSave(this, db);
            }

            static find(query = {}) {
                const data = db.getAll();
                let results = data;
                if (Object.keys(query).length > 0) {
                    results = data.filter(item => {
                        return Object.entries(query).every(([key, value]) => {
                            if (value instanceof RegExp) return value.test(item[key]);
                            return item[key] == value;
                        });
                    });
                }
                const attached = JsonModel._attachSave(results, db);
                return new Query(attached);
            }

            static async findOne(query) {
                const q = this.find(query);
                const results = await q.exec();
                return results[0] || null;
            }

            static async findById(id) {
                if (!id) return null;
                const item = db.getById(id.toString());
                return JsonModel._attachSave(item, db);
            }

            static async findByIdAndUpdate(id, updates, options = {}) {
                const updated = db.update(id.toString(), updates);
                return JsonModel._attachSave(updated, db);
            }

            static async findOneAndUpdate(query, updates, options = {}) {
                let item = await this.findOne(query);
                if (item) {
                    const updatedItem = { ...item, ...updates };
                    const result = db.update(item._id || item.id, updatedItem);
                    return JsonModel._attachSave(result, db);
                } else if (options.upsert) {
                    return this.create({ ...query, ...updates });
                }
                return null;
            }

            static async create(data) {
                const items = Array.isArray(data) ? data : [data];
                const createdItems = items.map(item => db.create(item));
                const attached = JsonModel._attachSave(createdItems, db);
                return Array.isArray(data) ? attached : attached[0];
            }

            static async deleteMany(query = {}) {
                if (Object.keys(query).length === 0) {
                    db.write([]);
                    return { deletedCount: 'all' };
                }
                const data = db.getAll();
                const filtered = data.filter(item => {
                    return !Object.entries(query).every(([key, value]) => item[key] == value);
                });
                db.write(filtered);
                return { deletedCount: data.length - filtered.length };
            }

            static async findByIdAndDelete(id) {
                const item = await this.findById(id);
                if (item) {
                    db.delete(id.toString());
                    return item;
                }
                return null;
            }
        };
    }
}

module.exports = {
    User: JsonModel.createModel('users.json'),
    Product: JsonModel.createModel('products.json'),
    Purchase: JsonModel.createModel('purchases.json'),
    Order: JsonModel.createModel('orders.json'),
    UserProgress: JsonModel.createModel('progress.json'),
    DigitalLibrary: JsonModel.createModel('digital_library.json')
};
