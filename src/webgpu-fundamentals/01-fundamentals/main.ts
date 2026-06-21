// WebGPU Fundamentals — 基本
// https://webgpufundamentals.org/webgpu/lessons/ja/webgpu-fundamentals.html
//
// すべての出発点。キャンバスを単色でクリアするだけの最小構成のレンダーパス。

async function main() {
  // 1. アダプタとデバイスの取得 (デバイス = 特定の GPU の表現)
  const adapter = await navigator.gpu?.requestAdapter();
  const device = await adapter?.requestDevice();
  if (!device) {
    fail("このブラウザは WebGPU に対応していません (Chrome / Edge 113+ など)。");
    return;
  }

  // 2. キャンバスを WebGPU 用に設定
  const canvas = document.querySelector("canvas")!;
  const context = canvas.getContext("webgpu")!;
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format: presentationFormat,
  });
  console.log({ device, presentationFormat });

  // 3. レンダーパスの記述子 (どこに・どうやって描くか)
}

function fail(msg: string) {
  document.body.innerHTML = `<p style="font-family:sans-serif;padding:1rem;color:#c00">${msg}</p>`;
}

main();
