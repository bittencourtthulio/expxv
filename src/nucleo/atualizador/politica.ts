// Política de decisão (Fase 21, T-21.13): assinatura PRIMEIRO, depois canal, validade, anti-replay, anti-downgrade, artefato e rollout.
// Função pura: relógio e `idInstalacao` entram por parâmetro. Nenhum manifesto sem assinatura válida chega a `disponivel` (AU-01).
import type {
  ArquiteturaAtualizacao,
  ArtefatoAtualizacao,
  CanalAtualizacao,
  ManifestoAtualizacao,
  MotivoAtualizacao,
  PlataformaAtualizacao,
} from "../../compartilhado/atualizacao";
import { verificarAssinatura } from "./assinatura";
import { canalPermitido } from "./canais";
import { dentroDoRollout } from "./rollout";
import { compararTextos } from "./versao";
import { dataIso, lerManifesto } from "./manifesto";

export interface EntradaAvaliacao {
  /** bytes originais do manifesto e assinatura destacada recebida. */
  bytes: Uint8Array;
  assinatura: string | Uint8Array | null | undefined;
  chavesAceitas: readonly string[];
  /** chaves já revogadas e persistidas localmente (só crescem). */
  revogadasLocais?: readonly string[];
  versaoAtual: string;
  /** canal que a pessoa escolheu (o manifesto precisa ser do MESMO canal). */
  canal: CanalAtualizacao;
  betaConsentido: boolean;
  idInstalacao: string;
  agora: Date;
  /** maior `publicado_em` já visto (anti-replay), em ISO; `null` na primeira vez. */
  ultimoPublicadoEm: string | null;
  plataforma: PlataformaAtualizacao;
  arquitetura: ArquiteturaAtualizacao;
  /** tolerância de relógio para `publicado_em` no futuro. */
  toleranciaFuturoMs?: number;
}

export type Avaliacao =
  | {
      ok: true;
      tipo: "disponivel";
      manifesto: ManifestoAtualizacao;
      artefato: ArtefatoAtualizacao;
      /** a versão atual está abaixo de `versao_minima`: o rollout não adia. */
      obrigatoria: boolean;
      chaveUsada: string;
      /** chaves a persistir como revogadas (monotônico). */
      novasRevogadas: string[];
    }
  | { ok: true; tipo: "atual"; manifesto: ManifestoAtualizacao; chaveUsada: string; novasRevogadas: string[]; motivo: "ja_atual" | "fora_do_rollout" }
  | { ok: false; motivo: MotivoAtualizacao };

const TOLERANCIA_PADRAO_MS = 24 * 3_600_000;
const recusa = (motivo: MotivoAtualizacao): Avaliacao => ({ ok: false, motivo });

export function avaliarManifesto(e: EntradaAvaliacao): Avaliacao {
  // 1. assinatura sobre os bytes originais, ANTES de interpretar o conteúdo (AU-01)
  const s = verificarAssinatura(e.bytes, e.assinatura, e.chavesAceitas, e.revogadasLocais ?? []);
  if (!s.ok) return recusa(s.motivo);
  // 2. forma estrita
  const l = lerManifesto(e.bytes);
  if (!l.ok) return recusa("manifesto_invalido");
  const m = l.manifesto;
  if (m.nao_assinado === true) return recusa("assinatura_ausente"); // defesa em profundidade (D-348)
  const novasRevogadas = (m.chaves_revogadas ?? []).filter((c) => !(e.revogadasLocais ?? []).includes(c));
  if ((m.chaves_revogadas ?? []).includes(s.chave)) return recusa("chave_revogada"); // um manifesto não se assina com a chave que ele mesmo revoga
  // 3. canal (AU-06)
  if (m.canal !== e.canal) return recusa("canal_cruzado");
  if (!canalPermitido(e.canal, e.betaConsentido)) return recusa("canal_nao_permitido");
  // 4. validade e relógio (AU-05)
  const agora = e.agora.getTime();
  const pub = dataIso(m.publicado_em) as number;
  const val = dataIso(m.valido_ate) as number;
  if (pub > agora + (e.toleranciaFuturoMs ?? TOLERANCIA_PADRAO_MS)) return recusa("manifesto_invalido");
  if (agora > val) return recusa("expirado");
  // 5. anti-replay monotônico por `publicado_em`
  if (e.ultimoPublicadoEm !== null) {
    const ultimo = dataIso(e.ultimoPublicadoEm);
    if (ultimo !== null && pub < ultimo) return recusa("manifesto_antigo");
  }
  // 6. anti-downgrade (AU-02)
  const cmp = compararTextos(m.versao, e.versaoAtual);
  if (cmp === null) return recusa("manifesto_invalido");
  if (cmp === -1) return recusa("downgrade");
  if (cmp === 0) return { ok: true, tipo: "atual", manifesto: m, chaveUsada: s.chave, novasRevogadas, motivo: "ja_atual" };
  // 7. artefato da plataforma (universal só vale no macOS)
  const artefato = m.artefatos.find((a) => a.plataforma === e.plataforma && a.arquitetura === e.arquitetura) ?? (e.plataforma === "darwin" ? m.artefatos.find((a) => a.plataforma === "darwin" && a.arquitetura === "universal") : undefined);
  if (artefato === undefined) return recusa("sem_artefato");
  // 8. versão mínima torna a atualização obrigatória; senão vale o rollout (AU-16)
  const abaixoDoMinimo = m.versao_minima !== undefined && compararTextos(e.versaoAtual, m.versao_minima) === -1;
  if (!abaixoDoMinimo && !dentroDoRollout(e.idInstalacao, m.versao, m.staging)) return { ok: true, tipo: "atual", manifesto: m, chaveUsada: s.chave, novasRevogadas, motivo: "fora_do_rollout" };
  return { ok: true, tipo: "disponivel", manifesto: m, artefato, obrigatoria: abaixoDoMinimo, chaveUsada: s.chave, novasRevogadas };
}
