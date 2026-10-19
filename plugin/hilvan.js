/*
 * Hilván · el campo para Sveltia CMS. Un campo de texto como los de siempre con un botón «Sugerir mejora»: manda el
 * texto y su contexto al servidor de Hilván, que pide a Claude una versión pulida; la sugerencia sale debajo con los
 * cambios marcados y quien escribe la usa, la retoca o la descarta. Nunca cambia nada solo.
 *
 * Se carga después de Sveltia:
 *   <script src="https://unpkg.com/@sveltia/cms/dist/sveltia-cms.js"></script>
 *   <script src="/admin/hilvan.js" data-endpoint="https://hilvan-miweb.workers.dev"></script>
 *
 * Y en config.yml, en vez de `widget: string` o `widget: text`:
 *   - { name: entradilla, label: Entradilla, widget: hilvan, multiline: true, maxlength: 160, hint: "…" }
 * Con `formato: true`, un editor con negrita, cursiva y enlaces que guarda Markdown (ver «el formato»).
 *
 * Sin data-endpoint, sin sesión o si el servidor falla, el campo sigue funcionando como un campo de texto normal.
 */
(() => {
  const script = document.currentScript;
  const CMS = window.CMS;
  if (!CMS?.React) {
    console.warn("[hilvan] carga este script después de Sveltia CMS");
    return;
  }
  const React = CMS.React;
  const h = React.createElement;
  const { useState, useRef, useEffect } = React;
  const opciones = { endpoint: "", nombre: "hilvan", ...(window.HILVAN ?? {}), ...(script?.dataset ?? {}) };
  const endpoint = String(opciones.endpoint ?? "").replace(/\/$/, "");

  const T = {
    sugerir: "✦ Sugerir mejora",
    pidiendo: "Pensando…",
    otra: "Otra",
    usar: "Usar esta",
    retocar: "Retocar",
    descartar: "Descartar",
    igual: "Está bien así: no hay nada que cambiar.",
    largo: "Ojo: aún se pasa del límite.",
    quedan: (n) => `Quedan ${n} sugerencias hoy.`,
    pista: "Si quieres, dile cómo (más corto, más cercano…)",
    caracteres: (n, max) => `${n} / ${max}`,
    sinServidor: "Sin conexión con el servidor de sugerencias.",
    anterior: "Has seguido escribiendo: la sugerencia es del texto anterior.",
    negrita: "Negrita (⌘B)",
    cursiva: "Cursiva (⌘I)",
    enlace: "Enlace (⌘K)",
    pideEnlace: "Dirección del enlace (vacía, lo quita):",
  };

  // ------------------------------------------------------------------------------------------- utilidades

  // la sesión del panel: Sveltia guarda el token de GitHub en localStorage
  const token = () => {
    try {
      return JSON.parse(localStorage.getItem("sveltia-cms.user") ?? "{}")?.token ?? "";
    } catch {
      return "";
    }
  };

  // la sección y la página que se editan, de la dirección del panel (#/collections/<col>/entries/<slug>)
  const contexto = () => {
    const m = location.hash.match(/#\/collections\/([^/]+)(?:\/entries\/([^/?]+))?/);
    return { coleccion: m?.[1] ?? "", entrada: m?.[2] ? decodeURIComponent(m[2]) : "" };
  };

  // la configuración del campo llega como objeto o como Immutable Map (API de Decap)
  const conf = (field) => (field && typeof field.toJS === "function" ? field.toJS() : (field ?? {}));

  // diferencias por palabras (LCS): lo que se quita y lo que se pone, para enseñar el cambio de un vistazo
  function diferencias(a, b) {
    const A = a.split(/(\s+)/);
    const B = b.split(/(\s+)/);
    if (A.length * B.length > 250000) return [{ tipo: "pone", t: b }];
    const L = Array.from({ length: A.length + 1 }, () => new Uint16Array(B.length + 1));
    for (let i = A.length - 1; i >= 0; i--)
      for (let j = B.length - 1; j >= 0; j--)
        L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out = [];
    const mete = (tipo, t) => {
      const u = out[out.length - 1];
      if (u?.tipo === tipo) u.t += t;
      else out.push({ tipo, t });
    };
    let i = 0;
    let j = 0;
    while (i < A.length && j < B.length) {
      if (A[i] === B[j]) {
        mete("igual", A[i]);
        i++;
        j++;
      } else if (L[i + 1][j] >= L[i][j + 1]) mete("quita", A[i++]);
      else mete("pone", B[j++]);
    }
    while (i < A.length) mete("quita", A[i++]);
    while (j < B.length) mete("pone", B[j++]);
    return out;
  }

  // ------------------------------------------------------------------------------------------- el formato

  // Con `formato: true` el campo es un editor con formato: se escribe viendo cómo queda, con negrita, cursiva y
  // enlaces; Intro empieza un párrafo y Mayús+Intro salta de línea. Se guarda en Markdown, lo justo: **negrita**,
  // *cursiva*, [texto](dirección), los párrafos separados por una línea en blanco y el salto de línea, uno simple.
  const ESC_HTML = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
  const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ESC_HTML[c]);
  const URL_OK = /^(https?:|mailto:|tel:|\/|#)/i;
  const GUARDA = ""; // lo escapado con \ se aparta mientras se buscan las marcas

  // una línea de Markdown, a HTML (sin bloques)
  function enLinea(md) {
    const apartado = [];
    let s = md.replace(/\\([\\*[\]])/g, (_, c) => `${GUARDA}${apartado.push(c) - 1}${GUARDA}`);
    s = escHtml(s)
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, url) => (URL_OK.test(url) ? `<a href="${url}">${t}</a>` : t))
      .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/\n/g, "<br>");
    return s.replace(new RegExp(`${GUARDA}(\\d+)${GUARDA}`, "g"), (_, i) => escHtml(apartado[i]));
  }
  // Markdown → el HTML del editor: un <p> por párrafo
  const aHtml = (md) =>
    String(md ?? "")
      .split(/\n[ \t]*\n/)
      .map((p) => `<p>${enLinea(p) || "<br>"}</p>`)
      .join("");

  const BLOQUE = /^(P|DIV|H\d|LI|UL|OL|BLOCKQUOTE)$/;
  const esNegrita = (n) =>
    /^(B|STRONG)$/.test(n.nodeName) || Number(n.style?.fontWeight) >= 600 || n.style?.fontWeight === "bold";
  const esCursiva = (n) => /^(I|EM)$/.test(n.nodeName) || n.style?.fontStyle === "italic";
  // las marcas, pegadas al texto: « **hola** » y no «** hola **»
  const envuelve = (marca, t) => {
    const m = t.match(/^(\s*)([\s\S]*?)(\s*)$/);
    return m[2] ? `${m[1]}${marca}${m[2]}${marca}${m[3]}` : t;
  };
  // un nodo del editor, a Markdown en línea
  function nodoMd(n) {
    // (el salto de Mayús+Intro llega como <br> o, con white-space: pre-wrap, como un \n en el texto)
    if (n.nodeType === 3) return n.nodeValue.replace(/[^\S\n]+/g, " ").replace(/([\\*])/g, "\\$1");
    if (n.nodeName === "BR") return "\n";
    if (n.nodeType !== 1) return "";
    let t = [...n.childNodes].map((x, i) => (i && BLOQUE.test(x.nodeName) ? "\n" : "") + nodoMd(x)).join("");
    if (n.nodeName === "A") {
      const url = n.getAttribute("href") ?? "";
      return URL_OK.test(url) && t.trim() ? `[${t}](${url})` : t;
    }
    if (esCursiva(n)) t = envuelve("*", t);
    if (esNegrita(n)) t = envuelve("**", t);
    return t;
  }
  // el editor entero, a Markdown: cada bloque, un párrafo; lo suelto entre bloques, otro
  function aMd(raiz) {
    const parrafos = [];
    let suelto = "";
    for (const n of raiz.childNodes) {
      if (!BLOQUE.test(n.nodeName)) {
        suelto += nodoMd(n);
        continue;
      }
      parrafos.push(suelto, nodoMd(n));
      suelto = "";
    }
    parrafos.push(suelto);
    return parrafos
      .map((p) => p.replace(/ *\n */g, "\n").replace(/^\n+|\n+$/g, "").trim())
      .filter(Boolean)
      .join("\n\n");
  }

  // ------------------------------------------------------------------------------------------- estilos

  const CSS = `
.hilvan{display:flex;flex-direction:column;gap:8px}
.hilvan-campo{width:100%;box-sizing:border-box;font:inherit;color:inherit;background:var(--sui-textbox-background-color,#fff);border:1px solid var(--sui-textbox-border-color,var(--sui-control-border-color,#ccc));border-radius:var(--sui-textbox-border-radius,4px);padding:8px 10px;line-height:1.5}
textarea.hilvan-campo{min-height:96px;resize:vertical}
.hilvan-campo:focus{outline:2px solid var(--sui-primary-accent-color,#36c);outline-offset:-1px}
.hilvan-barra{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:13px}
.hilvan-cuenta{margin-left:auto;opacity:.7;font-variant-numeric:tabular-nums}
.hilvan-cuenta.pasa{color:var(--sui-error-foreground-color,#c00);opacity:1}
.hilvan button{font:inherit;font-size:13px;cursor:pointer;border-radius:4px;padding:5px 10px;border:1px solid var(--sui-control-border-color,#ccc);background:var(--sui-secondary-background-color,#f5f5f5);color:inherit}
.hilvan button.principal{background:var(--sui-primary-accent-color,#36c);border-color:transparent;color:var(--sui-primary-accent-color-inverted,#fff)}
.hilvan button:disabled{opacity:.5;cursor:default}
.hilvan-pista{flex:1 1 220px;min-width:0;font:inherit;font-size:13px;padding:5px 8px;border:1px solid var(--sui-control-border-color,#ccc);border-radius:4px;background:transparent;color:inherit}
.hilvan-sugerencia{border:1px dashed var(--sui-primary-accent-color,#36c);border-radius:6px;padding:10px 12px;background:color-mix(in srgb,var(--sui-primary-accent-color,#36c) 5%,transparent)}
.hilvan-texto{white-space:pre-wrap;line-height:1.55}
.hilvan-texto del{color:var(--sui-error-foreground-color,#b00);text-decoration:line-through;opacity:.75}
.hilvan-texto ins{text-decoration:none;background:color-mix(in srgb,var(--sui-success-foreground-color,#080) 18%,transparent);border-radius:2px}
.hilvan-nota{margin:6px 0 0;font-size:12px;opacity:.8}
.hilvan-error{font-size:13px;color:var(--sui-error-foreground-color,#b00)}
.hilvan-herramientas{display:flex;gap:4px}
.hilvan-herramientas button{min-width:32px;padding:4px 8px}
.hilvan-herramientas button[aria-pressed=true]{background:var(--sui-primary-accent-color,#36c);border-color:transparent;color:var(--sui-primary-accent-color-inverted,#fff)}
.hilvan-rico{min-height:96px;resize:vertical;overflow:auto;white-space:pre-wrap}
.hilvan-rico p{margin:0}
.hilvan-rico p+p{margin-top:.7em}
.hilvan-rico a{color:var(--sui-primary-accent-color,#36c)}
`;
  const estilos = () => {
    if (document.getElementById("hilvan-css")) return;
    const s = document.createElement("style");
    s.id = "hilvan-css";
    s.textContent = CSS;
    document.head.appendChild(s);
  };

  // ------------------------------------------------------------------------------------------- el campo

  // el campo con formato: se edita en HTML y se guarda en Markdown a cada cambio
  function Rico({ id, valor, onChange, caja, className }) {
    const ultimo = useRef(null);
    const [activos, setActivos] = useState({});
    useEffect(() => {
      document.execCommand?.("defaultParagraphSeparator", false, "p"); // Intro hace un <p>, no un <div>
    }, []);
    useEffect(() => {
      if (!caja.current || valor === ultimo.current) return; // lo que acaba de escribir no se vuelve a pintar
      caja.current.innerHTML = aHtml(valor);
      ultimo.current = valor;
    }, [valor]);
    const cambia = () => {
      ultimo.current = aMd(caja.current);
      onChange(ultimo.current);
    };
    const mira = () =>
      setActivos({ negrita: document.queryCommandState("bold"), cursiva: document.queryCommandState("italic") });
    const orden = (cmd, arg) => {
      caja.current.focus();
      document.execCommand(cmd, false, arg);
      cambia();
      mira();
    };
    const enlace = () => {
      const sel = window.getSelection();
      const rango = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
      let a = sel.anchorNode;
      while (a && a !== caja.current && a.nodeName !== "A") a = a.parentNode;
      const url = window.prompt(T.pideEnlace, a?.nodeName === "A" ? a.getAttribute("href") : "https://");
      if (url === null) return;
      caja.current.focus();
      if (rango) {
        sel.removeAllRanges();
        sel.addRange(rango);
      }
      const limpia = url.trim();
      orden(limpia && limpia !== "https://" ? "createLink" : "unlink", limpia);
    };
    const teclas = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        enlace();
      }
    };
    // lo pegado entra como texto, sin los estilos de donde venga
    const pega = (e) => {
      e.preventDefault();
      document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
    };
    // los botones actúan al pulsar, sin quitarle el foco (ni la selección) al texto
    const boton = (etiqueta, letra, estilo, pulsado, accion) =>
      h(
        "button",
        {
          type: "button",
          title: etiqueta,
          "aria-label": etiqueta,
          "aria-pressed": pulsado,
          style: estilo,
          onMouseDown: (e) => {
            e.preventDefault();
            accion();
          },
        },
        letra,
      );
    return h(
      "div",
      { className: "hilvan" },
      h(
        "div",
        { className: "hilvan-herramientas" },
        boton(T.negrita, "B", { fontWeight: 700 }, Boolean(activos.negrita), () => orden("bold")),
        boton(T.cursiva, "I", { fontStyle: "italic", fontFamily: "serif" }, Boolean(activos.cursiva), () =>
          orden("italic"),
        ),
        boton(T.enlace, "↗", null, false, enlace),
      ),
      h("div", {
        id,
        ref: caja,
        className: `hilvan-campo hilvan-rico ${className ?? ""}`,
        contentEditable: true,
        suppressContentEditableWarning: true,
        role: "textbox",
        "aria-multiline": "true",
        onInput: cambia,
        onKeyDown: teclas,
        onKeyUp: mira,
        onMouseUp: mira,
        onPaste: pega,
      }),
    );
  }

  function Hilvan(props) {
    const { value, onChange, forID, classNameWrapper } = props;
    const c = conf(props.field);
    const multilinea = c.multiline === true || c.multiline === "true";
    const formato = c.formato === true || c.formato === "true";
    const max = Number(c.maxlength) || 0;
    const texto = typeof value === "string" ? value : "";
    const [estado, setEstado] = useState({ fase: "quieto" });
    const [pista, setPista] = useState("");
    const caja = useRef(null);
    useEffect(estilos, []);

    const pedir = async () => {
      setEstado({ fase: "pidiendo" });
      try {
        const r = await fetch(`${endpoint}/sugerir`, {
          method: "POST",
          headers: { "content-type": "application/json", ...(token() ? { authorization: `Bearer ${token()}` } : {}) },
          body: JSON.stringify({
            texto,
            pista,
            campo: { nombre: c.name, etiqueta: c.label, ayuda: c.hint, max, multilinea, formato },
            contexto: contexto(),
          }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
        setEstado({ fase: "lista", ...j, de: texto });
      } catch (e) {
        setEstado({ fase: "error", error: e instanceof TypeError ? T.sinServidor : e.message });
      }
    };

    const usar = (retocar) => {
      onChange(estado.sugerencia);
      setEstado({ fase: "quieto" });
      setPista("");
      if (retocar) setTimeout(() => caja.current?.focus(), 0);
    };

    const campo = formato
      ? h(Rico, { id: forID, valor: texto, onChange, caja, className: classNameWrapper })
      : h(multilinea ? "textarea" : "input", {
      id: forID,
      ref: caja,
      className: `hilvan-campo ${classNameWrapper ?? ""}`,
      value: texto,
      ...(multilinea ? {} : { type: "text" }),
      onChange: (e) => onChange(e.target.value),
    });

    const pasa = max && texto.length > max;
    const barra = h(
      "div",
      { className: "hilvan-barra" },
      endpoint &&
        h(
          "button",
          { type: "button", className: "principal", disabled: !texto.trim() || estado.fase === "pidiendo", onClick: pedir },
          estado.fase === "pidiendo" ? T.pidiendo : T.sugerir,
        ),
      endpoint && h("input", { className: "hilvan-pista", value: pista, placeholder: T.pista, onChange: (e) => setPista(e.target.value), "aria-label": T.pista }),
      max ? h("span", { className: `hilvan-cuenta${pasa ? " pasa" : ""}` }, T.caracteres(texto.length, max)) : null,
    );

    const abajo =
      estado.fase === "error"
        ? h("p", { className: "hilvan-error", role: "alert" }, estado.error)
        : estado.fase === "lista" &&
          h(Sugerencia, { estado, texto, pedir, usar, descartar: () => setEstado({ fase: "quieto" }) });
    return h("div", { className: "hilvan" }, campo, barra, abajo);
  }

  // la sugerencia: los cambios marcados y qué hacer con ella
  function Sugerencia({ estado, texto, pedir, usar, descartar }) {
    const cambiado = estado.de !== texto; // si se ha seguido escribiendo, la sugerencia es de un texto anterior
    const pocas = typeof estado.restantes === "number" && estado.restantes < 10;
    const cuerpo = estado.igual
      ? h("p", { className: "hilvan-nota" }, T.igual)
      : h(
          "div",
          { className: "hilvan-texto" },
          diferencias(estado.de, estado.sugerencia).map((d, i) =>
            d.tipo === "igual" ? d.t : h(d.tipo === "pone" ? "ins" : "del", { key: i }, d.t),
          ),
        );
    return h(
      "div",
      { className: "hilvan-sugerencia", "aria-live": "polite" },
      cuerpo,
      estado.largo && h("p", { className: "hilvan-nota" }, T.largo),
      cambiado && h("p", { className: "hilvan-nota" }, T.anterior),
      pocas && h("p", { className: "hilvan-nota" }, T.quedan(estado.restantes)),
      h(
        "div",
        { className: "hilvan-barra", style: { marginTop: "8px" } },
        !estado.igual && h("button", { type: "button", className: "principal", onClick: () => usar(false) }, T.usar),
        !estado.igual && h("button", { type: "button", onClick: () => usar(true) }, T.retocar),
        h("button", { type: "button", onClick: pedir }, T.otra),
        h("button", { type: "button", onClick: descartar }, T.descartar),
      ),
    );
  }

  const vista = ({ value, field }) =>
    conf(field).formato
      ? h("div", { dangerouslySetInnerHTML: { __html: aHtml(value) } })
      : h("div", { style: { whiteSpace: "pre-wrap" } }, value ?? "");
  const registra = CMS.registerFieldType ?? CMS.registerWidget;
  registra.call(CMS, opciones.nombre, Hilvan, vista);
  Hilvan.diferencias = diferencias; // para las pruebas
  Hilvan.formato = { aHtml, aMd };
})();
