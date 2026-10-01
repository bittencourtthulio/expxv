import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { SCHEMA_SUPORTADO, type Artefato, type RejeicaoLeitura, type VereditoTexto } from "../tipos";
import { extrairFrontmatter } from "./frontmatter";
import { KIND_DESCONHECIDO, normalizarKind } from "./kinds";
import { extrairVeredito } from "./veredito";

export const LIMITE_BYTES = 2 * 1024 * 1024;

/** Artefatos que, por desenho das skills, não têm frontmatter: não contam como rejeição. */
const SEM_FRONTMATTER_NORMAL = new Set([
  "00-AUDITORIA.md", "00-LACUNAS.md", "PR.md", "QA-PACOTE.md", "ATENCAO.md",
  "PERFIL.md", "LACUNAS.md", "DIVIDA.md", "CONVENCOES.md", "RESUMO.md", "HISTORICO.md",
]);

const FAIXA = /^[ \t]*#{1,6}[ \t]*FAIXA:[ \t]*\**[ \t]*(BAIXO|M[ÉE]DIO|ALTO)\b/im;

function normalizarCaminho(rel: string): string {
  return rel.replace(/\\/g, "/").replace(/^\.\//, "");
}

function nomeDe(caminho: string): string {
  return caminho.slice(caminho.lastIndexOf("/") + 1);
}

function ferramentaPorCaminho(caminho: string): string | null {
  if (/^docs\/entregas\//.test(caminho)) return "mergex";
  if (/^docs\/legado\//.test(caminho)) return "legadox";
  if (/^docs\/stack\//.test(caminho)) return "stackx";
  if (/^docs\/design-system\//.test(caminho)) return "designx";
  if (/^docs\/produto\//.test(caminho)) return "prodx";
  return null;
}

function versaoDoSchemaProdx(schema: unknown): number | null {
  if (typeof schema !== "string") return null;
  const m = /^expx-schema-v(\d+)$/.exec(schema.trim());
  return m?.[1] ? Number(m[1]) : null;
}

function vazio(caminho: string, rejeicao: RejeicaoLeitura, avisos: string[] = []): Artefato {
  return {
    caminho,
    nome: nomeDe(caminho),
    ferramenta: ferramentaPorCaminho(caminho),
    kind: KIND_DESCONHECIDO,
    trabalho_id: null,
    dados: null,
    corpo: "",
    veredito: null,
    faixa: null,
    rejeicao,
    avisos,
  };
}

/**
 * Lê um arquivo de estado do método e devolve o `Artefato`. Nunca lança (entrada malformada,
 * arquivo sumido ou grande demais viram `rejeicao`). Aplica os leitores específicos dos drifts
 * conhecidos: prodx (`schema`/`pd_id`), legadox/stackx (regex de FAIXA), ENTREGA.md
 * (`expx_tool: runx` mesmo em sprintx), designx, VEREDITO por regex.
 */
export async function lerArtefato(raiz: string, relativo: string): Promise<Artefato> {
  const caminho = normalizarCaminho(relativo);
  const nome = nomeDe(caminho);
  try {
    const abs = join(raiz, ...caminho.split("/"));
    const info = await stat(abs);
    if (info.size > LIMITE_BYTES) return vazio(caminho, "arquivo_grande", [`${caminho}: arquivo acima de 2 MB ignorado`]);
    const texto = await readFile(abs, "utf8");

    const fm = extrairFrontmatter(texto);
    const avisos: string[] = [];
    let rejeicao: RejeicaoLeitura | null = null;
    const dados = fm.dados;

    if (dados === null) {
      if (fm.motivo === "sem_frontmatter") {
        if (!SEM_FRONTMATTER_NORMAL.has(nome) && !/^docs\/(legado|stack)\//.test(caminho)) rejeicao = "sem_frontmatter";
      } else {
        rejeicao = "yaml_invalido";
        avisos.push(`${caminho}: frontmatter ${fm.motivo === "truncado" ? "truncado (gravação em andamento?)" : "inválido"}`);
      }
    } else {
      const v = dados.expx_schema;
      if (typeof v === "number" && v > SCHEMA_SUPORTADO) rejeicao = "schema_maior";
      const vp = versaoDoSchemaProdx(dados.schema);
      if (vp !== null && vp > SCHEMA_SUPORTADO) rejeicao = "schema_maior";
    }

    let ferramenta: string | null = null;
    let trabalhoId: string | null = null;
    if (dados) {
      if (typeof dados.expx_tool === "string") ferramenta = dados.expx_tool;
      else if (typeof dados.schema === "string" && dados.schema.startsWith("expx-schema-v")) ferramenta = "prodx";
      const id = dados.trabalho_id ?? dados.pd_id ?? dados.projeto_id;
      if (typeof id === "string" && id.trim() !== "") trabalhoId = id.trim();
    }
    // ENTREGA.md é da mergex, embora grave expx_tool: runx; o caminho decide.
    const porCaminho = ferramentaPorCaminho(caminho);
    if (nome === "ENTREGA.md" || (porCaminho !== null && porCaminho !== "prodx" && ferramenta === null)) ferramenta = porCaminho;
    if (ferramenta === null) ferramenta = porCaminho;

    let veredito: VereditoTexto | null = null;
    if (nome === "00-AUDITORIA.md" || nome === "QA.md") {
      veredito = extrairVeredito(fm.corpo);
      if (veredito === null && dados) {
        const dv = dados.veredito;
        if (dv === "aprovado" || dv === "reprovado") veredito = dv;
      }
    }

    let faixa: string | null = null;
    if (/^docs\/(legado|stack)\//.test(caminho)) {
      const m = FAIXA.exec(fm.corpo);
      if (m?.[1]) faixa = m[1].toLowerCase().replace("é", "e");
    }

    return {
      caminho,
      nome,
      ferramenta,
      kind: dados ? normalizarKind(dados.kind) : KIND_DESCONHECIDO,
      trabalho_id: trabalhoId,
      dados,
      corpo: fm.corpo,
      veredito,
      faixa,
      rejeicao,
      avisos,
    };
  } catch {
    return vazio(caminho, "ilegivel");
  }
}
