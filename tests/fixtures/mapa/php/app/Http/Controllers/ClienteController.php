<?php
namespace App\Http\Controllers;

use App\Models\Cliente;

abstract class ClienteController extends Controller
{
    public function index()
    {
        $dados = DB::table('clientes')->where('ativo', 1)->get();
        DB::table('logs')->insert(['x' => 1]);
        return view('clientes', ['c' => Cliente::all()]);
    }

    public function show($id)
    {
        $sql = "SELECT c.id FROM clientes c JOIN pedidos p ON p.cid = c.id WHERE c.id = $id";
        return $this->achar($id);
    }

    private function achar($id) { return null; }
}

interface Repositorio { public function achar($id); }

trait Datavel { public function criadoEm() { return 1; } }

enum Status: string { case Ativo = 'a'; }

function auxiliar() { return 1; }
