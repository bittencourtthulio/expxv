// Configurações → Voz e captura → "Local neste computador" (Fase 11, D-545): assistente de modelo de voz local. Escolher (recomendado pré-selecionado) → consentimento por download → progresso
// (pausar/retomar/cancelar) → verificação e autoteste → "Pronto: voz local ativada". Depois: gerenciar (usar, verificar, apagar, baixar outro, tempo até descarregar da memória).
// Nenhum caminho nem URL passa por aqui: só `modelo_id`. Progresso com role="progressbar"; anúncios discretos só em mudança de fase/25%; sem animação com prefers-reduced-motion.
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import type { ApiVoz, EstadoVoz } from "../../../compartilhado/captura";
import type { ListaModelosVoz, ModeloVozInfo, ProgressoModelo, ResultadoAutoteste } from "../../../compartilhado/voz-local";
import { PRODUTO } from "../../../nucleo/produto";
import { Dialogo, DialogoConfirmacao } from "../../componentes/Dialogo";
import {
  acoesDoErro, anuncioDe, aplicarProgresso, cabeEmDisco, descreverIdiomas, emAndamento, escolhaPadrao, formatarBytes, formatarTempo, formatarVelocidade, OPCOES_OCIOSIDADE, percentual, resumoOciosidade,
  ROTULO_QUALIDADE, ROTULO_VELOCIDADE,
} from "../../voz/modelos";

const limpar = (e: unknown): string => (e instanceof Error ? e.message.replace(/^\[[a-z_]+\] /, "") : "Não foi possível concluir.");

interface Props {
  voz: ApiVoz;
  ev: EstadoVoz;
  /** o estado da voz mudou (motor/modelo ativos): a seção recarrega. */
  aoAtualizar: () => void;
}

function CartaoModelo({ m, marcado, aoMarcar, livre }: { m: ModeloVozInfo; marcado: boolean; aoMarcar: () => void; livre: number | null }): ReactElement {
  const cabe = cabeEmDisco(m, livre);
  return (
    <label className={`cfgvl-modelo${marcado ? " cfgvl-modelo-marcado" : ""}${m.baixavel ? "" : " cfgvl-modelo-bloqueado"}`}>
      <input type="radio" name="modelo-voz-local" checked={marcado} disabled={!m.baixavel} onChange={aoMarcar} aria-describedby={`mv-${m.id}`} />
      <span className="cfgvl-modelo-corpo">
        <span className="cfgvl-modelo-topo">
          <b>{m.nome}</b>
          {m.recomendado ? <span className="cfgvl-selo cfgvl-selo-destaque">Recomendado</span> : null}
          {m.pt_br ? <span className="cfgvl-selo cfgvl-selo-pt">PT-BR</span> : <span className="cfgvl-selo">Sem português</span>}
        </span>
        <span id={`mv-${m.id}`} className="cfgvl-modelo-desc">{m.descricao}</span>
        <dl className="cfgvl-dados">
          <div><dt>Download</dt><dd>{formatarBytes(m.tamanho_bytes)}</dd></div>
          <div><dt>Memória ao usar</dt><dd>cerca de {formatarBytes(m.ram_estimada_mb * 1e6)}</dd></div>
          <div><dt>Idiomas</dt><dd>{descreverIdiomas(m)}</dd></div>
          <div><dt>Licença</dt><dd><a href={m.licenca.url} target="_blank" rel="noreferrer noopener">{m.licenca.id}</a></dd></div>
          <div className="cfgvl-largo"><dt>Velocidade</dt><dd>{ROTULO_VELOCIDADE[m.velocidade]}</dd></div>
          <div className="cfgvl-largo"><dt>Qualidade</dt><dd>{ROTULO_QUALIDADE[m.qualidade]}</dd></div>
        </dl>
        {!m.baixavel ? <span role="note" className="cfg-erro">{m.motivo_nao_baixavel}</span> : null}
        {cabe === false ? <span role="alert" className="cfg-erro">Sem espaço livre suficiente para este modelo ({formatarBytes(livre ?? 0)} livres).</span> : null}
      </span>
    </label>
  );
}

function Andamento({ m, p, aoPausar, aoRetomar, aoCancelar, aoBaixarDeNovo, aoApagar }: { m: ModeloVozInfo; p: ProgressoModelo; aoPausar: () => void; aoRetomar: () => void; aoCancelar: () => void; aoBaixarDeNovo: () => void; aoApagar: () => void }): ReactElement {
  const pct = percentual(p);
  const indeterminado = p.fase === "verificando" || p.fase === "autoteste";
  const acoes = p.fase === "erro" ? acoesDoErro(p.codigo) : [];
  return (
    <div className="cfgvl-andamento" role="group" aria-label={`Instalação de ${m.nome}`}>
      <div className="cfgvl-andamento-topo">
        <b>{m.nome}</b>
        <span className="cfg-ajuda cfgv-nota">{p.fase === "baixando" ? "Baixando…" : p.fase === "pausado" ? "Pausado" : p.fase === "verificando" ? "Verificando…" : p.fase === "autoteste" ? "Testando o reconhecimento…" : "Não foi possível concluir"}</span>
      </div>
      {p.fase !== "erro" ? (
        <div
          className={`cfgvl-barra${indeterminado ? " cfgvl-barra-indeterminada" : ""}`}
          role="progressbar"
          aria-label={`Progresso de ${m.nome}`}
          aria-valuemin={0}
          aria-valuemax={100}
          {...(indeterminado ? { "aria-valuetext": p.fase === "verificando" ? "Verificando os arquivos" : "Testando o reconhecimento" } : { "aria-valuenow": pct, "aria-valuetext": `${pct}%` })}
        >
          <span className="cfgvl-barra-preenchida" style={indeterminado ? undefined : { width: `${pct}%` }} />
        </div>
      ) : null}
      {p.fase === "baixando" || p.fase === "pausado" ? (
        <p className="cfgvl-detalhe">
          {formatarBytes(p.bytes)} de {formatarBytes(p.total)} ({pct}%)
          {p.fase === "baixando" ? ` · ${formatarVelocidade(p.velocidade_bps)} · faltam ${formatarTempo(p.restante_s)}` : " · o que já foi baixado é aproveitado ao retomar"}
        </p>
      ) : null}
      {p.fase === "erro" && p.instrucao !== null ? <p role="alert" className="cfg-erro">{p.instrucao}</p> : null}
      <div className="cfg-linha cfgv-linha">
        {p.fase === "baixando" ? <button type="button" className="botao" onClick={aoPausar}>Pausar</button> : null}
        {p.fase === "pausado" || acoes.includes("retomar") ? <button type="button" className="botao botao-primario" onClick={aoRetomar}>Retomar</button> : null}
        {acoes.includes("baixar_de_novo") ? <button type="button" className="botao botao-primario" onClick={aoBaixarDeNovo}>Baixar de novo</button> : null}
        {acoes.includes("apagar") ? <button type="button" className="botao botao-perigo" onClick={aoApagar}>Apagar modelo</button> : null}
        {p.fase === "baixando" || p.fase === "pausado" || p.fase === "erro" ? <button type="button" className="botao" onClick={aoCancelar}>{p.fase === "erro" ? "Descartar" : "Cancelar"}</button> : null}
      </div>
    </div>
  );
}

export function VozLocal({ voz, ev, aoAtualizar }: Props): ReactElement {
  const [lista, setLista] = useState<ListaModelosVoz | null>(null);
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [consentindo, setConsentindo] = useState<string | null>(null);
  const [mostrarAssistente, setMostrarAssistente] = useState(false);
  const [apagando, setApagando] = useState<string | null>(null);
  const [anuncio, setAnuncio] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [testes, setTestes] = useState<Record<string, ResultadoAutoteste | "rodando">>({});
  const ultimo = useRef<Record<string, ProgressoModelo>>({});
  const nomes = useRef<Record<string, string>>({});
  const ativoRef = useRef(aoAtualizar);
  ativoRef.current = aoAtualizar;

  const recarregar = useCallback(async (): Promise<void> => {
    try {
      const l = await voz.modelosListar();
      nomes.current = Object.fromEntries(l.modelos.map((m) => [m.id, m.nome]));
      setLista(l);
      setEscolhido((atual) => (atual !== null && l.modelos.some((m) => m.id === atual && !m.instalado && m.baixavel) ? atual : escolhaPadrao(l.modelos)));
    } catch (e) { setErro(limpar(e)); }
  }, [voz]);

  useEffect(() => { void recarregar(); }, [recarregar]);

  useEffect(() => {
    const parar = voz.assinarModelos((p) => {
      const anterior = ultimo.current[p.modelo_id] ?? null;
      if (anterior !== null && p.sequencia <= anterior.sequencia) return; // fora de ordem
      ultimo.current[p.modelo_id] = p;
      const texto = anuncioDe(anterior, p, nomes.current[p.modelo_id] ?? "o modelo");
      if (texto !== null) setAnuncio(texto);
      setLista((l) => (l === null ? l : aplicarProgresso(l, p)));
      if (p.fase === "instalado" || p.fase === "nao_instalado" || p.fase === "erro" || p.fase === "pausado") { void recarregar(); if (p.fase === "instalado") ativoRef.current(); }
    });
    return parar;
  }, [voz, recarregar]);

  const rodar = async (fn: () => Promise<unknown>): Promise<void> => {
    setErro(null);
    try { await fn(); } catch (e) { setErro(limpar(e)); }
  };

  if (lista === null) return <p className="cfg-ajuda" role="status">{erro ?? "Carregando os modelos de voz…"}</p>;

  const instalados = lista.modelos.filter((m) => m.integridade !== null);
  const emCurso = lista.modelos.find((m) => emAndamento(m.download));
  const disponiveis = lista.modelos.filter((m) => !m.instalado);
  const assistente = instalados.length === 0 || mostrarAssistente;
  const alvo = lista.modelos.find((m) => m.id === consentindo) ?? null;
  const baixar = (id: string): void => setConsentindo(id);
  const prontoAgora = ev.motor === "local_embutido" && ev.modelo_local !== null && instalados.some((m) => m.id === ev.modelo_local && m.instalado);

  const confirmarDownload = async (): Promise<void> => {
    if (alvo === null) return;
    const id = alvo.id;
    setConsentindo(null);
    setMostrarAssistente(false);
    await rodar(async () => { await voz.modeloBaixar({ modelo_id: id, aceite_versao: lista.versao_consentimento, ativar: true }); await recarregar(); });
  };

  return (
    <div className="cfgvl" role="group" aria-label="Voz local neste computador">
      <p className="cfg-ajuda">
        Reconhecimento de voz que roda aqui, no seu computador: depois de baixar o modelo, o áudio nunca sai da máquina e não precisa de internet. O modelo só ocupa memória enquanto você dita
        e é descarregado depois de {resumoOciosidade(lista.ociosidade_s)} sem uso.
      </p>
      <div role="status" aria-live="polite" className="cfgvl-leitor">{anuncio}</div>
      {erro !== null ? <p role="alert" className="cfg-erro">{erro}</p> : null}
      {!lista.runtime_disponivel ? <p role="alert" className="cfg-aviso">{lista.motivo_runtime ?? "O motor de voz local não está disponível neste computador."} Use o comando local ou o serviço HTTP compatível (opções avançadas).</p> : null}

      {prontoAgora && emCurso === undefined ? (
        <p role="status" className="cfgvl-pronto">
          <b>Pronto: voz local ativada.</b> Use o atalho de ditado ({ev.disparo === "alternar" ? "alternar" : "segurar para falar"}) em qualquer terminal. A permissão do microfone continua sendo pedida por você, abaixo.
        </p>
      ) : null}

      {emCurso !== undefined && emCurso.download !== null ? (
        <Andamento
          m={emCurso}
          p={emCurso.download}
          aoPausar={() => void rodar(() => voz.modeloPausar(emCurso.id))}
          aoRetomar={() => void rodar(async () => { await voz.modeloRetomar(emCurso.id); await recarregar(); })}
          aoCancelar={() => void rodar(async () => { await voz.modeloCancelar(emCurso.id); await recarregar(); })}
          aoBaixarDeNovo={() => baixar(emCurso.id)}
          aoApagar={() => setApagando(emCurso.id)}
        />
      ) : null}

      {instalados.length > 0 ? (
        <div className="cfgvl-gerenciar" role="group" aria-label="Modelos instalados">
          <h4>Modelos instalados</h4>
          <ul className="cfgvl-lista">
            {instalados.map((m) => {
              const t = testes[m.id];
              return (
                <li key={m.id} className="cfgvl-instalado">
                  <div className="cfgvl-instalado-info">
                    <b>{m.nome}</b>
                    {m.ativo ? <span className="cfgvl-selo cfgvl-selo-destaque">Em uso</span> : null}
                    <span className="cfg-ajuda cfgv-nota">{m.bytes_em_disco === null ? "" : `${formatarBytes(m.bytes_em_disco)} no disco`}</span>
                    {m.integridade === "corrompido" ? <span role="alert" className="cfg-erro">Arquivos corrompidos ou trocados. Apague o modelo e baixe de novo.</span> : null}
                    {t !== undefined && t !== "rodando" ? <span role="status" className={t.ok ? "cfgvl-ok" : "cfg-erro"}>{t.ok ? `Funcionando: ${t.acertos} de ${t.esperadas} palavras da amostra${t.rtf !== null ? ` (${t.rtf.toFixed(2).replace(".", ",")}× o tempo real)` : ""}.` : t.instrucao}</span> : null}
                  </div>
                  <div className="cfg-linha cfgv-linha">
                    {!m.ativo && m.instalado ? <button type="button" className="botao" onClick={() => void rodar(async () => { const r = await voz.modeloAtivar(m.id); if (!r.ok) setErro(r.instrucao ?? "Não foi possível ativar."); await recarregar(); aoAtualizar(); })}>Usar este modelo</button> : null}
                    {m.instalado ? <button type="button" className="botao" disabled={t === "rodando"} onClick={() => void rodar(async () => { setTestes((x) => ({ ...x, [m.id]: "rodando" })); const r = await voz.modeloAutoteste(m.id); setTestes((x) => ({ ...x, [m.id]: r })); await recarregar(); })}>{t === "rodando" ? "Testando…" : "Testar"}</button> : null}
                    <button type="button" className="botao botao-perigo" onClick={() => setApagando(m.id)}>Apagar modelo</button>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="cfg-linha cfgv-linha">
            <label>Descarregar da memória após
              <select value={lista.ociosidade_s} aria-label="Descarregar o modelo da memória após" onChange={(e) => void rodar(async () => { await voz.configGravar({ ociosidade_s: Number(e.target.value) }); await recarregar(); })}>
                {[...new Set([...OPCOES_OCIOSIDADE, lista.ociosidade_s])].sort((a, b) => a - b).map((s) => <option key={s} value={s}>{resumoOciosidade(s)} sem ditar</option>)}
              </select>
            </label>
            <span className="cfg-ajuda cfgv-nota">{lista.carregado ? `Modelo na memória agora${lista.ram_mb !== null ? ` (${formatarBytes(lista.ram_mb * 1e6)})` : ""}.` : "Modelo fora da memória: 0 MB e nenhum processo ativo."}</span>
          </div>
          {!assistente && emCurso === undefined ? <div className="cfg-linha cfgv-linha"><button type="button" className="botao" onClick={() => setMostrarAssistente(true)}>Baixar outro modelo</button></div> : null}
        </div>
      ) : null}

      {assistente && emCurso === undefined ? (
        <div className="cfgvl-assistente" role="group" aria-label="Escolher modelo de voz">
          <h4>{instalados.length === 0 ? "Escolha o modelo de voz" : "Baixar outro modelo"}</h4>
          <p className="cfg-ajuda cfgv-nota">Espaço livre em disco: <b>{lista.espaco_livre_bytes === null ? "não informado pelo sistema" : formatarBytes(lista.espaco_livre_bytes)}</b>. O recomendado já vem marcado.</p>
          <div className="cfgvl-modelos" role="radiogroup" aria-label="Modelos de voz disponíveis">
            {disponiveis.map((m) => <CartaoModelo key={m.id} m={m} marcado={escolhido === m.id} aoMarcar={() => setEscolhido(m.id)} livre={lista.espaco_livre_bytes} />)}
          </div>
          <div className="cfg-linha cfgv-linha">
            <button
              type="button"
              className="botao botao-primario"
              disabled={escolhido === null || !lista.runtime_disponivel || cabeEmDisco(lista.modelos.find((m) => m.id === escolhido) ?? { tamanho_bytes: 0 }, lista.espaco_livre_bytes) === false}
              title={escolhido === null
                ? "Escolha um modelo para baixar"
                : !lista.runtime_disponivel
                  ? lista.motivo_runtime ?? "O motor de voz local não está disponível neste computador"
                  : cabeEmDisco(lista.modelos.find((m) => m.id === escolhido) ?? { tamanho_bytes: 0 }, lista.espaco_livre_bytes) === false
                    ? "Sem espaço livre em disco para o modelo escolhido"
                    : "Baixar o modelo escolhido e ativar a voz local"}
              onClick={() => { if (escolhido !== null) baixar(escolhido); }}
            >
              Baixar e ativar
            </button>
            {instalados.length > 0 ? <button type="button" className="botao" onClick={() => setMostrarAssistente(false)}>Fechar</button> : null}
            <span className="cfg-ajuda cfgv-nota">Você confirma antes de qualquer download.</span>
          </div>
        </div>
      ) : null}

      {alvo !== null ? (
        <Dialogo titulo={`Baixar ${alvo.nome}?`} aoFechar={() => setConsentindo(null)} largura={560}>
          <div className="dialogo-corpo">
            <p>O {PRODUTO.nomeDeExibicao} vai baixar <b>um modelo de voz</b> para rodar neste computador. Confira antes de continuar:</p>
            <ul className="cfgvl-consentimento">
              <li><b>De onde:</b> <code>{alvo.host_origem}</code> e, no redirecionamento do arquivo, servidores de {alvo.hosts_arquivos.map((h, i) => <span key={h}>{i > 0 ? ", " : ""}<code>{h}</code></span>)} (mesma organização). Nenhum outro endereço é aceito.</li>
              <li><b>O que:</b> só os arquivos do modelo, <b>{formatarBytes(alvo.tamanho_bytes)}</b>, conferidos por checksum SHA-256 antes de usar.</li>
              <li><b>Privacidade:</b> <b>nenhum áudio, texto ou dado seu sai do computador</b>. Entra o modelo; não sai nada.</li>
              <li><b>Onde fica:</b> {lista.pasta_exibicao}, no seu computador (pasta só sua).</li>
              <li><b>Como apagar:</b> Configurações › Voz e captura › <i>Apagar modelo</i>. Apagar remove o modelo e libera o espaço.</li>
              <li><b>Licença:</b> {alvo.licenca.id}. {alvo.licenca.atribuicao}</li>
            </ul>
          </div>
          <div className="dialogo-acoes">
            <button type="button" className="botao" data-foco-inicial onClick={() => setConsentindo(null)}>Cancelar</button>
            <button type="button" className="botao botao-primario" onClick={() => void confirmarDownload()}>Concordo e baixar</button>
          </div>
        </Dialogo>
      ) : null}

      {apagando !== null ? (
        <DialogoConfirmacao
          titulo="Apagar modelo de voz?"
          texto={<p>O modelo <b>{lista.modelos.find((m) => m.id === apagando)?.nome ?? ""}</b> será removido do computador{lista.modelos.find((m) => m.id === apagando)?.ativo === true ? " e a voz local será desativada" : ""}. Você pode baixar de novo quando quiser.</p>}
          rotuloConfirmar="Apagar"
          perigoso
          aoCancelar={() => setApagando(null)}
          aoConfirmar={() => { const id = apagando; setApagando(null); void rodar(async () => { await voz.modeloApagar(id); await recarregar(); aoAtualizar(); }); }}
        />
      ) : null}
    </div>
  );
}
