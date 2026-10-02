// Coerência de embeddings (G §6): nunca misturar modelos nem dimensões; mudou o modelo → nova coleção versionada.
import type { MetricaDistancia } from "../armazenamento/interface";

export interface ConfigVetorial {
  modeloEmbedding: string;
  dimensao: number;
  metrica: MetricaDistancia;
}

export function nomeColecaoVersionada(projeto_id: string, modelo: string, dimensao: number): string {
  return `conhecimento_${projeto_id}_${modelo.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase()}_${dimensao}`.slice(0, 80);
}

export function verificarCoerencia(local: ConfigVetorial, remoto: ConfigVetorial | null, dimensaoMaximaRemota?: number): { ok: boolean; diferencas: string[] } {
  const dif: string[] = [];
  if (dimensaoMaximaRemota !== undefined && local.dimensao > dimensaoMaximaRemota) dif.push(`dimensão ${local.dimensao} acima do máximo do provedor (${dimensaoMaximaRemota})`);
  if (remoto !== null) {
    if (remoto.modeloEmbedding !== local.modeloEmbedding) dif.push(`modelo local ${local.modeloEmbedding} ≠ remoto ${remoto.modeloEmbedding}`);
    if (remoto.dimensao !== local.dimensao) dif.push(`dimensão local ${local.dimensao} ≠ remota ${remoto.dimensao}`);
    if (remoto.metrica !== local.metrica) dif.push(`métrica local ${local.metrica} ≠ remota ${remoto.metrica}`);
  }
  return { ok: dif.length === 0, diferencas: dif };
}
