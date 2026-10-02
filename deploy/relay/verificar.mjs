// Lint estático LOCAL do deploy do relay (T-22.19): nada é executado nem enviado. Parser mínimo de YAML (mapas, listas de escalares) e de Dockerfile, sem dependência.
// Uso: node deploy/relay/verificar.mjs   (exit 1 se alguma regra falhar). Também importado pelos testes, que mutam os textos em memória.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));

/** YAML mínimo: `chave: valor`, `chave:` (mapa ou lista aninhada), `- item`, `{}`. Comentários `#` e aspas simples/duplas. */
export function parseYaml(texto) {
  const linhas = texto
    .split("\n")
    .map((l) => l.replace(/\s+#.*$/, "").replace(/^#.*$/, "").replace(/\s+$/, ""))
    .filter((l) => l.trim() !== "")
    .map((l) => ({ ind: l.length - l.trimStart().length, t: l.trim() }));
  let i = 0;
  const escalar = (v) => {
    if (v === "{}") return {};
    if (v === "true") return true;
    if (v === "false") return false;
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    return v.replace(/^(["'])(.*)\1$/, "$2");
  };
  function bloco(ind) {
    if (i >= linhas.length) return null;
    if (linhas[i].t.startsWith("- ")) {
      const lista = [];
      while (i < linhas.length && linhas[i].ind === ind && linhas[i].t.startsWith("- ")) lista.push(escalar(linhas[i++].t.slice(2).trim()));
      return lista;
    }
    const mapa = {};
    while (i < linhas.length && linhas[i].ind === ind && !linhas[i].t.startsWith("- ")) {
      const m = /^([^:]+?):\s*(.*)$/.exec(linhas[i].t);
      if (m === null) throw new Error(`yaml inválido: ${linhas[i].t}`);
      i++;
      if (m[2] !== "") mapa[m[1]] = escalar(m[2]);
      else if (i < linhas.length && linhas[i].ind > ind) mapa[m[1]] = bloco(linhas[i].ind);
      else mapa[m[1]] = null;
    }
    return mapa;
  }
  return bloco(linhas[0]?.ind ?? 0) ?? {};
}

/** Instruções do Dockerfile (junta continuações com `\`), sem comentários. */
export function parseDockerfile(texto) {
  const lim = texto.replace(/\\\n/g, " ").split("\n").map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#"));
  return lim.map((l) => {
    const m = /^(\w+)\s*(.*)$/.exec(l);
    return { op: m[1].toUpperCase(), arg: m[2] };
  });
}

const SEGREDO = /(token|senha|secret|segredo|password|passwd|psk|api[_-]?key|private)/i;
const lista = (x) => (Array.isArray(x) ? x : []);

/** devolve a lista de códigos de violação (vazia = ok). */
export function verificar({ dockerfile, compose, dockerignore }) {
  const v = [];
  const ins = parseDockerfile(dockerfile);
  const froms = ins.filter((x) => x.op === "FROM");
  const ultimo = froms[froms.length - 1];
  // TODA base (inclusive a do estágio de build) tem de ter digest: tag flutuante em qualquer estágio é cadeia de suprimento aberta (A-10)
  if (froms.length === 0 || froms.some((f) => !/@sha256:[0-9a-f]{64}(\s|$)/.test(f.arg))) v.push("base_sem_digest");
  void ultimo;
  if (ins.some((x) => x.op === "RUN" && /--package=typescript@(?:\d+|latest|next)(?!\.)/.test(x.arg) || (x.op === "RUN" && /npx\s/.test(x.arg) && !/--package=\S+@\d+\.\d+\.\d+/.test(x.arg)))) v.push("build_com_versao_flutuante");
  const users = ins.filter((x) => x.op === "USER");
  const user = users[users.length - 1]?.arg.split(":")[0];
  if (user === undefined || user === "root" || user === "0") v.push("usuario_root");
  if (!ins.some((x) => x.op === "HEALTHCHECK" && !/^NONE/i.test(x.arg))) v.push("sem_healthcheck");
  if (ins.some((x) => { const m = x.op === "ENV" ? /^([^=\s]+)[=\s]\s*(\S+)/.exec(x.arg) : null; return m !== null && SEGREDO.test(m[1]); })) v.push("env_com_segredo");
  if (ins.some((x) => x.op === "ARG" && SEGREDO.test(x.arg))) v.push("env_com_segredo");
  const ent = ins.find((x) => x.op === "ENTRYPOINT" || x.op === "CMD");
  if (ent !== undefined && /\b(sh|bash)\b["',\s]+-c\b/.test(ent.arg)) v.push("usa_shell");

  const y = parseYaml(compose);
  const servicos = y.services ?? {};
  const relay = servicos.relay ?? {};
  if (relay.read_only !== true) v.push("relay_nao_read_only");
  if (!lista(relay.tmpfs).includes("/tmp")) v.push("relay_sem_tmpfs");
  if (!lista(relay.cap_drop).map(String).some((c) => c.toUpperCase() === "ALL")) v.push("relay_sem_cap_drop_all");
  if (!lista(relay.security_opt).includes("no-new-privileges:true")) v.push("relay_sem_no_new_privileges");
  for (const k of ["mem_limit", "cpus", "pids_limit"]) if (relay[k] === undefined || relay[k] === null) v.push(`relay_sem_${k}`);
  if (lista(relay.ports).length > 0) v.push("relay_publica_porta");
  for (const [nome, s] of Object.entries(servicos)) {
    if (typeof s.image === "string" && !/@sha256:[0-9a-f]{64}$/.test(s.image)) v.push(`${nome}_imagem_sem_digest`);
    if (s.privileged === true) v.push(`${nome}_privileged`);
    if (s.network_mode === "host") v.push(`${nome}_rede_host`);
    if (s.pid === "host") v.push(`${nome}_pid_host`);
    if (lista(s.volumes).some((x) => String(x).includes("docker.sock"))) v.push(`${nome}_socket_docker`);
    const amb = s.environment ?? {};
    for (const [k, val] of Object.entries(Array.isArray(amb) ? Object.fromEntries(amb.map((e) => String(e).split(/=(.*)/s))) : amb)) {
      if (SEGREDO.test(k) && String(val ?? "") !== "" && !/^\$\{/.test(String(val))) v.push(`${nome}_env_com_segredo`);
    }
  }

  const caddy = servicos.caddy;
  if (caddy !== undefined) {
    // o Caddy guarda chaves e certificados ACME em /data: sem volume, cada recriação perde a chave TLS e arrisca o limite de emissão (A-11)
    if (!lista(caddy.volumes).some((x) => /^[A-Za-z0-9_]+:\/data$/.test(String(x)))) v.push("caddy_sem_volume_de_dados");
    if (caddy.read_only !== true) v.push("caddy_nao_read_only");
    if (!lista(caddy.tmpfs).includes("/tmp")) v.push("caddy_sem_tmpfs");
  }

  const di = dockerignore.split("\n").map((l) => l.trim());
  for (const r of [".env", ".env.*", "*.pem", "*.key", "docs"]) if (!di.includes(r)) v.push(`dockerignore_sem_${r}`);
  return v;
}

export function lerArquivos(dir = AQUI) {
  const ler = (n) => readFileSync(join(dir, n), "utf8");
  return { dockerfile: ler("Dockerfile"), compose: ler("compose.yaml"), dockerignore: ler(".dockerignore") };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!existsSync(join(AQUI, "Dockerfile"))) {
    console.error("deploy/relay incompleto");
    process.exit(1);
  }
  const falhas = verificar(lerArquivos());
  if (falhas.length > 0) {
    console.error(`deploy/relay: ${falhas.length} violação(ões): ${falhas.join(", ")}`);
    process.exit(1);
  }
  const marcadores = (Object.values(lerArquivos()).join("\n").match(/@sha256:0{64}/g) ?? []).length;
  if (marcadores > 0) console.warn(`deploy/relay: AVISO: ${marcadores} digest(s) ainda são o marcador de zeros (P-360): troque pelos reais antes do primeiro build`);
  console.log("deploy/relay: regras estáticas ok (nada foi executado nem enviado)");
}
