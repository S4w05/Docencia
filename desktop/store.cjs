"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {randomUUID} = require("node:crypto");

const workbookKey = /^docencia\.calificaciones\.v1\.\d{1,8}\.\d{1,10}$/;
const storedFile = /^docencia\.calificaciones\.v1\.\d{1,8}\.\d{1,10}\.(xlsx|json|archived|draft)$/;
const unavailable = "La carpeta de datos no está disponible.";
const readJSON = file => JSON.parse(fs.readFileSync(file, "utf8"));
const isDirectory = folder => fs.statSync(folder, {throwIfNoEntry: false})?.isDirectory() ?? false;
function writeAtomic(file, bytes) {
  const temporary = file + "." + randomUUID() + ".tmp";
  try {
    fs.writeFileSync(temporary, bytes, {flag: "wx", mode: 0o600});
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, {force: true});
  }
}

class RegisterStore {
  constructor(profile) {
    this.preferences = path.join(profile, "docencia.json");
    const folder = path.join(profile, "Listas");
    fs.mkdirSync(profile, {recursive: true, mode: 0o700});
    if (fs.existsSync(this.preferences)) {
      this.state = readJSON(this.preferences);
    } else {
      fs.mkdirSync(folder, {recursive: true, mode: 0o700});
      this.state = {folder, semesters: [], active: null};
    }
  }

  update(changes) {
    const next = {...this.state, ...changes};
    writeAtomic(this.preferences, JSON.stringify(next));
    this.state = next;
  }

  get folder() { return this.state.folder; }

  component(key, extension) {
    if (!workbookKey.test(key)) throw Error("Identificador de lista inválido.");
    if (!isDirectory(this.folder)) throw Error(unavailable);
    return path.join(this.folder, key + "." + extension);
  }

  catalog() {
    const available = isDirectory(this.folder);
    const lists = [], archived = [];
    if (available) {
      for (const item of fs.readdirSync(this.folder, {withFileTypes: true})) {
        const match = item.name.match(storedFile);
        if (!item.isFile() || !match || !["json", "archived"].includes(match[1])) continue;
        const key = path.parse(item.name).name;
        if (!fs.existsSync(this.component(key, "xlsx"))) continue;
        const entry = readJSON(path.join(this.folder, item.name));
        if (entry.key !== key || typeof entry.name !== "string") continue;
        (match[1] === "json" ? lists : archived).push(entry);
      }
    }
    for (const entries of [lists, archived]) entries.sort((a, b) => a.name.localeCompare(b.name, "es", {numeric: true}));
    return {folder: this.folder, available, lists, archived, semesters: this.state.semesters,
      active: lists.some(item => item.key === this.state.active) ? this.state.active : null};
  }

  remember(key, name, bytes) {
    const workbook = this.component(key, "xlsx");
    if (fs.existsSync(workbook)) {
      if (!fs.readFileSync(workbook).equals(bytes)) throw Error("Ya existe una lista diferente con este identificador.");
    } else {
      writeAtomic(workbook, bytes);
    }
    const metadata = this.component(key, "json");
    const archived = this.component(key, "archived");
    if (fs.existsSync(archived) && !fs.existsSync(metadata)) fs.renameSync(archived, metadata);
    writeAtomic(metadata, JSON.stringify({key, name}));
    return this.catalog();
  }

  load(key) {
    const {name} = readJSON(this.component(key, "json"));
    return {name, bytes: fs.readFileSync(this.component(key, "xlsx")).toString("base64")};
  }

  restore(key) {
    const draft = this.component(key, "draft");
    return fs.existsSync(draft) ? fs.readFileSync(draft, "utf8") : null;
  }

  save(key, draft) {
    fs.accessSync(this.component(key, "json"));
    writeAtomic(this.component(key, "draft"), draft);
    if (key !== this.state.active) this.update({active: key});
    return true;
  }

  archive(key, archived) {
    const source = this.component(key, archived ? "json" : "archived");
    const target = this.component(key, archived ? "archived" : "json");
    if (fs.existsSync(target)) throw Error("Ya existe otra copia del registro.");
    fs.renameSync(source, target);
    return this.catalog();
  }

  async deleteList(key, trash) {
    const metadata = this.component(key, "json");
    const workbook = this.component(key, "xlsx");
    const draft = this.component(key, "draft");
    const entry = readJSON(metadata);
    if (entry.key !== key || !fs.existsSync(workbook)) throw Error("La lista ya no está disponible.");
    const stage = fs.mkdtempSync(path.join(this.folder, "Lista eliminada de Docencia - "));
    const moved = [];
    try {
      for (const source of [metadata, workbook, draft]) {
        if (source === draft && !fs.existsSync(source)) continue;
        const destination = path.join(stage, path.basename(source));
        fs.renameSync(source, destination);
        moved.push([source, destination]);
      }
      await trash(stage);
    } catch (error) {
      try {
        for (const [source, destination] of moved.reverse()) fs.renameSync(destination, source);
        fs.rmdirSync(stage);
      } catch {
        throw Error("No se pudo restaurar la lista automáticamente. Revisa la carpeta «" + stage + "».");
      }
      throw Error("No se pudo enviar la lista a la papelera. Se conservó en Docencia.", {cause: error});
    }
    return this.catalog();
  }

  switchSemester(folder) {
    if (!isDirectory(folder)) throw Error(unavailable);
    const semesters = [this.folder, ...this.state.semesters.filter(item => item !== folder && item !== this.folder)];
    this.update({folder, semesters, active: null});
    return this.catalog();
  }

  startSemester() {
    if (!isDirectory(this.folder)) throw Error(unavailable);
    const parent = path.dirname(this.folder);
    const container = path.basename(parent) === "Docencia - Semestres" ? parent : path.join(parent, "Docencia - Semestres");
    fs.mkdirSync(container, {recursive: true, mode: 0o700});
    const now = new Date();
    const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map(n => String(n).padStart(2, "0")).join("-");
    return this.switchSemester(fs.mkdtempSync(path.join(container, "Semestre " + date + " - ")));
  }

  openSemester(folder) {
    if (!this.state.semesters.includes(folder)) throw Error("El semestre no está en la lista de archivos.");
    return this.switchSemester(folder);
  }

  relocate(selected) {
    const name = "Docencia - Listas";
    let target = path.basename(selected) === name ? selected : path.join(selected, name);
    if (!isDirectory(this.folder)) {
      target = [selected, target].find(candidate => isDirectory(candidate) &&
        fs.readdirSync(candidate).some(file => storedFile.test(file) && /\.(json|archived)$/.test(file)));
      if (!target) throw Error(unavailable);
      this.update({folder: target});
      return this.catalog();
    }
    const source = fs.realpathSync(this.folder);
    target = isDirectory(target) ? fs.realpathSync(target) : path.join(fs.realpathSync(selected), name);
    if (source === target) return this.catalog();
    for (const relative of [path.relative(source, target), path.relative(target, source)]) {
      if (relative.split(path.sep)[0] !== ".." && !path.isAbsolute(relative)) throw Error("Elige una carpeta fuera de la ubicación actual.");
    }
    const files = fs.readdirSync(source, {withFileTypes: true}).filter(item => item.isFile() && storedFile.test(item.name)).map(item => item.name);
    for (const file of files) {
      const existing = path.join(target, file);
      const alternate = file.endsWith(".json") ? file.replace(/\.json$/, ".archived") :
        file.endsWith(".archived") ? file.replace(/\.archived$/, ".json") : null;
      if (alternate && fs.existsSync(path.join(target, alternate)) ||
          fs.existsSync(existing) && !fs.readFileSync(existing).equals(fs.readFileSync(path.join(source, file)))) {
        throw Error("La ubicación elegida contiene una copia diferente. Elige otra carpeta.");
      }
    }
    fs.mkdirSync(target, {recursive: true, mode: 0o700});
    for (const file of files) {
      const destination = path.join(target, file);
      if (!fs.existsSync(destination)) writeAtomic(destination, fs.readFileSync(path.join(source, file)));
    }
    this.update({folder: target});
    return this.catalog();
  }
}

module.exports = {RegisterStore, writeAtomic};
