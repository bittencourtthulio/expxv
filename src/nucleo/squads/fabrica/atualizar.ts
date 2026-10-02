// Atualização de squads de fábrica em 3 vias (Fase 14, D-206). PURO. Compara, por unidade, o ORIGINAL ANTIGO (hash em
// `origem.json`), a CÓPIA DO USUÁRIO e o ORIGINAL NOVO: a edição do usuário NUNCA é sobrescrita.
//   `squad.json`        → hash dos campos da squad (descrição, escopo, limites, portões; sem slug/nome/membros)
//   `membros/<slug>.md` → hash do membro (metadados + corpo do prompt)
// O mesmo hash alimenta o `manifesto.json` da fábrica e o `origem.json` das cópias.
import { createHash } from "node:crypto";
import type { EstadoMembroFabrica, FabricaAtualizacao, Membro, ProvenienciaFabrica, Squad } from "../tipos";
import { caminhoPromptDe } from "../tipos";

export const CHAVE_SQUAD = "squad.json";
const sha = (t: string): string => createHash("sha256").update(t).digest("hex");

export const hashDeCamposDaSquad = (s: Squad): string =>
  sha(JSON.stringify([s.descricao, s.escopo, s.rigidez_padrao, s.max_instancias_paralelas, s.orcamento.tempo_min, s.orcamento.tokens, s.orcamento.modo, s.portoes]));

export const hashDeMembro = (m: Membro, corpo: string): string =>
  sha(
    JSON.stringify([
      m.slug, m.papel, m.rotulo, m.descricao, m.perfil.cli, m.perfil.modelo, m.perfil.esforco, m.perfil.faixa,
      m.skills_permitidas, m.mcps_permitidos, m.hooks, m.max_instancias, m.orcamento.tempo_min, m.orcamento.tokens, m.orcamento.modo, m.rigidez, m.permissao, corpo,
    ]),
  );

/** Hashes comparáveis de uma squad (a fábrica ou uma cópia): `squad.json` + um por membro. */
export function hashesDaSquad(s: Squad, prompts: Record<string, string>): Record<string, string> {
  const r: Record<string, string> = { [CHAVE_SQUAD]: hashDeCamposDaSquad(s) };
  for (const m of s.membros) r[caminhoPromptDe(m.slug)] = hashDeMembro(m, prompts[m.slug] ?? "");
  return r;
}

/** `origem.json` de uma cópia criada a partir do original de fábrica. */
export function proveniencia(original: Squad, prompts: Record<string, string>): ProvenienciaFabrica {
  return { fabrica_id: original.fabrica?.id ?? original.slug, versao: original.fabrica?.versao ?? 1, arquivos: hashesDaSquad(original, prompts) };
}

/** 3 vias de uma unidade. `undefined` = a unidade não existe naquele lado. */
export function estadoDaUnidade(antigo: string | undefined, usuario: string | undefined, novo: string | undefined): EstadoMembroFabrica {
  if (antigo === undefined) {
    // não veio do original antigo: ou é novo na fábrica, ou foi criado pelo usuário
    if (novo === undefined) return "igual";
    if (usuario === undefined) return "novo";
    return usuario === novo ? "igual" : "editado";
  }
  if (novo === undefined) return usuario === undefined ? "igual" : "removido";
  if (usuario === undefined) return "editado"; // o usuário apagou: nunca recria em silêncio
  if (usuario === antigo) return novo === antigo ? "igual" : "atualizavel";
  return usuario === novo ? "igual" : "editado";
}

const nomeDaChave = (chave: string): string => (chave === CHAVE_SQUAD ? "@squad" : chave.slice("membros/".length, -".md".length));

/** Compara as três versões. `versao_nova` só quando a fábrica subiu de versão; as unidades `igual` não aparecem. */
export function compararComFabrica(
  antigo: ProvenienciaFabrica,
  usuario: Record<string, string>,
  novo: { versao: number; arquivos: Record<string, string> },
): FabricaAtualizacao {
  const chaves = [...new Set([...Object.keys(antigo.arquivos), ...Object.keys(usuario), ...Object.keys(novo.arquivos)])].sort();
  const membros: FabricaAtualizacao["membros"] = [];
  for (const c of chaves) {
    const estado = estadoDaUnidade(antigo.arquivos[c], usuario[c], novo.arquivos[c]);
    if (estado !== "igual") membros.push({ membro: nomeDaChave(c), estado });
  }
  return { versao_nova: novo.versao > antigo.versao ? novo.versao : null, membros };
}
