const fs = require("fs");
const { join, resolve: resolver } = require("path");
const utilidades = require("./util");
require("./efeito");

/** Soma dois valores. */
function somar(a, b) {
  return a + b;
}

const multiplicar = function (a, b) {
  return a && b ? a * b : 0;
};

class Calculadora extends Base {
  dividir(a, b) {
    if (b === 0) throw new Error("divisão por zero");
    return somar(a, 0) / b;
  }
}

exports.nome = "lib";
exports.dobrar = (n) => n * 2;
module.exports.somar = somar;
module.exports = { multiplicar, Calculadora, join };
