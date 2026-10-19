/*
 * Hilván · servidor. La lógica, sin nada de Cloudflare dentro, para poder probarla con `node --test`: recibe la
 * petición, la configuración (env) y un `fetch` que se puede sustituir en las pruebas.
 *
 * POST /sugerir  { texto, campo: { nombre, etiqueta, ayuda, max, multilinea }, contexto: { coleccion, entrada }, pista }
 *   → 200 { sugerencia, igual, largo, restantes }   ·   4xx/5xx { error }
 *
 * Quién puede pedir: quien tenga sesión de GitHub en el panel y permiso de escritura en el repositorio de la web
 * (env.REPO). La clave de Anthropic vive aquí y nunca llega al navegador. Tope de peticiones por persona y día.
 */

export const MODELO = "claude-haiku-5-5";
const MAX_TEXTO = 6000;

// ------------------------------------------------------------------------------------------- el encargo

export function sistema(voz) {
  return [
    "Eres corrector de estilo de los textos de una página web. Te pasan el texto de un campo y lo mejoras sin cambiar lo que dice.",
    "",
    "Reglas:",
    "1. Pule, no reescribas: corrige ortografía, puntuación, concordancia, ritmo y claridad, cambiando lo mínimo. Si el texto ya está bien, devuélvelo tal cual.",
    "2. Mantén la voz, el tono, la persona gramatical y el registro del original. Si mezcla idiomas (palabras en inglés en un texto en español, por ejemplo), es a propósito: déjalo así.",
    "3. No inventes nada: ni nombres, ni marcas, ni fechas, ni cifras, ni hechos que no estén en el texto.",
    "4. Si el campo tiene un límite de caracteres, el resultado no puede pasarlo.",
    "5. Lo que vaya entre corchetes [así] es un hueco sin rellenar: déjalo exactamente igual.",
    "6. Respeta los saltos de línea del original y el formato Markdown si lo hay.",
    "7. Devuelve solo el texto final: sin comillas, sin explicaciones, sin encabezados.",
    ...(voz?.trim() ? ["", "La voz de esta web:", voz.trim()] : []),
  ].join("\n");
}

const esc = (s) => String(s ?? "").replace(/[<>]/g, (c) => (c === "<" ? "&lt;" : "&gt;"));

export function mensaje({ texto, campo = {}, contexto = {}, pista }) {
  const datos = [
    contexto.coleccion && `Sección del panel: ${contexto.coleccion}`,
    contexto.entrada && `Página: ${contexto.entrada}`,
    campo.etiqueta && `Campo: ${campo.etiqueta}`,
    campo.ayuda && `Para qué sirve: ${campo.ayuda}`,
    campo.max && `Límite: ${campo.max} caracteres como máximo`,
    `Formato: ${campo.multilinea ? "texto de uno o varios párrafos" : "una sola línea"}`,
  ].filter(Boolean);
  return [
    `<campo>\n${esc(datos.join("\n"))}\n</campo>`,
    pista?.trim() ? `<peticion>\n${esc(pista.trim().slice(0, 300))}\n</peticion>` : "",
    `<texto>\n${esc(texto)}\n</texto>`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// lo que devuelve el modelo, limpio: sin comillas que lo envuelvan ni etiquetas
export function limpia(s, original) {
  let t = String(s ?? "").trim();
  t = t.replace(/^<texto>\s*|\s*<\/texto>$/g, "").trim();
  const comillas = [
    ["«", "»"],
    ["“", "”"],
    ['"', '"'],
  ];
  for (const [a, b] of comillas) {
    if (t.startsWith(a) && t.endsWith(b) && !(original.trim().startsWith(a) && original.trim().endsWith(b)))
      t = t.slice(a.length, -b.length).trim();
  }
  if (!original.includes("\n")) t = t.replace(/\s*\n+\s*/g, " ");
  return t.replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

// ------------------------------------------------------------------------------------------- acceso

export function origenPermitido(origen, lista) {
  if (!origen) return false;
  let host;
  try {
    host = new URL(origen);
  } catch {
    return false;
  }
  return String(lista ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .some((patron) => {
      const p = new URL(patron.replace("*.", "comodin."));
      if (p.protocol !== host.protocol || (p.port || "") !== (host.port || "")) return false;
      if (p.hostname.startsWith("comodin.")) return host.hostname.endsWith(p.hostname.slice("comodin".length));
      return p.hostname === host.hostname;
    });
}

const esLocal = (origen) => {
  try {
    return ["localhost", "127.0.0.1"].includes(new URL(origen).hostname);
  } catch {
    return false;
  }
};

async function huella(token) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

// ¿Este token de GitHub puede escribir en el repositorio de la web? Se recuerda 10 minutos.
async function puedeEscribir(token, env, fetchFn) {
  const id = await huella(token);
  const guardado = await env.HILVAN?.get(`acceso:${id}`);
  if (guardado) return { ok: guardado === "si", id };
  const r = await fetchFn(`https://api.github.com/repos/${env.REPO}`, {
    headers: { authorization: `Bearer ${token}`, "user-agent": "hilvan", accept: "application/vnd.github+json" },
  });
  const ok = r.ok && (await r.json())?.permissions?.push === true;
  await env.HILVAN?.put(`acceso:${id}`, ok ? "si" : "no", { expirationTtl: 600 });
  return { ok, id };
}

// cuenta las peticiones de hoy; si se pasa del tope, no hay más hasta mañana
async function gasta(id, env) {
  const tope = Number(env.TOPE_DIARIO) || 60;
  const clave = `tope:${id}:${new Date().toISOString().slice(0, 10)}`;
  const usadas = Number((await env.HILVAN?.get(clave)) ?? 0);
  if (usadas >= tope) return { ok: false, restantes: 0 };
  await env.HILVAN?.put(clave, String(usadas + 1), { expirationTtl: 60 * 60 * 26 });
  return { ok: true, restantes: tope - usadas - 1 };
}

// ------------------------------------------------------------------------------------------- el modelo

async function pide(env, fetchFn, cuerpo) {
  const r = await fetchFn("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: env.MODELO || MODELO, max_tokens: 2048, ...cuerpo }),
  });
  if (!r.ok) throw new Error(`modelo ${r.status}`);
  const j = await r.json();
  return (j.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("");
}

export async function sugiere(datos, env, fetchFn = fetch) {
  const system = sistema(env.VOZ);
  const primero = { role: "user", content: mensaje(datos) };
  let s = limpia(await pide(env, fetchFn, { system, messages: [primero] }), datos.texto);
  const max = Number(datos.campo?.max) || 0;
  // si se ha pasado del límite, una segunda vuelta pidiendo que lo acorte
  if (max && s.length > max) {
    s = limpia(
      await pide(env, fetchFn, {
        system,
        messages: [
          primero,
          { role: "assistant", content: s },
          { role: "user", content: `Tiene ${s.length} caracteres y el límite es ${max}. Acórtalo sin perder lo importante. Devuelve solo el texto.` },
        ],
      }),
      datos.texto,
    );
  }
  return { sugerencia: s, igual: s.trim() === datos.texto.trim(), largo: Boolean(max && s.length > max) };
}

// sin clave de Anthropic y en local: una sugerencia de prueba, para trabajar el panel sin gastar
function demo(texto) {
  const t = texto.trim().replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1");
  const s = t.charAt(0).toUpperCase() + t.slice(1);
  return { sugerencia: /[.!?…»]$/.test(s) ? s : `${s}.`, igual: false, largo: false, demo: true };
}

// ------------------------------------------------------------------------------------------- la petición

function cabecerasCors(origen, env) {
  if (!origenPermitido(origen, env.ORIGENES)) return {};
  return {
    "access-control-allow-origin": origen,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

// el cuerpo de la petición, o el motivo por el que no vale
async function leeDatos(request) {
  let datos;
  try {
    datos = await request.json();
  } catch {
    return { error: [400, "El cuerpo no es JSON"] };
  }
  if (typeof datos?.texto !== "string" || !datos.texto.trim()) return { error: [400, "Falta el texto"] };
  if (datos.texto.length > MAX_TEXTO) return { error: [413, "El texto es demasiado largo"] };
  return { datos };
}

// quién pide: en local (MODO_LOCAL y origen localhost) no hace falta sesión; fuera, token con permiso de escritura
async function quien(request, env, fetchFn, local) {
  if (local) return { id: "local" };
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return { error: [401, "Inicia sesión en el panel"] };
  const acceso = await puedeEscribir(token, env, fetchFn);
  return acceso.ok ? { id: acceso.id } : { error: [403, "Esta cuenta no puede editar la web"] };
}

export async function atiende(request, env, fetchFn = fetch) {
  const origen = request.headers.get("origin") ?? "";
  const cors = cabecerasCors(origen, env);
  const permitido = Boolean(cors["access-control-allow-origin"]);
  const responde = (estado, cuerpo) =>
    new Response(JSON.stringify(cuerpo), {
      status: estado,
      headers: { "content-type": "application/json; charset=utf-8", ...cors },
    });
  const falla = ([estado, error]) => responde(estado, { error });

  if (request.method === "OPTIONS") return new Response(null, { status: permitido ? 204 : 403, headers: cors });
  if (new URL(request.url).pathname !== "/sugerir") return falla([404, "No existe"]);
  if (request.method !== "POST") return falla([405, "Solo POST"]);
  if (!permitido) return falla([403, "Origen no permitido"]);

  const { datos, error } = await leeDatos(request);
  if (error) return falla(error);
  const local = env.MODO_LOCAL === "1" && esLocal(origen);
  const persona = await quien(request, env, fetchFn, local);
  if (persona.error) return falla(persona.error);
  const cupo = await gasta(persona.id, env);
  if (!cupo.ok) return falla([429, "Hoy ya no quedan sugerencias; mañana más"]);

  if (!env.ANTHROPIC_API_KEY) {
    return local
      ? responde(200, { ...demo(datos.texto), restantes: cupo.restantes })
      : falla([503, "El servidor no tiene clave de Anthropic"]);
  }
  try {
    return responde(200, { ...(await sugiere(datos, env, fetchFn)), restantes: cupo.restantes });
  } catch {
    return falla([502, "No se ha podido pedir la sugerencia; prueba otra vez"]);
  }
}
