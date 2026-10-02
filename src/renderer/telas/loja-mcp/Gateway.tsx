// Painel do Gateway MCP (Fase 7C) dentro da Loja de MCPs. Opt-in por workspace (padrão DESLIGADO): ligado, os Panes falam com UM endpoint
// loopback que agrega os servidores habilitados, com filtro por papel/ferramenta, limite de chamadas e auditoria. A auditoria mostra só
// metadados (nome, decisão, tamanhos): nunca argumentos nem resultado. Nada aqui recebe segredo.
import { useEffect, useMemo, useState } from "react";
import { MODOS_SUPERFICIE_GATEWAY, PAPEIS_GATEWAY, type DecisaoAuditoriaGateway, type EntradaAuditoriaGateway, type ModoSuperficieGateway } from "../../../compartilhado/catalogo";
import { Dialogo } from "../../componentes/Dialogo";
import { VirtualLista } from "../../componentes/VirtualLista";
import { storeGateway, useGateway, type StoreGateway } from "../../estado/gateway";

export const ROTULO_MODO: Readonly<Record<ModoSuperficieGateway, string>> = {
  completo: "Completo: todas as ferramentas permitidas",
  reduzido: "Reduzido: descrições curtas e teto de ferramentas",
  busca: "Busca: só procurar e chamar sob demanda",
};
export const ROTULO_DECISAO: Readonly<Record<DecisaoAuditoriaGateway, string>> = {
  permitida: "permitida", negada_filtro: "negada (filtro)", negada_limite: "negada (limite)", negada_servidor: "negada (servidor)", erro: "erro",
};
export const TEXTO_OPT_IN = "Desligado por padrão. Ligado, as CLIs dos Panes deste workspace falam com um único endpoint local (loopback, token por Pane) em vez de um servidor por Pane. Nada sai da máquina.";

/** Hora local curta; entrada inválida vira "—" (nunca lança). */
export const horaCurta = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString("pt-BR", { hour12: false }); };
export const paneCurto = (id: string): string => (id.length > 12 ? `${id.slice(0, 12)}…` : id);
export const tamanho = (b: number | null): string => (b === null ? "—" : b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} KB`);

interface Props {
  store?: StoreGateway;
  workspaceId: string | null;
  servidores: ReadonlyArray<{ id: string; nome: string }>;
  aoFechar: () => void;
}

export function DialogoGateway({ store = storeGateway, workspaceId, servidores, aoFechar }: Props) {
  const est = useGateway(store);
  const [ativo, setAtivo] = useState(false);
  const [modo, setModo] = useState<ModoSuperficieGateway>("reduzido");
  const [max, setMax] = useState(40);
  const [limite, setLimite] = useState(60);
  const [ocioso, setOcioso] = useState(300);
  const [msg, setMsg] = useState<string | null>(null);
  const [revogar, setRevogar] = useState<string | null>(null);

  useEffect(() => { void store.iniciar(); return () => store.parar(); }, [store]);
  useEffect(() => {
    const c = est.config;
    if (c === null) return;
    setAtivo(c.ativo); setModo(c.modo_superficie); setMax(c.max_ferramentas); setLimite(c.limite_por_min); setOcioso(c.ocioso_s);
  }, [est.config]);

  const panes = useMemo(() => [...new Set(est.auditoria.map((a) => a.pane_id))], [est.auditoria]);
  const faixaOk = max >= 1 && max <= 200 && limite >= 1 && limite <= 600 && ocioso >= 30 && ocioso <= 3600;

  const salvar = async () => {
    setMsg(null);
    const ok = await store.gravarConfig({ ativo, modo_superficie: modo, max_ferramentas: max, limite_por_min: limite, ocioso_s: ocioso });
    setMsg(ok ? "Configuração gravada." : null);
  };

  if (!est.disponivel) {
    return <Dialogo titulo="Gateway MCP" aoFechar={aoFechar}><p role="status">O Gateway precisa do aplicativo desktop.</p><div className="dialogo-acoes"><button type="button" className="botao" onClick={aoFechar}>Fechar</button></div></Dialogo>;
  }

  return (
    <Dialogo titulo="Gateway MCP" aoFechar={aoFechar} largura={760}>
      <p className="lm-nota">{TEXTO_OPT_IN}</p>
      {est.erro !== null ? <p className="erro-caixa" role="alert">{est.erro} <button type="button" className="botao lm-mini" onClick={() => void store.carregar()}>Tentar de novo</button></p> : null}
      {est.carregando && est.estado === null ? <p role="status" aria-busy="true">Carregando…</p> : null}
      {est.estado !== null ? (
        <p className="lm-nota" role="status" data-testid="estado-gateway">
          {est.estado.disponivel ? "No ar" : "Fora do ar"} · {est.estado.panes_ativos} Pane(s) · {est.estado.servidores_conectados} servidor(es) conectado(s) · {est.estado.chamadas} chamadas · {est.estado.bloqueadas} bloqueadas · {est.estado.limitadas} limitadas
        </p>
      ) : null}

      {workspaceId === null ? <p className="aviso-caixa" role="status">Abra um projeto para configurar o Gateway deste workspace.</p> : (
        <fieldset className="lm-gw-form">
          <legend>Configuração do workspace</legend>
          <label className="lm-gw-check"><input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Usar o Gateway neste workspace</label>
          <label className="lm-gw-campo">Superfície de ferramentas
            <select value={modo} onChange={(e) => setModo(e.target.value as ModoSuperficieGateway)}>{MODOS_SUPERFICIE_GATEWAY.map((m) => <option key={m} value={m}>{ROTULO_MODO[m]}</option>)}</select>
          </label>
          <label className="lm-gw-campo">Máximo de ferramentas (1–200)
            <input type="number" min={1} max={200} value={max} onChange={(e) => setMax(Number(e.target.value))} />
          </label>
          <label className="lm-gw-campo">Chamadas por minuto por Pane (1–600)
            <input type="number" min={1} max={600} value={limite} onChange={(e) => setLimite(Number(e.target.value))} />
          </label>
          <label className="lm-gw-campo">Encerrar servidor ocioso após (30–3600 s)
            <input type="number" min={30} max={3600} value={ocioso} onChange={(e) => setOcioso(Number(e.target.value))} />
          </label>
          <div className="lm-acoes"><button type="button" className="botao botao-primario lm-btn" disabled={!faixaOk} onClick={() => void salvar()}>Gravar configuração</button>{!faixaOk ? <span className="lm-nota" role="status">Valores fora da faixa.</span> : null}</div>
          {msg !== null ? <p className="lm-ok" role="status">{msg}</p> : null}
        </fieldset>
      )}

      {workspaceId !== null ? (
        <section className="lm-secao" aria-label="Filtro de ferramentas">
          <h3>Filtro de ferramentas por papel</h3>
          <div className="lm-gw-linha">
            <label className="lm-gw-campo">Servidor
              <select value={est.servidor ?? ""} onChange={(e) => void store.escolherServidor(e.target.value === "" ? null : e.target.value)}>
                <option value="">Escolha…</option>{servidores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </select>
            </label>
            <label className="lm-gw-campo">Papel
              <select value={est.papel} onChange={(e) => void store.escolherPapel(e.target.value as (typeof PAPEIS_GATEWAY)[number])}>{PAPEIS_GATEWAY.map((p) => <option key={p} value={p}>{p}</option>)}</select>
            </label>
          </div>
          {est.servidor === null ? <p className="lm-nota">Escolha um servidor instalado para ver as ferramentas.</p>
            : est.carregandoFerramentas ? <p role="status" aria-busy="true">Carregando ferramentas…</p>
            : est.ferramentas.length === 0 ? <p className="lm-nota" role="status">Nenhuma ferramenta conhecida. Teste o servidor na Loja para listá-las.</p> : (
              <div className="lm-gw-lista">
                <VirtualLista itens={est.ferramentas} alturaItem={36} alturaPadrao={168} rotulo="Ferramentas do servidor" chave={(f) => f.nome}
                  renderItem={(f) => (
                    <label className="lm-gw-ferr" title={f.descricao ?? f.nome}>
                      <input type="checkbox" checked={f.habilitada} onChange={(e) => void store.definirFiltro(f.nome, e.target.checked)} />
                      <code>{f.nome}</code>
                      <span className="lst-selo" data-tom={f.risco === "escrita" ? "aviso" : undefined}>{f.risco}</span>
                      {f.explicita ? <span className="lst-selo">regra</span> : null}
                    </label>
                  )} />
              </div>
            )}
        </section>
      ) : null}

      <section className="lm-secao" aria-label="Auditoria">
        <h3>Auditoria (só metadados)</h3>
        {est.auditoria.length === 0 ? <p className="lm-nota" role="status">Nenhuma chamada registrada.</p> : (
          <div className="lm-gw-lista">
            <VirtualLista itens={est.auditoria} alturaItem={34} alturaPadrao={176} rotulo="Chamadas auditadas" chave={(a: EntradaAuditoriaGateway) => a.id}
              renderItem={(a) => (
                <div className="lm-gw-aud" data-decisao={a.decisao}>
                  <span>{horaCurta(a.em)}</span><span title={a.pane_id}>{paneCurto(a.pane_id)}</span><span>{a.papel}</span>
                  <span className="lm-gw-ferr-nome">{a.servidor_id ?? "—"}{a.ferramenta !== null ? `/${a.ferramenta}` : ""}</span>
                  <span>{ROTULO_DECISAO[a.decisao]}</span><span>{a.duracao_ms === null ? "—" : `${a.duracao_ms} ms`}</span><span>{tamanho(a.bytes_entrada)}/{tamanho(a.bytes_saida)}</span>
                </div>
              )} />
          </div>
        )}
        {panes.length > 0 ? (
          <div className="lm-gw-linha">
            <label className="lm-gw-campo">Revogar acesso de um Pane
              <select value={revogar ?? ""} onChange={(e) => setRevogar(e.target.value === "" ? null : e.target.value)}>
                <option value="">Escolha…</option>{panes.map((p) => <option key={p} value={p}>{paneCurto(p)}</option>)}
              </select>
            </label>
            <button type="button" className="botao lm-btn" disabled={revogar === null} onClick={() => { if (revogar !== null) { void store.revogarPane(revogar); setRevogar(null); setMsg("Acesso do Pane revogado: o token anterior deixa de valer."); } }}>Revogar</button>
          </div>
        ) : null}
      </section>
      <div className="dialogo-acoes"><button type="button" className="botao" onClick={aoFechar}>Fechar</button></div>
    </Dialogo>
  );
}
