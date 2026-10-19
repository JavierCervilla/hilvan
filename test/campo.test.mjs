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
