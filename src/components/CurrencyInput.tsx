"use client";

import { useState } from "react";

// Digita os números e o valor vai se ajustando da direita pra esquerda (como
// nos apps de banco): "1" -> R$ 0,01, "18" -> R$ 0,18, "1800" -> R$ 18,00.
// Manda o valor de verdade num input escondido, pro form action continuar
// lendo por `name` normalmente.
export default function CurrencyInput({
  name,
  defaultValue,
  className,
}: {
  name: string;
  defaultValue: number | null;
  className?: string;
}) {
  const [cents, setCents] = useState(() => Math.round((defaultValue ?? 0) * 100));

  const display =
    cents === 0
      ? ""
      : (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <>
      <input
        type="text"
        inputMode="numeric"
        value={display}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "");
          setCents(digits ? parseInt(digits, 10) : 0);
        }}
        placeholder="R$ 0,00"
        className={className}
      />
      <input type="hidden" name={name} value={(cents / 100).toFixed(2)} />
    </>
  );
}
