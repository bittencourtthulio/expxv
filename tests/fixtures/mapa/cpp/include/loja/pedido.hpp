#pragma once
#include <string>
#include "loja/base.hpp"

namespace loja {

// Pedido da loja.
class Pedido : public Base, private Auditavel<int> {
 public:
  Pedido();
  virtual ~Pedido();
  virtual int total(int extra) const;
  static Pedido* criar();

 protected:
  void ajustar();

 private:
  int id_;
};

struct Item {
  int qtd;
};

enum class Estado { Aberto, Fechado };

int calcular(int a, int b);

}  // namespace loja
