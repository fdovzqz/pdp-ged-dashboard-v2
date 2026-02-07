import { redirect } from "next/navigation";

/** Redirige /january a / (página principal) para compatibilidad con enlaces antiguos */
export default function JanuaryRedirect(): never {
  redirect("/");
}
