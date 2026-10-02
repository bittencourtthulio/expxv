import { afterEach, describe, expect, it } from "vitest";
import { abrirBanco, migrar, type Banco } from "../banco/index";
import { criarRepositorios } from "../banco/repos/index";
import { reciboEscolhaConta, reciboModelo, reciboTroca, sanitizarTexto, trocaParaLog, type DadosReciboModelo, type DadosReciboTroca } from "./recibo";

const SEGREDOS = ["sk-ant-api03-ABCDEFGHIJKLMNOP", "Bearer abc.def.ghi", "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5", "/Users/fulano/.claude/.credentials.json", "or-v1_abcdefgh12345678"];

describe("sanitizarTexto: sem segredos", () => {
  it.each(SEGREDOS)("remove %s", (s) => {
    const r = sanitizarTexto(`conta ${s} fim`, 200);
    expect(r).not.toContain(s);
    expect(r).toMatch(/\[(oculto|caminho)\]/);
  });
  it("remove controles, colapsa espaços e limita o tamanho", () => {
    expect(sanitizarTexto("a\u0000\u001b[31m  b\n\tc")).toBe("a [31m b c");
    expect(sanitizarTexto("ab cd ".repeat(30), 10)).toHaveLength(10);
    expect(sanitizarTexto(null)).toBe("");
  });
});

describe("reciboEscolhaConta (formato do plano)", () => {
  it("com folga medida", () => {
    expect(reciboEscolhaConta({ rotulo: "Pessoal", detalhe: "reseta primeiro", task_type: "bug-fix", fonte_task_type: "regra", used_pct: 40, janela: "five_hour" })).toBe(
      "Conta Pessoal escolhida por regra (reseta primeiro). Tipo bug-fix (regra). Folga medida: 40% usado na janela five_hour.",
    );
  });
  it("dado desconhecido NUNCA vira 0%: 'Sem dado de limite'", () => {
    const r = reciboEscolhaConta({ rotulo: "A", detalhe: "d", task_type: "geral", fonte_task_type: "politica", used_pct: null, janela: null });
    expect(r).toMatch(/Sem dado de limite\./);
    expect(r).not.toMatch(/0%/);
  });
  it("rótulo com segredo é sanitizado e o recibo cabe em 240", () => {
    const r = reciboEscolhaConta({ rotulo: SEGREDOS[0] as string, detalhe: "x".repeat(300), task_type: "t", fonte_task_type: "regra", used_pct: 86.5, janela: "weekly" });
    expect(r).not.toContain(SEGREDOS[0] as string);
    expect(r.length).toBeLessThanOrEqual(240);
    expect(reciboEscolhaConta({ rotulo: "A", detalhe: "d", task_type: "t", fonte_task_type: "regra", used_pct: 86.5, janela: "weekly" })).toMatch(/86,5% usado/);
  });
});

const lado = (x: Partial<DadosReciboModelo["atual"]> = {}): DadosReciboModelo["atual"] => ({ provedor: "claude", modelo: "opus", conta_id: "cta_1", faixa: "topo", used_pct: 87, ...x });
const base = (x: Partial<DadosReciboModelo> = {}): DadosReciboModelo => ({ motivo: "outra_conta", trocando: true, atual: lado(), escolhida: { ...lado({ conta_id: "cta_2", used_pct: 20 }), janela: "five_hour" }, confianca: "alta", avisos: [], bloqueio: null, limiar_troca_pct: 85, ...x });

describe("reciboModelo", () => {
  it("cada motivo gera texto próprio, com confiança, ≤ 240", () => {
    const motivos: Array<[DadosReciboModelo["motivo"], RegExp]> = [
      ["mesma_conta_ok", /Mantido .*abaixo do gatilho de 85%/],
      ["outra_conta", /Outra conta do mesmo provedor/],
      ["outro_provedor", /outro provedor/],
      ["faixa_inferior", /Faixa inferior .*Pode render menos/],
    ];
    for (const [m, re] of motivos) {
      const r = reciboModelo(base({ motivo: m, escolhida: { ...lado({ conta_id: "cta_2", used_pct: 20, faixa: "alto" }), janela: "five_hour" } }));
      expect(r).toMatch(re);
      expect(r).toMatch(/Confiança alta\./);
      expect(r.length).toBeLessThanOrEqual(240);
    }
  });
  it("sem alternativa: diz que permanece e por quê (bloqueios nominais)", () => {
    expect(reciboModelo(base({ motivo: "sem_alternativa", escolhida: null }))).toMatch(/Sem alternativa: permanece em claude\/opus \(cta_1\); nenhuma conta ou modelo equivalente com folga/);
    expect(reciboModelo(base({ motivo: "sem_alternativa", escolhida: null, bloqueio: "operacao_nao_retomavel" }))).toMatch(/operação que não se retoma/);
    expect(reciboModelo(base({ motivo: "sem_alternativa", escolhida: null, bloqueio: "max_saltos" }))).toMatch(/limite de trocas por tarefa/);
    expect(reciboModelo(base({ motivo: "sem_alternativa", escolhida: null, bloqueio: "intervalo_entre_trocas" }))).toMatch(/intervalo mínimo/);
  });
  it("usa rótulos quando fornecidos; sem eles usa o id; desconhecido = 'sem dado de limite'", () => {
    expect(reciboModelo(base(), { cta_1: "Pessoal", cta_2: "Trabalho" })).toMatch(/Pessoal.*Trabalho/);
    expect(reciboModelo(base({ escolhida: { ...lado({ conta_id: "cta_2", used_pct: null }), janela: null } }))).toMatch(/destino sem dado de limite/);
  });
  it("modelo null = padrão da CLI; sem segredo mesmo com rótulo malicioso", () => {
    expect(reciboModelo(base({ atual: lado({ modelo: null }) }))).toMatch(/padrão da CLI/);
    expect(reciboModelo(base(), { cta_2: SEGREDOS[0] as string })).not.toContain(SEGREDOS[0] as string);
  });
});

const troca = (x: Partial<DadosReciboTroca> = {}): DadosReciboTroca => ({
  motivo: "consumo_alto",
  modo: "automatico",
  tipo_troca: "outra_conta",
  status: "feita",
  de: { provedor: "claude", modelo: "opus", conta_id: "cta_1", faixa: "topo", used_pct: 87, janela: "five_hour" },
  para: { provedor: "claude", modelo: "opus", conta_id: "cta_2", faixa: "topo", used_pct: 20 },
  limiar_troca_pct: 85,
  ...x,
});

describe("reciboTroca e troca_log (T-09.14)", () => {
  it("CT-9.18: diz de onde veio, por quê, o consumo e que o 'pensamento' não foi preservado", () => {
    const r = reciboTroca(troca(), { cta_1: "Pessoal", cta_2: "Trabalho" });
    expect(r).toMatch(/Troca feita: claude\/opus \(Pessoal\) → claude\/opus \(Trabalho\) \(outra conta do mesmo provedor\)/);
    expect(r).toMatch(/Motivo: consumo alto; origem 87% usado na janela five_hour \(gatilho 85%\), destino 20% usado/);
    expect(r).toMatch(/pensamento da sessão anterior não foi preservado/);
    expect(r.length).toBeLessThanOrEqual(480);
  });
  it("outro provedor e faixa inferior (com aviso de descida)", () => {
    expect(reciboTroca(troca({ tipo_troca: "outro_provedor", para: { provedor: "codex", modelo: null, conta_id: "cta_9", faixa: "topo", used_pct: 10 } }))).toMatch(/modelo equivalente de outro provedor/);
    const fi = reciboTroca(troca({ tipo_troca: "faixa_inferior", para: { provedor: "claude", modelo: "sonnet", conta_id: "cta_2", faixa: "alto", used_pct: 10 } }));
    expect(fi).toMatch(/Desceu de faixa \(topo → alto\): pode render menos/);
  });
  it("sugerida (só sugerir) e adiada (com a razão) e falhou (não promete pensamento preservado)", () => {
    expect(reciboTroca(troca({ status: "sugerida", modo: "so_sugerir" }))).toMatch(/Troca sugerida.*Modo só sugerir: nada foi trocado sem a sua confirmação/);
    const ad = reciboTroca(troca({ status: "adiada", adiada_por: "operacao_git" }));
    expect(ad).toMatch(/Adiada porque há operação git em curso/);
    expect(ad).not.toMatch(/pensamento/);
    expect(reciboTroca(troca({ status: "falhou" }))).not.toMatch(/pensamento/);
    expect(reciboTroca(troca({ motivo: "limite_atingido" }))).toMatch(/limite atingido/);
    expect(reciboTroca(troca({ motivo: "manual" }))).toMatch(/pedido manual/);
  });
  it("consumo desconhecido nunca vira 0%", () => {
    const r = reciboTroca(troca({ de: { provedor: "claude", modelo: "opus", conta_id: "cta_1", faixa: "topo", used_pct: null, janela: null } }));
    expect(r).toMatch(/origem sem dado de limite/);
    expect(r).not.toMatch(/origem 0%/);
  });
  it("nenhum segredo atravessa: rótulos e ids hostis são sanitizados", () => {
    const r = reciboTroca(troca(), { cta_1: SEGREDOS[0] as string, cta_2: SEGREDOS[3] as string });
    for (const s of SEGREDOS) expect(r).not.toContain(s);
    const r2 = reciboTroca(troca({ de: { provedor: SEGREDOS[1] as string, modelo: SEGREDOS[2] as string, conta_id: null, faixa: null, used_pct: 1, janela: SEGREDOS[4] as string } }));
    for (const s of SEGREDOS) expect(r2).not.toContain(s);
  });
  it("determinístico: mesma entrada, mesma saída", () => {
    expect(reciboTroca(troca())).toBe(reciboTroca(troca()));
  });
});

describe("trocaParaLog persiste no repositório real (formato de troca_log)", () => {
  const abertos: Banco[] = [];
  afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));
  it("mapeia todos os campos e o recibo gravado é o sanitizado", () => {
    const b = abrirBanco(":memory:");
    abertos.push(b);
    migrar(b);
    const r = criarRepositorios(b);
    const ws = r.workspace.criar({ nome: "w", raiz: "/w" });
    const linha = trocaParaLog({ workspace_id: ws.id, mission_id: null, task_ref: "T-1", pane_antigo_id: null, pane_novo_id: null, decisao_id: null }, troca({ status: "adiada", adiada_por: "trabalhando" }), { cta_1: SEGREDOS[0] as string });
    expect(linha).toMatchObject({ workspace_id: ws.id, task_ref: "T-1", motivo: "consumo_alto", modo: "automatico", tipo_troca: "outra_conta", status: "adiada", adiada_por: "trabalhando", consumo_origem_pct: 87, consumo_destino_pct: 20, faixa: "topo" });
    const gravada = r.trocaLog.inserir(linha);
    expect(gravada.de).toEqual({ conta_id: "cta_1", provedor: "claude", modelo: "opus" });
    expect(gravada.para.conta_id).toBe("cta_2");
    expect(gravada.recibo).not.toContain(SEGREDOS[0] as string);
    expect(gravada.recibo).toBe(linha.recibo);
    expect(r.trocaLog.listar({ workspace_id: ws.id }).itens).toHaveLength(1);
  });
});
