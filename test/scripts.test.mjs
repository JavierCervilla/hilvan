// Los dos revisores de la CI: los caracteres invisibles y la CI honesta. Si no saben ponerse en rojo, no valen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { busca } from "../scripts/unicode.mjs";
import { autoprueba, revisa } from "../scripts/ci-honesto.mjs";

test("unicode: encuentra controles bidireccionales, ancho cero y etiquetas; deja pasar el texto normal", () => {
  assert.deepEqual(busca("const a = 1; // ñandú «hola» — café"), []);
  assert.equal(busca("if (x) {‮ } // texto").length, 1);
  assert.equal(busca("a​b")[0].cp, "U+200B");
  assert.equal(busca("hola\u{E0041}\u{E0042}").length, 2);
  assert.deepEqual(busca("﻿BOM al principio vale"), []);
  const [h] = busca("línea 1\nlínea ⁦dos");
  assert.equal(h.linea, 2);
});

test("ci-honesto: la autoprueba pasa y detecta cada trampa", () => {
  assert.deepEqual(autoprueba(), []);
  assert.equal(revisa("      - run: npm test || true")[0].trampa, "|| true");
  assert.equal(revisa("        continue-on-error: true").length, 1);
  assert.equal(revisa("      # continue-on-error: true no cuenta en un comentario").length, 0);
  assert.equal(revisa("      - run: npm test").length, 0);
});
