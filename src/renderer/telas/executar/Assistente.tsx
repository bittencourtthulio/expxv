import "./assistente.css";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import type { ConfigExecucaoIpc } from "../../../compartilhado/executar";
import { CLIS_ASSISTENTE, type CliAssistente, type PreviaAssistente, type PropostaItemIpc, type ResultadoAssistente } from "../../../compartilhado/executar-assistente";
import { Dialogo } from "../../componentes/Dialogo";
import { useAssistenteExecutar, type EstadoAssistenteUI, type StoreAssistente } from "../../estado/executar-assistente";
import { useExecutar, type StoreExecutar } from "../../estado/executar";
import { dividirLinha, juntarLinha } from "./linha";

const NOME_CLI: Record<CliAssistente, string> = { claude: "Claude Code", codex: "Codex", opencode: "OpenCode" };
const FRASE_FASE: Record<string, (cli: string) => string> = {
  preparando: () => "Montando o resumo do projeto…",
  consultando: (cli) => `Consultando ${cli}…`,
  validando: () => "Conferindo a resposta com as regras de segurança…",
  retentando: () => "A resposta veio fora do padrão; pedindo de novo (uma única retentativa)…",
};

const relogio = (ms: number): string => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
const duracaoTexto = (s: number): string => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min${s % 60 === 0 ? "" : ` ${s % 60} s`}`);
const kb = (bytes: number): string => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1).replace(".", ",")} KB`);
const milhar = (n: number): string => n.toLocaleString("pt-BR");

// ---------------------------------------------------------------- consentimento
export function Consentimento({ ui, aoTrocarCli, aoConsentir, aoCancelar }: { ui: EstadoAssistenteUI; aoTrocarCli: (c: CliAssistente) => void; aoConsentir: () => void; aoCancelar: () => void }): ReactElement {
  const p: PreviaAssistente | null = ui.previa;
  const disponiveis = p?.clis.filter((c) => c.disponivel) ?? [];
  const semCli = p !== null && disponiveis.length === 0;
  return (
    <Dialogo titulo="Configurar a execução com IA" aoFechar={aoCancelar} largura={680}>
      <div className="dialogo-corpo asst-consentimento">
        <p>
          A IA da sua CLI vai ler um <strong>resumo do projeto</strong> e propor como executá-lo. <strong>Nada é executado</strong> durante a análise e <strong>nada é salvo</strong> antes
          de você revisar e clicar em “Salvar configurações”.
        </p>
        {p === null ? <p className="asst-meta" role="status">Montando a prévia do que seria enviado…</p> : (
          <>
            <section className="asst-bloco" aria-labelledby="asst-enviado">
              <h3 id="asst-enviado">O que será enviado</h3>
              <ul className="asst-fatos">
                <li><strong>{milhar(p.itens_arvore)}</strong> caminhos de arquivos e pastas (até 3 níveis)</li>
                <li>Trechos de <strong>{p.arquivos.length}</strong> arquivos de configuração e do README:</li>
              </ul>
              <ul className="asst-arquivos" aria-label="Arquivos cujo trecho será enviado">
                {p.arquivos.map((a) => <li key={a}><code>{a}</code></li>)}
              </ul>
              <ul className="asst-fatos">
                <li>O que a detecção automática já achou ({p.pistas}), como pista</li>
                <li>Tamanho: <strong>{kb(p.bytes)}</strong> · custo estimado de <strong>≈ {milhar(p.tokens_estimados)} tokens</strong> de entrada (estimativa)</li>
              </ul>
            </section>
            <section className="asst-bloco" aria-labelledby="asst-nunca">
              <h3 id="asst-nunca">O que nunca é enviado</h3>
              <p>
                Arquivos de ambiente, chaves, credenciais, a pasta <code>.git</code>, lockfiles e binários — nem o nome deles.
                {p.omitidos_sensiveis > 0 ? <> Foram omitidos <strong>{p.omitidos_sensiveis}</strong> {p.omitidos_sensiveis === 1 ? "arquivo sensível" : "arquivos sensíveis"} deste projeto.</> : null}{" "}
                Todo o texto passa pela redação de segredos antes de sair.
              </p>
            </section>
            <section className="asst-bloco" aria-labelledby="asst-quem">
              <h3 id="asst-quem">Quem vai analisar</h3>
              {semCli ? (
                <p className="exec-aviso" role="alert">Nenhuma CLI compatível foi encontrada. Instale o Claude Code, o Codex ou o OpenCode e abra o assistente de novo.</p>
              ) : (
                <div className="asst-linha-cli">
                  <label className="campo">CLI
                    <select value={ui.cli ?? ""} onChange={(e) => aoTrocarCli(e.target.value as CliAssistente)} disabled={ui.carregando}>
                      {CLIS_ASSISTENTE.map((c) => {
                        const est = p.clis.find((x) => x.cli === c);
                        return <option key={c} value={c} disabled={est?.disponivel !== true}>{NOME_CLI[c]}{est?.disponivel === true ? "" : ` — ${est?.motivo ?? "indisponível"}`}</option>;
                      })}
                    </select>
                  </label>
                  <p className="asst-meta">Modelo: <strong>{p.modelo ?? "padrão da CLI"}</strong> · escolhida pelo harness; você pode trocar.</p>
                </div>
              )}
              <p className="asst-meta">Isso <strong>consome tokens da sua conta</strong> nessa CLI. A análise leva até {duracaoTexto(p.limite_tempo_s)} e pode ser cancelada a qualquer momento. A CLI roda sem ferramentas: não lê, não escreve e não executa nada no seu projeto.</p>
            </section>
          </>
        )}
      </div>
      <div className="dialogo-acoes">
        <button type="button" className="botao" data-foco-inicial onClick={aoCancelar}>Cancelar</button>
        <button type="button" className="botao botao-primario" disabled={p === null || semCli || ui.carregando || ui.cli === null} onClick={aoConsentir}>Concordo, analisar o projeto</button>
      </div>
    </Dialogo>
  );
}

// ---------------------------------------------------------------- gerando
function Gerando({ ui, aoCancelar }: { ui: EstadoAssistenteUI; aoCancelar: () => void }): ReactElement {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);
  const cli = ui.cli === null ? "a CLI" : NOME_CLI[ui.cli];
  const frase = ui.cancelando ? "Cancelando…" : (FRASE_FASE[ui.faseIa ?? "preparando"] ?? FRASE_FASE["preparando"]!)(cli);
  const decorrido = ui.iniciadoEm === null ? 0 : agora - ui.iniciadoEm;
  const limite = (ui.previa?.limite_tempo_s ?? 150) * 1000;
  return (
    <Dialogo titulo="Analisando o projeto…" aoFechar={aoCancelar} largura={520}>
      <div className="dialogo-corpo asst-gerando">
        <div className="asst-anel" aria-hidden="true" />
        <div>
          {/* anuncia só a mudança de fase (o cronômetro, que muda a cada segundo, fica fora da região viva) */}
          <p className="asst-fase" role="status" aria-live="polite">{frase}</p>
          <p className="asst-meta" aria-hidden="true">{relogio(decorrido)} de até {relogio(limite)}</p>
          <p className="asst-meta">Nada está sendo executado no seu projeto. Você pode cancelar quando quiser.</p>
        </div>
      </div>
      <div className="dialogo-acoes">
        <button type="button" className="botao" data-foco-inicial disabled={ui.cancelando} onClick={aoCancelar}>Cancelar análise</button>
      </div>
    </Dialogo>
  );
}

// ---------------------------------------------------------------- erro
function Erro({ ui, aoTentar, aoDeteccao, aoFechar }: { ui: EstadoAssistenteUI; aoTentar: () => void; aoDeteccao: () => void; aoFechar: () => void }): ReactElement {
  return (
    <Dialogo titulo="Não foi possível analisar o projeto" aoFechar={aoFechar} largura={540}>
      <div className="dialogo-corpo">
        <p role="alert"><strong>{ui.erro?.mensagem ?? "O assistente não conseguiu concluir."}</strong></p>
        {ui.erro?.sugestao !== undefined && ui.erro.sugestao !== "" ? <p>{ui.erro.sugestao}</p> : null}
        <p className="asst-meta">Nada foi executado nem salvo.</p>
      </div>
      <div className="dialogo-acoes">
        <button type="button" className="botao" onClick={aoFechar}>Fechar</button>
        <button type="button" className="botao" onClick={aoDeteccao}>Usar a detecção automática</button>
        <button type="button" className="botao botao-primario" data-foco-inicial onClick={aoTentar}>Tentar de novo</button>
      </div>
    </Dialogo>
  );
}

// ---------------------------------------------------------------- proposta (revisão humana)
interface Linha {
  id: string;
  marcado: boolean;
  nome: string;
  /** programa + argumentos numa linha (aspas do shell só para dividir; nunca vira shell) */
  comando: string;
  cwd: string;
  prePassos: string;
  porta: string;
  base: PropostaItemIpc;
}

const linhaDe = (it: PropostaItemIpc): Linha => ({
  id: it.config.id, marcado: true, nome: it.config.nome, comando: juntarLinha([it.config.executavel, ...it.config.argumentos]), cwd: it.config.cwd,
  prePassos: it.config.pre_passos.map((p) => juntarLinha([p.executavel, ...p.argumentos])).join("\n"), porta: it.config.porta === null ? "" : String(it.config.porta), base: it,
});

/** Linha editada → configuração do contrato, ou o texto do erro (a validação estrita final é do main). */
function configDaLinha(l: Linha): { ok: true; config: ConfigExecucaoIpc } | { ok: false; erro: string } {
  const cmd = dividirLinha(l.comando);
  if (!cmd.ok) return { ok: false, erro: `Comando: ${cmd.erro}` };
  if (cmd.argumentos.length === 0) return { ok: false, erro: "Informe o programa a executar" };
  const passos: Array<{ executavel: string; argumentos: string[] }> = [];
  for (const [i, t] of l.prePassos.split(/\r?\n/).entries()) {
    if (t.trim() === "") continue;
    const d = dividirLinha(t);
    if (!d.ok || d.argumentos.length === 0) return { ok: false, erro: `Pré-passo ${i + 1}: ${d.ok ? "linha vazia" : d.erro}` };
    passos.push({ executavel: d.argumentos[0]!, argumentos: d.argumentos.slice(1) });
  }
  const porta = l.porta.trim() === "" ? null : Number(l.porta);
  if (porta !== null && (!Number.isInteger(porta) || porta < 1 || porta > 65_535)) return { ok: false, erro: "Porta: use um número de 1 a 65535" };
  if (l.nome.trim() === "") return { ok: false, erro: "Dê um nome à configuração" };
  const b = l.base.config;
  return {
    ok: true,
    config: { ...b, nome: l.nome.trim(), executavel: cmd.argumentos[0]!, argumentos: cmd.argumentos.slice(1), cwd: l.cwd, pre_passos: passos, porta, abrir_navegador: b.abrir_navegador && (porta !== null || b.url !== null), shell: null },
  };
}

const linhasDoComando = (c: ConfigExecucaoIpc): string => [...c.pre_passos.map((p) => juntarLinha([p.executavel, ...p.argumentos])), juntarLinha([c.executavel, ...c.argumentos])].map((x) => `$ ${x}`).join("\n");

function Proposta({ ui, pastas, aoSalvar, aoFechar, aoDeteccao }: { ui: EstadoAssistenteUI; pastas: readonly string[]; aoSalvar: (c: ConfigExecucaoIpc[], padrao: string | null) => void; aoFechar: () => void; aoDeteccao: () => void }): ReactElement {
  const r = ui.resultado as ResultadoAssistente;
  const [linhas, setLinhas] = useState<Linha[]>(() => r.itens.map(linhaDe));
  const [padrao, setPadrao] = useState<string | null>(() => r.itens.find((i) => i.padrao)?.config.id ?? r.itens[0]?.config.id ?? null);
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  const opcoesPasta = useMemo(() => [...new Set([".", ...pastas, ...r.itens.map((i) => i.config.cwd)])].sort((a, b) => (a === "." ? -1 : b === "." ? 1 : a.localeCompare(b))), [pastas, r.itens]);
  const novas = r.itens.filter((i) => i.novo).length;
  const marcadas = linhas.filter((l) => l.marcado);
  const padraoEfetivo = marcadas.some((l) => l.id === padrao) ? padrao : (marcadas.find((l) => l.base.config.tipo === "rodar")?.id ?? marcadas[0]?.id ?? null);
  const edita = (id: string, p: Partial<Linha>): void => { setLinhas((ls) => ls.map((l) => (l.id === id ? { ...l, ...p } : l))); setErroLocal(null); };
  const erros = new Map(linhas.map((l) => { const c = configDaLinha(l); return [l.id, c.ok ? null : c.erro] as const; }));
  const invalida = marcadas.some((l) => erros.get(l.id) !== null);

  const salvar = (): void => {
    const configs: ConfigExecucaoIpc[] = [];
    for (const l of marcadas) {
      const c = configDaLinha(l);
      if (!c.ok) { setErroLocal(`${l.nome}: ${c.erro}`); return; }
      configs.push(c.config);
    }
    aoSalvar(configs, padraoEfetivo);
  };

  if (r.itens.length === 0) {
    return (
      <Dialogo titulo="Proposta da IA" aoFechar={aoFechar} largura={600}>
        <div className="dialogo-corpo">
          {r.aviso_fonte !== null ? <p className="exec-aviso" role="note">{r.aviso_fonte}</p> : null}
          <p><strong>A IA não encontrou uma forma segura de executar este projeto.</strong></p>
          {r.avisos.length > 0 ? <ul className="asst-avisos" aria-label="Avisos e pré-requisitos">{r.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul> : null}
          {r.descartados.length > 0 ? <p className="asst-meta">{r.descartados.length} {r.descartados.length === 1 ? "item proposto foi descartado" : "itens propostos foram descartados"} pela validação de segurança.</p> : null}
        </div>
        <div className="dialogo-acoes">
          <button type="button" className="botao" data-foco-inicial onClick={aoFechar}>Fechar</button>
          <button type="button" className="botao botao-primario" onClick={aoDeteccao}>Abrir o editor de configurações</button>
        </div>
      </Dialogo>
    );
  }

  return (
    <Dialogo titulo="Proposta da IA" aoFechar={aoFechar} largura={980}>
      <div className="asst-proposta">
        <div className="asst-resumo">
          {r.aviso_fonte !== null ? <p className="exec-aviso" role="note"><strong>Esta proposta NÃO veio da IA.</strong> {r.aviso_fonte}</p> : null}
          <p className="asst-meta">
            {r.fonte === "ia" ? <>Proposta de {NOME_CLI[r.cli]} em {relogio(r.duracao_ms)}{r.tentativas > 1 ? " (após uma retentativa)" : ""}. </> : null}
            A detecção automática achou <strong>{r.deteccao_total}</strong> {r.deteccao_total === 1 ? "configuração" : "configurações"}; {r.fonte === "ia" ? <><strong>{novas}</strong> {novas === 1 ? "item da proposta é novo" : "itens da proposta são novos"}.</> : "estas são elas."}
          </p>
        </div>
        <div className="asst-corpo">
          {r.avisos.length > 0 ? (
            <section className="asst-bloco asst-avisos-bloco" aria-labelledby="asst-avisos-t">
              <h3 id="asst-avisos-t">Avisos e pré-requisitos</h3>
              <ul className="asst-avisos">{r.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>
            </section>
          ) : null}
          <ul className="asst-cartoes" aria-label="Configurações propostas">
            {linhas.map((l) => {
              const erro = erros.get(l.id) ?? null;
              const cfg = configDaLinha(l);
              const it = l.base;
              return (
                <li key={l.id} className="asst-cartao" data-marcado={l.marcado || undefined} data-invalido={l.marcado && erro !== null ? "" : undefined}>
                  <div className="asst-cartao-topo">
                    <label className="asst-marca"><input type="checkbox" checked={l.marcado} onChange={(e) => edita(l.id, { marcado: e.target.checked })} aria-label={`Salvar ${l.nome}`} /> Salvar</label>
                    <label className="asst-marca"><input type="radio" name="asst-padrao" checked={padraoEfetivo === l.id} disabled={!l.marcado} onChange={() => setPadrao(l.id)} aria-label={`Definir ${l.nome} como padrão`} /> Padrão</label>
                    <span className="asst-selos">
                      {r.fonte === "ia" ? (
                        <>
                          <span className="asst-selo" data-tom={it.novo ? "novo" : "igual"}>{it.novo ? "novo" : "já detectada"}</span>
                          <span className="asst-selo" data-tom="confianca" title="Confiança declarada pela IA">confiança {Math.round(it.confianca * 100)}%</span>
                        </>
                      ) : <span className="asst-selo" data-tom="igual">detecção automática</span>}
                    </span>
                  </div>
                  <div className="asst-campos">
                    <label className="campo asst-c-nome">Nome<input value={l.nome} maxLength={60} onChange={(e) => edita(l.id, { nome: e.target.value })} /></label>
                    <label className="campo asst-c-comando">Comando (programa e argumentos)<input value={l.comando} spellCheck={false} className="asst-mono" onChange={(e) => edita(l.id, { comando: e.target.value })} /></label>
                    <label className="campo asst-c-pasta">Pasta (dentro do projeto)
                      <select value={l.cwd} onChange={(e) => edita(l.id, { cwd: e.target.value })}>
                        {opcoesPasta.map((p) => <option key={p} value={p}>{p === "." ? ". (raiz do projeto)" : p}</option>)}
                      </select>
                    </label>
                    <label className="campo asst-c-porta">Porta esperada<input value={l.porta} inputMode="numeric" placeholder="auto" title="Vazio: o app detecta a porta pela saída do processo" onChange={(e) => edita(l.id, { porta: e.target.value })} /></label>
                    <label className="campo asst-c-pre">Pré-passos (um comando por linha)
                      <textarea value={l.prePassos} rows={2} spellCheck={false} className="asst-mono" onChange={(e) => edita(l.id, { prePassos: e.target.value })} />
                    </label>
                  </div>
                  {it.justificativa !== "" ? <p className="asst-just"><span className="asst-meta">Por quê:</span> {it.justificativa}</p> : null}
                  {cfg.ok ? <pre className="exec-comando asst-exato" aria-label={`Comando exato de ${l.nome}`}>{linhasDoComando(cfg.config)}</pre> : null}
                  {l.marcado && erro !== null ? <p className="campo-erro" role="alert">{erro}</p> : null}
                </li>
              );
            })}
          </ul>
          {r.descartados.length > 0 ? (
            <details className="asst-descartados">
              <summary>{r.descartados.length} {r.descartados.length === 1 ? "item da IA foi descartado" : "itens da IA foram descartados"} pela validação de segurança</summary>
              <ul>{r.descartados.map((d, i) => <li key={i}><strong>{d.nome}</strong> — {d.motivo}</li>)}</ul>
            </details>
          ) : null}
        </div>
        {erroLocal !== null || ui.erroSalvar !== null ? <p className="campo-erro" role="alert">{erroLocal ?? ui.erroSalvar}</p> : null}
        <p className="asst-meta asst-rodape-nota">Nada foi salvo nem executado. Ao salvar, a primeira execução de cada configuração <strong>ainda pede a sua confirmação</strong> — a IA nunca concede confiança.</p>
      </div>
      <div className="dialogo-acoes">
        <button type="button" className="botao" onClick={aoFechar}>Cancelar</button>
        <button type="button" className="botao botao-primario" data-foco-inicial disabled={marcadas.length === 0 || invalida || ui.salvando} onClick={salvar}>
          Salvar configurações{marcadas.length > 0 ? ` (${marcadas.length})` : ""}
        </button>
      </div>
    </Dialogo>
  );
}

// ---------------------------------------------------------------- salvo
function Salvo({ ui, aoFechar }: { ui: EstadoAssistenteUI; aoFechar: () => void }): ReactElement {
  return (
    <Dialogo titulo="Configurações salvas" aoFechar={aoFechar} largura={500}>
      <div className="dialogo-corpo">
        <p role="status"><strong>{ui.salvas} {ui.salvas === 1 ? "configuração salva" : "configurações salvas"}</strong> no projeto.</p>
        <p>Use o ▶ do cabeçalho para executar. Na primeira vez de cada uma, o app mostra o comando exato e pede a sua confirmação.</p>
      </div>
      <div className="dialogo-acoes"><button type="button" className="botao botao-primario" data-foco-inicial onClick={aoFechar}>Fechar</button></div>
    </Dialogo>
  );
}

/** Ponto único do chunk lazy do assistente: consentimento, gerando, proposta, salvo e erro. `key={fase}` recomeça o foco a cada passo. */
export default function Assistente({ store, executar }: { store: StoreAssistente; executar: StoreExecutar }): ReactElement | null {
  const ui = useAssistenteExecutar(store);
  const lista = useExecutar(executar).lista;
  useEffect(() => store.ligar(), [store]);
  const pastas = useMemo(() => [...new Set((lista?.configuracoes ?? []).map((c) => c.cwd))], [lista]);
  switch (ui.fase) {
    case "consentimento": return <Consentimento key="consentimento" ui={ui} aoTrocarCli={(c) => void store.trocarCli(c)} aoConsentir={() => void store.consentir()} aoCancelar={() => store.fechar()} />;
    case "gerando": return <Gerando key="gerando" ui={ui} aoCancelar={() => void store.cancelar()} />;
    case "erro": return <Erro key="erro" ui={ui} aoTentar={() => store.voltar()} aoDeteccao={() => store.usarDeteccao()} aoFechar={() => store.fechar()} />;
    case "proposta": return ui.resultado === null ? null : <Proposta key={ui.resultado.assistente_id} ui={ui} pastas={pastas} aoSalvar={(c, p) => void store.salvar(c, p)} aoFechar={() => store.fechar()} aoDeteccao={() => store.usarDeteccao()} />;
    case "salvo": return <Salvo key="salvo" ui={ui} aoFechar={() => store.fechar()} />;
    default: return null;
  }
}
