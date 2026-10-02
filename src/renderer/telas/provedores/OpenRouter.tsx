import "./openrouter.css";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { ContaOpenRouterEstado, EstadoOpenRouter, Faixa, ModeloOpenRouter, ResultadoAtualizarModelos, ResultadoTesteOpenRouter } from "../../../compartilhado/harness";
import type { ApiAde } from "../../../compartilhado/ipc";
import { ade } from "../../ade";
import { Badge } from "../../componentes/Badge";
import { Dialogo } from "../../componentes/Dialogo";
import { VirtualLista } from "../../componentes/VirtualLista";
import { ehCanalAusente, useCarga } from "../../estado/carga";
import { aoPedirOpenRouter, type AlvoOpenRouter } from "../../estado/openrouter-acoes";
import {
  FAIXAS_OPENROUTER, ROTULO_FAIXA, TEXTO_CONSENTIMENTO_OPENROUTER, VERSAO_TEXTO_CONSENTIMENTO, aceitarSugestao, cliPreferida, explicarCli, faixaSugerida, formatarMtok, formatarUsd,
  mascararChave, mensagemDoErro, ordemSugerida, validarChave,
} from "./openrouter-logica";

export type ApiOpenRouter = ApiAde["openrouter"];
export const ALTURA_MODELO = 36;
const LIMITE_PAGINA = 200;

export interface PropsOpenRouter { api?: ApiOpenRouter | undefined }

function Confirmar({ titulo, texto, rotulo, aoConfirmar, aoFechar }: { titulo: string; texto: string; rotulo: string; aoConfirmar: () => void; aoFechar: () => void }) {
  return (
    <Dialogo titulo={titulo} aoFechar={aoFechar}>
      <div className="dialogo-corpo"><p>{texto}</p></div>
      <div className="dialogo-acoes">
        <button type="button" className="botao" onClick={aoFechar}>Cancelar</button>
        <button type="button" className="botao botao-primario" data-foco-inicial onClick={() => { aoFechar(); aoConfirmar(); }}>{rotulo}</button>
      </div>
    </Dialogo>
  );
}

function Consentimento({ aoAceitar, aoFechar }: { aoAceitar: () => void; aoFechar: () => void }) {
  return (
    <Dialogo titulo="Ativar OpenRouter" aoFechar={aoFechar}>
      <div className="dialogo-corpo">
        <p>{TEXTO_CONSENTIMENTO_OPENROUTER}</p>
      </div>
      <div className="dialogo-acoes">
        <button type="button" className="botao" data-foco-inicial onClick={aoFechar}>Cancelar</button>
        <button type="button" className="botao botao-primario" onClick={aoAceitar}>Entendi, ativar</button>
      </div>
    </Dialogo>
  );
}

/** Formulário da chave: o valor vive só neste estado (nunca em store, storage ou props) e é zerado ao salvar. */
function FormChave({ api, aoSalvar }: { api: ApiOpenRouter; aoSalvar: () => void }) {
  const [rotulo, setRotulo] = useState("");
  const [chave, setChave] = useState("");
  const [tentou, setTentou] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [teste, setTeste] = useState<ResultadoTesteOpenRouter | null>(null);
  const problemaChave = validarChave(chave);
  const problemaRotulo = rotulo.trim() === "" ? "Dê um rótulo à conta (por exemplo, pessoal)." : null;

  const testar = async () => {
    setTentou(true); setTeste(null);
    if (problemaChave !== null) return;
    setOcupado(true); setErro(null);
    try { setTeste(await api.testar({ chave: chave.trim() })); }
    catch (e) { setErro(mensagemDoErro(e)); }
    finally { setOcupado(false); }
  };
  const salvar = async () => {
    setTentou(true); setTeste(null);
    if (problemaChave !== null || problemaRotulo !== null) return;
    const valor = chave.trim();
    setTentou(false);
    setChave(""); // descartada do estado antes mesmo da resposta
    setOcupado(true); setErro(null);
    try { await api.gravarChave(rotulo.trim(), valor); setRotulo(""); aoSalvar(); }
    catch (e) { setErro(mensagemDoErro(e)); }
    finally { setOcupado(false); }
  };
  return (
    <div role="group" aria-label="Adicionar chave">
      <div className="or-barra">
        <input type="text" aria-label="Rótulo da conta OpenRouter" placeholder="Rótulo" maxLength={60} value={rotulo} aria-invalid={tentou && problemaRotulo !== null} onChange={(e) => setRotulo(e.target.value)} />
        <input type="password" aria-label="Chave do OpenRouter" placeholder="sk-or-…" autoComplete="off" spellCheck={false} value={chave} aria-invalid={tentou && problemaChave !== null} onChange={(e) => setChave(e.target.value)} />
        <button type="button" className="botao-mini" disabled={ocupado} onClick={() => void testar()}>Testar sem salvar</button>
        <button type="button" className="botao-mini" disabled={ocupado} onClick={() => void salvar()}>Salvar no cofre</button>
      </div>
      {tentou && problemaChave !== null ? <p role="alert" className="or-erro">{problemaChave}</p> : null}
      {tentou && problemaChave === null && problemaRotulo !== null ? <p role="alert" className="or-erro">{problemaRotulo}</p> : null}
      {erro !== null ? <p role="alert" className="or-erro">{erro}</p> : null}
      {teste !== null ? <p role="status" className="or-ok">{textoTeste(teste)}</p> : null}
      <p className="or-nota">A chave vai direto ao cofre do sistema e nunca volta para esta tela; só os últimos 4 caracteres aparecem. “Testar sem salvar” usa a chave uma vez e não guarda nada.</p>
    </div>
  );
}

export function textoTeste(t: ResultadoTesteOpenRouter): string {
  if (!t.ok) return `Chave recusada${t.motivo !== undefined ? `: ${t.motivo}` : "."}`;
  const partes = [`Chave válida (${t.tipo === "pago" ? "conta paga" : t.tipo === "gratuito" ? "conta gratuita" : "tipo desconhecido"})`];
  if (t.limite_usd !== null) partes.push(`limite ${formatarUsd(t.limite_usd)}`);
  if (t.saldo_usd !== null) partes.push(`saldo ${formatarUsd(t.saldo_usd)}`);
  if (t.latencia_ms !== null) partes.push(`${t.latencia_ms} ms`);
  return `${partes.join(" · ")}.`;
}

function LinhaConta({ conta, api, aoMudar, aoErro }: { conta: ContaOpenRouterEstado; api: ApiOpenRouter; aoMudar: (e?: EstadoOpenRouter) => void; aoErro: (m: string) => void }) {
  const [ocupado, setOcupado] = useState(false);
  const [teste, setTeste] = useState<ResultadoTesteOpenRouter | null>(null);
  const [apagar, setApagar] = useState(false);
  const rodar = async (f: () => Promise<void>) => { setOcupado(true); try { await f(); } catch (e) { aoErro(mensagemDoErro(e)); } finally { setOcupado(false); } };
  return (
    <li className="or-conta">
      <span className="or-mascara" aria-label={`Chave ${conta.rotulo} terminada em ${conta.ultimos4}`}>{mascararChave(conta.ultimos4)}</span>
      <strong>{conta.rotulo}</strong>
      <Badge tom={conta.tipo === "pago" ? "sucesso" : "neutro"}>{conta.tipo === "pago" ? "Paga" : conta.tipo === "gratuito" ? "Gratuita" : "Tipo desconhecido"}</Badge>
      <span>saldo {formatarUsd(conta.saldo_usd)}</span>
      <span>limite {conta.limite_usd === null ? "sem limite" : formatarUsd(conta.limite_usd)}</span>
      <span>usado {formatarUsd(conta.usado_usd)}</span>
      <button type="button" className="botao-mini" disabled={ocupado} onClick={() => void rodar(async () => { setTeste(await api.testar({ conta_id: conta.conta_id })); })}>Testar</button>
      <button type="button" className="botao-mini" disabled={ocupado} onClick={() => void rodar(async () => { setTeste(null); aoMudar(await api.atualizarSaldo(conta.conta_id)); })}>Atualizar saldo</button>
      <button type="button" className="botao-mini" disabled={ocupado} onClick={() => setApagar(true)}>Apagar</button>
      {teste !== null ? <span role="status">{textoTeste(teste)}</span> : null}
      {apagar ? <Confirmar titulo="Apagar chave" texto={`A chave da conta “${conta.rotulo}” será removida do cofre. Panes OpenRouter que usam essa conta deixam de funcionar.`} rotulo="Apagar" aoFechar={() => setApagar(false)} aoConfirmar={() => void rodar(async () => { await api.apagarChave(conta.conta_id); aoMudar(); })} /> : null}
    </li>
  );
}

interface PropsLinhaModelo { m: ModeloOpenRouter; todos: readonly ModeloOpenRouter[]; aoGravar: (m: ModeloOpenRouter, mudanca: Partial<Pick<ModeloOpenRouter, "habilitado" | "faixa" | "ordem" | "tipos_permitidos">>) => void; aoAceitar: (m: ModeloOpenRouter) => void }
const LinhaModelo = memo(function LinhaModelo({ m, todos, aoGravar, aoAceitar }: PropsLinhaModelo) {
  const sug = faixaSugerida(m);
  const ord = ordemSugerida(m, todos);
  const jaAplicada = sug !== null && m.faixa === sug && m.ordem === ord;
  const tipos = m.tipos_permitidos.join(", ");
  return (
    <div className="or-linha">
      <input type="checkbox" aria-label={`Habilitar ${m.nome}`} checked={m.habilitado} onChange={(e) => aoGravar(m, { habilitado: e.target.checked })} />
      <span title={m.id}>{m.nome}{m.nome !== m.id ? <small> {m.id}</small> : null}</span>
      <span>{m.contexto === null ? "—" : `${Math.round(m.contexto / 1000)}k`}</span>
      <span title="entrada / saída, por milhão de tokens">{m.preco_entrada_por_mtok === null && m.preco_saida_por_mtok === null ? "sem preço" : `${formatarMtok(m.preco_entrada_por_mtok)} / ${formatarMtok(m.preco_saida_por_mtok)}`}</span>
      <select aria-label={`Faixa de ${m.nome}`} value={m.faixa ?? ""} onChange={(e) => aoGravar(m, { faixa: e.target.value === "" ? null : (e.target.value as Faixa) })}>
        <option value="">Sem faixa</option>
        {FAIXAS_OPENROUTER.map((f) => <option key={f} value={f}>{ROTULO_FAIXA[f]}</option>)}
      </select>
      <input type="number" min={0} max={9999} aria-label={`Ordem de ${m.nome}`} defaultValue={m.ordem} key={`o${m.id}${m.ordem}`}
        onBlur={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 0 && n !== m.ordem) aoGravar(m, { ordem: n }); }} />
      <input type="text" aria-label={`Tipos de tarefa de ${m.nome}`} placeholder="todos os tipos" defaultValue={tipos} key={`t${m.id}${tipos}`}
        onBlur={(e) => { const novos = e.target.value.split(",").map((t) => t.trim()).filter((t) => t !== ""); if (novos.join(", ") !== tipos) aoGravar(m, { tipos_permitidos: novos }); }} />
      {sug !== null && !jaAplicada
        ? <button type="button" className="botao-mini" title={`Sugestão por preço de saída: ${ROTULO_FAIXA[sug]}, ordem ${ord ?? "?"}`} onClick={() => aoAceitar(m)}>Aceitar {ROTULO_FAIXA[sug]} #{ord}</button>
        : <span className="or-nota">{sug === null ? "sem sugestão" : "sugestão aplicada"}</span>}
    </div>
  );
});

type EstadoModelos = { estado: "carregando" | "ok" | "indisponivel" | "erro"; itens: ModeloOpenRouter[]; total: number; proximo: string | null; mensagem?: string };

function Modelos({ api, estado, aoMudar }: { api: ApiOpenRouter; estado: EstadoOpenRouter; aoMudar: (e?: EstadoOpenRouter) => void }) {
  const [busca, setBusca] = useState("");
  const [buscaAtiva, setBuscaAtiva] = useState("");
  const [soHab, setSoHab] = useState(false);
  const [n, setN] = useState(0);
  const [modelos, setModelos] = useState<EstadoModelos>({ estado: "carregando", itens: [], total: 0, proximo: null });
  const [atualizando, setAtualizando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoAtualizarModelos | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const geracao = useRef(0);

  useEffect(() => { const t = setTimeout(() => setBuscaAtiva(busca.trim()), 200); return () => clearTimeout(t); }, [busca]);
  useEffect(() => {
    const g = ++geracao.current;
    setModelos((a) => ({ ...a, estado: "carregando" }));
    api.listarModelos({ ...(buscaAtiva !== "" ? { busca: buscaAtiva } : {}), ...(soHab ? { so_habilitados: true } : {}), limite: LIMITE_PAGINA }).then(
      (p) => { if (g === geracao.current) setModelos({ estado: "ok", itens: p.itens, total: p.total, proximo: p.proximo }); },
      (e) => { if (g === geracao.current) setModelos({ estado: ehCanalAusente(e) ? "indisponivel" : "erro", itens: [], total: 0, proximo: null, mensagem: mensagemDoErro(e) }); },
    );
  }, [api, buscaAtiva, soHab, n]);

  const maisPagina = async () => {
    if (modelos.proximo === null) return;
    try {
      const p = await api.listarModelos({ ...(buscaAtiva !== "" ? { busca: buscaAtiva } : {}), ...(soHab ? { so_habilitados: true } : {}), cursor: modelos.proximo, limite: LIMITE_PAGINA });
      setModelos((a) => ({ ...a, itens: [...a.itens, ...p.itens], proximo: p.proximo, total: p.total }));
    } catch (e) { setErro(mensagemDoErro(e)); }
  };
  const atualizar = async () => {
    setAtualizando(true); setErro(null); setResultado(null);
    try { setResultado(await api.atualizarModelos()); setN((x) => x + 1); aoMudar(); }
    catch (e) { setErro(mensagemDoErro(e)); }
    finally { setAtualizando(false); }
  };
  const gravar = useCallback(async (m: ModeloOpenRouter, mudanca: Partial<ModeloOpenRouter>) => {
    try {
      const salvo = await api.gravarModelo({ id: m.id, habilitado: m.habilitado, faixa: m.faixa, tipos_permitidos: m.tipos_permitidos, ordem: m.ordem, ...mudanca });
      setModelos((a) => ({ ...a, itens: a.itens.map((x) => (x.id === salvo.id ? salvo : x)) }));
      setErro(null);
      if (mudanca.habilitado !== undefined) aoMudar();
    } catch (e) { setErro(mensagemDoErro(e)); }
  }, [api, aoMudar]);
  const itensRef = useRef<readonly ModeloOpenRouter[]>([]);
  itensRef.current = modelos.itens;
  const aceitar = useCallback((m: ModeloOpenRouter) => { const p = aceitarSugestao(m, itensRef.current); if (p !== null) void gravar(m, p); }, [gravar]);

  return (
    <div role="group" aria-label="Modelos do OpenRouter">
      <div className="or-barra">
        <strong>Modelos</strong>
        <input type="search" aria-label="Buscar modelo" placeholder="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <label><input type="checkbox" checked={soHab} onChange={(e) => setSoHab(e.target.checked)} /> só habilitados</label>
        <button type="button" className="botao-mini" disabled={atualizando || estado.contas.length === 0} title={estado.contas.length === 0 ? "Grave uma chave para listar os modelos" : "Consulta o OpenRouter agora (só por clique)"} onClick={() => void atualizar()}>{atualizando ? "Atualizando…" : "Atualizar lista"}</button>
        <span className="or-nota">{estado.modelos.total} modelos · {estado.modelos.habilitados} habilitados{estado.modelos.atualizados_em !== null ? ` · lista de ${estado.modelos.atualizados_em.slice(0, 16).replace("T", " ")}` : " · lista nunca atualizada"}</span>
      </div>
      {resultado !== null ? <p role="status" className="or-ok">{resultado.novos} novos, {resultado.removidos} removidos ({resultado.total} no total).</p> : null}
      {erro !== null ? <p role="alert" className="or-erro">{erro}</p> : null}
      {modelos.estado === "indisponivel" ? <p role="status" className="or-nota">Lista de modelos indisponível neste build.</p>
        : modelos.estado === "erro" ? <p role="alert" className="or-erro">Não foi possível ler os modelos: {modelos.mensagem}</p>
        : modelos.estado === "carregando" && modelos.itens.length === 0 ? <p className="or-nota" aria-busy="true">Carregando modelos…</p>
        : modelos.itens.length === 0 ? (
          <p role="status" className="or-nota">{buscaAtiva !== "" || soHab ? "Nenhum modelo encontrado com esse filtro." : estado.modelos.total === 0 ? "Nenhum modelo ainda. Grave uma chave e clique em “Atualizar lista” para buscar os modelos e preços do OpenRouter." : "Nenhum modelo para mostrar."}</p>
        ) : (
          <>
            <div className="or-linha or-cab" aria-hidden="true"><span /><span>modelo</span><span>contexto</span><span>US$/Mtok entrada / saída</span><span>faixa</span><span>ordem</span><span>tipos</span><span>sugestão</span></div>
            <VirtualLista itens={modelos.itens} alturaItem={ALTURA_MODELO} rotulo="Modelos do OpenRouter" className="or-lista" chave={(m) => m.id}
              renderItem={(m) => <LinhaModelo m={m} todos={modelos.itens} aoGravar={(x, c) => void gravar(x, c)} aoAceitar={aceitar} />} />
            <p className="or-nota">{modelos.itens.length} de {modelos.total} modelos{modelos.proximo !== null ? <> · <button type="button" className="botao-mini" onClick={() => void maisPagina()}>Carregar mais</button></> : null}. A faixa e a ordem sugeridas vêm do preço de saída; só valem depois de você aceitar.</p>
          </>
        )}
    </div>
  );
}

function Clis({ clis }: { clis: EstadoOpenRouter["clis"] }) {
  const pref = cliPreferida(clis);
  return (
    <div role="group" aria-label="CLIs compatíveis">
      <div className="or-barra"><strong>CLIs compatíveis</strong><span className="or-nota">{pref !== null ? `CLI preferida: ${pref}` : "Nenhuma CLI pronta: instale uma com adaptador verificado."}</span></div>
      {clis.length === 0 ? <p className="or-nota">Nenhuma CLI compatível conhecida.</p> : (
        <ul className="or-clis">
          {clis.map((c) => {
            const e = explicarCli(c);
            return (
              <li key={c.cli}>
                <strong>{c.cli}</strong>
                <Badge tom={e.tom === "ok" ? "sucesso" : e.tom === "aviso" ? "aviso" : "neutro"}>{e.texto}</Badge>
                <Badge>{c.instalada ? "instalada" : "não instalada"}</Badge>
                <span className="or-nota">{e.detalhe}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Seção OpenRouter da tela Provedores. Nenhuma ação de rede existe antes do consentimento; chave só no cofre. */
export function SecaoOpenRouter({ api = ade()?.openrouter }: PropsOpenRouter) {
  const carga = useCarga<EstadoOpenRouter>(api?.estado === undefined ? undefined : () => api.estado(), "openrouter");
  const [sobre, setSobre] = useState<EstadoOpenRouter | null>(null);
  const [consentir, setConsentir] = useState(false);
  const [revogar, setRevogar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const estado = sobre ?? carga.dados;
  const raiz = useRef<HTMLElement>(null);
  const [alvo, setAlvo] = useState<AlvoOpenRouter | null>(null);
  useEffect(() => aoPedirOpenRouter(setAlvo), []);
  // pedido da paleta: rola até a seção e foca o controle certo assim que o estado existir
  useEffect(() => {
    if (alvo === null || estado === null) return;
    const el = raiz.current;
    el?.scrollIntoView?.({ block: "start" });
    const seletor = alvo === "chave" ? 'input[aria-label="Chave do OpenRouter"]' : alvo === "modelos" ? 'input[aria-label="Buscar modelo"]' : "button";
    (el?.querySelector<HTMLElement>(seletor) ?? el?.querySelector<HTMLElement>("button"))?.focus();
    setAlvo(null);
  }, [alvo, estado]);
  const recarregar = carga.recarregar;
  const aoMudar = useCallback((e?: EstadoOpenRouter) => { if (e !== undefined) setSobre(e); else { setSobre(null); recarregar(); } }, [recarregar]);

  const rodar = async (f: () => Promise<EstadoOpenRouter>) => { try { setErro(null); setSobre(await f()); } catch (e) { setErro(mensagemDoErro(e)); } };

  return (
    <section ref={raiz} className="or-secao" aria-label="OpenRouter" id="openrouter">
      <div className="or-barra">
        <strong>OpenRouter</strong>
        {estado !== null ? <Badge tom={estado.habilitado ? "sucesso" : "neutro"}>{estado.habilitado ? "Ativo" : "Desligado"}</Badge> : null}
        {estado !== null && api !== undefined ? (
          estado.habilitado
            ? <button type="button" className="botao-mini" onClick={() => setRevogar(true)}>Revogar consentimento</button>
            : <button type="button" className="botao-mini" onClick={() => setConsentir(true)}>Ativar OpenRouter</button>
        ) : null}
      </div>
      {erro !== null ? <p role="alert" className="or-erro">{erro}</p> : null}
      {api === undefined || carga.estado === "indisponivel" ? <p role="status" className="or-nota">OpenRouter indisponível: esta janela não está ligada ao app ou este build ainda não expõe o OpenRouter.</p>
        : carga.estado === "erro" && estado === null ? <p role="alert" className="or-erro">Não foi possível ler o estado do OpenRouter: {mensagemDoErro(new Error(carga.mensagem))} <button type="button" className="botao-mini" onClick={recarregar}>Tentar de novo</button></p>
        : estado === null ? <p className="or-nota" aria-busy="true">Carregando OpenRouter…</p>
        : !estado.habilitado ? (
          <p className="or-nota">Desligado: nenhuma conexão é feita. Ao ativar, você usa o catálogo inteiro do OpenRouter com CLIs compatíveis (OpenCode, Aider e outras). {TEXTO_CONSENTIMENTO_OPENROUTER}</p>
        ) : (
          <>
            {estado.contas.length === 0 ? <p className="or-nota">Ativo, sem conta: adicione uma chave abaixo para listar modelos e lançar Panes.</p> : (
              <ul className="prov-lista-contas or-clis" aria-label="Contas OpenRouter">
                {estado.contas.map((c) => <LinhaConta key={c.conta_id} conta={c} api={api} aoMudar={aoMudar} aoErro={setErro} />)}
              </ul>
            )}
            <FormChave api={api} aoSalvar={() => aoMudar()} />
            <Modelos api={api} estado={estado} aoMudar={aoMudar} />
            <Clis clis={estado.clis} />
            <p className="or-nota">Proxy local: {estado.proxy.ativo ? "ativo (sobe só com um Pane OpenRouter e desliga após 5 min sem uso)" : "desligado (sobe só com um Pane OpenRouter)"}.</p>
          </>
        )}
      {consentir && api !== undefined ? <Consentimento aoFechar={() => setConsentir(false)} aoAceitar={() => { setConsentir(false); void rodar(() => api.consentir(VERSAO_TEXTO_CONSENTIMENTO)); }} /> : null}
      {revogar && api !== undefined ? <Confirmar titulo="Revogar OpenRouter" texto="O app para de enviar qualquer coisa ao OpenRouter e os Panes OpenRouter abertos perdem o acesso. As chaves continuam no cofre." rotulo="Revogar" aoFechar={() => setRevogar(false)} aoConfirmar={() => void rodar(() => api.revogar())} /> : null}
    </section>
  );
}

export default SecaoOpenRouter;
