// Hilván · el campo: se registra en Sveltia con su nombre y las diferencias por palabras salen bien.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const carga = (cms, dataset = {}) => {
  const ctx = { window: { CMS: cms }, document: { currentScript: { dataset } }, console, localStorage: { getItem: () => null }, location: { hash: "" } };
  ctx.window.window = ctx.window;
  vm.runInNewContext(readFileSync(new URL("../plugin/hilvan.js", import.meta.url), "utf8"), { ...ctx, CMS: cms });
};
const cmsFalso = () => {
  const registrados = [];
  return { React: { createElement: () => null, useState: () => [], useRef: () => ({}), useEffect: () => {} }, registerFieldType: (...a) => registrados.push(a), registrados };
};

test("se registra como campo «hilvan» (o con el nombre que se le dé)", () => {
  const cms = cmsFalso();
  carga(cms);
  assert.equal(cms.registrados[0][0], "hilvan");
  assert.equal(typeof cms.registrados[0][1], "function");
  const otro = cmsFalso();
  carga(otro, { nombre: "texto-ia" });
  assert.equal(otro.registrados[0][0], "texto-ia");
});

test("sin Sveltia cargado antes, no rompe nada", () => {
  assert.doesNotThrow(() => vm.runInNewContext(readFileSync(new URL("../plugin/hilvan.js", import.meta.url), "utf8"), { window: {}, document: {}, console: { warn() {} } }));
});

test("diferencias por palabras", () => {
  const cms = cmsFalso();
  carga(cms);
  const dif = cms.registrados[0][1].diferencias;
  const junta = (d) => d.map((x) => (x.tipo === "igual" ? x.t : x.tipo === "pone" ? `{+${x.t}+}` : `[-${x.t}-]`)).join("");
  assert.equal(junta(dif("hola soy noor", "Hola, soy Noor")), "[-hola-]{+Hola,+} soy [-noor-]{+Noor+}");
  assert.equal(junta(dif("igual", "igual")), "igual");
  // reconstruye los dos textos
  const a = "Diseño de moda y comunicacion en Madrid";
  const b = "Diseño de moda, comunicación y producción en Madrid";
  const d = dif(a, b);
  assert.equal(d.filter((x) => x.tipo !== "pone").map((x) => x.t).join(""), a);
  assert.equal(d.filter((x) => x.tipo !== "quita").map((x) => x.t).join(""), b);
});

// un DOM mínimo para aMd: lo justo que lee (nodeType, nodeName, childNodes, nodeValue, getAttribute, style)
const t = (v) => ({ nodeType: 3, nodeName: "#text", nodeValue: v, childNodes: [] });
const el = (nombre, hijos = [], attrs = {}, style = {}) => ({
  nodeType: 1,
  nodeName: nombre,
  childNodes: hijos.map((x) => (typeof x === "string" ? t(x) : x)),
  getAttribute: (k) => attrs[k] ?? null,
  style,
});

test("formato: de Markdown al HTML del editor", () => {
  const cms = cmsFalso();
  carga(cms);
  const { aHtml } = cms.registrados[0][1].formato;
  assert.equal(aHtml("Hola, soy **Noor**."), "<p>Hola, soy <strong>Noor</strong>.</p>");
  assert.equal(aHtml("uno\ndos\n\ntres"), "<p>uno<br>dos</p><p>tres</p>");
  assert.equal(aHtml("*cursiva* y ***las dos***"), "<p><em>cursiva</em> y <strong><em>las dos</em></strong></p>");
  assert.equal(aHtml("[Vinted](https://vinted.es/x?a=1&b=2)"), '<p><a href="https://vinted.es/x?a=1&amp;b=2">Vinted</a></p>');
  // nada de código: lo de dentro se escapa y los enlaces raros se quedan en texto
  assert.equal(aHtml('<img src=x onerror="a()">'), "<p>&lt;img src=x onerror=&quot;a()&quot;&gt;</p>");
  assert.equal(aHtml("[pulsa](javascript:alert(1))"), "<p>pulsa)</p>");
  // lo escapado se queda tal cual, y un hueco [así] también
  assert.equal(aHtml("2 \\* 3 y [hueco]"), "<p>2 * 3 y [hueco]</p>");
  assert.equal(aHtml(""), "<p><br></p>");
});

test("formato: del editor a Markdown", () => {
  const cms = cmsFalso();
  carga(cms);
  const { aMd } = cms.registrados[0][1].formato;
  // lo que hace el navegador al escribir: párrafos, saltos, negrita y cursiva (con etiqueta o con estilo) y enlaces
  const raiz = el("DIV", [
    el("P", ["Hola, soy ", el("B", ["Noor "]), "y ", el("SPAN", ["esto"], {}, { fontStyle: "italic" }), "."]),
    el("P", ["uno", el("BR"), "dos", el("BR")]),
    el("P", [el("BR")]),
    el("P", ["en ", el("A", ["Vinted"], { href: "https://vinted.es" }), " y 2 * 3"]),
  ]);
  assert.equal(aMd(raiz), "Hola, soy **Noor** y *esto*.\n\nuno\ndos\n\nen [Vinted](https://vinted.es) y 2 \\* 3");
  assert.equal(aMd(el("DIV", [el("P", ["uno\ndos"])])), "uno\ndos"); // Mayús+Intro con pre-wrap
  // lo primero que se escribe en un editor vacío va suelto, sin párrafo
  assert.equal(aMd(el("DIV", ["suelto", el("P", ["luego"])])), "suelto\n\nluego");
  // ida y vuelta
  const { aHtml } = cms.registrados[0][1].formato;
  assert.equal(aHtml(aMd(raiz)), "<p>Hola, soy <strong>Noor</strong> y <em>esto</em>.</p><p>uno<br>dos</p><p>en <a href=\"https://vinted.es\">Vinted</a> y 2 * 3</p>");
});
