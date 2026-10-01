// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { varrer } from "./varredura";

function regras(html: string): string[] {
  const raiz = document.createElement("div");
  raiz.innerHTML = html;
  document.body.append(raiz);
  try { return varrer(raiz).map((a) => a.regra).sort(); } finally { raiz.remove(); }
}

describe("varredura de acessibilidade (utilitário próprio)", () => {
  it("marcação correta passa sem achados", () => {
    expect(regras(`
      <button>Salvar</button><button aria-label="Fechar"><svg aria-hidden="true"></svg></button>
      <label>Nome <input type="text" /></label><input aria-label="Busca" />
      <label for="e">E-mail</label><input id="e" />
      <img src="x" alt="" /><img src="y" alt="logo" />
      <div role="tablist"><button role="tab" aria-selected="true" tabindex="0">A</button></div>
      <ul role="listbox" aria-label="x"><li role="option" aria-selected="false">1</li></ul>
      <div role="dialog" aria-modal="true" aria-label="Diálogo"></div>
      <button aria-expanded="false" aria-controls="ainda-nao-existe">Abrir</button>`)).toEqual([]);
  });

  it("detecta botão e link sem nome (inclusive só com ícone aria-hidden)", () => {
    expect(regras('<button></button><button><svg aria-hidden="true"></svg></button><a href="#x"></a>')).toEqual(["botao-sem-nome", "botao-sem-nome", "link-sem-nome"]);
  });

  it("detecta imagem sem alt, role=img sem nome e svg decorativo sem aria-hidden", () => {
    expect(regras('<img src="x" /><span role="img"></span><svg></svg>')).toEqual(["imagem-sem-alt", "imagem-sem-alt", "imagem-sem-alt"]);
  });

  it("detecta campo sem rótulo (placeholder não conta)", () => {
    expect(regras('<input placeholder="Nome" /><select></select><textarea></textarea>')).toEqual(["campo-sem-rotulo", "campo-sem-rotulo", "campo-sem-rotulo"]);
  });

  it("detecta ids duplicados", () => {
    expect(regras('<div id="a"></div><div id="a"></div>')).toEqual(["id-duplicado"]);
  });

  it("detecta aria-* inválido: nome, valor, número e referência inexistente", () => {
    expect(regras('<div aria-foo="1"></div><div aria-pressed="talvez"></div><div aria-valuenow="x"></div><div aria-labelledby="nada"></div>'))
      .toEqual(["aria-invalido", "aria-invalido", "aria-invalido", "aria-invalido"]);
  });

  it("detecta role inexistente", () => {
    expect(regras('<div role="botao"></div><div role="button foo">x</div>')).toEqual(["role-inexistente"]);
  });

  it("detecta tabindex positivo", () => {
    expect(regras('<div tabindex="2">x</div><div tabindex="0">y</div><div tabindex="-1">z</div>')).toEqual(["tabindex-positivo"]);
  });

  it("detecta aba fora de tablist, item de lista fora de lista, diálogo sem nome e foco em aria-hidden", () => {
    expect(regras('<button role="tab">A</button>')).toEqual(["pai-obrigatorio"]);
    expect(regras('<div role="dialog"></div>')).toEqual(["dialogo-sem-nome"]);
    expect(regras('<div aria-hidden="true"><button>x</button></div>')).toEqual(["aria-hidden-focavel"]);
  });

  it("ignora conteúdo oculto ([hidden]) nas regras de nome", () => {
    expect(regras("<div hidden><button></button></div>")).toEqual([]);
  });
});
