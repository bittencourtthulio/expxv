import { useState } from "react";
import type { ApiRelatorios, ConfigRelatorios } from "../../../compartilhado/relatorios";
import { avisar } from "../../estado/avisos";
import { textoDoErro } from "./logica";

/** Aba Config: o padrão é o mais seguro (gerar ao fechar, texto padrão, nada sai da máquina); a IA e os canais só funcionam depois de um consentimento explícito, revogável aqui. */
export function Config({ api, ws, config, aoMudar }: { api: ApiRelatorios; ws: string; config: ConfigRelatorios; aoMudar: (c: ConfigRelatorios) => void }) {
  const [hashtags, setHashtags] = useState(config.hashtags.map((h) => `#${h}`).join(" "));
  const [cta, setCta] = useState(config.cta ?? "");
  const falha = (e: unknown): void => { avisar(textoDoErro(e), "erro"); };
  const gravar = (parcial: Parameters<ApiRelatorios["configGravar"]>[1]): void => void api.configGravar(ws, parcial).then((c) => { aoMudar(c); avisar("Configuração salva.", "sucesso"); }, falha);
  const tags = (t: string): string[] => t.split(/[\s,]+/).filter(Boolean).map((h) => h.replace(/^#/, ""));

  return (
    <div className="rl-config">
      <section className="rl-secao" aria-labelledby="rl-cfg-geral">
        <h4 id="rl-cfg-geral">Geração</h4>
        <label className="rl-check"><input type="checkbox" checked={config.gerar_ao_fechar} onChange={(e) => gravar({ gerar_ao_fechar: e.target.checked })} /> Gerar o pacote ao fechar a sprint</label>
        <label className="rl-check"><input type="checkbox" checked={config.csv_bom} onChange={(e) => gravar({ csv_bom: e.target.checked })} /> CSV com marca de codificação (abre com acentos certos no Excel)</label>
        <label className="rl-campo"><span>Redação do texto</span>
          <select aria-label="Redação do texto" value={config.redacao_modo} onChange={(e) => gravar({ redacao_modo: e.target.value as ConfigRelatorios["redacao_modo"] })}>
            <option value="template">Texto padrão (sem IA)</option>
            <option value="auto">Automática: IA quando permitida</option>
            <option value="llm">Sempre IA quando permitida</option>
          </select>
        </label>
      </section>
      <section className="rl-secao" aria-labelledby="rl-cfg-ia">
        <h4 id="rl-cfg-ia">Redação por IA</h4>
        <p className="rl-meta">A IA só recebe fatos estruturados (títulos, números e textos já limpos de segredos e caminhos), nunca código. Roda na CLI de IA que você já usa, sem ferramentas, e todo texto passa por verificação antes de entrar no relatório.</p>
        <label className="rl-check"><input type="checkbox" checked={config.consentimento_llm_em !== null} onChange={(e) => void api.consentimentoLlm(ws, e.target.checked).then((c) => { aoMudar(c); avisar(e.target.checked ? "Consentimento registrado." : "Consentimento revogado.", "sucesso"); }, falha)} /> Permito enviar esses fatos à minha CLI de IA para redigir o texto</label>
      </section>
      <section className="rl-secao" aria-labelledby="rl-cfg-div">
        <h4 id="rl-cfg-div">Divulgação</h4>
        <label className="rl-campo"><span>Hashtags (até 5)</span><input aria-label="Hashtags" value={hashtags} onChange={(e) => setHashtags(e.target.value)} onBlur={() => gravar({ hashtags: tags(hashtags) })} placeholder="#novidades #produto" /></label>
        <label className="rl-campo"><span>Chamada para ação</span><input aria-label="Chamada para ação" value={cta} onChange={(e) => setCta(e.target.value)} onBlur={() => gravar({ cta: cta.trim() === "" ? null : cta })} placeholder="Saiba mais no app" maxLength={120} /></label>
      </section>
    </div>
  );
}
