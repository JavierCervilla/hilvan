// Hilván · servidor en Cloudflare Workers. Toda la lógica está en sugerir.js.
import { atiende } from "./sugerir.js";

export default {
  fetch: (request, env) => atiende(request, env),
};
