/**
 * Copies text to the clipboard as robustly as possible: first the modern async
 * Clipboard API, otherwise the execCommand fallback (works even without the
 * clipboard permission in the hardened renderer). Renderer-side only — no extra
 * main-process channel.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* Falls back to execCommand. */
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
