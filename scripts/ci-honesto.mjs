// Una CI honesta no apaga sus comprobaciones a escondidas. Revisa los workflows de .github/workflows y sale en rojo si
// algún paso puede fallar sin que la CI se entere: `continue-on-error: true`, `|| true`, `|| exit 0`, `set +e`,
// `--exit-zero`, `if: false`… Antes de revisar, se prueba a sí mismo con ejemplos buenos y malos: si no sabe ponerse en
// rojo, tampoco vale su verde.
//
//   node scripts/ci-honesto.mjs   → revisa .github/workflows/*.yml
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const TRAMPAS = [
  [/^\s*continue-on-error:\s*true\b/m, "continue-on-error: true"],
  [/\|\|\s*true\b/, "|| true"],
  [/\|\|\s*exit\s+0\b/, "|| exit 0"],
  [/\|\|\s*:\s*$/m, "|| :"],
  [/^\s*set\s+\+e\b/m, "set +e"],
  [/--exit-zero\b/, "--exit-zero"],
  [/--no-error\b/, "--no-error"],
  [/^\s*if:\s*(false|\$\{\{\s*false\s*\}\})\s*$/m, "if: false"],
];

// las líneas de comentario no cuentan: se puede explicar una trampa sin hacerla
export function revisa(texto) {
  const out = [];
  texto.split("\n").forEach((l, i) => {
    if (/^\s*#/.test(l)) return;
    for (const [re, nombre] of TRAMPAS) if (re.test(l)) out.push({ linea: i + 1, trampa: nombre, texto: l.trim() });
  });
  return out;
}

const MALOS = [
  "      - run: npm test || true",
  "        continue-on-error: true",
  "      - run: semgrep scan --exit-zero",
  "        run: |\n          set +e\n          npm audit",
  "      - run: npm audit || exit 0",
  "        if: false",
];
const BUENOS = ["      - run: npm test", "      # || true aquí no vale: esto es un comentario", "        if: github.event_name == 'push'"];

export function autoprueba() {
  const fallos = [
    ...MALOS.filter((m) => revisa(m).length === 0).map((m) => `no detecta: ${m.trim()}`),
    ...BUENOS.filter((b) => revisa(b).length > 0).map((b) => `falso positivo: ${b.trim()}`),
  ];
  return fallos;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fallos = autoprueba();
  if (fallos.length) {
    console.log(`ROJO: el revisor no es fiable.\n${fallos.join("\n")}`);
    process.exit(1);
  }
  const dir = ".github/workflows";
  let malos = 0;
  for (const f of readdirSync(dir).filter((x) => /\.ya?ml$/.test(x))) {
    for (const h of revisa(readFileSync(join(dir, f), "utf8"))) {
      malos += 1;
      console.log(`MAL  ${dir}/${f}:${h.linea}  ${h.trampa}  →  ${h.texto}`);
    }
  }
  console.log(malos ? `\nROJO: ${malos} comprobaciones apagadas.` : "OK: ningún paso de la CI puede fallar en silencio.");
  process.exit(malos ? 1 : 0);
}
