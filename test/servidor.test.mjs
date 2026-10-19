// Hilván · servidor: quién puede pedir, el tope, el límite de caracteres, lo que se le manda al modelo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { atiende, limpia, mensaje, origenPermitido, sistema } from "../worker/src/sugerir.js";

const kv = () => {
  const m = new Map();
  return { get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, v), _m: m };
};
const ENV = (extra = {}) => ({
  REPO: "dueña/web",
  ORIGENES: "https://web.com,https://*.web.pages.dev,http://localhost:4321",
  ANTHROPIC_API_KEY: "sk-ant-prueba",
  TOPE_DIARIO: "3",
  VOZ: "Cercana y directa.",
  HILVAN: kv(),
  ...extra,
});
// GitHub dice si el token puede escribir; Anthropic devuelve lo que se le pida
const falso = ({ push = true, respuestas = ["Texto pulido."] } = {}) => {
  const llamadas = [];
  const f = async (url, init = {}) => {
    llamadas.push({ url: String(url), init });
    if (String(url).startsWith("https://api.github.com/repos/"))
      return new Response(JSON.stringify({ permissions: { push } }), { status: init.headers?.authorization === "Bearer bueno" ? 200 : 401 });
    if (String(url) === "https://api.anthropic.com/v1/messages") {
      const t = respuestas.shift() ?? "otra";
      return new Response(JSON.stringify({ content: [{ type: "text", text: t }] }));
    }
    throw new Error(`fetch inesperado: ${url}`);
  };
  f.llamadas = llamadas;
  return f;
};
const pide = (cuerpo, { origen = "https://web.com", token = "bueno", metodo = "POST", ruta = "/sugerir" } = {}) =>
  new Request(`https://hilvan.ejemplo.dev${ruta}`, {
    method: metodo,
    headers: { origin: origen, "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(metodo === "POST" ? { body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo) } : {}),
  });
const json = async (r) => [r.status, await r.json()];

test("una sugerencia con sesión válida", async () => {
  const f = falso();
  const [s, b] = await json(await atiende(pide({ texto: "texto pulido" }), ENV(), f));
  assert.equal(s, 200);
  assert.equal(b.sugerencia, "Texto pulido.");
  assert.equal(b.restantes, 2);
  const llamada = f.llamadas.find((l) => l.url.includes("anthropic"));
  assert.equal(llamada.init.headers["x-api-key"], "sk-ant-prueba");
});

test("sin sesión, con una cuenta sin permiso o con un token falso: no", async () => {
  assert.equal((await atiende(pide({ texto: "a" }, { token: "" }), ENV(), falso())).status, 401);
  assert.equal((await atiende(pide({ texto: "a" }), ENV(), falso({ push: false }))).status, 403);
  assert.equal((await atiende(pide({ texto: "a" }, { token: "malo" }), ENV(), falso())).status, 403);
});

test("el permiso se recuerda y el token no se guarda tal cual", async () => {
  const env = ENV();
  const f = falso({ respuestas: ["Uno.", "Dos."] });
  await atiende(pide({ texto: "uno" }), env, f);
  await atiende(pide({ texto: "dos" }), env, f);
  assert.equal(f.llamadas.filter((l) => l.url.includes("github")).length, 1);
  assert.ok([...env.HILVAN._m.keys()].every((k) => !k.includes("bueno")));
});

test("solo desde los orígenes permitidos (también subdominios con comodín)", async () => {
  assert.equal((await atiende(pide({ texto: "a" }, { origen: "https://malo.com" }), ENV(), falso())).status, 403);
  assert.equal((await atiende(pide({ texto: "a" }, { origen: "https://rama.web.pages.dev" }), ENV(), falso())).status, 200);
  assert.ok(!origenPermitido("https://web.pages.dev.malo.com", "https://*.web.pages.dev"));
  assert.ok(!origenPermitido("http://web.com", "https://web.com"));
  const r = await atiende(pide(null, { metodo: "OPTIONS" }), ENV(), falso());
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("access-control-allow-origin"), "https://web.com");
});

test("el tope diario", async () => {
  const env = ENV({ TOPE_DIARIO: "2" });
  const f = falso({ respuestas: ["a", "b", "c"] });
  assert.equal((await atiende(pide({ texto: "1" }), env, f)).status, 200);
  assert.equal((await atiende(pide({ texto: "2" }), env, f)).status, 200);
  const [s, b] = await json(await atiende(pide({ texto: "3" }), env, f));
  assert.equal(s, 429);
  assert.match(b.error, /mañana/);
});

test("si se pasa del límite, pide que lo acorte una vez", async () => {
  const f = falso({ respuestas: ["Un texto demasiado largo para el campo.", "Corto."] });
  const [, b] = await json(await atiende(pide({ texto: "texto", campo: { max: 10 } }), ENV(), f));
  assert.equal(b.sugerencia, "Corto.");
  assert.equal(b.largo, false);
  assert.equal(f.llamadas.filter((l) => l.url.includes("anthropic")).length, 2);
  const f2 = falso({ respuestas: ["Larguísimo de verdad.", "Sigue larguísimo."] });
  const [, b2] = await json(await atiende(pide({ texto: "texto", campo: { max: 10 } }), ENV(), f2));
  assert.equal(b2.largo, true);
});

test("peticiones mal hechas", async () => {
  assert.equal((await atiende(pide("{no es json"), ENV(), falso())).status, 400);
  assert.equal((await atiende(pide({ texto: "   " }), ENV(), falso())).status, 400);
  assert.equal((await atiende(pide({ texto: "x".repeat(7000) }), ENV(), falso())).status, 413);
  assert.equal((await atiende(pide({ texto: "a" }, { ruta: "/otra" }), ENV(), falso())).status, 404);
});

test("en local: sin sesión y sin clave, una sugerencia de prueba; fuera de local, nunca", async () => {
  const env = ENV({ MODO_LOCAL: "1", ANTHROPIC_API_KEY: "" });
  const [s, b] = await json(await atiende(pide({ texto: "hola  mundo ,adiós" }, { origen: "http://localhost:4321", token: "" }), env, falso()));
  assert.equal(s, 200);
  assert.equal(b.demo, true);
  assert.equal(b.sugerencia, "Hola mundo,adiós.");
  assert.equal((await atiende(pide({ texto: "a" }, { token: "" }), env, falso())).status, 401);
});

test("el encargo: reglas, voz, contexto y el texto separado", () => {
  const s = sistema("Cercana y directa.");
  assert.match(s, /No inventes nada/);
  assert.match(s, /corchetes/);
  assert.match(s, /Cercana y directa\./);
  const m = mensaje({ texto: "hola <b>", campo: { etiqueta: "Entradilla", max: 160, ayuda: "Bajo el título" }, contexto: { coleccion: "Make", entrada: "Hanya" }, pista: "más corto" });
  assert.match(m, /Límite: 160/);
  assert.match(m, /Página: Hanya/);
  assert.match(m, /<peticion>\nmás corto/);
  assert.match(m, /<texto>\nhola &lt;b&gt;\n<\/texto>/);
});

test("limpia comillas que el original no tenía y saltos en campos de una línea", () => {
  assert.equal(limpia("«Hola, soy Noor»", "hola soy noor"), "Hola, soy Noor");
  assert.equal(limpia("«Una cita»", "«una cita»"), "«Una cita»");
  assert.equal(limpia("Una\nlínea", "una línea"), "Una línea");
  assert.equal(limpia("Dos\n\npárrafos", "dos\n\npárrafos"), "Dos\n\npárrafos");
});
