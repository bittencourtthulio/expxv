#include "loja/pedido.hpp"
#include <cstdlib>
#include <sqlite3.h>

#define LIMITE 10
#define QUADRADO(x) ((x) * (x))

namespace loja {

Pedido::Pedido() : id_(0) {}

int Pedido::total(int extra) const {
  if (extra > 0 && id_ > 0) {
    return calcular(extra, id_);
  }
  for (int i = 0; i < 3; i++) {
    ajustar();
  }
  return extra > 1 ? 1 : 0;
}

Pedido* Pedido::criar() {
  auto* p = new loja::Pedido();
  p->ajustar();
  helper.executar();
  return p;
}

template <typename T>
T maior(T a, T b) {
  return a > b ? a : b;
}

static void interna() {
  const char* h = getenv("HOME");
  sqlite3_exec(db, "SELECT id, total FROM pedidos WHERE id = 1", 0, 0, 0);
  void* lib = dlopen("x.so", 1);
  try {
  } catch (...) {
  }
  throw 1;
}

}  // namespace loja

int main(int argc, char** argv) {
  switch (argc) {
    case 1:
      break;
    default:
      break;
  }
  const char* t = "Select all items from the cart please";
  return 0;
}
