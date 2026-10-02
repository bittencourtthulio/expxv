import { useEffect, useState } from "react";
import type { AprendizadoModo, ChatExecucao, ConsultaObrigatoria } from "../../../compartilhado/conhecimento-api";
import type { EstadoStoreConhecimento, StoreConhecimento } from "../../estado/conhecimento";
import { formatarBytes, formatarPct } from "./logica";

export interface PropsConfig { store: StoreConhecimento; estado: EstadoStoreConhecimento }

function Interruptor({ rotulo, ligado, aoMudar, descricao }: { rotulo: string; ligado: boolean; aoMudar: (v: boolean) => void; descricao?: string }) {
  return (
    <>
      <label>{rotulo}</label>
      <span><button type="button" role="switch" className="con-mini" aria-checked={ligado} aria-label={rotulo} onClick={() => aoMudar(!ligado)}>{ligado ? "ligado" : "desligado"}</button>{descricao !== undefined ? <span className="meta"> {descricao}</span> : null}</span>
    </>
  );
}

function CampoNumero({ id, rotulo, valor, min, max, sufixo, aoConfirmar }: { id: string; rotulo: string; valor: number; min: number; max: number; sufixo: string; aoConfirmar: (n: number) => void }) {
  const [t, setT] = useState(String(valor));
  useEffect(() => setT(String(valor)), [valor]);
  const n = Number(t);
  const invalido = !Number.isInteger(n) || n < min || n > max;
  return (
    <>
      <label htmlFor={id}>{rotulo}</label>
      <span>
        <input id={id} type="number" min={min} max={max} value={t} aria-invalid={invalido} onChange={(e) => setT(e.target.value)} onBlur={() => { if (!invalido && n !== valor) aoConfirmar(n); else if (invalido) setT(String(valor)); }} /> <span className="meta">{sufixo} (de {min} a {max})</span>
      </span>
    </>
  );
}

export function Config({ store, estado }: PropsConfig) {
  const c = estado.config;
  const e = estado.estado;
  const m = estado.modelos;
  useEffect(() => { void store.carregarModelos(); }, [store, estado.workspaceId]);
  const [ultimoModelo, setUltimoModelo] = useState<string | null>(null);
  if (c === null) return <div className="con-rolavel"><p className="con-vazio" role="status">Carregando configuração…</p></div>;
  const grava = (p: Parameters<StoreConhecimento["gravarConfig"]>[0]): void => { void store.gravarConfig(p); };
  const ativoModelo = m?.modelos.find((x) => x.id === m.ativo);

  return (
    <div className="con-rolavel">
      <div className="con-secao">
        <h2>Conhecimento do projeto</h2>
        <div className="con-grade">
          <Interruptor rotulo="Conhecimento ligado" ligado={c.ativo} aoMudar={(v) => grava({ ativo: v })} descricao={c.ativo ? "agentes consultam o índice local" : "nada novo é indexado nem consultado"} />
          <label htmlFor="con-consulta">Consulta obrigatória</label>
          <select id="con-consulta" value={c.consulta_obrigatoria} onChange={(ev) => grava({ consulta_obrigatoria: ev.target.value as ConsultaObrigatoria })}>
            <option value="off">Desligada</option><option value="aviso">Aviso (lembra o agente)</option><option value="bloqueio">Bloqueio (exige consultar antes de agir)</option>
          </select>
          <CampoNumero id="con-ctx" rotulo="Tamanho do contexto" valor={c.contexto_chars} min={500} max={40_000} sufixo="caracteres" aoConfirmar={(n) => grava({ contexto_chars: n })} />
          <Interruptor rotulo="Hook de prompt" ligado={c.hook_prompt} aoMudar={(v) => grava({ hook_prompt: v })} descricao="injeta o contexto nos prompts das CLIs" />
          <Interruptor rotulo="Indexar código" ligado={c.indexar_codigo} aoMudar={(v) => grava({ indexar_codigo: v })} />
          <Interruptor rotulo="Indexar transcrições" ligado={c.indexar_transcricoes} aoMudar={(v) => grava({ indexar_transcricoes: v })} descricao="conversas dos terminais, com segredos mascarados" />
          <CampoNumero id="con-ret" rotulo="Retenção das transcrições" valor={c.retencao_transcricao_dias} min={1} max={3650} sufixo="dias" aoConfirmar={(n) => grava({ retencao_transcricao_dias: n })} />
          <label htmlFor="con-apr-modo">Aprendizado</label>
          <span>
            <select id="con-apr-modo" value={c.aprendizado_modo} onChange={(ev) => grava({ aprendizado_modo: ev.target.value as AprendizadoModo })}>
              <option value="deterministico">Determinístico (sem IA)</option><option value="assistido">Assistido (destilar com IA)</option>
            </select>
            {c.aprendizado_modo === "assistido" ? <p className="con-faixa" role="note">Destilar com IA consome a cota da sua CLI a cada missão concluída.</p> : null}
          </span>
          <label htmlFor="con-chat-exec">Execução pelo chat</label>
          <span>
            <select id="con-chat-exec" value={c.chat_execucao} onChange={(ev) => grava({ chat_execucao: ev.target.value as ChatExecucao })}>
              <option value="confirmar">Confirmar sempre</option><option value="reversiveis">Direto só para ações reversíveis (padrão)</option><option value="total">Direto total</option>
            </select>
            {c.chat_execucao === "total" ? <p className="con-faixa" role="note">Direto total: o chat executa os planos sem pedir confirmação. Ações destrutivas e as decisões humanas do método continuam exigindo você.</p> : null}
          </span>
        </div>

        <h2>Modelo de embedding</h2>
        {estado.modelosErro !== null ? <p className="con-erro" role="alert">{estado.modelosErro}</p> : null}
        {m === null ? <p role="status">Detectando modelos…</p> : (
          <div className="con-grade">
            <label htmlFor="con-modelo">Modelo</label>
            <select id="con-modelo" value={m.ativo} onChange={(ev) => { setUltimoModelo(ev.target.value); void store.definirModelo(ev.target.value); }}>
              {m.modelos.map((x) => <option key={x.id} value={x.id} disabled={!x.disponivel && x.origem !== "onnx"}>{x.rotulo} · {x.dimensao}d{x.disponivel ? "" : " (indisponível)"}</option>)}
            </select>
            <label>Ollama</label><span>{m.ollama_url !== null ? `detectado em ${m.ollama_url}` : "não detectado (a busca usa o modelo local de piso, só lexical-forte)"}</span>
            {m.modelos.filter((x) => !x.disponivel).map((x) => (
              <span key={x.id} style={{ display: "contents" }}>
                <label>{x.rotulo}</label>
                <span>{x.motivo ?? "indisponível"} {x.origem === "onnx" ? <button type="button" className="con-mini" onClick={() => { setUltimoModelo(x.id); void store.definirModelo(x.id); }}>Baixar modelo</button> : null}</span>
              </span>
            ))}
          </div>
        )}
        {ultimoModelo !== null && ativoModelo !== undefined && ultimoModelo !== ativoModelo.id ? <p className="meta" role="status">O main respondeu: modelo ativo continua {ativoModelo.rotulo}.</p> : null}
        {e?.reembutindo_pct != null ? <p role="status">Reembutindo o índice com o novo modelo: {formatarPct(e.reembutindo_pct)}</p> : null}

        <h2>Estado do índice</h2>
        {e === null ? <p role="status">Carregando…</p> : (
          <table className="con-tabela" aria-label="Estado do índice">
            <tbody>
              <tr><th scope="row">Cobertura de consulta (7 dias)</th><td>{formatarPct(e.cobertura_consulta_7d_pct)} das tasks consultaram o conhecimento</td></tr>
              <tr><th scope="row">Documentos e trechos</th><td>{e.documentos} · {e.chunks}</td></tr>
              <tr><th scope="row">Tamanho</th><td>{formatarBytes(e.tamanho_bytes)}</td></tr>
              <tr><th scope="row">Busca textual (FTS5)</th><td>{e.fts5 ? "disponível" : "indisponível (modo simples)"}</td></tr>
              <tr><th scope="row">Backend vetorial</th><td>{e.vetor_backend}</td></tr>
              <tr><th scope="row">Backend de dados</th><td>{e.backend}</td></tr>
              <tr><th scope="row">Aprendizados</th><td>{e.aprendizados.ativo} ativos · {e.aprendizados.candidato} candidatos · {e.aprendizados.arquivado} arquivados · {e.aprendizados.rejeitado} rejeitados</td></tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
