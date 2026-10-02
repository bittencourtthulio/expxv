import { useCallback, useEffect, useReducer, useState } from "react";
import type { ApiAlertas, AutorizadoCompletoVisao, EstadoTelegram, NaoAutorizadoVisao } from "../../../compartilhado/alertas";
import { DialogoConfirmacao } from "../../componentes/Dialogo";
import { formatarCodigoPareamento, restanteAte } from "../../estado/alertas-formato";
import { pedirPanicoTelegram } from "../../estado/alertas-acoes";
import {
  CONFIRMACAO_DIRETO, confirmaDireto, exigeConfirmacaoDireto, formatoTokenOk, linhasIniciais, MENSAGENS_ERRO_TOKEN, mensagemErro, montarWorkspaces, passoSugerido, passosConcluidos, reduzirToken,
  RESTRICOES_DIRETO, ROTULOS_PASSOS, TOKEN_INICIAL, type LinhaWorkspace, type ModoLinha, type PassoAssistente,
} from "./assistente-estado";
import type { WorkspaceOpcao } from "./Lista";

const PASSOS: readonly PassoAssistente[] = [1, 2, 3, 4, 5];

function PassoToken({ api, estado, aoMudou }: { api: ApiAlertas; estado: EstadoTelegram; aoMudou: () => void }) {
  const [t, dispatch] = useReducer(reduzirToken, TOKEN_INICIAL);
  const [trocando, setTrocando] = useState(false);
  const [removendo, setRemovendo] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const mostrarForm = estado.token_mascarado === null || trocando;
  const ocupado = t.fase === "testando" || t.fase === "salvando";

  const testar = async (): Promise<void> => {
    dispatch({ t: "testar" });
    try { dispatch({ t: "resultado_teste", r: await api.telegram.tokenTestar(t.token.trim()) }); } catch { dispatch({ t: "resultado_teste", r: { ok: false, erro: "rede" } }); }
  };
  const salvar = async (): Promise<void> => {
    dispatch({ t: "salvar" });
    try {
      const r = await api.telegram.tokenSalvar(t.token.trim());
      dispatch({ t: "resultado_salvo", r });
      if (r.ok) { setTrocando(false); aoMudou(); }
    } catch { dispatch({ t: "resultado_salvo", r: { ok: false, erro: "rede" } }); }
  };
  const testarSalvo = async (): Promise<void> => {
    try { const r = await api.telegram.tokenTestar(null); dispatch({ t: "resultado_teste", r }); setMsg(r.ok ? `Token salvo válido: @${r.bot?.username ?? "bot"}.` : null); } catch { dispatch({ t: "resultado_teste", r: { ok: false, erro: "rede" } }); }
  };
  const limparWebhook = async (): Promise<void> => {
    try { const r = await api.telegram.webhookLimpar(); setMsg(r.ok ? "Webhook removido. Teste o token de novo." : "Não foi possível limpar o webhook (o token precisa estar salvo)."); } catch { setMsg("Não foi possível limpar o webhook."); }
  };
  return (
    <div className="alertas-passo">
      <p>O token é a senha do bot. Ele vai direto para o cofre do sistema e nunca volta para esta tela.</p>
      {estado.token_mascarado !== null ? (
        <p className="alertas-estado" role="status"><span aria-hidden="true">✓</span> Token salvo no cofre: <code>{estado.token_mascarado}</code>{estado.bot !== null ? <> · @{estado.bot.username}</> : null}</p>
      ) : <p className="alertas-estado" role="status"><span aria-hidden="true">○</span> Nenhum token salvo.</p>}
      {!estado.cofre_disponivel ? <p role="alert" className="alertas-erro">{MENSAGENS_ERRO_TOKEN.cofre_indisponivel}</p> : null}
      {mostrarForm ? (
        <form onSubmit={(e) => { e.preventDefault(); void (t.fase === "testado" ? salvar() : testar()); }}>
          <label className="campo"><span>Token do bot</span>
            <input type="password" autoComplete="new-password" autoCorrect="off" autoCapitalize="off" spellCheck={false} name="token-do-bot" value={t.token} onChange={(e) => dispatch({ t: "digitar", token: e.target.value })} aria-invalid={t.erro === "formato" || undefined} />
          </label>
          <div className="alertas-linha-botoes">
            <button type="submit" className="botao alertas-mini" disabled={ocupado || !formatoTokenOk(t.token)} onClick={(e) => { e.preventDefault(); void testar(); }}>{t.fase === "testando" ? "Testando…" : "Testar"}</button>
            <button type="button" className="botao botao-primario alertas-mini" disabled={ocupado || t.fase !== "testado"} onClick={() => void salvar()}>{t.fase === "salvando" ? "Salvando…" : "Salvar token"}</button>
            {trocando ? <button type="button" className="botao alertas-mini" onClick={() => { setTrocando(false); dispatch({ t: "limpar" }); }}>Cancelar</button> : null}
          </div>
          {t.fase === "testado" && t.bot !== null ? <p role="status" className="alertas-aviso">Bot encontrado: @{t.bot.username} ({t.bot.nome}). Salve o token para continuar.</p> : null}
        </form>
      ) : (
        <div className="alertas-linha-botoes">
          <button type="button" className="botao alertas-mini" onClick={() => { setTrocando(true); dispatch({ t: "limpar" }); }}>Trocar token</button>
          <button type="button" className="botao alertas-mini" onClick={() => void testarSalvo()}>Testar o token salvo</button>
          <button type="button" className="botao botao-perigo alertas-mini" onClick={() => setRemovendo(true)}>Remover token</button>
        </div>
      )}
      {t.fase === "erro" && t.erro !== null ? (
        <div role="alert" className="alertas-erro">
          <p>{t.instrucao ?? MENSAGENS_ERRO_TOKEN[t.erro as keyof typeof MENSAGENS_ERRO_TOKEN]}</p>
          {t.erro === "webhook_ativo" ? <button type="button" className="botao alertas-mini" onClick={() => void limparWebhook()}>Limpar webhook</button> : null}
        </div>
      ) : null}
      {msg !== null ? <p role="status" className="alertas-aviso">{msg}</p> : null}
      {removendo ? <DialogoConfirmacao titulo="Remover o token" texto={<p>Remove o token do cofre e desliga o canal. Será preciso informar o token de novo.</p>} rotuloConfirmar="Remover" perigoso aoCancelar={() => setRemovendo(false)} aoConfirmar={() => { setRemovendo(false); void api.telegram.tokenRemover().then(aoMudou, () => setMsg("Não foi possível remover o token.")); }} /> : null}
    </div>
  );
}

function PassoConsentimento({ api, estado, aoMudou, aoAvancar }: { api: ApiAlertas; estado: EstadoTelegram; aoMudou: () => void; aoAvancar: () => void }) {
  const tc = estado.texto_consentimento;
  const c = estado.canal.consentimento;
  const vigente = c !== null && c.versao_texto === tc.versao_texto;
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const aceitar = async (): Promise<void> => {
    setOcupado(true);
    try { await api.canais.consentir(estado.canal.id, tc.versao_texto, tc.hash_texto); setErro(null); aoMudou(); aoAvancar(); } catch { setErro("Não foi possível gravar o consentimento."); } finally { setOcupado(false); }
  };
  return (
    <div className="alertas-passo">
      <blockquote className="alertas-consentimento" aria-label="Texto do consentimento">{tc.texto}</blockquote>
      {tc.itens.length > 0 ? <ul aria-label="Tipos que sairão da máquina">{tc.itens.map((i) => <li key={i}>{i}</li>)}</ul> : null}
      <p className="alertas-nota">Host: <code>{tc.host}</code> · versão do texto: {tc.versao_texto}</p>
      {vigente ? <p className="alertas-estado" role="status"><span aria-hidden="true">✓</span> Consentimento dado em {new Date(c.aceito_em).toLocaleString("pt-BR")}.</p>
        : <p className="alertas-estado" role="status"><span aria-hidden="true">○</span> {c === null ? "Sem consentimento: nada sai da máquina." : "O texto mudou: é preciso consentir de novo."}</p>}
      {erro !== null ? <p role="alert" className="campo-erro">{erro}</p> : null}
      {!vigente ? <div className="alertas-linha-botoes"><button type="button" className="botao botao-primario alertas-mini" disabled={ocupado} onClick={() => void aceitar()}>Aceitar e continuar</button><button type="button" className="botao alertas-mini" onClick={aoAvancar}>Cancelar</button></div> : null}
    </div>
  );
}

function PassoPareamento({ api, estado, aoMudou, agora }: { api: ApiAlertas; estado: EstadoTelegram; aoMudou: () => void; agora: () => number }) {
  const [cod, setCod] = useState<{ codigo: string; link: string | null; expira_em: string } | null>(null);
  const [, tick] = useReducer((x: number) => x + 1, 0);
  const [revogando, setRevogando] = useState<AutorizadoCompletoVisao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => api.assinarPareamento((e) => { if (e.estado === "pareado" || e.estado === "expirado" || e.estado === "cancelado") { setCod(null); aoMudou(); } }), [api, aoMudou]);
  useEffect(() => { if (cod === null) return; const i = setInterval(tick, 1000); return () => clearInterval(i); }, [cod]);
  const restante = cod === null ? null : restanteAte(cod.expira_em, agora());
  useEffect(() => { if (cod !== null && restante === null) setCod(null); }, [cod, restante]);
  const iniciar = async (): Promise<void> => { try { setCod(await api.telegram.parearIniciar()); setErro(null); } catch { setErro("Não foi possível gerar o código. Salve o token primeiro."); } };
  const cancelar = async (): Promise<void> => { setCod(null); try { await api.telegram.parearCancelar(); } catch { /* o código expira sozinho */ } };
  return (
    <div className="alertas-passo">
      <p>O código vale por 5 minutos e só pode ser usado uma vez. Quando o bot recebê-lo, você confirma aqui no desktop.</p>
      {cod === null ? <button type="button" className="botao botao-primario alertas-mini" disabled={estado.token_mascarado === null} onClick={() => void iniciar()}>Gerar código de pareamento</button> : (
        <div className="alertas-codigo" role="status">
          <p>Código (aparece só agora): <strong className="alertas-codigo-valor">{formatarCodigoPareamento(cod.codigo)}</strong></p>
          <p>Envie <code>/parear {formatarCodigoPareamento(cod.codigo)}</code> ao bot{cod.link !== null ? <>, ou abra: <code>{cod.link}</code></> : null}.</p>
          <p>Expira em {restante ?? "0:00"}.</p>
          <button type="button" className="botao alertas-mini" onClick={() => void cancelar()}>Cancelar pareamento</button>
        </div>
      )}
      {erro !== null ? <p role="alert" className="campo-erro">{erro}</p> : null}
      <h3>Contas pareadas</h3>
      {estado.autorizados.filter((a) => a.revogado_em === null).length === 0 ? <p className="alertas-nota">Nenhuma conta pareada.</p> : (
        <ul className="alertas-autorizados">
          {estado.autorizados.filter((a) => a.revogado_em === null).map((a) => (
            <li key={a.id}>{a.nome_exibicao} · expira em {new Date(a.expira_em).toLocaleDateString("pt-BR")} <button type="button" className="alertas-mini-botao" aria-label={`Revogar ${a.nome_exibicao}`} onClick={() => setRevogando(a)}>Revogar</button></li>
          ))}
        </ul>
      )}
      {revogando !== null ? <DialogoConfirmacao titulo="Revogar pareamento" texto={<p>Revogar a conta &ldquo;{revogando.nome_exibicao}&rdquo;? Planos pendentes dela são cancelados e ela só volta com um novo pareamento.</p>} rotuloConfirmar="Revogar" perigoso aoCancelar={() => setRevogando(null)} aoConfirmar={() => { const id = revogando.id; setRevogando(null); void api.telegram.autorizadoRevogar(id).then(aoMudou, () => setErro("Não foi possível revogar.")); }} /> : null}
    </div>
  );
}

function PassoBot({ api, estado, workspaces, aoMudou }: { api: ApiAlertas; estado: EstadoTelegram; workspaces: readonly WorkspaceOpcao[]; aoMudou: () => void }) {
  const ativo = estado.autorizados.find((a) => a.revogado_em === null);
  const [linhas, setLinhas] = useState<LinhaWorkspace[]>(() => linhasIniciais(workspaces, ativo?.workspaces ?? []));
  const [textoLivre, setTextoLivre] = useState(ativo?.texto_livre ?? true);
  const [pin, setPin] = useState("");
  const [confirma, setConfirma] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [naoAut, setNaoAut] = useState<NaoAutorizadoVisao[]>([]);
  useEffect(() => { setLinhas(linhasIniciais(workspaces, ativo?.workspaces ?? [])); setTextoLivre(ativo?.texto_livre ?? true); }, [workspaces, ativo]);
  useEffect(() => { void api.telegram.naoAutorizadoListar().then(setNaoAut, () => undefined); }, [api]);
  const nome = (id: string): string => workspaces.find((w) => w.id === id)?.nome ?? id;
  const precisaDireto = exigeConfirmacaoDireto(linhas);
  const saidaLigada = estado.canal.saida_ligada;
  const entradaLigada = estado.canal.entrada_ligada;

  const salvarPermissoes = async (): Promise<void> => {
    if (ativo === undefined) return;
    if (precisaDireto && !confirmaDireto(confirma)) { setMsg(mensagemErro("confirmacao_direto_ausente")); return; }
    try {
      const r = await api.telegram.autorizadoConfig({ id: ativo.id, patch: { workspaces: montarWorkspaces(linhas), texto_livre: textoLivre }, ...(precisaDireto ? { confirmacao: confirma } : {}) });
      setMsg(r.ok ? "Permissões salvas." : mensagemErro(r.erro)); if (r.ok) { setConfirma(""); aoMudou(); }
    } catch { setMsg("Não foi possível salvar as permissões."); }
  };
  const definirPin = async (remover: boolean): Promise<void> => {
    if (ativo === undefined) return;
    try { const r = await api.telegram.autorizadoConfig({ id: ativo.id, patch: { pin: remover ? null : pin } }); setPin(""); setMsg(r.ok ? (remover ? "PIN removido." : "PIN definido.") : mensagemErro(r.erro)); if (r.ok) aoMudou(); } catch { setPin(""); setMsg("Não foi possível alterar o PIN."); }
  };
  const alternarSaida = async (): Promise<void> => { try { await (saidaLigada ? api.canais.desligarSaida(estado.canal.id) : api.canais.ligarSaida(estado.canal.id)); setMsg(null); aoMudou(); } catch { setMsg("Não foi possível alterar os alertas. O consentimento do passo 3 é necessário."); } };
  const alternarEntrada = async (): Promise<void> => { try { const r = await api.telegram.entradaLigar(!entradaLigada); setMsg(r.ok ? null : mensagemErro(r.erro)); aoMudou(); } catch { setMsg("Não foi possível alterar os pedidos."); } };
  const regraPronta = async (): Promise<void> => { try { await api.regraPreset("tarefas_do_telegram", estado.canal.id); setMsg("Regra criada: tarefas, Missões e erros no Telegram."); } catch { setMsg("Não foi possível criar a regra."); } };
  const comandos = async (): Promise<void> => { try { const r = await api.telegram.comandosConfigurar(); setMsg(r.ok ? "Menu de comandos do bot atualizado." : "Não foi possível atualizar o menu do bot."); } catch { setMsg("Não foi possível atualizar o menu do bot."); } };
  const teste = async (): Promise<void> => { try { const r = await api.canais.testeEnvio(estado.canal.id); setMsg(r.ok ? "Mensagem de teste enviada." : `O teste falhou: ${r.detalhe}`); } catch { setMsg("O teste falhou."); } };

  return (
    <div className="alertas-passo">
      <section aria-label="Alertas no Telegram" className="alertas-sub">
        <h3>Alertas (saída)</h3>
        <p className="alertas-estado" role="status"><span aria-hidden="true">{saidaLigada ? "✓" : "○"}</span> {saidaLigada ? "Alertas ligados" : "Alertas desligados"}</p>
        <div className="alertas-linha-botoes">
          <button type="button" className="botao alertas-mini" disabled={estado.canal.consentimento === null} aria-pressed={saidaLigada} onClick={() => void alternarSaida()}>{saidaLigada ? "Desligar alertas" : "Ligar alertas"}</button>
          <button type="button" className="botao alertas-mini" disabled={!saidaLigada} onClick={() => void regraPronta()}>Criar regra pronta (tarefas, Missões e erros)</button>
          <button type="button" className="botao alertas-mini" disabled={!saidaLigada} onClick={() => void teste()}>Enviar mensagem de teste</button>
        </div>
      </section>
      <section aria-label="Pedidos pelo Telegram" className="alertas-sub">
        <h3>Pedidos (entrada)</h3>
        <p className="alertas-estado" role="status"><span aria-hidden="true">{entradaLigada ? "◆" : "○"}</span> {entradaLigada ? "Pedidos ligados (entrada ativa)" : "Pedidos desligados"}</p>
        {ativo === undefined ? <p className="alertas-nota">Pareie uma conta (passo 4) para liberar workspaces.</p> : (
          <>
            <table className="alertas-tabela">
              <caption className="sr-only">Workspaces liberados para o bot</caption>
              <thead><tr><th>Workspace</th><th>Modo</th><th>Padrão</th></tr></thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.workspace_id}>
                    <td>{nome(l.workspace_id)}</td>
                    <td>
                      <select aria-label={`Modo em ${nome(l.workspace_id)}`} value={l.modo} onChange={(e) => setLinhas((x) => x.map((y) => (y.workspace_id === l.workspace_id ? { ...y, modo: e.target.value as ModoLinha } : y)))}>
                        <option value="nenhum">Não liberado</option><option value="consulta">Só consultar</option><option value="aprovar">Aprovar antes</option><option value="direto">Executar direto</option>
                      </select>
                    </td>
                    <td><input type="radio" name="ws-padrao" aria-label={`Padrão: ${nome(l.workspace_id)}`} disabled={l.modo === "nenhum"} checked={l.padrao && l.modo !== "nenhum"} onChange={() => setLinhas((x) => x.map((y) => ({ ...y, padrao: y.workspace_id === l.workspace_id })))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {precisaDireto ? (
              <div role="group" aria-label="Confirmação do modo direto" className="alertas-direto">
                <p><strong>Executar direto</strong> roda o plano sem esperar o seu toque. Restrições:</p>
                <ul>{RESTRICOES_DIRETO.map((r) => <li key={r}>{r}</li>)}</ul>
                <label className="campo"><span>Digite {CONFIRMACAO_DIRETO} para confirmar</span><input value={confirma} autoComplete="off" onChange={(e) => setConfirma(e.target.value)} /></label>
              </div>
            ) : null}
            <label className="alertas-check"><input type="checkbox" checked={textoLivre} onChange={(e) => setTextoLivre(e.target.checked)} /> Tratar texto livre como pedido (sem precisar de /pedir)</label>
            <div className="alertas-linha-botoes"><button type="button" className="botao alertas-mini" onClick={() => void salvarPermissoes()}>Salvar permissões</button></div>
            <fieldset className="alertas-grupo">
              <legend>PIN de aprovação (opcional, recomendado)</legend>
              <p className="alertas-nota">{ativo.com_pin ? "Há um PIN definido. Com PIN, o botão Aprovar não aparece: a aprovação é /aprovar com o PIN." : "Sem PIN, qualquer pessoa com acesso à conta do Telegram pareada pode aprovar planos de baixo risco."}</p>
              <label className="campo"><span>Novo PIN (4 a 12 dígitos)</span><input type="password" inputMode="numeric" autoComplete="new-password" maxLength={12} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} /></label>
              <div className="alertas-linha-botoes">
                <button type="button" className="botao alertas-mini" disabled={pin.length < 4} onClick={() => void definirPin(false)}>Definir PIN</button>
                <button type="button" className="botao alertas-mini" disabled={!ativo.com_pin} onClick={() => void definirPin(true)}>Remover PIN</button>
              </div>
            </fieldset>
          </>
        )}
        <div className="alertas-linha-botoes">
          <button type="button" className="botao alertas-mini" disabled={ativo === undefined || estado.canal.consentimento === null} aria-pressed={entradaLigada} onClick={() => void alternarEntrada()}>{entradaLigada ? "Desligar pedidos" : "Ligar pedidos"}</button>
          <button type="button" className="botao alertas-mini" onClick={() => void comandos()}>Atualizar menu de comandos do bot</button>
        </div>
      </section>
      <section aria-label="Não autorizados" className="alertas-sub">
        <h3>Tentativas de contas desconhecidas</h3>
        {naoAut.length === 0 ? <p className="alertas-nota">Nenhuma tentativa registrada.</p> : (
          <ul className="alertas-autorizados">
            {naoAut.map((n) => (
              <li key={n.user_id}>id {n.user_id} · {n.contagem} {n.contagem === 1 ? "tentativa" : "tentativas"} · {n.bloqueado ? "bloqueado" : <button type="button" className="alertas-mini-botao" aria-label={`Bloquear o id ${n.user_id}`} onClick={() => void api.telegram.naoAutorizadoBloquear(n.user_id).then(() => setNaoAut((x) => x.map((y) => (y.user_id === n.user_id ? { ...y, bloqueado: true } : y))), () => setMsg("Não foi possível bloquear."))}>Bloquear id</button>}</li>
            ))}
          </ul>
        )}
      </section>
      {msg !== null ? <p role="status" className="alertas-aviso">{msg}</p> : null}
    </div>
  );
}

export function TelegramAssistente({ api, workspaces, agora = Date.now }: { api: ApiAlertas; workspaces: readonly WorkspaceOpcao[]; agora?: () => number }) {
  const [estado, setEstado] = useState<EstadoTelegram | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [passo, setPasso] = useState<PassoAssistente | null>(null);
  const [retomando, setRetomando] = useState(false);

  const carregar = useCallback(async (): Promise<void> => {
    try { const e = await api.telegram.estado(); setEstado(e); setErro(null); setPasso((p) => p ?? passoSugerido(e)); } catch (x) { setErro(x instanceof Error ? x.message : "Não foi possível ler o estado do Telegram."); }
  }, [api]);
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { const d = [api.assinarTelegram(() => void carregar()), api.assinarCanal(() => void carregar())]; return () => d.forEach((f) => f()); }, [api, carregar]);

  if (erro !== null) return <section className="alertas-cartao" aria-label="Telegram"><h2>Telegram</h2><div role="alert" className="alertas-erro">{erro} <button type="button" className="botao alertas-mini" onClick={() => void carregar()}>Tentar de novo</button></div></section>;
  if (estado === null) return <section className="alertas-cartao" aria-label="Telegram" aria-busy="true"><h2>Telegram</h2><p className="alertas-nota" role="status">Lendo o estado do Telegram…</p></section>;
  const feitos = passosConcluidos(estado);
  const atual = passo ?? passoSugerido(estado);
  const p = estado.poller;
  const retomar = async (): Promise<void> => { setRetomando(true); try { setEstado(await api.telegram.retomar()); } catch { setErro("Não foi possível retomar."); } finally { setRetomando(false); } };
  return (
    <section className="alertas-cartao alertas-telegram" aria-label="Telegram">
      <div className="alertas-bloco-cab">
        <h2>Telegram{estado.bot !== null ? ` · @${estado.bot.username}` : ""}</h2>
        <button type="button" className="botao botao-perigo alertas-mini" onClick={pedirPanicoTelegram}>Parar tudo</button>
      </div>
      <p className="alertas-estado" role="status">
        <span aria-hidden="true">{p.estado === "ativo" ? "●" : p.estado === "conflito" || p.estado === "erro" || p.estado === "token_possivelmente_comprometido" ? "▲" : "○"}</span> Estado do canal: {estado.canal.estado}; recebimento: {p.estado}
        {p.ultimo_poll_em !== null ? ` (última consulta ${new Date(p.ultimo_poll_em).toLocaleTimeString("pt-BR")})` : ""}
      </p>
      {p.estado === "conflito" || p.estado === "token_possivelmente_comprometido" ? (
        <div role="alert" className="alertas-erro">
          <p>{p.estado === "conflito" ? "Outro programa está lendo este bot: pode ser outra instância sua ou alguém com o token." : "Há um webhook que não foi criado por este app: o token pode ter vazado. Rotacione o token no BotFather."}</p>
          <button type="button" className="botao alertas-mini" disabled={retomando} onClick={() => void retomar()}>Retomar</button>
        </div>
      ) : null}
      <ol className="alertas-passos" aria-label="Passos de configuração">
        {PASSOS.map((n) => (
          <li key={n}><button type="button" aria-current={n === atual ? "step" : undefined} data-feito={feitos.has(n) || undefined} onClick={() => setPasso(n)}><span aria-hidden="true">{feitos.has(n) ? "✓" : n}</span> {n}. {ROTULOS_PASSOS[n]}{feitos.has(n) ? " (feito)" : ""}</button></li>
        ))}
      </ol>
      <div className="alertas-passo-corpo" role="group" aria-label={`Passo ${atual}: ${ROTULOS_PASSOS[atual]}`}>
        {atual === 1 ? (
          <div className="alertas-passo">
            <ol className="alertas-botfather">{estado.passos_botfather.map((t) => <li key={t}>{t}</li>)}</ol>
            <button type="button" className="botao botao-primario alertas-mini" onClick={() => setPasso(2)}>Já criei o bot, continuar</button>
          </div>
        ) : null}
        {atual === 2 ? <PassoToken api={api} estado={estado} aoMudou={() => void carregar()} /> : null}
        {atual === 3 ? <PassoConsentimento api={api} estado={estado} aoMudou={() => void carregar()} aoAvancar={() => setPasso(4)} /> : null}
        {atual === 4 ? <PassoPareamento api={api} estado={estado} aoMudou={() => void carregar()} agora={agora} /> : null}
        {atual === 5 ? <PassoBot api={api} estado={estado} workspaces={workspaces} aoMudou={() => void carregar()} /> : null}
      </div>
      {estado.contadores.planos_pendentes > 0 ? <p className="alertas-nota" role="status">{estado.contadores.planos_pendentes} plano(s) pendente(s) de aprovação.</p> : null}
    </section>
  );
}

