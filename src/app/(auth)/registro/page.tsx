import Link from "next/link";
import { registerAction } from "@/app/actions/auth";
import { inputClass, labelClass } from "@/lib/formStyles";

const ERROR_MESSAGES: Record<string, string> = {
  campos: "Preencha nome, usuário e senha.",
  senha: "A senha deve ter pelo menos 6 caracteres.",
  email: "Já existe uma conta com este usuário.",
};

export default function RegistroPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const error = searchParams.error
    ? ERROR_MESSAGES[searchParams.error] ?? "Não foi possível criar a conta."
    : null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <span className="text-4xl">🚚</span>
          <h1 className="text-xl font-bold text-neutral-900 mt-2">Central de Mudanças</h1>
        </div>

        <form
          action={registerAction}
          className="bg-white border border-neutral-200 rounded-2xl p-6 flex flex-col gap-4"
        >
          {error && (
            <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
              {error}
            </p>
          )}
          <div>
            <label className={labelClass} htmlFor="name">
              Nome
            </label>
            <input id="name" name="name" required autoFocus className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="email">
              Usuário
            </label>
            <input id="email" name="email" type="text" required className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="password">
              Senha
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={6}
              className={inputClass}
            />
          </div>
          <button
            type="submit"
            className="bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-xl px-4 py-2.5"
          >
            Criar conta
          </button>
        </form>

        <p className="text-center text-sm text-neutral-500 mt-4">
          Já tem conta?{" "}
          <Link href="/login" className="text-orange-700 font-medium hover:underline">
            Entrar
          </Link>
        </p>
      </div>
    </div>
  );
}
