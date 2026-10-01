// Varredura de acessibilidade leve (T-05.05). Só para teste: nada daqui entra no bundle do app.
// Regras: nome acessível de botão/link/controle, imagem sem alt, campo sem rótulo, ids duplicados,
// aria-* inválido (nome e valor), role inexistente, tabindex positivo, filho sem pai exigido, diálogo sem nome,
// aria-hidden em foco, referência (IDREF) para id que não existe.

export interface Achado { regra: string; elemento: string; detalhe: string }

const ROLES = new Set([
  "alert", "alertdialog", "application", "article", "banner", "blockquote", "button", "caption", "cell", "checkbox", "code", "columnheader", "combobox",
  "complementary", "contentinfo", "definition", "deletion", "dialog", "directory", "document", "emphasis", "feed", "figure", "form", "generic", "grid",
  "gridcell", "group", "heading", "img", "insertion", "link", "list", "listbox", "listitem", "log", "main", "mark", "marquee", "math", "menu", "menubar",
  "menuitem", "menuitemcheckbox", "menuitemradio", "meter", "navigation", "none", "note", "option", "paragraph", "presentation", "progressbar", "radio",
  "radiogroup", "region", "row", "rowgroup", "rowheader", "scrollbar", "search", "searchbox", "separator", "slider", "spinbutton", "status", "strong",
  "subscript", "superscript", "switch", "tab", "table", "tablist", "tabpanel", "term", "textbox", "time", "timer", "toolbar", "tooltip", "tree", "treegrid",
  "treeitem",
]);

const BOOL = ["true", "false"];
const ARIA_ENUM: Record<string, readonly string[]> = {
  "aria-atomic": BOOL, "aria-busy": BOOL, "aria-disabled": BOOL, "aria-expanded": [...BOOL, "undefined"], "aria-hidden": [...BOOL, "undefined"],
  "aria-modal": BOOL, "aria-multiline": BOOL, "aria-multiselectable": BOOL, "aria-readonly": BOOL, "aria-required": BOOL, "aria-selected": [...BOOL, "undefined"],
  "aria-checked": [...BOOL, "mixed", "undefined"], "aria-pressed": [...BOOL, "mixed", "undefined"],
  "aria-current": [...BOOL, "page", "step", "location", "date", "time"],
  "aria-invalid": [...BOOL, "grammar", "spelling"], "aria-live": ["off", "polite", "assertive"],
  "aria-haspopup": [...BOOL, "menu", "listbox", "tree", "grid", "dialog"], "aria-orientation": ["horizontal", "vertical", "undefined"],
  "aria-autocomplete": ["none", "inline", "list", "both"], "aria-sort": ["none", "ascending", "descending", "other"],
  "aria-relevant": ["additions", "all", "removals", "text", "additions text"], "aria-dropeffect": ["none", "copy", "execute", "link", "move", "popup"],
  "aria-grabbed": [...BOOL, "undefined"],
};
const ARIA_NUM = ["aria-valuenow", "aria-valuemin", "aria-valuemax", "aria-level", "aria-posinset", "aria-setsize", "aria-colcount", "aria-colindex", "aria-colspan", "aria-rowcount", "aria-rowindex", "aria-rowspan"];
const ARIA_IDREF = ["aria-labelledby", "aria-describedby", "aria-controls", "aria-activedescendant", "aria-owns", "aria-flowto", "aria-details", "aria-errormessage"];
const ARIA_LIVRE = ["aria-label", "aria-valuetext", "aria-roledescription", "aria-keyshortcuts", "aria-placeholder", "aria-description", "aria-braillelabel", "aria-brailleroledescription"];
const ARIA_CONHECIDOS = new Set([...Object.keys(ARIA_ENUM), ...ARIA_NUM, ...ARIA_IDREF, ...ARIA_LIVRE]);

const PAIS_EXIGIDOS: Record<string, readonly string[]> = {
  tab: ["tablist"], option: ["listbox", "group"], menuitem: ["menu", "menubar", "group"], menuitemradio: ["menu", "menubar", "group"],
  menuitemcheckbox: ["menu", "menubar", "group"], listitem: ["list"], treeitem: ["tree", "group"], row: ["table", "grid", "treegrid", "rowgroup"],
};

/** Roles cujo nome pode vir do conteúdo. */
const NOME_DO_CONTEUDO = new Set(["button", "link", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "switch", "checkbox", "radio", "heading", "treeitem", "tooltip"]);

const descrever = (el: Element): string => {
  const id = el.id !== "" ? `#${el.id}` : "";
  const classe = typeof el.className === "string" && el.className.trim() !== "" ? `.${el.className.trim().split(/\s+/)[0]}` : "";
  const role = el.getAttribute("role");
  return `<${el.tagName.toLowerCase()}${id}${classe}${role !== null ? ` role=${role}` : ""}>`;
};

function oculto(el: Element): boolean {
  for (let a: Element | null = el; a !== null; a = a.parentElement) {
    if (a.hasAttribute("hidden") || a.getAttribute("aria-hidden") === "true") return true;
    const estilo = (a as HTMLElement).style;
    if (estilo?.display === "none" || estilo?.visibility === "hidden") return true;
  }
  return false;
}

export function papel(el: Element): string | null {
  const explicito = el.getAttribute("role")?.trim().split(/\s+/)[0];
  if (explicito !== undefined && explicito !== "") return explicito;
  const tag = el.tagName.toLowerCase();
  if (tag === "button") return "button";
  if (tag === "a" && el.hasAttribute("href")) return "link";
  if (tag === "select") return (el as HTMLSelectElement).multiple ? "listbox" : "combobox";
  if (tag === "textarea") return "textbox";
  if (tag === "input") {
    const t = ((el as HTMLInputElement).type || "text").toLowerCase();
    if (["button", "submit", "reset", "image"].includes(t)) return "button";
    if (t === "checkbox") return "checkbox";
    if (t === "radio") return "radio";
    if (t === "range") return "slider";
    if (t === "search") return "searchbox";
    if (t === "hidden") return null;
    return "textbox";
  }
  if (tag === "img") return "img";
  if (/^h[1-6]$/.test(tag)) return "heading";
  if (tag === "li") return "listitem";
  if (tag === "ul" || tag === "ol") return "list";
  if (tag === "dialog") return "dialog";
  return null;
}

function texto(el: Node, doc: Document, visitados: Set<Node>): string {
  if (visitados.has(el)) return "";
  visitados.add(el);
  if (el.nodeType === 3) return el.textContent ?? "";
  if (el.nodeType !== 1) return "";
  const e = el as Element;
  if (e.getAttribute("aria-hidden") === "true" || e.hasAttribute("hidden")) return "";
  const rotulo = e.getAttribute("aria-label")?.trim();
  if (rotulo) return rotulo;
  const tag = e.tagName.toLowerCase();
  if (tag === "img") return e.getAttribute("alt") ?? "";
  if (tag === "svg") return e.querySelector(":scope > title")?.textContent ?? "";
  return [...e.childNodes].map((n) => texto(n, doc, visitados)).join(" ");
}

/** Nome acessível (aproximação fiel o bastante para os controles do app): aria-labelledby, aria-label, rótulo nativo, conteúdo, title. */
export function nomeAcessivel(el: Element): string {
  const doc = el.ownerDocument;
  const por = el.getAttribute("aria-labelledby");
  if (por !== null) {
    const t = por.split(/\s+/).map((id) => doc.getElementById(id)).filter((x): x is HTMLElement => x !== null).map((x) => texto(x, doc, new Set())).join(" ").trim();
    if (t !== "") return t;
  }
  const rot = el.getAttribute("aria-label")?.trim();
  if (rot) return rot;
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "select" || tag === "textarea") {
    const labels = (el as HTMLInputElement).labels;
    if (labels !== null && labels !== undefined && labels.length > 0) {
      const t = [...labels].map((l) => {
        // o texto do rótulo não inclui o próprio controle
        const clone = l.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("input,select,textarea").forEach((c) => c.remove());
        return texto(clone, doc, new Set());
      }).join(" ").trim();
      if (t !== "") return t;
    }
    const tipo = ((el as HTMLInputElement).type ?? "").toLowerCase();
    if (tag === "input" && ["button", "submit", "reset"].includes(tipo)) { const v = (el as HTMLInputElement).value; if (v) return v; }
  }
  if (tag === "svg") { const t = el.querySelector(":scope > title")?.textContent?.trim(); if (t) return t; }
  if (tag === "img") { const a = el.getAttribute("alt")?.trim(); if (a) return a; }
  const p = papel(el);
  if (p !== null && NOME_DO_CONTEUDO.has(p)) {
    const t = texto(el, doc, new Set()).replace(/\s+/g, " ").trim();
    if (t !== "") return t;
  }
  return el.getAttribute("title")?.trim() ?? "";
}

const CAMPOS_COM_ROTULO = new Set(["textbox", "searchbox", "combobox", "listbox", "slider", "spinbutton", "checkbox", "radio", "switch"]);
const CONTROLES_COM_NOME = new Set(["button", "link", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option"]);

export function varrer(raiz: ParentNode = document): Achado[] {
  const achados: Achado[] = [];
  const doc = (raiz as Node).ownerDocument ?? (raiz as Document);
  const add = (regra: string, el: Element, detalhe: string) => achados.push({ regra, elemento: descrever(el), detalhe });
  const todos = [...raiz.querySelectorAll("*")];

  // ids duplicados (a página inteira conta, mesmo ocultos: o id precisa ser único no documento)
  const vistos = new Map<string, number>();
  for (const el of doc.querySelectorAll("[id]")) vistos.set(el.id, (vistos.get(el.id) ?? 0) + 1);
  for (const [id, n] of vistos) if (n > 1 && id !== "") achados.push({ regra: "id-duplicado", elemento: `#${id}`, detalhe: `${n} elementos com o mesmo id` });

  for (const el of todos) {
    const tag = el.tagName.toLowerCase();
    if (["script", "style", "link", "meta", "title", "head", "html", "body"].includes(tag)) continue;
    const escondido = oculto(el);

    // role inexistente (vale também escondido: o código está errado do mesmo jeito)
    const roleAttr = el.getAttribute("role");
    if (roleAttr !== null) {
      const fichas = roleAttr.trim().split(/\s+/).filter(Boolean);
      if (fichas.length === 0 || !fichas.some((r) => ROLES.has(r))) add("role-inexistente", el, `role="${roleAttr}"`);
    }

    // aria-* inválido
    for (const a of el.getAttributeNames()) {
      if (!a.startsWith("aria-")) continue;
      const v = el.getAttribute(a) ?? "";
      if (!ARIA_CONHECIDOS.has(a)) { add("aria-invalido", el, `atributo desconhecido ${a}`); continue; }
      const enumerado = ARIA_ENUM[a];
      if (enumerado !== undefined && !enumerado.includes(v.trim().toLowerCase()) && !(a === "aria-relevant" && v.split(/\s+/).every((x) => ["additions", "all", "removals", "text"].includes(x)))) {
        add("aria-invalido", el, `${a}="${v}" fora de {${enumerado.join(", ")}}`);
      }
      if (ARIA_NUM.includes(a) && (v.trim() === "" || !Number.isFinite(Number(v)))) add("aria-invalido", el, `${a}="${v}" não é número`);
      if (ARIA_IDREF.includes(a)) {
        const ids = v.split(/\s+/).filter(Boolean);
        const faltam = ids.filter((id) => doc.getElementById(id) === null);
        // aria-controls de algo colapsado (aria-expanded=false) pode apontar para um elemento ainda inexistente
        const colapsado = a === "aria-controls" && el.getAttribute("aria-expanded") === "false";
        if (ids.length === 0) add("aria-invalido", el, `${a} vazio`);
        else if (faltam.length > 0 && !colapsado) add("aria-invalido", el, `${a} aponta para id inexistente: ${faltam.join(", ")}`);
      }
      if (a === "aria-label" && v.trim() === "") add("aria-invalido", el, "aria-label vazio");
    }

    // tabindex positivo
    const ti = el.getAttribute("tabindex");
    if (ti !== null && Number.parseInt(ti, 10) > 0) add("tabindex-positivo", el, `tabindex="${ti}"`);

    if (escondido) continue;
    const p = papel(el);

    // controles sem nome
    if (p !== null && CONTROLES_COM_NOME.has(p) && nomeAcessivel(el) === "") add(p === "link" ? "link-sem-nome" : "botao-sem-nome", el, "sem texto, aria-label nem aria-labelledby");

    // imagens
    if (tag === "img" && !el.hasAttribute("alt") && p !== "presentation" && p !== "none") add("imagem-sem-alt", el, "<img> sem atributo alt");
    if ((p === "img" && tag !== "img") && nomeAcessivel(el) === "") add("imagem-sem-alt", el, "role=img sem aria-label");
    if (tag === "svg" && p === null && el.getAttribute("aria-hidden") !== "true" && el.querySelector(":scope > title") === null && !el.hasAttribute("aria-label") && !el.hasAttribute("role")) {
      add("imagem-sem-alt", el, "<svg> decorativo sem aria-hidden=true");
    }

    // campos
    if (p !== null && CAMPOS_COM_ROTULO.has(p) && !(tag === "input" && (el as HTMLInputElement).type === "hidden") && nomeAcessivel(el) === "") add("campo-sem-rotulo", el, "sem <label>, aria-label nem aria-labelledby");
    if (p === "heading" && nomeAcessivel(el) === "") add("titulo-vazio", el, "título sem texto");

    // diálogo/região viva nomeados
    if ((p === "dialog" || p === "alertdialog") && nomeAcessivel(el) === "") add("dialogo-sem-nome", el, "diálogo sem aria-label/aria-labelledby");

    // pais obrigatórios
    const exigidos = p === null ? undefined : PAIS_EXIGIDOS[p];
    if (exigidos !== undefined) {
      let ok = false;
      for (let a = el.parentElement; a !== null && !ok; a = a.parentElement) {
        const pa = papel(a);
        if (pa !== null && exigidos.includes(pa)) ok = true;
      }
      if (!ok) add("pai-obrigatorio", el, `role=${p} fora de ${exigidos.join(" | ")}`);
    }
  }

  // foco dentro de aria-hidden
  for (const el of doc.querySelectorAll('[aria-hidden="true"]')) {
    if (el.closest("[hidden]") !== null) continue;
    const foco = el.matches('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ? el : el.querySelector('button:not([disabled]), a[href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])');
    if (foco !== null && !(foco as HTMLButtonElement).disabled && raiz.contains(foco)) add("aria-hidden-focavel", foco, "elemento focável dentro de aria-hidden=true");
  }
  return achados;
}

export const formatar = (achados: readonly Achado[]): string => achados.map((a) => `[${a.regra}] ${a.elemento}: ${a.detalhe}`).join("\n");
