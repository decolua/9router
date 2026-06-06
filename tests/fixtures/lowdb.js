import fs from "node:fs/promises";

export class JSONFile {
  constructor(filename) {
    this.filename = filename;
  }

  async read() {
    try {
      return JSON.parse(await fs.readFile(this.filename, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async write(data) {
    await fs.writeFile(this.filename, JSON.stringify(data, null, 2));
  }
}

export class Low {
  constructor(adapter, defaultData = {}) {
    this.adapter = adapter;
    this.defaultData = defaultData;
    this.data = defaultData;
  }

  async read() {
    this.data = await this.adapter.read() || structuredClone(this.defaultData);
  }

  async write() {
    await this.adapter.write(this.data);
  }
}
