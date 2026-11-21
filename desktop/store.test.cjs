"use strict";

const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {RegisterStore} = require("./store.cjs");

test("mantiene los semestres y las listas separados al volver a abrir Docencia", t => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "docencia-tests-"));
  t.after(() => fs.rmSync(sandbox, {recursive: true, force: true}));
  const profile = path.join(sandbox, "perfil");
  const key = "docencia.calificaciones.v1.42.1234567";
  const template = Buffer.from("libro de prueba");
  const draft = JSON.stringify({sheets: {mezcla: {periodo: "Semestral", calificacion: 91}}});
  let store = new RegisterStore(profile);
  const original = store.folder;
  store.remember(key, "Lista.xlsx", template);
  store.save(key, draft);
  assert.equal(store.archive(key, true).archived[0].name, "Lista.xlsx");
  assert.equal(store.archive(key, false).active, key);

  const semester = store.startSemester();
  assert.equal(semester.lists.length, 0);
  assert.equal(store.restore(key), null);
  assert.ok(semester.semesters.includes(original));
  store = new RegisterStore(profile);
  assert.equal(store.folder, semester.folder);
  assert.equal(store.openSemester(original).lists.length, 1);
  assert.equal(store.restore(key), draft);
  assert.deepEqual(Buffer.from(store.load(key).bytes, "base64"), template);
});

test("copia una carpeta con sus borradores y preserva el original ante conflictos", t => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "docencia-tests-"));
  t.after(() => fs.rmSync(sandbox, {recursive: true, force: true}));
  const store = new RegisterStore(path.join(sandbox, "perfil"));
  const key = "docencia.calificaciones.v1.50.1234567";
  const original = store.folder;
  const parent = path.join(sandbox, "destino");
  fs.mkdirSync(parent);
  store.remember(key, "Lista.xlsx", Buffer.from("prueba"));
  store.save(key, '{"sheets":{}}');
  const migrated = store.relocate(parent);
  assert.notEqual(migrated.folder, original);
  assert.equal(store.restore(key), '{"sheets":{}}');
  assert.ok(fs.existsSync(path.join(original, key + ".draft")));
  fs.writeFileSync(path.join(original, key + ".draft"), "otra copia");
  const conflictParent = path.join(sandbox, "otro");
  const conflict = path.join(conflictParent, "Docencia - Listas");
  fs.mkdirSync(conflict, {recursive: true});
  fs.copyFileSync(path.join(original, key + ".draft"), path.join(conflict, key + ".draft"));
  assert.throws(() => store.relocate(conflictParent), /copia diferente/);
  assert.equal(store.folder, migrated.folder);
  assert.throws(() => store.load("../externo"), /inválido/);
});

test("elimina solo la lista seleccionada y recupera sus datos si falla la papelera", async t => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "docencia-tests-"));
  t.after(() => fs.rmSync(sandbox, {recursive: true, force: true}));
  const store = new RegisterStore(path.join(sandbox, "perfil"));
  const key = "docencia.calificaciones.v1.40.1234567";
  const other = "docencia.calificaciones.v1.51.1234567";
  const original = path.join(sandbox, "Origen.xlsx");
  fs.writeFileSync(original, "plantilla");
  store.remember(key, "Origen.xlsx", fs.readFileSync(original));
  store.remember(other, "Otra.xlsx", Buffer.from("otra lista"));
  store.save(key, '{"sheets":{"curso":{}}}');
  await assert.rejects(store.deleteList(key, async () => { throw Error("sin papelera"); }), /Se conservó/);
  assert.equal(store.catalog().lists.length, 2);
  assert.equal(store.restore(key), '{"sheets":{"curso":{}}}');
  const trash = path.join(sandbox, "papelera");
  const catalog = await store.deleteList(key, async stage => { fs.renameSync(stage, trash); });
  assert.deepEqual(catalog.lists.map(item => item.key), [other]);
  assert.equal(catalog.active, null);
  assert.equal(store.restore(key), null);
  assert.deepEqual(fs.readdirSync(trash).sort(), ["draft", "json", "xlsx"].map(ext => key + "." + ext));
  assert.equal(fs.readFileSync(original, "utf8"), "plantilla");
  assert.throws(() => store.save(key, "{}"), /ENOENT/);
  store.remember(key, "Origen.xlsx", fs.readFileSync(original));
  assert.equal(store.restore(key), null);
  store.archive(other, true);
  await assert.rejects(store.deleteList(other, async () => assert.fail("La lista archivada debe permanecer")), /ENOENT/);
});
