using System;

namespace Velho
{
    public struct P { }
    public record R(int X) : Base(X), IFoo;
    public enum E { A, B }

    class Externa
    {
        class Aninhada { void M() { } }

        void Refletir(string nome)
        {
            var t = Activator.CreateInstance(Type.GetType(nome));
            var m = t.GetType().GetMethod("X");
            try { Fazer(); } catch (Exception) { }
            try { Fazer(); } catch (Exception e) { Log(e); }
            var s = $"SELECT * FROM usuarios WHERE id = {nome}";
            int Local() => 1;
            var tp = typeof(Outra);
        }

        void Fazer() { }
    }
}
