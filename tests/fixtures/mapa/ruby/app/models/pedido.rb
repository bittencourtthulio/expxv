require 'json'
require_relative "../services/calculo"
autoload :Relatorio, "relatorio"

module Loja
  # Pedido da loja.
  class Pedido < ApplicationRecord
    include Comparable
    extend Forwardable

    LIMITE = 10

    # Calcula o total do pedido.
    def total(extra, desconto = 0)
      if extra && desconto > 0
        Calculo.new(self).run
      elsif extra
        ajustar
      end
      send(:recalcular)
      raise ArgumentError, "inválido" if desconto < 0
      @chave ||= ENV["CHAVE_X"]
      linhas.find_by_sql("SELECT * FROM itens WHERE pedido_id = 1")
      Loja::Fatura.new
    rescue StandardError
    end

    def self.criar
      new
    end

    def ajustar; end

    private

    def oculto; end

    def tambem_oculto; end
  end

  class Item < ApplicationRecord
    self.table_name = "itens_loja"
  end
end

def utilitario
  eval("1 + 1")
end
