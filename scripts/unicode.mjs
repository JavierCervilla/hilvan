// Busca caracteres invisibles o de control en los ficheros del repositorio: los que se usan para que un código se lea
// distinto de como se ejecuta (controles bidireccionales, «Trojan Source»), espacios de ancho cero y caracteres de
// etiqueta Unicode (texto oculto para instrucciones a modelos). Sale en rojo si encuentra alguno.
//
//   node scripts/unicode.mjs            → revisa los ficheros que sigue git
//   node scripts/unicode.mjs a.js b.md  → solo esos
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const PELIGROSOS = [
  [0x202a, 0x202e, "control bidireccional"],
  [0x2066, 0x2069, "aislamiento bidireccional"],
  [0x200b, 0x200f, "ancho cero o marca de dirección"],
  [0x2028, 0x2029, "separador de línea o párrafo"],
  [0x2060, 0x2064, "unión o invisible"],
  [0xfeff, 0xfeff, "BOM en medio del texto"],
  [0xe0000, 0xe007f, "etiqueta Unicode (texto oculto)"],
];

export function busca(texto) {
  const hallazgos = [];
  let linea = 1;
  let col = 0;
  let i = 0;
  for (const c of texto) {
    const cp = c.codePointAt(0);
    col += 1;
    if (c === "\n") {
      linea += 1;
      col = 0;
    } else if (!(cp === 0xfeff && i === 0)) {
      const tipo = PELIGROSOS.find(([a, b]) => cp >= a && cp <= b);
      if (tipo) hallazgos.push({ linea, col, cp: `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`, tipo: tipo[2] });
    }
    i += 1;
  }
  return hallazgos;
}

const binario = (buf) => buf.subarray(0, 8000).includes(0);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ficheros = process.argv.slice(2).length
    ? process.argv.slice(2)
    : execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
  let malos = 0;
  let revisados = 0;
  for (const f of ficheros) {
    const buf = readFileSync(f);
    if (binario(buf)) continue;
    revisados += 1;
    for (const h of busca(buf.toString("utf8"))) {
      malos += 1;
      console.log(`MAL  ${f}:${h.linea}:${h.col}  ${h.cp} (${h.tipo})`);
    }
  }
  console.log(malos ? `\nROJO: ${malos} caracteres peligrosos.` : `OK: ${revisados} ficheros sin caracteres peligrosos.`);
  process.exit(malos ? 1 : 0);
}
