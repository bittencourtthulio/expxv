#include "banco.h"
#include "util/log.h"
#include <stdlib.h>

#define VERSAO 3

static int estado = 0;

int banco_abrir(const char *caminho) {
  if (caminho == NULL || estado) {
    log_erro("sem caminho");
    return -1;
  }
  char buf[64];
  snprintf(buf, sizeof buf, "UPDATE contas SET aberto = %d WHERE id = 1", 1);
  void (*cb)(int) = NULL;
  (*cb)(1);
  return 0;
}

static void limpar(void) {
  free(NULL);
}

int main(void) {
  EXEC SQL SELECT nome FROM clientes WHERE id = :id;
  return banco_abrir("x");
}
