"use strict";

const bridge = window.webkit?.messageHandlers?.docencia;
const send = (action, payload = {}) => bridge.postMessage({action, ...payload});
let savedLists = [];
let saveVersion = 0;
let latestSave = Promise.resolve(true);
const confirmAction = message => bridge ? send("confirm", {message}) : window.confirm(message);

function fileFromPayload({name, bytes}) {
  return new File([Uint8Array.fromBase64(bytes)], name, {type: mime});
}

async function restoreDraft(key) {
  const stored = bridge ? await send("restore", {key}) : localStorage.getItem(key);
  return stored ? JSON.parse(stored) : {sheets: {}};
}

function persistDraft(key, draft) {
  const version = ++saveVersion;
  const payload = JSON.stringify(draft);
  latestSave = writeDraft(key, payload, version);
}

async function writeDraft(key, payload, version) {
  try {
    if (bridge) await send("save", {key, draft: payload});
    else localStorage.setItem(key, payload);
    if (version === saveVersion) $("save-status").textContent = bridge ? "Cambios guardados en esta Mac" : "Borrador guardado en este navegador";
    return true;
  } catch (error) {
    if (version === saveVersion) {
      $("save-status").textContent = "Guardado pendiente";
      notice("No se pudo guardar el registro. " + (error?.message ?? error), true);
    }
    return false;
  }
}

async function flushPending() { return latestSave; }

async function rememberTemplate(nextBook, file) {
  if (!bridge) return;
  const bytes = new Uint8Array(await file.arrayBuffer()).toBase64();
  const catalog = await send("remember", {key: nextBook.key, name: file.name, bytes});
  showCatalog(catalog, nextBook.key);
}

function showCatalog(catalog, selected) {
  savedLists = catalog.lists;
  $("saved-lists").replaceChildren(new Option("Seleccionar lista", ""),
    ...savedLists.map(item => new Option(item.name, item.key)));
  $("saved-lists").value = selected ?? "";
  $("saved-label").hidden = !savedLists.length;
  $("storage").hidden = false;
  $("folder-path").textContent = catalog.folder;
  $("reveal-folder").disabled = !catalog.available;
  $("archived-controls").hidden = !catalog.archived.length;
  $("archived-lists").replaceChildren(...catalog.archived.map(item => new Option(item.name, item.key)));
  if (!catalog.available) {
    $("storage").open = true;
    notice("La carpeta de datos no está disponible. Conecta el disco o selecciona la carpeta donde están tus listas.", true);
  }
}

async function manageStorage(action) {
  if (!bridge) return;
  setBusy(true);
  $("workspace").inert = $("storage").inert = true;
  try {
    if (!(await flushPending())) throw Error("Hay cambios pendientes de guardar. Recupera primero el acceso a la carpeta de datos.");
    const key = action === "archive" ? book?.key : $("archived-lists").value;
    if (action === "archive" && !(await confirmAction("¿Archivar esta lista con todos sus registros? Podrás restaurarla desde Carpeta de datos."))) return;
    const catalog = await send(action, {key});
    if (!catalog) return;
    if (action === "archive") {
      book = sheet = data = record = null;
      students = [];
      rows = [];
      $("workspace").hidden = $("export-tools").hidden = $("archive-list").hidden = true;
      $("welcome").hidden = false;
      showCatalog(catalog);
      if (catalog.lists.length) await openSaved(catalog.lists[0].key);
    } else if (action === "unarchive") {
      showCatalog(catalog, key);
      await openSaved(key);
    } else {
      showCatalog(catalog, book?.key ?? catalog.active);
      if (!book && catalog.active) await openSaved(catalog.active);
      notice("Carpeta de guardado actualizada.");
    }
  } catch (error) { notice(error?.message ?? error, true); }
  finally {
    $("workspace").inert = $("storage").inert = false;
    setBusy(false);
    if (book) refresh();
  }
}

$("reveal-folder").onclick = () => send("revealFolder").catch(error => notice(error?.message ?? error, true));
$("choose-folder").onclick = () => manageStorage("chooseFolder");
$("archive-list").onclick = () => manageStorage("archive");
$("restore-list").onclick = () => manageStorage("unarchive");

async function openSaved(key) {
  if (!key) return;
  setBusy(true);
  $("workspace").inert = true;
  try {
    await loadFile(fileFromPayload(await send("load", {key})));
    $("saved-lists").value = book?.key ?? "";
  } catch (error) {
    $("saved-lists").value = book?.key ?? "";
    notice("No se pudo abrir la lista guardada. " + (error?.message ?? error), true);
  } finally {
    $("workspace").inert = false;
    setBusy(false);
    if (book) refresh();
  }
}

$("choose").onclick = async () => {
  if (!bridge) { $("file").click(); return; }
  setBusy(true);
  $("workspace").inert = true;
  try {
    const result = await send("choose");
    if (result) await loadFile(fileFromPayload(result), true);
  } catch (error) { notice(error?.message ?? error, true); }
  finally {
    $("workspace").inert = false;
    setBusy(false);
    if (book) refresh();
  }
};
$("saved-lists").onchange = () => openSaved($("saved-lists").value);

const periodNames = {"1": "Primer parcial", "2": "Segundo parcial", "3": "Tercer parcial"};
const periodName = () => periodNames[record.period] ?? "";

function renderRecords(state) {
  $("record").replaceChildren(...state.records.map((r, index) =>
    new Option([r.label.trim() || "Materia " + (index + 1), r.group?.trim(), periodNames[r.period]].filter(Boolean).join(" · "), index)));
  $("record").value = state.current;
}

function switchView(view) {
  const attendance = view === "attendance";
  $("show-attendance").setAttribute("aria-pressed", String(attendance));
  $("show-grades").setAttribute("aria-pressed", String(!attendance));
  $("attendance").hidden = !attendance || !students.length;
  $("evaluation").hidden = attendance || !students.length;
}
for (const view of ["attendance", "grades"]) {
  $("show-" + view).onclick = () => {
    data.view = view;
    switchView(view);
    save();
  };
}

function newSession() { return {date: "", marks: {}}; }
const session = () => record.sessions[record.day];
const datedSessions = () => record.sessions.filter(day => day.date).sort((a, b) => a.date.localeCompare(b.date));
const capturedSessions = () => datedSessions().filter(day => students.some(student => day.marks[student.row]));
const hasAttendance = () => Boolean(record && capturedSessions().length);
const displayDate = date => date ? date.split("-").reverse().join("/") : "";
const isoToday = () => {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
};

function tallies(student, days) {
  const presents = days.filter(day => day.marks[student.row] === "P").length;
  const absences = days.filter(day => day.marks[student.row] === "F").length;
  return {presents, absences, pending: days.length - presents - absences};
}

function renderAttendance(focus = null) {
  if (!students.length) return;
  const day = session();
  const days = datedSessions();
  const todayMarks = students.filter(student => day.marks[student.row]).length;
  $("attendance-summary").textContent = todayMarks + " de " + students.length + " marcados en esta sesión · " +
    days.length + " sesiones fechadas de " + record.sessions.length + " disponibles";
  $("sessions").replaceChildren(...record.sessions.map((entry, index) =>
    new Option(entry.date ? displayDate(entry.date) : "Sin fecha · Espacio " + (index + 1), index)));
  $("sessions").value = record.day;
  $("session-date").value = day.date;
  $("all-present").disabled = !day.date || todayMarks === students.length;
  $("add-session").disabled = record.sessions.length >= 16378;

  const head = element("thead");
  const headings = element("tr");
  for (const title of ["Alumno", "Esta sesión", "Presentes", "Faltas"]) {
    const cell = element("th", title);
    cell.scope = "col";
    headings.append(cell);
  }
  head.append(headings);
  const body = element("tbody");
  students.forEach((student, index) => {
    const row = element("tr");
    const name = element("th");
    name.scope = "row";
    name.append(element("span", String(index + 1), "row-number"), document.createTextNode(student.name));
    const markCell = element("td");
    const controls = element("div", "", "mark-buttons");
    for (const [status, label, style] of [["P", "Presente", "present"], ["F", "Falta", "absent"]]) {
      const button = element("button", label, style);
      button.type = "button";
      button.id = "mark-" + student.row + "-" + status;
      button.setAttribute("aria-label", student.name + " · " + label);
      button.setAttribute("aria-pressed", String(day.marks[student.row] === status));
      button.disabled = !day.date;
      button.onclick = () => {
        if (day.marks[student.row] === status) delete day.marks[student.row];
        else day.marks[student.row] = status;
        attendanceChanged(button.id);
      };
      controls.append(button);
    }
    markCell.append(controls);
    const {presents, absences} = tallies(student, days);
    row.append(name, markCell, element("td", presents, "summary-cell"), element("td", absences, "summary-cell"));
    body.append(row);
  });
  const grid = $("attendance-grid");
  grid.replaceChildren(head, body);
  if (focus) $(focus)?.focus({preventScroll: true});
}

function attendanceChanged(focus = null) {
  notice();
  renderAttendance(focus);
  refresh();
  save();
}

function addSession() {
  if (record.sessions.length >= 16378) return;
  record.sessions.push(newSession());
  record.day = record.sessions.length - 1;
}

$("sessions").onchange = () => { record.day = Number($("sessions").value); attendanceChanged(); };
$("add-session").onclick = () => { addSession(); attendanceChanged(); $("session-date").focus(); };
$("session-date").onchange = () => {
  const date = $("session-date").value;
  const current = session();
  if ((!date && Object.keys(current.marks).length) || (date && record.sessions.some(day => day !== current && day.date === date))) {
    $("session-date").value = current.date;
    notice(date ? "Ya existe un pase de lista para esa fecha en esta materia." : "Puedes cambiar la fecha de una sesión con marcas, pero debe conservar una fecha.", true);
    return;
  }
  current.date = date;
  attendanceChanged();
};
$("today").onclick = () => {
  const date = isoToday();
  const existing = record.sessions.findIndex(day => day.date === date);
  const free = record.sessions.findIndex(day => !day.date);
  if (existing >= 0) record.day = existing;
  else if (free >= 0) record.day = free;
  else if (record.sessions.length < 16378) addSession();
  else { notice("Esta lista alcanzó el límite de sesiones de Excel.", true); return; }
  session().date = date;
  attendanceChanged();
};
$("all-present").onclick = () => {
  if (!session().date) return;
  for (const student of students) session().marks[student.row] ??= "P";
  attendanceChanged();
};

function columnName(index) {
  let result = "";
  while (index) {
    index--;
    result = String.fromCharCode(65 + index % 26) + result;
    index = Math.floor(index / 26);
  }
  return result;
}

const serializer = new XMLSerializer();
const attendanceColumns = Array.from({length: 23}, (_, index) => columnName(index + 4));
const existingValue = ref => sheet.value(ref) !== "" || Boolean(sheet.cells.get(ref) && child(sheet.cells.get(ref), "f"));
const shortDate = date => displayDate(date).slice(0, 5);

async function excelDateStyles(changes) {
  if (!book.styles) return null;
  const doc = await book.zip.xml(book.styles);
  const root = doc.documentElement;
  const ns = root.namespaceURI;
  const formats = child(root, "numFmts") ?? root.insertBefore(doc.createElementNS(ns, "numFmts"), root.firstElementChild);
  const xfs = child(root, "cellXfs");
  if (!xfs?.children.length) return null;
  const next = Math.max(163, ...[...formats.children].map(node => Number(node.getAttribute("numFmtId")))) + 1;
  const formatIds = new Map(), styleIds = new Map();
  return (formatCode, original = 0, compact = false) => {
    if (!formatIds.has(formatCode)) {
      const id = next + formatIds.size;
      const format = doc.createElementNS(ns, "numFmt");
      format.setAttribute("numFmtId", id);
      format.setAttribute("formatCode", formatCode);
      formats.append(format);
      formats.setAttribute("count", formats.children.length);
      formatIds.set(formatCode, id);
    }
    const key = [formatCode, original, compact].join(":");
    if (!styleIds.has(key)) {
      const index = xfs.children.length;
      const xf = (xfs.children[original] ?? xfs.children[0]).cloneNode(true);
      xf.setAttribute("numFmtId", formatIds.get(formatCode));
      xf.setAttribute("applyNumberFormat", "1");
      if (compact) {
        const alignment = child(xf, "alignment") ?? xf.insertBefore(doc.createElementNS(ns, "alignment"), xf.firstElementChild);
        alignment.setAttribute("horizontal", "center");
        alignment.setAttribute("shrinkToFit", "1");
        alignment.removeAttribute("wrapText");
        xf.setAttribute("applyAlignment", "1");
      }
      xfs.append(xf);
      xfs.setAttribute("count", xfs.children.length);
      styleIds.set(key, index);
      changes.set(book.styles, serializer.serializeToString(doc));
    }
    return styleIds.get(key);
  };
}

function excelDate(date) {
  const base = book.date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
  const time = Date.parse(date + "T00:00:00Z");
  return (time - base) / 86400000 + (!book.date1904 && date >= "1900-03-01" ? 1 : 0);
}

function attendanceConflicts() {
  if (!sheet.attendanceLayout) return false;
  return attendanceColumns.some(column => existingValue(column + "6") ||
    students.some(student => existingValue(column + student.row))) ||
    students.some(student => existingValue("AA" + student.row));
}

function writeInstitutionalAttendance(doc, days, dateStyle) {
  attendanceColumns.forEach((column, index) => {
    const day = days[index];
    const ref = column + "6";
    if (day || existingValue(ref)) {
      const cell = writeCell(doc, ref, day ? (dateStyle ? excelDate(day.date) : shortDate(day.date)) : null);
      if (day && dateStyle) cell.setAttribute("s", dateStyle('dd"/"mm', Number(cell.getAttribute("s")), true));
    }
    students.forEach(student => {
      const ref = column + student.row;
      const mark = day?.marks[student.row];
      if (mark || existingValue(ref)) writeCell(doc, ref, mark ?? null);
    });
  });
  students.forEach(student => {
    const {presents, absences} = tallies(student, days);
    const ref = "AA" + student.row;
    if (presents + absences || existingValue(ref)) writeCell(doc, ref, presents + absences ? absences : null);
  });
}

function extraAttendanceXML(ns, days, grades, dateStyle) {
  const doc = document.implementation.createDocument(ns, "worksheet");
  const root = doc.documentElement;
  function append(parent, tag, attributes = {}) {
    const node = doc.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    parent.append(node);
    return node;
  }
  const lastColumn = columnName(6 + days.length);
  append(root, "dimension", {ref: "A1:" + lastColumn + (4 + students.length)});
  const views = append(root, "sheetViews");
  const view = append(views, "sheetView", {workbookViewId: 0});
  append(view, "pane", {xSplit: 2, ySplit: 4, topLeftCell: "C5", activePane: "bottomRight", state: "frozen"});
  append(view, "selection", {pane: "bottomRight", activeCell: "C5", sqref: "C5"});
  append(root, "sheetFormatPr", {defaultRowHeight: 16});
  const cols = append(root, "cols");
  append(cols, "col", {min: 1, max: 1, width: 8, customWidth: 1});
  append(cols, "col", {min: 2, max: 2, width: 42, customWidth: 1});
  append(cols, "col", {min: 3, max: 6, width: 15, customWidth: 1});
  if (days.length) append(cols, "col", {min: 7, max: 6 + days.length, width: 16, customWidth: 1});
  const body = append(root, "sheetData");
  function addRow(index, values) {
    const row = append(body, "row", {r: index});
    values.forEach((value, column) => {
      if (value === null || value === "") return;
      const cell = append(row, "c", {r: columnName(column + 1) + index});
      if (index === 4 && column >= 6 && dateStyle) {
        cell.setAttribute("s", dateStyle('dd"/"mm"/"yyyy'));
        append(cell, "v").textContent = excelDate(days[column - 6].date);
      } else if (typeof value === "number") append(cell, "v").textContent = value;
      else {
        cell.setAttribute("t", "inlineStr");
        append(append(cell, "is"), "t").textContent = value;
      }
    });
  }
  const group = record.group.trim() || $("group").placeholder;
  addRow(1, ["", ["Asistencia diaria", record.label.trim() || "Materia", group, periodName()].filter(Boolean).join(" · ")]);
  addRow(2, ["", "P = presente · F = falta · Celda vacía = pendiente"]);
  addRow(4, ["No.", "Alumno", "Presentes", "Faltas", "Pendientes", "Calificación", ...days.map(day => displayDate(day.date))]);
  students.forEach((student, index) => {
    const sums = tallies(student, days);
    addRow(5 + index, [index + 1, student.name, sums.presents, sums.absences, sums.pending,
      grades.get(student.row) ?? student.original, ...days.map(day => day.marks[student.row] ?? "")]);
  });
  append(root, "pageMargins", {left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15});
  append(root, "pageSetup", {orientation: "landscape"});
  return serializer.serializeToString(doc);
}

async function appendAttendance(changes, days, grades, dateStyle) {
  const workbookPath = "xl/workbook.xml";
  const relsPath = "xl/_rels/workbook.xml.rels";
  const typesPath = "[Content_Types].xml";
  const [workbook, rels, types] = await Promise.all([workbookPath, relsPath, typesPath].map(path => book.zip.xml(path)));
  const sheets = tags(workbook, "sheet");
  const relationships = tags(rels, "Relationship");
  const relIDs = new Set(relationships.map(node => node.getAttribute("Id")));
  const sheetNames = new Set(sheets.map(node => node.getAttribute("name").toLowerCase()));
  let index = 1, relId, path, relative;
  do {
    relId = "rId" + index;
    relative = "worksheets/docencia-attendance-" + index + ".xml";
    path = "xl/" + relative;
    index++;
  } while (relIDs.has(relId) || book.zip.entries.has(path));
  let title = "Asistencia diaria";
  for (let suffix = 2; sheetNames.has(title.toLowerCase()); suffix++) title = "Asistencia diaria " + suffix;
  const ns = workbook.documentElement.namespaceURI;
  const relAttr = sheets.flatMap(node => [...node.attributes]).find(attr => attr.localName === "id" && attr.namespaceURI);
  const sheetNode = workbook.createElementNS(ns, "sheet");
  sheetNode.setAttribute("name", title);
  sheetNode.setAttribute("sheetId", String(Math.max(0, ...sheets.map(node => Number(node.getAttribute("sheetId")))) + 1));
  sheetNode.setAttributeNS(relAttr.namespaceURI, relAttr.name, relId);
  tags(workbook, "sheets")[0].append(sheetNode);
  const relNode = rels.createElementNS(rels.documentElement.namespaceURI, "Relationship");
  relNode.setAttribute("Id", relId);
  relNode.setAttribute("Type", relAttr.namespaceURI + "/worksheet");
  relNode.setAttribute("Target", relative);
  rels.documentElement.append(relNode);
  const typeNode = types.createElementNS(types.documentElement.namespaceURI, "Override");
  typeNode.setAttribute("PartName", "/" + path);
  typeNode.setAttribute("ContentType", "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml");
  types.documentElement.append(typeNode);
  for (const [name, doc] of [[workbookPath, workbook], [relsPath, rels], [typesPath, types]]) changes.set(name, serializer.serializeToString(doc));
  changes.set(path, extraAttendanceXML(ns, days, grades, dateStyle));
}

const finalGrades = () => new Map(rows.filter(row => row.final !== null).map(row => [row.student.row, row.final]));

async function makeExcel() {
  const grades = finalGrades();
  const days = datedSessions();
  const official = sheet.official;
  const includeAttendance = days.length > 0;
  const changes = new Map();
  const doc = await book.zip.xml(sheet.entry.path);
  const dateStyle = includeAttendance ? await excelDateStyles(changes) : null;
  for (const student of students) if (student.ref && grades.has(student.row)) writeCell(doc, student.ref, grades.get(student.row));
  if (official && record.teacher.trim()) writeCell(doc, "B3", "MAESTRO: " + record.teacher.trim());
  if (official && record.label.trim()) writeCell(doc, "W3", record.label.trim());
  if (official && record.group.trim()) writeCell(doc, "V2", record.group.trim());
  if (official && periodName()) writeCell(doc, "B4", "PERIODO: " + periodName());
  if (includeAttendance && sheet.attendanceLayout) writeInstitutionalAttendance(doc, days, dateStyle);
  changes.set(sheet.entry.path, serializer.serializeToString(doc));
  if (includeAttendance || !activeSheetData().mapping.grade) await appendAttendance(changes, days, grades, dateStyle);
  return book.zip.withChanges(changes);
}

function exportName() {
  const safe = value => value.replace(/[\\/:*?"<>|]/g, "-").trim();
  const month = isoToday().slice(0, 7);
  return [month, book.name.replace(/\.xlsx$/i, ""), record.label || "Materia", record.group, periodName()]
    .map(safe).filter(Boolean).join(" - ") + ".xlsx";
}

function renderPreview(detail) {
  const days = datedSessions();
  const grades = finalGrades();
  const headerStart = ["Alumno"];
  let headers, values;
  if (detail) {
    headers = [...headerStart, "Presentes", "Faltas", "Pendientes", "Calificación", ...days.map(day => displayDate(day.date))];
    values = students.map(student => {
      const {presents, absences, pending} = tallies(student, days);
      return [student.name, presents, absences, pending, grades.get(student.row) ?? student.original,
        ...days.map(day => day.marks[student.row] ?? "")];
    });
  } else if (sheet.attendanceLayout) {
    const visibleDays = days.slice(0, attendanceColumns.length);
    headers = [...headerStart, ...attendanceColumns.map((column, index) =>
      days.length ? shortDate(visibleDays[index]?.date ?? "") : sheet.value(column + "6")), "Total faltas", "Calif."];
    values = students.map(student => {
      const {presents, absences} = tallies(student, days);
      const attendance = attendanceColumns.map((column, index) =>
        days.length ? visibleDays[index]?.marks[student.row] ?? "" : sheet.value(column + student.row));
      const total = days.length ? (presents + absences ? absences : "") : sheet.value("AA" + student.row);
      return [student.name, ...attendance, total, grades.get(student.row) ?? student.original];
    });
  } else {
    headers = [...headerStart, "Calificación"];
    values = students.map(student => [student.name, grades.get(student.row) ?? student.original]);
  }
  $("preview-name").textContent = exportName();
  $("preview-official").setAttribute("aria-pressed", String(!detail));
  $("preview-detail").setAttribute("aria-pressed", String(detail));
  $("preview-detail").disabled = !days.length && Boolean(activeSheetData().mapping.grade);
  const context = [record.label, record.group || $("group").placeholder, periodName()].filter(Boolean).join(" · ");
  $("preview-note").textContent = [context,
    !detail && sheet.attendanceLayout ? "La hoja institucional muestra hasta 23 fechas. Total faltas incluye todas." : "",
    "P = presente · F = falta"].filter(Boolean).join(" | ");
  const head = element("thead");
  const tr = element("tr");
  tr.append(...headers.map(title => element("th", title)));
  head.append(tr);
  const body = element("tbody");
  values.forEach(([student, ...cells]) => {
    const row = element("tr");
    const name = element("th", student);
    name.scope = "row";
    row.append(name, ...cells.map(value => element("td", value, value === "F" ? "absent" : "")));
    body.append(row);
  });
  $("preview-grid").replaceChildren(head, body);
}

$("preview-open").onclick = () => { renderPreview(!sheet.attendanceLayout && datedSessions().length > 0); $("preview").showModal(); };
$("preview-official").onclick = () => renderPreview(false);
$("preview-detail").onclick = () => renderPreview(true);

async function exportFile() {
  if ($("export").disabled) return;
  const replaceGrades = rows.some(row => row.final !== null && row.student.original !== "");
  const replaceAttendance = datedSessions().length && attendanceConflicts();
  setBusy(true);
  $("workspace").inert = true;
  try {
    if (replaceGrades || replaceAttendance) {
      const entries = [replaceGrades ? "calificaciones" : "", replaceAttendance ? "asistencias o totales de faltas" : ""].filter(Boolean).join(" y ");
      const message = "La copia sustituirá " + entries + " existentes por los valores de esta materia. ¿Continuar?";
      if (!(await confirmAction(message))) return;
    }
    const blob = await makeExcel();
    const name = exportName();
    if (bridge) {
      const bytes = new Uint8Array(await blob.arrayBuffer()).toBase64();
      if (!(await send("export", {name, bytes}))) return;
    } else {
      const link = element("a");
      link.href = URL.createObjectURL(blob);
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 30000);
    }
    notice("Excel guardado. Incluye lo capturado para esta materia.");
  } catch (error) { notice(error?.message ?? error, true); }
  finally {
    $("workspace").inert = false;
    setBusy(false);
    refresh();
  }
}
$("export").onclick = exportFile;

if (bridge) {
  send("catalog").then(async catalog => {
    showCatalog(catalog, catalog.active);
    if (catalog.active) await openSaved(catalog.active);
  }).catch(error => notice(error?.message ?? error, true));
} else {
  $("save-status").textContent = "Edición web";
  $("welcome").querySelector("small").textContent = "Vuelve a abrir el mismo Excel en este navegador para recuperar su borrador.";
}
