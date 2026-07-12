// レイマーチング — 06 ジュリア集合
// wgld.org GLSL 連載 第6回「ジュリア集合」に対応。原典 GLSL はフェッチできなかったため、
// 05 マンデルブロの作りを踏襲した忠実版として実装(原典と差があればコードを見て合わせる)。
// https://wgld.org/d/glsl/g006.html
//
// ● 05 マンデルブロとの違いは「誰がピクセルか」だけ。反復式 z→z²+c は全く同じ。
//
//   マンデルブロ(05): z0 = 0 に固定 / c = f(p) (ピクセルごと)  → 各点 c は発散するか?の地図
//   ジュリア(06):     z0 = f(p) (ピクセルごと) / c = 画面全体で1個に固定 → 各出発点 z0 は発散するか?の地図
//
// ● c は画面全体で共通の1個。c を変えるとまるで違う形のジュリア集合になる。
//   → 今回はマウスで c を動かせる。マウスを動かすと画面全体のフラクタルが変形する。
//   「c は画像全体のたった1個のパラメータ」を体感するのが狙い。
//
// ● 深いつながり: マウスで選ぶ c は 05 のマンデルブロ平面上の1点。
//   その c がマンデルブロ集合の中なら繋がったジュリア、外なら砂粒状に分解する(表裏一体)。
//
// ● 構造は 05 と同じ「1ピクセル内で z→z²+c を fold して脱出回数 j を収穫」。
//   複素数 = vec2f、(x+iy)²=(x²−y², 2xy)、|z|>2 で脱出。着色も 05 と同じ(色相=time、輝度=j/360)。

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
    label: "raymarching 06 - julia set",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
        mouse: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const MAX_ITER = 360;

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
        // 中心原点・アスペクト補正座標 (05 と同じ)。
        var p = (position.xy * 2.0 - u.resolution) / min(u.resolution.x, u.resolution.y);
        p.y = -p.y;

        // ★ 05 との唯一の違い: ピクセルは「出発点 z0」。 (05 では z0=0、c=ピクセルだった)
        //   ジュリア集合は |z|<2 あたりに広がるので 1.5 倍して全景を映す。
        var z = p * 1.5;

        // c は画面全体で1個の定数。マウスで動かす (0〜1 を複素平面 [-1,1] へ)。
        //   この c を変えると全く別のジュリア集合になる = c は画像全体のパラメータ。
        let c = vec2f(u.mouse.x * 2.0 - 1.0, -(u.mouse.y * 2.0 - 1.0));

        // z0 から z = z^2 + c を反復。|z|>2 で脱出 (05 と全く同じループ)。
        var j = 0;
        for (var i = 0; i < MAX_ITER; i++) {
          j += 1;
          if (length(z) > 2.0) { break; }
          z = vec2f(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
        }

        // 着色は 05 と同じ: 色相を時間で回し、脱出回数 j/360 を輝度に (有界=明るい)。
        let h = fract(u.time * 20.0 / 360.0);
        let rgb = hsv(h, 1.0, 1.0);
        let t = f32(j) / f32(MAX_ITER);
        return vec4f(rgb * t, 1.0);
      }
    `,
  });

  // 4. パイプライン
  const pipeline = device.createRenderPipeline({
    label: "raymarching 06 pipeline",
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
  const kResolutionOffset = 0;
  const kTimeOffset = 2;
  const kMouseOffset = 4;

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

  // マウス座標 (0〜1)。初期値は繋がった綺麗なジュリア (c ≈ -0.4 + 0.6i) になる位置。
  const mouse = { x: 0.3, y: 0.2 };
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

  // 毎フレーム time を進めて色相を回す (c はマウスで動かす)。
  const frame = (timeMs: number) => {
    render(device, timeMs * 0.001);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main();
