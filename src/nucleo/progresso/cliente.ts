// Entrada do RENDERER no núcleo do painel de progresso: só o que é leve e puro (máquina de ciclo e formatação). Fica de fora tudo que lê o catálogo do
// Maestro (derivadores), que roda no main; assim o bundle da interface não carrega o catálogo.
export * from "./ciclo";
export * from "./formato";
