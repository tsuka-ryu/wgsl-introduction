// レッスン共通のユーティリティ

// WebGPU 非対応などで処理を続けられないときに、画面へメッセージを出す。
export function fail(msg: string) {
  document.body.innerHTML = `<p style="font-family:sans-serif;padding:1rem;color:#c00">${msg}</p>`;
}
