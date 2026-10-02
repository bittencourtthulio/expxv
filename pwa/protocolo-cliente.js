// Protocolo do cliente web (T-22.14 resto, T-22.15): pareamento e sessão da Fase 13 INALTERADOS, só que dentro do invólucro do relay (JSON -> padding -> AES-256-GCM, AAD de direção).
// Espelho do host (`remoto-estendido/{canal,quadro,pareamento-relay}.ts`). Sem DOM: roda no navegador e no Node 22 (WebSocket global e WebCrypto), com tudo injetável (WebSocket, relógio,
// timers, armazém). A chave de DISPOSITIVO é ECDSA P-256 NÃO extraível; nada decifrado vai a cache, localStorage ou log. O PWA nunca aprova nada (D-21): confirmação é só no desktop.
import { abrirEnvelope, aleatorio, assinar, canalId, chaveEnvelope, confCliente, confServidor, criarCanal, dadosAssinadosCliente, deB64, derivarPareamento, derivarSessao, epocaDe, gerarChaveDispositivo, iguais, lp, macPareado, normalizarCodigo, paraB64, paraHex, parEfemero, selarEnvelope, sha256, transcricaoSessao, verificar } from "./cripto.js";
import { preencher, remover } from "./padding.js";
import { cifrarComPin, decifrarComPin, pinValido } from "./trava.js";

/** `__PRODUTO_ID__` é trocado no build (o nome do produto nunca é literal no código-fonte). */
export const AMBIENTE = { versaoRelay: "__PRODUTO_ID__-relay.1" };
export const TTL_PAREAMENTO_MS = 120000;
export const LIMITE_DECISAO_MS = 60000;
const CODIGO_OK = /^[A-HJ-NP-Z2-9]{12}$/;
const HEX32 = /^[0-9a-f]{32}$/;
const aadEnvelope = (d) => `xv-relay-env-v1|${d}`;
const textoBytes = (s) => new TextEncoder().encode(s);
const bytesTexto = (b) => new TextDecoder().decode(b);

export const grupos4 = (hex) => (hex.match(/.{1,4}/g) ?? []).join(" ");
export const normalizarImpressao = (t) => String(t).toLowerCase().replace(/[^0-9a-f]/g, "");
/** 16 primeiros bytes de SHA-256 em 32 hex (identidade do host, manifesto do PWA). */
export async function impressaoDigital(bytes) {
  return paraHex((await sha256(bytes)).subarray(0, 16));
}
/** S = SHA-256("xv/relay/pareamento-segredo|" ‖ código normalizado): canal efêmero = canalId(S, 0); invólucro = chaveEnvelope(S, "pareamento"). */
export async function segredoEfemero(codigo) {
  return sha256("xv/relay/pareamento-segredo|", normalizarCodigo(codigo));
}

export function urlValidaRelay(url, permitirLoopback = false) {
  if (typeof url !== "string" || url.length === 0 || url.length > 200 || /[\s\u0000-\u001f]/.test(url)) return false;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.username !== "" || u.password !== "" || u.search !== "" || u.hash !== "") return false;
  if (permitirLoopback && u.protocol === "ws:" && u.hostname === "127.0.0.1") return true;
  const h = u.hostname.replace(/\.+$/, ""); // nome local com ponto final é o mesmo nome local (A-07)
  return u.protocol === "wss:" && h.includes(".") && !h.includes(":") && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h) && !/\.(?:local|localhost|invalid|internal)$/i.test(h);
}
/** o relay só atende `/v1/canal/*`: URL sem caminho recebe o caminho padrão. */
export function urlDoCanal(url) {
  const u = new URL(url);
  if (u.pathname === "/" || u.pathname === "") u.pathname = "/v1/canal/x";
  return u.toString();
}

/** `#r=<url>&c=<código>&h=<32 hex>&p=<32 hex ou vazio>`; `null` se malformado. O fragmento nunca vai a servidor. */
export function lerLinkPareamento(texto, opcoes = {}) {
  if (typeof texto !== "string") return null;
  const t = texto.startsWith("#") ? texto.slice(1) : texto;
  if (t.length === 0 || t.length > 700) return null;
  const p = new URLSearchParams(t);
  const relay = p.get("r") ?? "";
  const codigo = normalizarCodigo(p.get("c") ?? "");
  const host = (p.get("h") ?? "").toLowerCase();
  const pwa = (p.get("p") ?? "").toLowerCase();
  if (!urlValidaRelay(relay, opcoes.permitirLoopback === true) || !CODIGO_OK.test(codigo)) return null;
  if ((host !== "" && !HEX32.test(host)) || (pwa !== "" && !HEX32.test(pwa))) return null;
  return { relay, codigo, host, pwa };
}
/** lê o link UMA vez e apaga o fragmento da barra (uso único: o código não fica no histórico). */
export function consumirFragmento(loc, hist, opcoes = {}) {
  const r = lerLinkPareamento(loc.hash, opcoes);
  if (loc.hash !== "") {
    try {
      hist.replaceState(null, "", loc.pathname + loc.search);
    } catch {
      /* sem history */
    }
  }
  return r;
}

export function backoffMs(tentativa, aleat) {
  const base = Math.min(60000, 1000 * 2 ** Math.max(0, tentativa));
  return Math.round(Math.min(60000, base * (0.8 + 0.4 * aleat())));
}

// ------------------------------------------------------------------------------ conexão com o relay (papel cliente)
/**
 * Abre UMA conexão com o relay e prova a posse da chave do dispositivo. Devolve `null` se o relay recusar (resposta uniforme), cair ou estourar o tempo.
 * `o`: {criarWs(url), url, canal, chaveEnv, privada, publicaSpki, agendar(fn, ms) -> cancelar, aoFechar?, aoTick?, versao?, esperaMs?}
 */
export function abrirCanalRelay(o) {
  return new Promise((resolve) => {
    let ws = null;
    let etapa = "hello";
    let pronto = false;
    let fechado = false;
    let seq = 0;
    let cancelaTimer = null;
    const pend = new Map();
    const nonce = aleatorio(16);
    const timer = (fn, ms) => {
      if (cancelaTimer !== null) cancelaTimer();
      cancelaTimer = o.agendar(() => {
        cancelaTimer = null;
        fn();
      }, ms);
    };
    const limpar = () => {
      if (fechado) return false;
      fechado = true;
      if (cancelaTimer !== null) cancelaTimer();
      cancelaTimer = null;
      for (const f of pend.values()) f(null);
      pend.clear();
      try {
        ws.close(1000);
      } catch {
        /* já fechado */
      }
      return true;
    };
    const falhar = () => {
      const eraPronto = pronto;
      if (!limpar()) return;
      if (!eraPronto) resolve(null);
      else if (o.aoFechar) o.aoFechar();
    };
    const enviarSelado = async (claro) => {
      if (fechado || ws === null || ws.readyState !== 1) return false;
      const q = await selarEnvelope(o.chaveEnv, preencher(claro), aadEnvelope("c2h"));
      if (fechado) return false;
      ws.send(q);
      return true;
    };
    const conn = {
      aberta: () => pronto && !fechado,
      fechar() {
        limpar();
      },
      /** `{status, corpo}` ou `null` (tempo esgotado ou conexão caída). */
      requisitar(rota, corpo, ms = 8000) {
        return new Promise((res) => {
          if (!pronto || fechado) return res(null);
          const id = ++seq;
          const cancela = o.agendar(() => {
            pend.delete(id);
            res(null);
          }, ms);
          pend.set(id, (r) => {
            cancela();
            res(r);
          });
          void enviarSelado(textoBytes(JSON.stringify({ r: rota, id, corpo }))).catch(() => undefined);
        });
      },
    };
    const tick = () => {
      if (!pronto || fechado) return;
      try {
        ws.send(JSON.stringify({ t: "ping" }));
        void selarEnvelope(o.chaveEnv, preencher(null), aadEnvelope("c2h")).then((q) => {
          if (!fechado && ws.readyState === 1) ws.send(q);
        });
        if (o.aoTick) o.aoTick();
      } catch {
        return falhar();
      }
      timer(tick, 25000 + Math.floor((aleatorio(1)[0] / 256) * 5000));
    };
    const controle = async (texto) => {
      let j;
      try {
        j = JSON.parse(texto);
      } catch {
        return;
      }
      if (typeof j !== "object" || j === null) return;
      if (etapa === "hello" && j.t === "desafio" && typeof j.n === "string") {
        etapa = "prova";
        const sig = await assinar(o.privada, lp("relay-prova-v1", deB64(j.n), nonce, o.canal, "cliente", "", ""));
        ws.send(JSON.stringify({ t: "prova", pub: paraB64(o.publicaSpki), sig: paraB64(sig) }));
      } else if (etapa === "prova" && j.t === "ok") {
        etapa = "ativo";
        pronto = true;
        timer(tick, 25000);
        resolve(conn);
      } else if (j.t === "erro") falhar();
    };
    const dados = async (buf) => {
      if (!pronto) return;
      const claro = await abrirEnvelope(o.chaveEnv, buf, aadEnvelope("h2c"));
      if (claro === null) return; // não autêntico: descartado (o host fecha do lado dele)
      const p = remover(claro);
      if (p === null || p.tipo !== "dado") return;
      let m;
      try {
        m = JSON.parse(bytesTexto(p.conteudo));
      } catch {
        return;
      }
      const f = typeof m === "object" && m !== null && typeof m.id === "number" ? pend.get(m.id) : undefined;
      if (f !== undefined) {
        pend.delete(m.id);
        f({ status: m.status, corpo: m.corpo });
      }
    };
    try {
      ws = o.criarWs(urlDoCanal(o.url));
      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        try {
          ws.send(JSON.stringify({ t: "hello", v: o.versao ?? AMBIENTE.versaoRelay, papel: "cliente", canal: o.canal, ts: Date.now(), nonce: paraB64(nonce) }));
          timer(falhar, o.esperaMs ?? 5000);
        } catch {
          falhar();
        }
      };
      ws.onmessage = (ev) => {
        const d = ev.data;
        if (typeof d === "string") void controle(d).catch(falhar);
        else if (d instanceof ArrayBuffer) void dados(new Uint8Array(d)).catch(() => undefined);
        else if (ArrayBuffer.isView(d)) void dados(new Uint8Array(d.buffer, d.byteOffset, d.byteLength)).catch(() => undefined);
      };
      ws.onclose = falhar;
      ws.onerror = () => undefined;
    } catch {
      limpar();
      resolve(null);
    }
  });
}

// ------------------------------------------------------------------------------ protocolo da Fase 13 sobre uma conexão
/** `requisitar(rota, corpo)` -> `{status, corpo}` | null. Mesmas derivações do ClienteRemoto de referência. */
export function criarProtocolo13({ requisitar, privada, publicaSpki, agora = () => Date.now() }) {
  const erro = (etapa) => ({ ok: false, etapa });
  return {
    /** passos `pareamento_inicio` e `pareamento_fim`; devolve o SAS para comparar com o desktop. */
    async iniciarPareamento(codigo, nome) {
      const e = await parEfemero();
      const nonceC = aleatorio(16);
      const ini = await requisitar("pareamento_inicio", { epk: paraB64(e.publica), nonce: paraB64(nonceC) });
      if (ini === null) return erro("relay");
      if (ini.status !== 200 || typeof ini.corpo !== "object" || ini.corpo === null) return erro("inicio");
      let spk;
      let nonceS;
      let confS;
      try {
        spk = deB64(String(ini.corpo.spk));
        nonceS = deB64(String(ini.corpo.nonce_s));
        confS = deB64(String(ini.corpo.conf_s));
      } catch {
        return erro("inicio");
      }
      const ecdh = await e.segredoCom(spk);
      if (ecdh === null) return erro("ecdh");
      const chaves = await derivarPareamento({ ecdh, codigo, epkC: e.publica, spk, nonceC, nonceS });
      if (!iguais(await confServidor(chaves), confS)) return erro("conf_s"); // o desktop não provou conhecer o código
      const conf = await confCliente(chaves, publicaSpki, nome);
      const fim = await requisitar("pareamento_fim", { hid: ini.corpo.hid, conf: paraB64(conf), chave_publica: paraB64(publicaSpki), nome });
      if (fim === null) return erro("relay");
      if (fim.status !== 200) return erro("fim");
      return { ok: true, sas: chaves.sas, hid: String(ini.corpo.hid), chaves };
    },
    /** `pareamento_status`: aguardando | negado | pareado (MAC conferido: a identidade só é fixada se autenticada pelo código). */
    async statusPareamento(hid, chaves) {
      const st = await requisitar("pareamento_status", { hid });
      if (st === null) return { estado: "relay" };
      if (st.status !== 200 || typeof st.corpo !== "object" || st.corpo === null) return { estado: "expirado" };
      if (st.corpo.estado === "aguardando") return { estado: "aguardando" };
      if (st.corpo.estado === "negado") return { estado: "negado" };
      if (st.corpo.estado !== "pareado") return { estado: "expirado" };
      try {
        const id = String(st.corpo.dispositivo_id);
        const identidade = deB64(String(st.corpo.identidade));
        if (!iguais(await macPareado(chaves, id, identidade), deB64(String(st.corpo.mac)))) return { estado: "mac_invalido" };
        return { estado: "pareado", dispositivoId: id, identidade };
      } catch {
        return { estado: "mac_invalido" };
      }
    },
    /** `sessao_inicio` com assinaturas mútuas; devolve a sessão (mensagens serializadas: uma em voo por vez, o contador do canal exige ordem). */
    async abrirSessao(dispositivoId, identidadeFixada) {
      const e = await parEfemero();
      const nonceC = aleatorio(16);
      const ts = agora();
      const sig = await assinar(privada, dadosAssinadosCliente(dispositivoId, e.publica, nonceC, ts));
      const r = await requisitar("sessao_inicio", { dispositivo_id: dispositivoId, epk: paraB64(e.publica), nonce: paraB64(nonceC), ts, sig: paraB64(sig) });
      if (r === null) return { ok: false, etapa: "relay", status: 0 };
      if (r.status !== 200 || typeof r.corpo !== "object" || r.corpo === null) return { ok: false, etapa: "sessao", status: r.status };
      try {
        const spk = deB64(String(r.corpo.spk));
        const nonceS = deB64(String(r.corpo.nonce_s));
        const tr = await transcricaoSessao(dispositivoId, e.publica, spk, nonceC, nonceS, ts);
        if (!(await verificar(identidadeFixada, tr, deB64(String(r.corpo.sig_s))))) return { ok: false, etapa: "identidade", status: 0 };
        const ecdh = await e.segredoCom(spk);
        if (ecdh === null) return { ok: false, etapa: "ecdh", status: 0 };
        const k = await derivarSessao(ecdh, tr);
        const sid = String(r.corpo.sid);
        const canal = criarCanal({ sid, envio: k.c2s, recebimento: k.s2c });
        let fila = Promise.resolve();
        const enviar = (msg) => {
          const p = fila.then(async () => {
            const quadro = await canal.selar(msg);
            const resp = await requisitar("canal", { sid, quadro });
            if (resp === null) return { status: 0, msg: null, erro: "relay" };
            if (resp.status !== 200 || typeof resp.corpo !== "object" || resp.corpo === null) return { status: resp.status, msg: null, erro: typeof resp.corpo?.e === "string" ? resp.corpo.e : null };
            return { status: 200, msg: await canal.abrir(resp.corpo.quadro), erro: null };
          });
          fila = p.catch(() => undefined);
          return p;
        };
        return { ok: true, sid, enviar };
      } catch {
        return { ok: false, etapa: "sessao", status: 0 };
      }
    },
  };
}

// ------------------------------------------------------------------------------ armazéns (IndexedDB no navegador; memória nos testes)
export function armazemMemoria() {
  let v = null;
  return { ler: async () => v, gravar: async (x) => void (v = x), apagar: async () => void (v = null) };
}
export function armazemIndexedDb(nomeBanco = "remoto") {
  const abrir = () =>
    new Promise((res, rej) => {
      const r = indexedDB.open(nomeBanco, 1);
      r.onupgradeneeded = () => r.result.createObjectStore("d");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  const tx = async (modo, f) => {
    const db = await abrir();
    return new Promise((res, rej) => {
      const t = db.transaction("d", modo);
      const rq = f(t.objectStore("d"));
      t.oncomplete = () => {
        db.close();
        res(rq ? rq.result : null);
      };
      t.onerror = () => rej(t.error);
    });
  };
  return { ler: () => tx("readonly", (s) => s.get("atual")), gravar: (v) => tx("readwrite", (s) => s.put(v, "atual")), apagar: () => tx("readwrite", (s) => s.delete("atual")) };
}

// ------------------------------------------------------------------------------ cliente de alto nível (usado pela interface)
const ESTADO_INICIAL = { fase: "sem_pareamento", etapa: null, sas: null, erro: null, nome: "", dispositivoId: null, identidadeHost: null, relay: "", permissao: null, atualizadoEm: null, status: null, paineis: null, missoes: null, temPin: false };

/**
 * `d`: {criarWs, armazem, relogio:{agora}, agendar(fn, ms)->cancelar, aleatorio?, intervaloPollMs?, permitirLoopback?, versao?, iteracoesPin?}
 * Fases: sem_pareamento | pareando | travado | conectando | conectado | indisponivel | revogado.
 */
export function criarClienteRemoto(d) {
  const agora = () => d.relogio.agora();
  const aleat = d.aleatorio ?? (() => aleatorio(1)[0] / 256);
  const intervalo = d.intervaloPollMs ?? 1500;
  let est = { ...ESTADO_INICIAL };
  let reg = null;
  let segredo = null;
  let conn = null;
  let sessao = null;
  let geracao = 0;
  let cancelaTimer = null;
  let cancelaAtualizar = null;
  let tentativas = 0;
  let epocaAtual = 0;
  let falhasPin = 0;
  let bloqueadoAte = 0;
  const ouvintes = new Set();
  const emitir = (p) => {
    est = { ...est, ...p };
    for (const f of [...ouvintes]) {
      try {
        f(est);
      } catch {
        /* ouvinte do dono não derruba o cliente */
      }
    }
  };
  const esperar = (ms) => new Promise((r) => d.agendar(r, ms));
  const parar = () => {
    geracao++;
    if (cancelaTimer !== null) cancelaTimer();
    if (cancelaAtualizar !== null) cancelaAtualizar();
    cancelaTimer = null;
    cancelaAtualizar = null;
    if (conn !== null) conn.fechar();
    conn = null;
    sessao = null;
  };
  const zerarDados = () => emitir({ status: null, paineis: null, missoes: null, atualizadoEm: null, permissao: null });
  const dadosDoRegistro = async (r) => ({ nome: r.nome, dispositivoId: r.dispositivo_id, identidadeHost: await impressaoDigital(deB64(r.identidade)), relay: r.relay, temPin: r.segredo.pin !== undefined });

  let recusas401 = 0;
  function agendarReconexao(gen) {
    if (gen !== geracao) return;
    emitir({ fase: "indisponivel" });
    cancelaTimer = d.agendar(() => {
      cancelaTimer = null;
      void conectarPermanente();
    }, backoffMs(tentativas++, aleat));
  }
  async function conectarPermanente() {
    if (reg === null || segredo === null) return;
    parar();
    const gen = geracao;
    emitir({ fase: "conectando", erro: null });
    try {
      const chaveEnv = await chaveEnvelope(segredo, "sessao");
      const e = epocaDe(agora());
      let c = null;
      for (const ep of [e, e - 1, e + 1]) {
        if (gen !== geracao) return;
        c = await abrirCanalRelay({
          criarWs: d.criarWs,
          url: reg.relay,
          canal: await canalId(segredo, ep),
          chaveEnv,
          privada: reg.chave,
          publicaSpki: deB64(reg.publica),
          agendar: d.agendar,
          ...(d.versao === undefined ? {} : { versao: d.versao }),
          aoTick: () => {
            if (epocaDe(agora()) !== epocaAtual) void conectarPermanente();
          },
          aoFechar: () => {
            if (gen === geracao) agendarReconexao(gen);
          },
        });
        if (c !== null) {
          epocaAtual = ep;
          break;
        }
      }
      if (gen !== geracao) {
        if (c !== null) c.fechar();
        return;
      }
      if (c === null) return agendarReconexao(gen);
      conn = c;
      const p13 = criarProtocolo13({ requisitar: c.requisitar, privada: reg.chave, publicaSpki: deB64(reg.publica), agora });
      const s = await p13.abrirSessao(reg.dispositivo_id, deB64(reg.identidade));
      if (gen !== geracao) return;
      if (!s.ok) {
        c.fechar();
        conn = null;
        if (s.status === 401) {
          // 401 no INÍCIO da sessão não prova revogação: o host responde igual a relógio fora da janela de ±60 s, nonce repetido (um relay hostil pode reenviar um pedido antigo) e dispositivo
          // desconhecido. Nunca apaga sozinho (A-01): tenta de novo e, depois de 3 recusas seguidas, avisa e deixa a decisão com a pessoa («Esquecer este aparelho»).
          recusas401++;
          if (recusas401 >= 3) emitir({ erro: "sessao_recusada" });
        }
        return agendarReconexao(gen);
      }
      sessao = s;
      tentativas = 0;
      recusas401 = 0;
      emitir({ fase: "conectado", erro: null });
      await atualizar();
    } catch {
      agendarReconexao(gen);
    }
  }
  async function revogado() {
    parar();
    segredo = null;
    reg = null;
    await d.armazem.apagar();
    emitir({ ...ESTADO_INICIAL, fase: "revogado", erro: "revogado" });
  }
  async function atualizar() {
    if (sessao === null) return false;
    const gen = geracao;
    const r = await sessao.enviar({ t: "estado" });
    if (gen !== geracao) return false;
    if (r.erro === "dispositivo_revogado") {
      await revogado();
      return false;
    }
    if (r.msg === null || typeof r.msg !== "object" || r.msg.t !== "estado") {
      agendarReconexao(gen); // sessão perdida (host reiniciou, quadro inválido): refaz do zero
      return false;
    }
    emitir({ status: r.msg.status ?? null, paineis: r.msg.paineis ?? null, missoes: r.msg.missoes ?? null, permissao: typeof r.msg.permissao === "string" ? r.msg.permissao : est.permissao, atualizadoEm: agora() });
    if (cancelaAtualizar !== null) cancelaAtualizar();
    cancelaAtualizar = d.agendar(() => {
      cancelaAtualizar = null;
      void atualizar();
    }, 20000);
    return true;
  }

  const falhaPareamento = (gen, codigo, conexao) => {
    if (conexao) conexao.fechar();
    if (gen === geracao) emitir({ fase: "sem_pareamento", etapa: null, sas: null, erro: codigo });
    return { ok: false, erro: codigo };
  };

  return {
    estado: () => est,
    assinar(cb) {
      ouvintes.add(cb);
      return () => void ouvintes.delete(cb);
    },
    /** carrega o registro guardado. Com PIN fica travado até `destravar`. */
    async iniciar() {
      reg = await d.armazem.ler();
      if (reg === null) return emitir({ ...ESTADO_INICIAL });
      const base = await dadosDoRegistro(reg);
      if (reg.segredo.pin !== undefined) return emitir({ ...ESTADO_INICIAL, ...base, fase: "travado" });
      segredo = deB64(reg.segredo.claro);
      emitir({ ...ESTADO_INICIAL, ...base });
      await conectarPermanente();
    },
    /** pareamento completo; o código vale uma vez (limpo daqui assim que usado) e a janela inteira é de 120 s (+ 60 s de decisão no desktop). */
    async parear({ relay, codigo, host = "", nome, pin = "" }) {
      parar();
      const gen = geracao;
      const inicio = agora();
      const nomeLimpo = String(nome ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim().slice(0, 40);
      const cod = normalizarCodigo(String(codigo ?? ""));
      if (!urlValidaRelay(relay, d.permitirLoopback === true) || !CODIGO_OK.test(cod) || nomeLimpo === "" || (pin !== "" && !pinValido(pin)) || (host !== "" && !HEX32.test(normalizarImpressao(host)))) {
        emitir({ fase: "sem_pareamento", erro: "dados_invalidos" });
        return { ok: false, erro: "dados_invalidos" };
      }
      emitir({ fase: "pareando", etapa: "conectando", erro: null, sas: null });
      let c = null;
      try {
        const s = await segredoEfemero(cod);
        const ident = await gerarChaveDispositivo();
        c = await abrirCanalRelay({ criarWs: d.criarWs, url: relay, canal: await canalId(s, 0), chaveEnv: await chaveEnvelope(s, "pareamento"), privada: ident.privada, publicaSpki: ident.publicaSpki, agendar: d.agendar, ...(d.versao === undefined ? {} : { versao: d.versao }) });
        if (gen !== geracao) return falhaPareamento(gen, "cancelado", c);
        if (c === null) return falhaPareamento(gen, "relay_indisponivel", null);
        const p13 = criarProtocolo13({ requisitar: c.requisitar, privada: ident.privada, publicaSpki: ident.publicaSpki, agora });
        const ini = await p13.iniciarPareamento(cod, nomeLimpo);
        if (gen !== geracao) return falhaPareamento(gen, "cancelado", c);
        if (!ini.ok) return falhaPareamento(gen, ini.etapa === "relay" ? "relay_indisponivel" : ini.etapa === "conf_s" ? "desktop_nao_autenticado" : "codigo_invalido", c);
        if (agora() - inicio > TTL_PAREAMENTO_MS) return falhaPareamento(gen, "expirou", c);
        emitir({ etapa: "aguardando_desktop", sas: ini.sas });
        let r = { estado: "aguardando" };
        while (r.estado === "aguardando") {
          if (agora() - inicio > TTL_PAREAMENTO_MS + LIMITE_DECISAO_MS) return falhaPareamento(gen, "expirou", c);
          await esperar(intervalo);
          if (gen !== geracao) return falhaPareamento(gen, "cancelado", c);
          r = await p13.statusPareamento(ini.hid, ini.chaves);
        }
        if (r.estado === "negado") return falhaPareamento(gen, "negado", c);
        if (r.estado !== "pareado") return falhaPareamento(gen, r.estado === "relay" ? "relay_indisponivel" : r.estado === "mac_invalido" ? "desktop_nao_autenticado" : "expirou", c);
        const impressao = await impressaoDigital(r.identidade);
        if (host !== "" && normalizarImpressao(host) !== impressao) return falhaPareamento(gen, "impressao_diferente", c); // AX-04: pin do host
        const s13 = await p13.abrirSessao(r.dispositivoId, r.identidade);
        if (!s13.ok) return falhaPareamento(gen, "sessao_falhou", c);
        const resp = await s13.enviar({ t: "canal_segredo" });
        const m = resp.msg;
        let seg = null;
        try {
          seg = m !== null && typeof m === "object" && m.t === "canal_segredo" ? deB64(String(m.segredo)) : null;
        } catch {
          seg = null;
        }
        if (seg === null || seg.length !== 32) return falhaPareamento(gen, "segredo_nao_entregue", c);
        const registro = { v: 1, dispositivo_id: r.dispositivoId, identidade: paraB64(r.identidade), relay, nome: nomeLimpo, chave: ident.privada, publica: paraB64(ident.publicaSpki), segredo: pin === "" ? { claro: paraB64(seg) } : { pin: await cifrarComPin(pin, seg, d.iteracoesPin) } };
        await d.armazem.gravar(registro);
        c.fechar(); // o canal efêmero morre aqui: dali em diante, canal_id rotativo
        if (gen !== geracao) return { ok: false, erro: "cancelado" };
        reg = registro;
        segredo = seg;
        tentativas = 0;
        emitir({ ...ESTADO_INICIAL, ...(await dadosDoRegistro(registro)), fase: "conectando" });
        void conectarPermanente();
        return { ok: true };
      } catch {
        return falhaPareamento(gen, "falhou", c);
      }
    },
    cancelarPareamento() {
      parar();
      emitir({ ...ESTADO_INICIAL, erro: null });
    },
    atualizar,
    async enviarComando(texto) {
      if (sessao === null) return null;
      const r = await sessao.enviar({ t: "comando", texto: String(texto).slice(0, 4000) });
      return r.msg !== null && typeof r.msg === "object" && r.msg.t === "resultado" ? r.msg.resultado : null;
    },
    async statusPedido(id) {
      if (sessao === null) return null;
      const r = await sessao.enviar({ t: "pedido_status", confirmacao_id: id });
      return r.msg !== null && typeof r.msg === "object" && r.msg.t === "pedido_status" ? r.msg : null;
    },
    /** apaga o estado em memória (segredo, sessão, dados); o registro cifrado/guardado fica para `destravar`. */
    travar() {
      if (reg === null) return;
      parar();
      segredo = null;
      zerarDados();
      emitir({ fase: "travado", erro: null });
    },
    async destravar(pin = "") {
      if (reg === null) return { ok: false, erro: "sem_registro" };
      if (agora() < bloqueadoAte) return { ok: false, erro: "aguarde" };
      if (reg.segredo.pin !== undefined) {
        const s = await decifrarComPin(pin, reg.segredo.pin);
        if (s === null) {
          if (++falhasPin >= 5) {
            falhasPin = 0;
            bloqueadoAte = agora() + 30000;
          }
          emitir({ erro: "pin_incorreto" });
          return { ok: false, erro: "pin_incorreto" };
        }
        segredo = s;
      } else segredo = deB64(reg.segredo.claro);
      falhasPin = 0;
      tentativas = 0;
      emitir({ erro: null });
      void conectarPermanente();
      return { ok: true };
    },
    /** define (ou remove, com `""`) o PIN local; só destravado. */
    async definirPin(pin) {
      if (reg === null || segredo === null || (pin !== "" && !pinValido(pin))) return false;
      reg = { ...reg, segredo: pin === "" ? { claro: paraB64(segredo) } : { pin: await cifrarComPin(pin, segredo, d.iteracoesPin) } };
      await d.armazem.gravar(reg);
      emitir({ temPin: pin !== "" });
      return true;
    },
    /** avisa o host (que revoga) e apaga TUDO local. */
    async esquecer() {
      const s = sessao;
      if (s !== null) await Promise.race([s.enviar({ t: "esquecer" }).catch(() => null), esperar(2500)]);
      parar();
      segredo = null;
      reg = null;
      await d.armazem.apagar();
      emitir({ ...ESTADO_INICIAL });
    },
    encerrar() {
      parar();
      ouvintes.clear();
    },
  };
}
