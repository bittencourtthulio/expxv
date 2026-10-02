// Telas do PWA (T-22.15). TUDO vira TEXTO (`textContent`): nenhum innerHTML, nenhum link nem HTML vindo do desktop (AX-12). Sem botão de aprovar (D-21): pedido que precisa de confirmação
// aparece como «aguardando o desktop». Painéis e Missões vêm de terceiros e levam o selo «conteúdo não confiável». Autolock e PIN local ficam em `trava.js`.
import { criarTrava } from "./trava.js";
import { consumirFragmento, grupos4, lerLinkPareamento } from "./protocolo-cliente.js";

const ABAS = [
  ["status", "Status"],
  ["paineis", "Painéis"],
  ["missoes", "Missões"],
  ["mensagem", "Mensagem"],
  ["config", "Configuração"],
];
export const TEXTO_ERRO = {
  dados_invalidos: "Confira o endereço do relay, o código (12 caracteres), o nome e o PIN (4 a 12 números).",
  relay_indisponivel: "Não foi possível falar com o relay. Confira o endereço e a internet.",
  codigo_invalido: "Código recusado ou expirado. Gere outro no desktop.",
  desktop_nao_autenticado: "O desktop não provou conhecer o código. Nada foi guardado.",
  expirou: "O pareamento expirou. Gere um código novo no desktop.",
  negado: "O desktop recusou este aparelho.",
  impressao_diferente: "A impressão digital do desktop não confere com a do link. Nada foi guardado.",
  sessao_falhou: "Não foi possível abrir a sessão segura com o desktop.",
  segredo_nao_entregue: "O desktop não concluiu a configuração do canal. Tente de novo.",
  cancelado: "Pareamento cancelado.",
  falhou: "Algo deu errado. Nada foi guardado.",
  revogado: "Este aparelho foi desligado pelo desktop. Pareie de novo para voltar a usar.",
  sessao_recusada: "O desktop recusou a sessão: este aparelho pode ter sido revogado, ou o relógio do celular está errado. Confira a data e a hora e, se continuar, use «Esquecer este aparelho» e pareie de novo.",
  pin_incorreto: "PIN incorreto.",
  aguarde: "Muitas tentativas. Aguarde 30 segundos.",
};
const FASE_TEXTO = { conectando: "◐ Conectando ao desktop…", conectado: "● Conectado", indisponivel: "○ Sem conexão com o desktop. Tentando de novo…" };
const PEDIDO_TEXTO = { aprovado: "Aprovado no desktop.", recusado: "Recusado no desktop.", expirado: "Expirou sem resposta do desktop.", desconhecido: "Estado desconhecido." };

export function criarNo(doc, tag, texto, classe) {
  const e = doc.createElement(tag);
  if (texto !== undefined && texto !== null) e.textContent = String(texto);
  if (classe !== undefined) e.className = classe;
  return e;
}
const botao = (doc, texto, aoClicar, classe) => {
  const b = criarNo(doc, "button", texto, classe);
  b.type = "button";
  b.addEventListener("click", aoClicar);
  return b;
};
const campo = (doc, rotulo, id, tipo, extra = {}) => {
  const l = criarNo(doc, "label", rotulo);
  l.htmlFor = id;
  const i = doc.createElement("input");
  i.id = id;
  i.type = tipo;
  i.autocomplete = "off";
  for (const [k, v] of Object.entries(extra)) i.setAttribute(k, v);
  const bloco = criarNo(doc, "div", undefined, "campo");
  bloco.append(l, i);
  return { bloco, entrada: i };
};
const grupos6 = (sas) => (sas.length === 6 ? `${sas.slice(0, 3)} ${sas.slice(3)}` : sas);

/** `resultado` do Jarvis -> nós de texto. `linhas` e `texto` são DADO: nunca interpretados. */
export function desenharResultado(doc, res, vazio) {
  const caixa = criarNo(doc, "div");
  if (res === null || typeof res !== "object") {
    caixa.append(criarNo(doc, "p", vazio, "suave"));
    return caixa;
  }
  const texto = res.tipo === "resposta" ? res.resposta?.texto : res.tipo === "confirmacao" ? res.confirmacao?.resumo : res.texto;
  if (typeof texto === "string" && texto !== "") caixa.append(criarNo(doc, "p", texto));
  const linhas = res.tipo === "resposta" && Array.isArray(res.resposta?.linhas) ? res.resposta.linhas : [];
  if (res.tipo === "resposta" && res.resposta.nao_confiavel === true) caixa.append(criarNo(doc, "p", "Conteúdo não confiável: veio de fora e é mostrado só como texto.", "selo"));
  if (res.tipo === "resposta" && linhas.length === 0 && !texto) caixa.append(criarNo(doc, "p", vazio, "suave"));
  if (linhas.length > 0) {
    const ul = criarNo(doc, "ul", undefined, "lista");
    for (const l of linhas.slice(0, 200)) {
      const li = criarNo(doc, "li");
      li.append(criarNo(doc, "strong", typeof l?.rotulo === "string" ? l.rotulo : ""));
      if (typeof l?.detalhe === "string" && l.detalhe !== "") li.append(criarNo(doc, "span", ` ${l.detalhe}`, "suave"));
      ul.append(li);
    }
    caixa.append(ul);
  }
  return caixa;
}

/**
 * Monta o app. `o`: {raiz, cliente, doc?, loc?, hist?, impressaoCliente?: async () => ({manifesto, sw}), agendar?, camera?, ms_trava?, nomePadrao?}
 * Devolve {desmontar, trava}.
 */
export function montarApp(o) {
  const doc = o.doc ?? document;
  const raiz = o.raiz;
  const cliente = o.cliente;
  const agendar = o.agendar ?? ((fn, ms) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  });
  let chave = "";
  let aba = "status";
  let atualizarAba = () => undefined;
  let prefill = null;
  let agendaPedido = null;
  let desmontado = false;
  const trava = criarTrava({ ms: o.ms_trava ?? 300000, agendar, aoTravar: () => cliente.travar() });
  const topo = criarNo(doc, "div", undefined, "topo");
  const avisoExp = criarNo(doc, "p", "Experimental. Sem revisão externa da criptografia.", "aviso");
  const conteudo = criarNo(doc, "div", undefined, "conteudo");
  const anuncio = criarNo(doc, "p", "", "so-leitor");
  anuncio.setAttribute("role", "status");
  anuncio.setAttribute("aria-live", "polite");
  raiz.textContent = "";
  topo.append(criarNo(doc, "h1", "Controle remoto"), avisoExp);
  raiz.append(topo, conteudo, anuncio);
  if (o.loc && o.hist) prefill = consumirFragmento(o.loc, o.hist, { permitirLoopback: o.permitirLoopback === true });
  const aoAtividade = () => trava.atividade();
  for (const ev of ["pointerdown", "keydown", "touchstart"]) doc.addEventListener(ev, aoAtividade, true);

  const chaveDe = (e) => (e.fase === "sem_pareamento" || e.fase === "pareando" || e.fase === "revogado" ? "parear" : e.fase === "travado" ? "travado" : "principal");

  function vistaParear(e) {
    const f = criarNo(doc, "form", undefined, "form");
    f.noValidate = true;
    f.setAttribute("aria-label", "Parear com o desktop");
    f.append(criarNo(doc, "h2", "Parear com o desktop"), criarNo(doc, "p", "No desktop, abra o relay e toque em «Parear celular». Leia o QR (abre este app já preenchido) ou digite o endereço e o código aqui."));
    const relay = campo(doc, "Endereço do relay (wss://…)", "campo-relay", "url", { inputmode: "url", placeholder: "wss://relay.exemplo.com" });
    const codigo = campo(doc, "Código de pareamento", "campo-codigo", "text", { autocapitalize: "characters", spellcheck: "false", placeholder: "XXXX-XXXX-XXXX", maxlength: "14" });
    const host = campo(doc, "Impressão digital do desktop (opcional)", "campo-host", "text", { spellcheck: "false", maxlength: "40" });
    const nome = campo(doc, "Nome deste aparelho", "campo-nome", "text", { maxlength: "40" });
    const pin = campo(doc, "PIN local (opcional, 4 a 12 números)", "campo-pin", "password", { inputmode: "numeric", maxlength: "12" });
    nome.entrada.value = o.nomePadrao ?? "Meu celular";
    if (prefill !== null) {
      relay.entrada.value = prefill.relay;
      codigo.entrada.value = prefill.codigo;
      host.entrada.value = grupos4(prefill.host);
      prefill = null;
    }
    const erro = criarNo(doc, "p", "", "erro");
    erro.setAttribute("role", "alert");
    const etapa = criarNo(doc, "p", "", "suave");
    etapa.setAttribute("aria-live", "polite");
    const sas = criarNo(doc, "div", "", "sas");
    sas.setAttribute("aria-live", "polite");
    const entrar = criarNo(doc, "button", "Parear");
    entrar.type = "submit";
    const cancelar = botao(doc, "Cancelar", () => cliente.cancelarPareamento(), "secundario");
    const camera = o.camera ?? (typeof BarcodeDetector !== "undefined" && doc.defaultView?.navigator?.mediaDevices ? "auto" : null);
    f.append(relay.bloco, codigo.bloco, host.bloco, nome.bloco, pin.bloco, erro, etapa, sas);
    const linha = criarNo(doc, "div", undefined, "linha");
    linha.append(entrar, cancelar);
    if (camera !== null) linha.append(botao(doc, "Ler QR com a câmera", () => lerCamera(doc, camera, (l) => {
      relay.entrada.value = l.relay;
      codigo.entrada.value = l.codigo;
      host.entrada.value = grupos4(l.host);
    }, erro), "secundario"));
    f.append(linha);
    f.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const pedido = { relay: relay.entrada.value.trim(), codigo: codigo.entrada.value, host: host.entrada.value, nome: nome.entrada.value, pin: pin.entrada.value };
      codigo.entrada.value = ""; // o código vale uma vez: sai da tela e da memória do formulário assim que usado
      pin.entrada.value = "";
      void cliente.parear(pedido);
    });
    const campos = [relay.entrada, codigo.entrada, host.entrada, nome.entrada, pin.entrada, entrar];
    atualizarAba = (x) => {
      const pareando = x.fase === "pareando";
      for (const c of campos) c.disabled = pareando;
      cancelar.hidden = !pareando;
      erro.textContent = x.erro !== null ? TEXTO_ERRO[x.erro] ?? TEXTO_ERRO.falhou : "";
      etapa.textContent = pareando ? (x.etapa === "aguardando_desktop" ? "Aguardando você confirmar no desktop…" : "Conectando ao relay…") : "";
      sas.textContent = pareando && x.sas ? `Confira se este número é o mesmo do desktop: ${grupos6(x.sas)}` : "";
      sas.className = pareando && x.sas ? "sas grande" : "sas";
    };
    conteudo.append(f);
    atualizarAba(e);
  }

  function vistaTravado(e) {
    const s = criarNo(doc, "section");
    s.setAttribute("aria-label", "Travado");
    s.append(criarNo(doc, "h2", "Travado"), criarNo(doc, "p", "Por segurança, o app travou e apagou o que estava na memória."));
    const pin = campo(doc, "PIN", "campo-pin-destravar", "password", { inputmode: "numeric", maxlength: "12" });
    const erro = criarNo(doc, "p", "", "erro");
    erro.setAttribute("role", "alert");
    const entrar = botao(doc, "Destravar", async () => {
      const r = await cliente.destravar(pin.entrada.value);
      pin.entrada.value = "";
      if (!r.ok) erro.textContent = TEXTO_ERRO[r.erro] ?? TEXTO_ERRO.falhou;
    });
    if (e.temPin) s.append(pin.bloco);
    s.append(erro, entrar);
    atualizarAba = (x) => {
      erro.textContent = x.erro !== null ? TEXTO_ERRO[x.erro] ?? "" : "";
    };
    conteudo.append(s);
    entrar.focus?.();
  }

  function vistaPrincipal(e) {
    const nav = criarNo(doc, "div", undefined, "abas");
    nav.setAttribute("role", "tablist");
    nav.setAttribute("aria-label", "Seções");
    const painel = criarNo(doc, "div", undefined, "painel");
    painel.setAttribute("role", "tabpanel");
    painel.id = "painel-aba";
    const botoes = ABAS.map(([id, rotulo]) => {
      const b = criarNo(doc, "button", rotulo, "aba");
      b.type = "button";
      b.setAttribute("role", "tab");
      b.id = `aba-${id}`;
      b.setAttribute("aria-controls", "painel-aba");
      b.addEventListener("click", () => escolher(id));
      b.addEventListener("keydown", (ev) => {
        const i = ABAS.findIndex(([x]) => x === id);
        const j = ev.key === "ArrowRight" ? (i + 1) % ABAS.length : ev.key === "ArrowLeft" ? (i + ABAS.length - 1) % ABAS.length : -1;
        if (j >= 0) {
          ev.preventDefault();
          escolher(ABAS[j][0]);
          botoes[j].focus();
        }
      });
      return b;
    });
    nav.append(...botoes);
    const estadoLinha = criarNo(doc, "p", "", "conexao");
    estadoLinha.setAttribute("role", "status");
    conteudo.append(estadoLinha, nav, painel);
    let desenharAba = () => undefined;
    function escolher(id) {
      aba = id;
      botoes.forEach((b, i) => {
        const sel = ABAS[i][0] === id;
        b.setAttribute("aria-selected", String(sel));
        b.tabIndex = sel ? 0 : -1;
      });
      painel.setAttribute("aria-labelledby", `aba-${id}`);
      painel.textContent = "";
      desenharAba = montarAba(id, painel);
      desenharAba(cliente.estado());
    }
    atualizarAba = (x) => {
      estadoLinha.textContent = x.erro === "sessao_recusada" ? `○ ${TEXTO_ERRO.sessao_recusada}` : FASE_TEXTO[x.fase] ?? "";
      estadoLinha.dataset.fase = x.fase;
      desenharAba(x);
    };
    escolher(aba);
    atualizarAba(e);
  }

  function montarAba(id, painel) {
    if (id === "status") return abaStatus(painel);
    if (id === "paineis") return abaLista(painel, "Painéis", (x) => x.paineis, "Nenhum painel aberto.");
    if (id === "missoes") return abaLista(painel, "Missões", (x) => x.missoes, "Nenhuma Missão em andamento.");
    if (id === "mensagem") return abaMensagem(painel);
    return abaConfig(painel);
  }
  const carregando = (x) => (x.fase === "conectado" ? "Carregando…" : x.fase === "indisponivel" ? "Sem conexão com o desktop. Os dados aparecem quando voltar." : "Conectando…");

  function abaStatus(painel) {
    painel.append(criarNo(doc, "h2", "Status"));
    const area = criarNo(doc, "div");
    const quando = criarNo(doc, "p", "", "suave");
    painel.append(area, quando, botao(doc, "Atualizar agora", () => void cliente.atualizar()));
    return (x) => {
      area.textContent = "";
      if (x.status === null) area.append(criarNo(doc, "p", carregando(x), "suave"));
      else area.append(desenharResultado(doc, x.status, "Sem informações de status."));
      quando.textContent = x.atualizadoEm === null ? "" : `Atualizado às ${new Date(x.atualizadoEm).toLocaleTimeString("pt-BR")}.`;
    };
  }
  function abaLista(painel, titulo, pegar, vazio) {
    painel.append(criarNo(doc, "h2", titulo));
    const area = criarNo(doc, "div");
    painel.append(area);
    return (x) => {
      area.textContent = "";
      const r = pegar(x);
      if (r === null) area.append(criarNo(doc, "p", carregando(x), "suave"));
      else area.append(desenharResultado(doc, r, vazio));
    };
  }
  function abaMensagem(painel) {
    painel.append(criarNo(doc, "h2", "Mensagem ao piloto"));
    const aviso = criarNo(doc, "p", "Este aparelho só tem permissão de leitura. Só o desktop pode aumentar a permissão.", "suave");
    const form = criarNo(doc, "form", undefined, "form");
    const l = criarNo(doc, "label", "O que você quer pedir");
    l.htmlFor = "campo-mensagem";
    const t = doc.createElement("textarea");
    t.id = "campo-mensagem";
    t.maxLength = 4000;
    t.rows = 4;
    const enviar = criarNo(doc, "button", "Enviar");
    enviar.type = "submit";
    const saida = criarNo(doc, "div", undefined, "saida");
    saida.setAttribute("aria-live", "polite");
    form.append(l, t, enviar);
    painel.append(aviso, form, saida);
    const mostrarPedido = async (res) => {
      saida.textContent = "";
      saida.append(desenharResultado(doc, res, "Sem resposta."));
      if (res !== null && res.tipo === "confirmacao") {
        saida.append(criarNo(doc, "p", "Aguardando o desktop. A decisão é só lá; este app não aprova nada.", "selo"));
        const id = res.confirmacao.id;
        const sondar = async () => {
          if (desmontado || !saida.isConnected) return;
          const r = await cliente.statusPedido(id);
          if (r === null) return;
          if (r.estado === "pendente") agendaPedido = agendar(() => void sondar(), 3000);
          else {
            saida.append(criarNo(doc, "p", `${PEDIDO_TEXTO[r.estado] ?? "Concluído."}${r.texto ? ` ${r.texto}` : ""}`));
            anuncio.textContent = PEDIDO_TEXTO[r.estado] ?? "Concluído.";
          }
        };
        agendaPedido = agendar(() => void sondar(), 2000);
      }
    };
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const texto = t.value.trim();
      if (texto === "") return void (saida.textContent = "Escreva a mensagem antes de enviar.");
      enviar.disabled = true;
      saida.textContent = "Enviando…";
      try {
        await mostrarPedido(await cliente.enviarComando(texto));
        t.value = "";
      } finally {
        enviar.disabled = false;
      }
    });
    return (x) => {
      const somenteLeitura = x.permissao === "leitura";
      aviso.hidden = !somenteLeitura;
      form.hidden = somenteLeitura;
    };
  }
  function abaConfig(painel) {
    painel.append(criarNo(doc, "h2", "Configuração"));
    const aparelho = criarNo(doc, "p");
    const digCliente = criarNo(doc, "p", "Calculando…", "mono");
    const digHost = criarNo(doc, "p", "", "mono");
    painel.append(aparelho, criarNo(doc, "h3", "Impressão digital do cliente"), criarNo(doc, "p", "Compare com a mostrada no desktop ao parear. O hash do sw.js é informado pelo próprio app: só prova algo se você o comparar com o do seu build (ele não protege contra um site hostil).", "suave"), digCliente, criarNo(doc, "h3", "Impressão digital do desktop (fixada)"), digHost);
    if (o.impressaoCliente) {
      void o.impressaoCliente().then((r) => {
        digCliente.textContent = `manifesto ${r.manifesto ? grupos4(r.manifesto) : "indisponível"}\nsw.js ${r.sw ? grupos4(r.sw) : "indisponível"}`;
      }, () => void (digCliente.textContent = "indisponível"));
    } else digCliente.textContent = "indisponível";
    painel.append(botao(doc, "Travar agora", () => cliente.travar()));
    const pin = campo(doc, "Novo PIN (4 a 12 números)", "campo-pin-novo", "password", { inputmode: "numeric", maxlength: "12" });
    const msg = criarNo(doc, "p", "", "suave");
    msg.setAttribute("role", "status");
    const definir = botao(doc, "Definir PIN", async () => {
      const ok = await cliente.definirPin(pin.entrada.value);
      pin.entrada.value = "";
      msg.textContent = ok ? "PIN definido. O app pedirá o PIN depois de travar." : "PIN inválido: use de 4 a 12 números.";
    });
    const remover = botao(doc, "Remover PIN", async () => {
      await cliente.definirPin("");
      msg.textContent = "PIN removido.";
    }, "secundario");
    painel.append(pin.bloco, definir, remover, msg);
    const esquecer = criarNo(doc, "div", undefined, "perigo");
    const pedir = botao(doc, "Esquecer este dispositivo", () => {
      confirmar.hidden = false;
      pedir.hidden = true;
      confirmar.querySelector("button")?.focus?.();
    }, "secundario");
    const confirmar = criarNo(doc, "div");
    confirmar.hidden = true;
    confirmar.append(criarNo(doc, "p", "O desktop vai revogar este aparelho e tudo guardado aqui será apagado."), botao(doc, "Confirmar: esquecer e apagar", () => void cliente.esquecer(), "perigo-botao"), botao(doc, "Cancelar", () => {
      confirmar.hidden = true;
      pedir.hidden = false;
    }, "secundario"));
    esquecer.append(pedir, confirmar);
    painel.append(esquecer);
    return (x) => {
      aparelho.textContent = `Aparelho: ${x.nome} · permissão: ${x.permissao ?? "leitura (padrão)"}`;
      digHost.textContent = x.identidadeHost ? grupos4(x.identidadeHost) : "";
      remover.hidden = !x.temPin;
    };
  }

  function desenhar(e) {
    if (desmontado) return;
    const k = chaveDe(e);
    if (k !== chave) {
      chave = k;
      conteudo.textContent = "";
      if (k === "parear") vistaParear(e);
      else if (k === "travado") vistaTravado(e);
      else vistaPrincipal(e);
      if (k === "travado") trava.parar();
      else if (k === "principal" && !trava.ativa()) trava.iniciar();
      if (k !== "principal" && k !== "travado") trava.parar();
      const h = conteudo.querySelector("h2");
      if (h) {
        h.tabIndex = -1;
        h.focus?.();
      }
    } else atualizarAba(e);
    if (e.fase === "revogado" || e.erro === "revogado") anuncio.textContent = TEXTO_ERRO.revogado;
  }
  const cancelarAssinatura = cliente.assinar(desenhar);
  desenhar(cliente.estado());
  return {
    trava,
    desmontar() {
      desmontado = true;
      cancelarAssinatura();
      trava.parar();
      if (agendaPedido !== null) agendaPedido();
      for (const ev of ["pointerdown", "keydown", "touchstart"]) doc.removeEventListener(ev, aoAtividade, true);
    },
  };
}

// ------------------------------------------------------------------------------ câmera (BarcodeDetector, quando existir)
async function lerCamera(doc, camera, aoLer, erro) {
  const nav = doc.defaultView?.navigator;
  let fluxo = null;
  try {
    const detector = camera === "auto" ? new BarcodeDetector({ formats: ["qr_code"] }) : camera.detector;
    fluxo = await (camera === "auto" ? nav.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }) : camera.fluxo());
    const v = doc.createElement("video");
    v.muted = true;
    v.setAttribute("playsinline", "");
    v.setAttribute("aria-label", "Câmera para ler o QR");
    v.srcObject = fluxo;
    doc.body.append(v);
    await v.play();
    for (let i = 0; i < 100; i++) {
      const achados = await detector.detect(v);
      for (const a of achados) {
        let hash = "";
        try {
          hash = new URL(a.rawValue).hash;
        } catch {
          hash = "";
        }
        const l = lerLinkPareamento(hash, {});
        if (l !== null) {
          v.remove();
          aoLer(l);
          return;
        }
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    v.remove();
    erro.textContent = "Não encontrei um QR válido. Digite o código.";
  } catch {
    erro.textContent = "Não foi possível usar a câmera. Digite o código.";
  } finally {
    if (fluxo !== null) for (const t of fluxo.getTracks?.() ?? []) t.stop();
  }
}
