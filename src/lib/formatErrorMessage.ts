/**
 * Sanitiza mensajes de error: evita mostrar HTML crudo (p. ej. página 524 de Cloudflare).
 */
export function formatErrorMessage(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return "Error desconocido";
  const trimmed = raw.trim();
  if (!trimmed) return "Error desconocido";

  // Detectar HTML crudo (respuestas HTTP de error como 524)
  if (
    trimmed.startsWith("<") ||
    trimmed.includes("<!DOCTYPE") ||
    trimmed.includes("<html")
  ) {
    if (
      trimmed.includes("524") ||
      trimmed.toLowerCase().includes("timeout") ||
      trimmed.includes("A timeout occurred")
    ) {
      return "Timeout: el servidor tardó demasiado en responder (524). Intenta de nuevo.";
    }
    if (
      trimmed.includes("502") ||
      trimmed.includes("503") ||
      trimmed.includes("504")
    ) {
      return "Error del servidor (5xx). Intenta de nuevo más tarde.";
    }
    return "Error del servidor. Intenta de nuevo.";
  }

  // Limitar longitud para evitar mensajes enormes
  const maxLen = 500;
  if (trimmed.length > maxLen) {
    return `${trimmed.slice(0, maxLen)}...`;
  }
  return trimmed;
}
