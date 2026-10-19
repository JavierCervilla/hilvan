// Los dos revisores de la CI: los caracteres invisibles y la CI honesta. Si no saben ponerse en rojo, no valen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { busca } from "../scripts/unicode.mjs";
import { autoprueba, revisa } from "../scripts/ci-honesto.mjs";

// los caracteres se crean al ejecutar: el fichero no lleva ninguno (si no, el propio revisor lo pararía)
const u = (...cps) => String.fromCodePoint(...cps);

test("unicode: encuentra controles bidireccionales, ancho cero y etiquetas; deja pasar el texto normal", () => {
  assert.deepEqual(busca("const a = 1; // ñandú «hola» — café"), []);
  assert.equal(busca(`if (x) {${u(0x202e)} } // texto`).length, 1);
  assert.equal(busca(`a${u(0x200b)}b`)[0].cp, "U+200B");
  assert.equal(busca(`hola${u(0xe0041, 0xe0042)}`).length, 2);
  assert.deepEqual(busca(`${u(0xfeff)}BOM al principio vale`), []);
  assert.equal(busca(`en medio${u(0xfeff)}no`).length, 1);
  const [h] = busca(`línea 1\nlínea ${u(0x2066)}dos`);
  assert.equal(h.linea, 2);
});

test("ci-honesto: la autoprueba pasa y detecta cada trampa", () => {
  assert.deepEqual(autoprueba(), []);
  assert.equal(revisa("      - run: npm test || true")[0].trampa, "|| true");
  assert.equal(revisa("        continue-on-error: true").length, 1);
  assert.equal(revisa("      # continue-on-error: true no cuenta en un comentario").length, 0);
  assert.equal(revisa("      - run: npm test").length, 0);
});
