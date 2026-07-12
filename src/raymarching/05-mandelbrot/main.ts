// レイマーチング — 05 マンデルブロ集合
// wgld.org GLSL 連載 第5回「マンデルブロ集合」を WGSL に忠実に読み替え。
// https://wgld.org/d/glsl/g005.html
// 原典 GLSL(抜粋):
//   vec2  p = (gl_FragCoord.xy * 2.0 - resolution) / min(resolution.x, resolution.y);
//   vec2  x = p + vec2(-0.5, 0.0);
//   float y = 1.5 - mouse.x * 0.5;           // マウスで拡大度を変える
//   vec2  z = vec2(0.0);
//   for (int i=0;i<360;i++){ j++; if(length(z)>2.0)break; z = vec2(z.x*z.x-z.y*z.y, 2*z.x*z.y) + x*y; }
//   float h = mod(time*20.0,360.0)/360.0;    // 色相を時間で回す
//   gl_FragColor = vec4(hsv(h,1,1) * float(j)/360.0, 1.0);
//
// 01 で作った「色 = f(uv)」の器の中身を、複素数の反復に差し替える回。
// まだ 3D ではないが、後のレイマーチ本体と同じ「1ピクセルの中でループを回して値を決める」構造。
//
// ● エスケープ時間アルゴリズム (この反復が全て):
//   各ピクセルに複素数 c を 1 個割り当て、z0=0 から z(n+1)=z(n)^2 + c を反復。
//   |z| が 2 を超えたら発散(脱出)。何回で脱出したか(escape time)を色にする。
//   原典は「脱出回数 j を輝度、色相を時間で回す」→ 集合の中(脱出せず j=360)ほど明るい単一色。
//
// ● 複素数を vec2f で表す:
//   z = x + iy  ↔  vec2f(x, y) / (x+iy)^2 = (x^2-y^2, 2xy) / |z|>2 の判定は length(z) で。
//
// ● この回で初めて time / mouse ユニフォームを足す(02 でスキップした分。原典 05 が使うのでここで導入)。
//   time  … 色相の周回
//   mouse … x で拡大度。ページ上でマウスを左右に動かすと集合の見え方が変わる
//
// ● 座標正規化 p = (fragCoord*2 - resolution)/min(res.x,res.y):
//   画面中心が原点 (0,0)、短辺の端が ±1 のアスペクト補正座標。wgld シリーズ共通の作り方で、
//   08 でレイの向き rd を作るときにもそのまま使う。WebGPU は y が上→下なので p.y を反転して GLSL に合わせる。
//
// FP メモ: マンデルブロ集合の denotation は述語 ℂ→bool、絵は escape-time 関数 ℂ→ℕ の色付け。
//   反復 z→z^2+c は Mandelbulb(3D)・buddhabrot でも再利用する中核式。src/raymarching/notes.md 参照。

import { fail } from "../../webgpu-fundamentals/util";

async function main() {
  // 1. アダプタとデバイスの取得
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
  context.configure({ device, format: presentationFormat });

  // 3. シェーダモジュール (頂点は 01 と同じフルスクリーン三角形)
  const module = device.createShaderModule({
    label: "raymarching 05 - mandelbrot (escape time)",
    code: /* wgsl */ `
      // メモリ配置: resolution(vec2f,0) time(f32,8) mouse(vec2f,16) → 32B に切り上げ。
      struct Uniforms {
        resolution: vec2f,
        time: f32,
        mouse: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // HSV → RGB (原典の hsv 関数をそのまま移植)。h,s,v は 0〜1。
      fn hsv(h: f32, s: f32, v: f32) -> vec3f {
        let t = vec4f(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
        let p = abs(fract(vec3f(h) + t.xyz) * 6.0 - vec3f(t.w));
        return v * mix(vec3f(t.x), clamp(p - vec3f(t.x), vec3f(0.0), vec3f(1.0)), s);
      }

      @vertex fn vs(
        @builtin(vertex_index) vertexIndex : u32
      ) -> @builtin(position) vec4f {
        let pos = array(
          vec2f(-1.0,  3.0),
          vec2f( 3.0, -1.0),
          vec2f(-1.0, -1.0),
        );
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(
        @builtin(position) position: vec4f
      ) -> @location(0) vec4f {
        // 中心原点・アスペクト補正座標。短辺の端が ±1。
        var p = (position.xy * 2.0 - u.resolution) / min(u.resolution.x, u.resolution.y);
        p.y = -p.y; // WebGPU は y が上→下。GLSL(下→上)に合わせて反転。

        // 各ピクセルに割り当てる複素数 c = x * y。
        //   x = p を原点から少しずらす / y = マウスで拡大度を変える。
        let x = p + vec2f(-0.5, 0.0);
        let y = 1.5 - u.mouse.x * 0.5;

        // z0 = 0 から z = z^2 + c を最大 360 回反復。|z|>2 で脱出。
        var z = vec2f(0.0, 0.0);
        var j = 0;
        for (var i = 0; i < 360; i++) {
          j += 1;
          if (length(z) > 2.0) { break; }
          // (x+iy)^2 = (x^2 - y^2, 2xy)、それに c = x*y を足す。
          z = vec2f(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + x * y;
        }

        // 色相を時間で周回させ、脱出回数 j/360 を輝度に。
        // → 集合の中(脱出せず j=360)ほど明るく、外は暗い。全体の色相が時間で回る。
        let h = fract(u.time * 20.0 / 360.0);
        let rgb = hsv(h, 1.0, 1.0);
        let t = f32(j) / 360.0;
        return vec4f(rgb * t, 1.0);
      }
    `,
  });

  // 4. パイプライン
  const pipeline = device.createRenderPipeline({
    label: "raymarching 05 pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: {
      module,
      entryPoint: "fs",
      targets: [{ format: presentationFormat }],
    },
  });

  // 5. ユニフォームバッファ (resolution: vec2f, time: f32, mouse: vec2f)
  const uniformBufferSize = 8 * 4; // 32 バイト
  const uniformValues = new Float32Array(uniformBufferSize / 4);
  const kResolutionOffset = 0; // [0],[1]
  const kTimeOffset = 2; // [2]
  const kMouseOffset = 4; // [4],[5] (vec2f は 16B 境界に整列)

  const uniformBuffer = device.createBuffer({
    label: "uniforms (resolution, time, mouse)",
    size: uniformBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const bindGroup = device.createBindGroup({
    label: "uniforms bind group",
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  // マウス座標 (0〜1 正規化)。原典の mouse ユニフォームに相当。
  const mouse = { x: 0.0, y: 0.0 };
  canvas.addEventListener("pointermove", (e) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - rect.left) / rect.width;
    mouse.y = (e.clientY - rect.top) / rect.height;
  });

  function render(device: GPUDevice, time: number) {
    uniformValues.set([canvas.width, canvas.height], kResolutionOffset);
    uniformValues[kTimeOffset] = time;
    uniformValues.set([mouse.x, mouse.y], kMouseOffset);
    device.queue.writeBuffer(uniformBuffer, 0, uniformValues);

    const renderPassDescriptor: GPURenderPassDescriptor = {
      label: "canvas renderPass",
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: [0, 0, 0, 1],
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    };

    const encoder = device.createCommandEncoder({ label: "encoder" });
    const pass = encoder.beginRenderPass(renderPassDescriptor);
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  // リサイズ時はキャンバス解像度だけ更新 (描画はループ側が毎フレーム行う)。
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const c = entry.target as HTMLCanvasElement;
      const width = entry.contentBoxSize[0].inlineSize;
      const height = entry.contentBoxSize[0].blockSize;
      c.width = Math.max(1, Math.min(width, device.limits.maxTextureDimension2D));
      c.height = Math.max(1, Math.min(height, device.limits.maxTextureDimension2D));
    }
  });
  observer.observe(canvas);

  // 毎フレーム time を進めて色相を回す。
  const frame = (timeMs: number) => {
    render(device, timeMs * 0.001);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main();
