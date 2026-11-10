const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { CATEGORIES, validDate, badRequest } = require("./validation");

class ExpenseStore {
  constructor(file) {
    this.file = file;
    this.records = [];
    this.queue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    let raw;
    try {
      raw = await fs.readFile(this.file, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await this.persist([]);
      return;
    }
    try {
      const records = JSON.parse(raw);
      const ids = new Set();
      let total = 0;
      if (!Array.isArray(records)) throw new Error("Expected an array.");
      for (const record of records) {
        if (
          !record ||
          typeof record.id !== "string" ||
          !record.id ||
          ids.has(record.id) ||
          typeof record.title !== "string" ||
          !record.title.trim() ||
          record.title !== record.title.trim() ||
          !Number.isSafeInteger(record.amountPaise) ||
          record.amountPaise <= 0 ||
          !CATEGORIES.includes(record.category) ||
          !validDate(record.date) ||
          typeof record.note !== "string" ||
          record.note !== record.note.trim()
        )
          throw new Error("Invalid expense record.");
        ids.add(record.id);
        total += record.amountPaise;
        if (!Number.isSafeInteger(total))
          throw new Error("Dataset total exceeds the safe numeric range.");
      }
      this.records = records;
    } catch (error) {
      throw new Error(
        `Cannot read expense data at ${this.file}: ${error.message} Existing data has not been overwritten.`,
        { cause: error },
      );
    }
  }

  async persist(records) {
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(records, null, 2) + "\n", {
        flag: "wx",
      });
      await fs.rename(temporary, this.file);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
  }

  all() {
    return this.records;
  }

  mutate(change) {
    const operation = this.queue.then(async () => {
      const next = this.records.map((record) => ({ ...record }));
      const result = change(next);
      const total = next.reduce((sum, record) => sum + record.amountPaise, 0);
      if (!Number.isSafeInteger(total))
        throw badRequest(
          "The combined expense total exceeds the safe numeric range.",
        );
      await this.persist(next);
      this.records = next;
      return result;
    });
    // A failed operation must not prevent subsequent writes.
    this.queue = operation.catch(() => {});
    return operation;
  }
}

module.exports = { ExpenseStore };
