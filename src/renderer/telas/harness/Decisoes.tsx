import { useState } from "react";
import type { ConfigDecisor, ConfigDecisorEntrada, Decisao, ModoDecisor, PaginaDecisoes } from "../../../compartilhado/harness";
import { Dialogo } from "../../componentes/Dialogo";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { VirtualLista } from "../../componentes/VirtualLista";
import { useCarga } from "../../estado/carga";
import { formatarHora, formatarUsd } from "../../estado/limites-formato";
import type { ApiCofre, PropsAba } from "./tipos";
import { hostDe, validarHttps } from "./validar";
import { PRODUTO } from "../../../nucleo/produto";

export const ALTURA_DECISAO = 40;
export const NOME_CHAVE_DECISOR = "DECISOR_CHAVE";
const ROTULO_MODO: Record<ModoDecisor, string> = { jev_direto: "JEV direto", jev_openrouter: "JEV via OpenRouter", openai_compat: "Endpoint compatível" };
const HOST_OPENROUTER = "openrouter.ai";

/** O que sai da máquina, em texto claro, para o host escolhido (aparece no consentimento). */
export function textoSaida(host: string, usos: ConfigDecisor["usar_para"]): string {
  const quando = [usos.task_type ? "classificar o tipo de tarefa" : "", usos.modelo_esforco ? "escolher modelo e esforço" : "", usos.intencao ? "entender a intenção do pedido" : ""].filter(Boolean).join(", ") || "nenhum uso marcado";
  return `Para ${quando}, o ${PRODUTO.nome} envia por HTTPS a ${host || "(host ainda não informado)"} um resumo de até 500 caracteres da sua tarefa, com caminhos e segredos já removidos. Nunca saem: código-fonte, conteúdo de arquivos, variáveis de ambiente, chaves, histórico do terminal. A regra local sempre decide se o decisor falhar, demorar ou ficar abaixo da confiança mínima.`;
}

const entrada = (c: ConfigDecisor, extra: Partial<ConfigDecisorEntrada> = {}): ConfigDecisorEntrada => ({ ...c, consentimento: c.consentimento === null ? null : { host: c.consentimento.host, modo: c.consentimento.modo }, ...extra });

function Consentimento({ cfg, api, apiCofre, aoFim }: { cfg: ConfigDecisor; api: PropsAba["api"]; apiCofre: ApiCofre | undefined; aoFim: (mudou: boolean) => void }) {
  const [modo, setModo] = useState<ModoDecisor>(cfg.modo);
  const [endpoint, setEndpoint] = useState(cfg.endpoint ?? "");
  const [modelo, setModelo] = useState(cfg.modelo ?? "");
  const [cabecalho, setCabecalho] = useState(cfg.cabecalho_chave);
  const [prefixo, setPrefixo] = useState(cfg.prefixo_chave ?? "");
  const [usos, setUsos] = useState(cfg.usar_para);
  const [chave, setChave] = useState("");
  const [aceito, setAceito] = useState(false);
  const [teste, setTeste] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const usaEndpoint = modo !== "jev_openrouter";
  const host = modo === "jev_openrouter" ? HOST_OPENROUTER : hostDe(endpoint);
  const problema = usaEndpoint ? validarHttps(endpoint) : null;
  const nenhumUso = !usos.task_type && !usos.modelo_esforco && !usos.intencao;

  const testar = async () => {
    setTeste("Testando…");
    try { const r = await api?.testarDecisor?.(chave === "" ? undefined : chave); setTeste(r?.ok ? `Conexão ok${r.latencia_ms !== null && r.latencia_ms !== undefined ? ` (${r.latencia_ms} ms)` : ""}.` : `Falhou: ${r?.motivo ?? "sem resposta"}.`); }
    catch (e) { setTeste(`Falhou: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setChave(""); } // o valor sai do estado do React logo após o uso
  };
  const confirmar = async () => {
    if (!aceito || problema !== null || nenhumUso) return;
    setOcupado(true);
    try {
      let ref = cfg.chave_ref;
      if (chave !== "" && apiCofre?.gravar !== undefined) {
        const existente = (await apiCofre.listar?.())?.find((e) => e.nome === NOME_CHAVE_DECISOR);
        await apiCofre.gravar({ id: existente?.id ?? null, nome: NOME_CHAVE_DECISOR, escopo: "global", workspace_id: null, sensivel: true, valor: chave });
        ref = NOME_CHAVE_DECISOR;
      }
      setChave("");
      await api?.gravarDecisor?.(entrada(cfg, { habilitado: true, modo, endpoint: usaEndpoint ? endpoint : null, modelo: modelo.trim() === "" ? null : modelo.trim(), cabecalho_chave: cabecalho, prefixo_chave: prefixo === "" ? null : prefixo, usar_para: usos, chave_ref: ref, consentimento: { host, modo } }));
      aoFim(true);
    } catch (e) { setChave(""); setErro(`Não foi possível ligar o decisor: ${e instanceof Error ? e.message : String(e)}`); setOcupado(false); }
  };
  return (
    <Dialogo titulo="Ligar o decisor externo" aoFechar={() => { setChave(""); aoFim(false); }} largura={560}>
      <div className="dialogo-corpo">
        <p className="h-aviso" role="note">{textoSaida(host, usos)}</p>
        <label className="h-campo">Modo
          <select value={modo} onChange={(e) => setModo(e.target.value as ModoDecisor)}>{(Object.keys(ROTULO_MODO) as ModoDecisor[]).map((m) => <option key={m} value={m}>{ROTULO_MODO[m]}</option>)}</select>
        </label>
        {usaEndpoint ? <label className="h-campo">Endereço (https)<input value={endpoint} aria-invalid={endpoint !== "" && problema !== null} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://api.exemplo.com/v1" />{endpoint !== "" && problema !== null ? <span role="alert" className="h-erro">{problema}</span> : null}</label> : <p className="h-nota">Usa a conta OpenRouter já cadastrada em Provedores; a chave dela não é copiada.</p>}
        <label className="h-campo">Modelo<input value={modelo} onChange={(e) => setModelo(e.target.value)} /></label>
        {usaEndpoint ? (
          <div className="h-linha-simples">
            <label className="h-campo">Cabeçalho da chave<input value={cabecalho} onChange={(e) => setCabecalho(e.target.value)} /></label>
            <label className="h-campo">Prefixo<input value={prefixo} onChange={(e) => setPrefixo(e.target.value)} placeholder="Bearer " /></label>
          </div>
        ) : null}
        {usaEndpoint ? <label className="h-campo">Chave (vai direto para o cofre; nunca é exibida)<input type="password" autoComplete="off" spellCheck={false} value={chave} onChange={(e) => setChave(e.target.value)} placeholder={cfg.chave_ref !== null ? "•••• já salva no cofre (deixe vazio para manter)" : ""} /></label> : null}
        <fieldset className="h-campo" aria-label="Usos do decisor">
          <label><input type="checkbox" checked={usos.task_type} onChange={(e) => setUsos({ ...usos, task_type: e.target.checked })} /> tipo de tarefa</label>
          <label><input type="checkbox" checked={usos.modelo_esforco} onChange={(e) => setUsos({ ...usos, modelo_esforco: e.target.checked })} /> modelo e esforço</label>
          <label><input type="checkbox" checked={usos.intencao} onChange={(e) => setUsos({ ...usos, intencao: e.target.checked })} /> intenção</label>
        </fieldset>
        <label><input type="checkbox" checked={aceito} onChange={(e) => setAceito(e.target.checked)} /> Li o que sai da máquina e autorizo enviar para {host || "o host informado"}.</label>
        {teste !== null ? <p role="status" className="h-nota">{teste}</p> : null}
        {erro !== null ? <p role="alert" className="h-erro">{erro}</p> : null}
      </div>
      <div className="dialogo-acoes">
        <button type="button" className="botao" onClick={() => { setChave(""); aoFim(false); }}>Cancelar</button>
        <button type="button" className="botao" disabled={problema !== null && usaEndpoint} onClick={() => void testar()}>Testar sem salvar</button>
        <button type="button" className="botao botao-primario" disabled={!aceito || problema !== null || nenhumUso || ocupado} onClick={() => void confirmar()}>Ligar decisor</button>
      </div>
    </Dialogo>
  );
}

const fonteTxt: Record<Decisao["fonte"], string> = { decisor: "decisor", regra: "regra", politica: "política", explicito: "explícito", fallback: "fallback" };
const custoTxt = (d: Decisao): string => (d.custo_usd === null ? "custo desconhecido" : `${formatarUsd(d.custo_usd)}${d.custo_origem !== null ? ` (${d.custo_origem})` : ""}`);

export function Decisoes({ api, apiCofre, versao }: PropsAba & { apiCofre: ApiCofre | undefined }) {
  const cfg = useCarga<ConfigDecisor>(api?.lerDecisor === undefined ? undefined : () => api.lerDecisor!(), `dec|${versao}`);
  const [extras, setExtras] = useState<{ itens: Decisao[]; proximo: string | null } | null>(null);
  const pag = useCarga<PaginaDecisoes>(api?.listarDecisoes === undefined ? undefined : () => api.listarDecisoes!({ limite: 500 }), `decs|${versao}`);
  const [consent, setConsent] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const itens = [...(pag.dados?.itens ?? []), ...(extras?.itens ?? [])];
  const proximo = extras !== null ? extras.proximo : pag.dados?.proximo ?? null;
  const t = pag.dados?.totais;

  const desligar = async () => {
    if (cfg.dados === null) return;
    try { await api?.gravarDecisor?.(entrada(cfg.dados, { habilitado: false, consentimento: null })); cfg.recarregar(); }
    catch (e) { setErro(`Não foi possível desligar: ${e instanceof Error ? e.message : String(e)}`); }
  };
  const maisUm = async () => {
    if (proximo === null) return;
    try { const p = await api!.listarDecisoes!({ limite: 500, cursor: proximo }); setExtras((a) => ({ itens: [...(a?.itens ?? []), ...p.itens], proximo: p.proximo })); }
    catch (e) { setErro(`Não foi possível carregar mais: ${e instanceof Error ? e.message : String(e)}`); }
  };

  return (
    <div className="harness-corpo-alto">
      <div className="h-secao">
        <h2>Decisor externo</h2>
        {cfg.estado === "indisponivel" ? <p className="h-nota">Decisor indisponível neste build. A regra local decide sozinha.</p>
          : cfg.dados === null ? <p className="h-nota" aria-busy="true">Carregando…</p> : (
            <>
              <div className="h-linha-simples">
                <button type="button" role="switch" aria-checked={cfg.dados.habilitado} aria-label="Decisor externo" className="botao-mini" onClick={() => (cfg.dados!.habilitado ? void desligar() : setConsent(true))}>{cfg.dados.habilitado ? "Ligado" : "Desligado"}</button>
                <span className="h-nota">{cfg.dados.habilitado ? `${ROTULO_MODO[cfg.dados.modo]} · ${cfg.dados.consentimento?.host ?? ""}` : "Desligado por padrão: nada sai da máquina."}</span>
              </div>
              {cfg.dados.habilitado && cfg.dados.consentimento !== null ? <p className="h-nota">{textoSaida(cfg.dados.consentimento.host, cfg.dados.usar_para)}</p> : null}
            </>
          )}
        {erro !== null ? <p role="alert" className="h-erro">{erro}</p> : null}
        <p className="h-nota" aria-live="polite">{t === undefined ? "" : `${t.consultas} consultas · ${t.custo_usd === null ? "custo desconhecido" : `${formatarUsd(t.custo_usd)}${t.custo_desconhecido > 0 ? " (≥)" : ""}`}`}</p>
      </div>
      {pag.estado === "indisponivel" ? <EstadoVazio icone="harness" titulo="Decisões indisponíveis" texto="Este build ainda não expõe o histórico de decisões." />
        : pag.estado === "erro" ? <p role="alert" className="h-erro">Não foi possível ler as decisões: {pag.mensagem}</p>
        : pag.dados === null ? <p className="h-nota" aria-busy="true">Carregando decisões…</p>
        : itens.length === 0 ? <EstadoVazio icone="harness" titulo="Nenhuma decisão ainda" texto="Cada escolha de conta, modelo ou troca grava uma decisão com o motivo em uma frase." />
        : (
          <>
            <VirtualLista
              itens={itens}
              alturaItem={ALTURA_DECISAO}
              rotulo="Decisões recentes"
              className="h-lista"
              chave={(d) => d.id}
              renderItem={(d) => (
                <div className="h-decisao" title={d.recibo}>
                  <span>{formatarHora(d.criado_em)}</span>
                  <span>{fonteTxt[d.fonte]}{d.fonte === "decisor" && d.confianca !== null ? ` ${Math.round(d.confianca * 100)}%` : ""}{d.divergiu ? " · divergiu" : ""}</span>
                  <span>{d.recibo}</span>
                  <span>{d.proposito}</span>
                  <span>{custoTxt(d)}</span>
                </div>
              )}
            />
            {proximo !== null ? <button type="button" className="botao-mini" onClick={() => void maisUm()}>Carregar mais</button> : null}
          </>
        )}
      {consent && cfg.dados !== null ? <Consentimento cfg={cfg.dados} api={api} apiCofre={apiCofre} aoFim={(m) => { setConsent(false); if (m) cfg.recarregar(); }} /> : null}
    </div>
  );
}
