/**
 * Kopiert Text möglichst robust in die Zwischenablage: erst die moderne Async-
 * Clipboard-API, sonst der execCommand-Fallback (funktioniert auch ohne
 * Clipboard-Permission im gehärteten Renderer). Rein renderer-seitig — kein
 * zusätzlicher Main-Prozess-Kanal.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* Fällt auf execCommand zurück. */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
