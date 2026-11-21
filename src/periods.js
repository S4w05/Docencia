"use strict";

const ordinalPeriods = ["Primer parcial", "Segundo parcial", "Tercer parcial", "Cuarto parcial"];
const partialName = n => ordinalPeriods[n - 1] ?? "Parcial " + n;
const subjectPeriods = () => activeSheetData().records.filter(item => item.subjectId === record.subjectId);
const periodName = () => record.period.trim() || (record.kind === "semester" ? "Semestral" : "Parcial");
const rosterGroup = () => (sheet.official && sheet.value("V2").trim()) || sheet.entry.name;

function initializePeriods(state) {
  const legacySubjects = new Map();
  for (const [index, item] of state.records.entries()) {
    if (item.subjectId) continue;
    const label = item.label.trim().normalize("NFC").toLocaleLowerCase("es-MX");
    const group = (item.group?.trim() || rosterGroup()).normalize("NFC").toLocaleLowerCase("es-MX");
    const key = label && JSON.stringify([label, group]);
    item.subjectId = legacySubjects.get(key) ?? "legacy-" + index;
    if (key) legacySubjects.set(key, item.subjectId);
    item.period = /^\d+$/.test(item.period ?? "") ? partialName(Number(item.period)) : item.period?.trim() || "Primer parcial";
    item.kind ??= /semestral/i.test(item.period) ? "semester" : "partial";
    item.sessions ??= Array.from({length: 30}, newSession);
    if (!item.sessions.length) item.sessions.push(newSession());
    item.day = Math.max(0, Math.min(item.day ?? 0, item.sessions.length - 1));
  }
  state.current = Math.max(0, Math.min(state.current ?? 0, state.records.length - 1));
  state.rules ??= {};
}

function renderRecords(state) {
  const subjects = new Map();
  for (const [index, item] of state.records.entries()) {
    if (!subjects.has(item.subjectId)) {
      const group = item.group?.trim();
      subjects.set(item.subjectId, new Option(
        [item.label.trim() || "Materia sin nombre", group && group !== rosterGroup() ? group : ""].filter(Boolean).join(" · "), index));
    }
  }
  $("subject").replaceChildren(...subjects.values());
  $("record").replaceChildren(...state.records.flatMap((item, index) => item.subjectId === record?.subjectId
    ? [new Option(item.period.trim() || "Periodo sin nombre", index)] : []));
  if (record) {
    $("subject").value = subjects.get(record.subjectId).value;
    $("record").value = state.current;
  }
  for (const id of ["subject", "record", "add-period", "add-semester"]) $(id).disabled = !record;
}

function selectPeriod(index) {
  activeSheetData().current = index;
  notice();
  configure();
  save();
}

$("subject").onchange = () => selectPeriod(Number($("subject").value));
$("record").onchange = () => selectPeriod(Number($("record").value));
$("new-record").onclick = () => {
  const {records} = activeSheetData();
  records.push({...freshRecord(""), subjectId: crypto.randomUUID()});
  selectPeriod(records.length - 1);
  $("record-name").focus();
};

function addPeriod(kind) {
  const periods = subjectPeriods();
  const existing = new Set(periods.map(item => item.period.trim().toLocaleLowerCase("es-MX")));
  let n = periods.filter(item => item.kind === kind).length + 1;
  let title;
  do {
    title = kind === "partial" ? partialName(n) : n === 1 ? "Semestral" : "Semestral " + n;
    n++;
  } while (existing.has(title.toLocaleLowerCase("es-MX")));
  const {records} = activeSheetData();
  const item = {...freshRecord(record.label), subjectId: record.subjectId, teacher: record.teacher, group: record.group, kind, period: title};
  if (kind === "semester") item.items = [{label: "Examen o proyecto semestral", weight: "100"}];
  records.push(item);
  selectPeriod(records.length - 1);
}

$("add-period").onclick = () => addPeriod("partial");
$("add-semester").onclick = () => addPeriod("semester");
$("record-name").oninput = () => {
  for (const item of subjectPeriods()) item.label = $("record-name").value;
  renderRecords(activeSheetData());
  save();
};
$("period").oninput = () => {
  record.period = $("period").value;
  renderRecords(activeSheetData());
  if (!$("summary").hidden) renderSummary();
  save();
};
$("teacher").oninput = () => { record.teacher = $("teacher").value; save(); };
$("period-kind").onchange = () => {
  record.kind = $("period-kind").value;
  if (!$("summary").hidden) renderSummary();
  save();
};

$("remove-subject").onclick = async () => {
  const state = activeSheetData();
  const id = record.subjectId;
  const name = record.label.trim() || "Materia sin nombre";
  const count = subjectPeriods().length;
  if (!(await confirmAction("¿Quitar «" + name + "» de esta lista? Se eliminarán sus " + count +
    " periodo(s), con sus calificaciones y asistencias."))) return;
  state.records = state.records.filter(item => item.subjectId !== id);
  delete state.rules[id];
  selectPeriod(0);
};

function subjectRules() {
  const state = activeSheetData();
  return state.rules[record.subjectId] ??= {planned: "3", partial: "50", semester: "50"};
}

function scoreInPoints(item, row) {
  const scores = item.scores[row] ?? [];
  let weightSum = 0, points = 0;
  for (const [index, activity] of item.items.entries()) {
    const weight = numeric(activity.weight);
    const score = numeric(scores[index]);
    if (!Number.isFinite(weight) || Number.isNaN(score) || (weight > 0 && score === null)) return null;
    weightSum += weight;
    points += (score ?? 0) * weight / 100;
  }
  return weightSum > 0 && rounded(weightSum, 8) <= 100 ? points : null;
}

function subjectSummary() {
  const rules = subjectRules();
  const periods = subjectPeriods();
  const partial = numeric(rules.partial), semester = numeric(rules.semester);
  const planned = Number(rules.planned);
  const valid = Number.isFinite(partial) && Number.isFinite(semester) && rounded(partial + semester, 8) === 100 &&
    Number.isSafeInteger(planned) && planned >= 1;
  const partialCount = periods.filter(item => item.kind === "partial").length;
  const semesterCount = periods.length - partialCount;
  const average = values => values.length && values.every(value => value !== null)
    ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const heading = ["Alumno", ...periods.flatMap(item => {
    const title = item.period.trim() || "Periodo sin nombre";
    return [title + " · Nota / 100", title + " · Presentes", title + " · Faltas"];
  }), "Presentes totales", "Faltas totales", "Parciales / " + (Number.isFinite(partial) ? partial : "—"),
    "Semestral / " + (Number.isFinite(semester) ? semester : "—"), "Final / 100"];
  const days = periods.map(item => item.sessions.filter(day => day.date));
  const values = students.map(student => {
    const grades = periods.map(item => scoreInPoints(item, student.row));
    const counts = days.map(entries => tallies(student, entries));
    const gradeFor = kind => average(grades.filter((_, index) => periods[index].kind === kind));
    const partialGrade = gradeFor("partial"), semesterGrade = gradeFor("semester");
    const partialResult = !valid ? null : partial === 0 ? 0 :
      partialCount >= planned && partialGrade !== null ? partialGrade * partial / 100 : null;
    const semesterResult = !valid ? null : semester === 0 ? 0 : semesterGrade === null ? null : semesterGrade * semester / 100;
    const final = partialResult === null || semesterResult === null ? null : rounded(partialResult + semesterResult, 2);
    return [student.name, ...grades.flatMap((grade, index) => [grade, counts[index].presents, counts[index].absences]),
      ...["presents", "absences"].map(key => counts.reduce((sum, count) => sum + count[key], 0)), partialResult, semesterResult, final];
  });
  const note = !valid ? "Configura al menos un parcial previsto y reparte 100 puntos entre los dos bloques." :
    partialCount < planned && partial > 0 ? "Parciales registrados: " + partialCount + " de " + planned + " previstos." :
    !semesterCount && semester > 0 ? "Agrega el periodo semestral para calcular la nota final." :
    "El resultado final aparece al completar las calificaciones de los bloques con puntos asignados.";
  return {heading, values, note};
}

function renderSummary() {
  const {heading, values, note} = subjectSummary();
  $("summary-note").textContent = note + " Cada bloque usa el promedio de sus notas sobre 100 y lo convierte a los puntos asignados.";
  const thead = element("thead"), headers = element("tr"), tbody = element("tbody");
  headers.append(...heading.map(text => element("th", text)));
  thead.append(headers);
  for (const [name, ...grades] of values) {
    const row = element("tr");
    row.append(element("th", name), ...grades.map(value => element("td", value === null ? "—" : format.format(value))));
    tbody.append(row);
  }
  $("summary-grid").replaceChildren(thead, tbody);
}

function summaryXML(ns, style) {
  const {heading, values} = subjectSummary();
  const doc = document.implementation.createDocument(ns, "worksheet");
  function append(parent, name, attributes = {}) {
    const node = doc.createElementNS(ns, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    parent.append(node);
    return node;
  }
  const root = doc.documentElement;
  const visibleColumns = heading.length;
  if (visibleColumns > 16384) throw Error("El recuento supera el ancho de una hoja de Excel.");
  const cols = append(root, "cols");
  append(cols, "col", {min: 1, max: 1, width: 38, customWidth: 1});
  append(cols, "col", {min: 2, max: visibleColumns, width: 26, customWidth: 1});
  const body = append(root, "sheetData");
  [[record.label, rosterGroup()], heading, ...values].forEach((cells, index) => {
    const row = append(body, "row", {r: index + 1});
    cells.forEach((value, column) => {
      if (value === null || value === "") return;
      const ref = columnName(column + 1) + (index + 1);
      const cell = append(row, "c", {r: ref});
      if (typeof value === "number") {
        centerExcelCell(cell, style);
        append(cell, "v").textContent = rounded(value, 2);
      } else {
        cell.setAttribute("t", "inlineStr");
        append(append(cell, "is"), "t").textContent = value;
      }
    });
  });
  return serializer.serializeToString(doc);
}

const ruleFields = {"planned": "planned", "partial-points": "partial", "semester-points": "semester"};
function showRules() {
  const rules = subjectRules();
  for (const [id, key] of Object.entries(ruleFields)) $(id).value = rules[key];
  renderSummary();
}
for (const [id, key] of Object.entries(ruleFields)) $(id).oninput = () => {
  subjectRules()[key] = $(id).value;
  renderSummary();
  save();
};
