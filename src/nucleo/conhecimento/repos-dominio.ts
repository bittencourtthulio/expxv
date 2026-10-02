// Repositórios do BANCO DO DOMÍNIO para o conhecimento e o chat (migration 0009; T-15.04). Fica em `conhecimento/` (área da fase);
// o `index.ts` de repos do domínio pode reexportar depois. Texto de mensagem JÁ redigido pelo chamador.
import type { Banco } from "../banco/banco";
import { agora as agoraIso } from "../banco/tempo";
import { idLocal } from "./ids";

export interface ConfigConhecimento {
  workspace_id: string;
  ativo: boolean;
  consulta_obrigatoria: "off" | "aviso" | "bloqueio";
  contexto_chars: number;
  hook_prompt: boolean;
  indexar_codigo: boolean;
  indexar_transcricoes: boolean;
  aprendizado_modo: "deterministico" | "assistido";
  retencao_transcricao_dias: number;
  chat_execucao: "confirmar" | "reversiveis" | "total";
}

type LinhaConfig = Omit<ConfigConhecimento, "ativo" | "hook_prompt" | "indexar_codigo" | "indexar_transcricoes"> & { ativo: number; hook_prompt: number; indexar_codigo: number; indexar_transcricoes: number };

export const CONFIG_PADRAO: Omit<ConfigConhecimento, "workspace_id"> = {
  ativo: true,
  consulta_obrigatoria: "aviso",
  contexto_chars: 2000,
  hook_prompt: true,
  indexar_codigo: true,
  indexar_transcricoes: true,
  aprendizado_modo: "deterministico",
  retencao_transcricao_dias: 90,
  chat_execucao: "reversiveis",
};

const paraConfig = (l: LinhaConfig): ConfigConhecimento => ({ ...l, ativo: l.ativo === 1, hook_prompt: l.hook_prompt === 1, indexar_codigo: l.indexar_codigo === 1, indexar_transcricoes: l.indexar_transcricoes === 1 });

export interface ConversaChat {
  id: string;
  workspace_id: string;
  titulo: string;
  modo: "perguntar" | "orquestrar";
  perfil_json: string;
  mission_alvo_id: string | null;
  indexar: boolean;
  criado_em: string;
  atualizado_em: string;
}

export interface MensagemChat {
  id: string;
  conversa_id: string;
  papel: "usuario" | "assistente" | "sistema" | "progresso";
  texto: string;
  citacoes_json: string | null;
  plano_id: string | null;
  estado: "transmitindo" | "completa" | "erro" | "cancelada";
  criado_em: string;
}

export interface PlanoPersistido {
  id: string;
  conversa_id: string;
  intencao: string;
  plano_json: string;
  estado: "proposto" | "aprovado" | "executando" | "concluido" | "cancelado" | "falhou";
  mission_id: string | null;
  pane_ids_json: string;
}

export function criarReposConhecimentoDominio(banco: Banco, relogio: () => string = agoraIso) {
  const config = {
    ler(workspace_id: string): ConfigConhecimento {
      const l = banco.consultarUm<LinhaConfig>("SELECT * FROM conhecimento_config WHERE workspace_id = ?", [workspace_id]);
      return l ? paraConfig(l) : { workspace_id, ...CONFIG_PADRAO };
    },
    gravar(workspace_id: string, mudanca: Partial<Omit<ConfigConhecimento, "workspace_id">>): ConfigConhecimento {
      const atual = config.ler(workspace_id);
      const n = { ...atual, ...mudanca };
      banco.executar(
        `INSERT INTO conhecimento_config (workspace_id,ativo,consulta_obrigatoria,contexto_chars,hook_prompt,indexar_codigo,indexar_transcricoes,aprendizado_modo,retencao_transcricao_dias,chat_execucao,atualizado_em)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(workspace_id) DO UPDATE SET ativo=excluded.ativo, consulta_obrigatoria=excluded.consulta_obrigatoria, contexto_chars=excluded.contexto_chars, hook_prompt=excluded.hook_prompt,
           indexar_codigo=excluded.indexar_codigo, indexar_transcricoes=excluded.indexar_transcricoes, aprendizado_modo=excluded.aprendizado_modo, retencao_transcricao_dias=excluded.retencao_transcricao_dias,
           chat_execucao=excluded.chat_execucao, atualizado_em=excluded.atualizado_em`,
        [workspace_id, n.ativo ? 1 : 0, n.consulta_obrigatoria, n.contexto_chars, n.hook_prompt ? 1 : 0, n.indexar_codigo ? 1 : 0, n.indexar_transcricoes ? 1 : 0, n.aprendizado_modo, n.retencao_transcricao_dias, n.chat_execucao, relogio()],
      );
      return config.ler(workspace_id);
    },
  };

  const conversa = {
    criar(p: { workspace_id: string; titulo: string; modo: ConversaChat["modo"]; perfil_json: string; mission_alvo_id?: string | null; indexar?: boolean }): ConversaChat {
      const id = idLocal("conv");
      const t = relogio();
      banco.executar("INSERT INTO chat_conversa (id,workspace_id,titulo,modo,perfil_json,mission_alvo_id,indexar,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?)", [id, p.workspace_id, p.titulo.slice(0, 120), p.modo, p.perfil_json, p.mission_alvo_id ?? null, p.indexar ? 1 : 0, t, t]);
      return conversa.obter(id) as ConversaChat;
    },
    obter(id: string): ConversaChat | undefined {
      const l = banco.consultarUm<Omit<ConversaChat, "indexar"> & { indexar: number }>("SELECT * FROM chat_conversa WHERE id = ?", [id]);
      return l ? { ...l, indexar: l.indexar === 1 } : undefined;
    },
    listar(workspace_id: string, limite = 50): ConversaChat[] {
      return banco.consultar<Omit<ConversaChat, "indexar"> & { indexar: number }>("SELECT * FROM chat_conversa WHERE workspace_id = ? ORDER BY atualizado_em DESC LIMIT ?", [workspace_id, Math.min(limite, 200)]).map((l) => ({ ...l, indexar: l.indexar === 1 }));
    },
    apagar: (id: string): void => void banco.executar("DELETE FROM chat_conversa WHERE id = ?", [id]),
    renomear: (id: string, titulo: string): void => void banco.executar("UPDATE chat_conversa SET titulo = ? WHERE id = ?", [titulo.slice(0, 120), id]),
  };

  const mensagem = {
    adicionar(p: { conversa_id: string; papel: MensagemChat["papel"]; texto: string; citacoes_json?: string | null; plano_id?: string | null; estado?: MensagemChat["estado"] }): MensagemChat {
      const id = idLocal("msg");
      const t = relogio();
      banco.transacao((tx) => {
        tx.executar("INSERT INTO chat_mensagem (id,conversa_id,papel,texto,citacoes_json,plano_id,estado,criado_em) VALUES (?,?,?,?,?,?,?,?)", [id, p.conversa_id, p.papel, p.texto.slice(0, 20000), p.citacoes_json ?? null, p.plano_id ?? null, p.estado ?? "completa", t]);
        tx.executar("UPDATE chat_conversa SET atualizado_em = ? WHERE id = ?", [t, p.conversa_id]);
      });
      return banco.consultarUm<MensagemChat>("SELECT * FROM chat_mensagem WHERE id = ?", [id]) as MensagemChat;
    },
    definirPlano: (id: string, plano_id: string): void => void banco.executar("UPDATE chat_mensagem SET plano_id = ? WHERE id = ?", [plano_id, id]),
    atualizar: (id: string, c: { texto?: string; estado?: MensagemChat["estado"]; citacoes_json?: string | null }): void => {
      if (c.texto !== undefined) banco.executar("UPDATE chat_mensagem SET texto = ? WHERE id = ?", [c.texto.slice(0, 20000), id]);
      if (c.estado !== undefined) banco.executar("UPDATE chat_mensagem SET estado = ? WHERE id = ?", [c.estado, id]);
      if (c.citacoes_json !== undefined) banco.executar("UPDATE chat_mensagem SET citacoes_json = ? WHERE id = ?", [c.citacoes_json, id]);
    },
    listar: (conversa_id: string, limite = 200): MensagemChat[] => banco.consultar<MensagemChat>("SELECT * FROM chat_mensagem WHERE conversa_id = ? ORDER BY criado_em, id LIMIT ?", [conversa_id, Math.min(limite, 1000)]),
    /** Retenção do chat (180 d): apaga mensagens antigas. */
    apagarAntes: (iso: string): number => banco.executar("DELETE FROM chat_mensagem WHERE criado_em < ?", [iso]).alteracoes,
  };

  const plano = {
    gravar(p: PlanoPersistido): void {
      const t = relogio();
      banco.executar(
        `INSERT INTO chat_plano (id,conversa_id,intencao,plano_json,estado,mission_id,pane_ids_json,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET plano_json=excluded.plano_json, estado=excluded.estado, mission_id=excluded.mission_id, pane_ids_json=excluded.pane_ids_json, atualizado_em=excluded.atualizado_em`,
        [p.id, p.conversa_id, p.intencao, p.plano_json, p.estado, p.mission_id, p.pane_ids_json, t, t],
      );
    },
    obter: (id: string): PlanoPersistido | undefined => banco.consultarUm("SELECT id,conversa_id,intencao,plano_json,estado,mission_id,pane_ids_json FROM chat_plano WHERE id = ?", [id]),
    listarPorConversa: (conversa_id: string): PlanoPersistido[] => banco.consultar("SELECT id,conversa_id,intencao,plano_json,estado,mission_id,pane_ids_json FROM chat_plano WHERE conversa_id = ? ORDER BY criado_em, id", [conversa_id]),
  };

  return { config, conversa, mensagem, plano };
}

export type ReposConhecimentoDominio = ReturnType<typeof criarReposConhecimentoDominio>;
