# Hilván

Sugerencias de mejora con IA para los campos de texto de [Sveltia CMS](https://github.com/sveltia/sveltia-cms).

Un campo de texto como los de siempre con un botón **«✦ Sugerir mejora»**. Manda el texto y su contexto (qué página,
qué campo, para qué sirve, su límite) a un servidor propio, que se lo pide a Claude con unas reglas fijas: pulir y no
reescribir, mantener la voz, no inventar datos, respetar el límite y dejar los huecos `[así]`. La sugerencia sale
debajo con los cambios marcados y quien escribe decide: **usar**, **retocar**, pedir **otra** o **descartar**. Nunca
cambia nada solo.

Se llama así porque una sugerencia es eso: un hilván, la puntada provisional antes de coser de verdad.

## Piezas

- `plugin/hilvan.js`: el campo. Un solo fichero, sin dependencias: usa el React que trae Sveltia (`CMS.React`).
- `worker/`: el servidor, en Cloudflare Workers. Guarda la clave de Anthropic (nunca llega al navegador), comprueba que
  quien pide tiene sesión de GitHub en el panel **y permiso de escritura en el repositorio de la web**, y pone un tope
  de peticiones por persona y día.

## Uso en una web

1. **Servidor**: en `worker/wrangler.toml`, el nombre, `REPO`, `ORIGENES` (desde dónde se llama, admite `*.`),
   `MODELO`, `TOPE_DIARIO` y la `VOZ` de la web. Luego:

   ```sh
   npx wrangler kv namespace create HILVAN   # pega el id en wrangler.toml
   npx wrangler secret put ANTHROPIC_API_KEY
   npm run deploy
   ```

2. **Panel**: copia `plugin/hilvan.js` junto al panel y cárgalo después de Sveltia:

   ```html
   <script src="https://unpkg.com/@sveltia/cms@0.248.0/dist/sveltia-cms.js"></script>
   <script src="/admin/hilvan.js" data-endpoint="https://hilvan-miweb.tu-cuenta.workers.dev"></script>
   ```

3. **Campos**: en `config.yml`, `widget: hilvan` en lugar de `string` o `text`:

   ```yaml
   - { name: entradilla, label: Entradilla, hint: Una o dos frases bajo el título., widget: hilvan, multiline: true }
   - name: descripcionSeo
     label: Descripción para buscadores
     widget: hilvan
     maxlength: 160          # contador, y el servidor lo respeta
     pattern: ["^.{0,160}$", "Hasta 160 caracteres"]   # Sveltia sigue validando al guardar
   ```

Sin `data-endpoint`, sin sesión o si el servidor falla, el campo funciona como uno de texto normal.

## Desarrollo

```sh
npm test       # servidor (acceso, orígenes, tope, límite, encargo), campo (registro, diferencias) y revisores
npm run lint   # ESLint con reglas contra el código descuidado (complejidad, duplicados, console olvidado)
npm run dev    # servidor en local, sin sesión ni clave: devuelve una sugerencia de prueba
```

La CI, en cada push y PR: pruebas y lint; secretos en todo el historial (gitleaks), análisis del código (semgrep) y
dependencias (`npm audit`, osv-scanner); y dos revisores propios, `scripts/unicode.mjs` (caracteres invisibles que
esconden código) y `scripts/ci-honesto.mjs` (ningún paso de la CI apagado a escondidas).

Opciones del campo: `data-endpoint`, `data-nombre` (por defecto `hilvan`; también `window.HILVAN = { … }`).

## Pendiente

- Publicarlo en npm para cargarlo desde un CDN en vez de copiarlo.
- Textos del botón en otros idiomas.
