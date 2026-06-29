// The Book of Shaders — 11 ノイズ: Circle wave (勾配ノイズの応用)
// https://thebookofshaders.com/11/?lan=jp
// 原典: @patriciogv 2015 / @beesandbombs の processing「Circle wave」を移植したもの
//
// 11-gradient-noise で作った noise() を「形を揺らす材料」として使う総まとめ。
// 描くのは円のアウトライン1本だけ。だが半径を角度と時間で脈打たせ、
// さらに noise で縁をざわつかせると、生き物の細胞や水紋のように見える。
//
// 1ピクセル st での考え方 (denotational に):
//   中心(0.5,0.5)から見た「距離 r」と「角度 a」に座標変換する (極座標)。
//   ある半径 f を決め、r が f を超えたら外、超えなければ内、と smoothstep で塗り分ける。
//   肝は f を定数にしない事: f を a (角度) と time の関数にすると、
//   方向ごとに縁の位置が変わり、輪郭が花びら状にうねる。
//   そのうねりの一部に noise(角度方向のばらつき) を混ぜて有機的なギザつきを足す。
//
//   shape()        … 「ある半径の塗りつぶし円 (縁が揺れる)」を 1/0 で返す関数。
//   shapeBorder()  … shape(大) - shape(小) = 太さ width のリングだけを残す引き算。
//
// random2 / noise は 11-gradient-noise と同一 (iq の勾配ノイズ)。ここでは使う側に徹する。

import { fail } from "../../webgpu-fundamentals/util";

async function main() {
  const adapter = await navigator.gpu?.requestAdapter();
  const device = await adapter?.requestDevice();
  if (!device) {
    fail("このブラウザは WebGPU に対応していません (Chrome / Edge 113+ など)。");
    return;
  }

  const canvas = document.querySelector("canvas")!;
  const context = canvas.getContext("webgpu")!;
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: presentationFormat });

  const module = device.createShaderModule({
    label: "book of shaders 11 - circle wave",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // GLSL の mod(x,y) は floor 基準で常に [0,y)。WGSL の % は符号が x に従うので別物。
      // a+time は atan2 由来で負にもなり得るため、floor 基準の正しい剰余を自前で用意する。
      fn gmod(x: f32, y: f32) -> f32 { return x - y * floor(x / y); }

      // 格子点 → ランダムな 2D ベクトル (-1〜1)。各格子点の "勾配 (斜面の向き)"。
      fn random2(p: vec2f) -> vec2f {
        let st = vec2f(dot(p, vec2f(127.1, 311.7)), dot(p, vec2f(269.5, 183.3)));
        return -1.0 + 2.0 * fract(sin(st) * 43758.5453123);
      }

      // Gradient Noise by Inigo Quilez - iq/2013。戻り値は -1〜1 (符号つき)。
      fn noise(st: vec2f) -> f32 {
        let i = floor(st);
        let f = fract(st);
        let w = f * f * (3.0 - 2.0 * f); // smoothstep 重み
        return mix(
          mix(dot(random2(i + vec2f(0.0, 0.0)), f - vec2f(0.0, 0.0)),
              dot(random2(i + vec2f(1.0, 0.0)), f - vec2f(1.0, 0.0)), w.x),
          mix(dot(random2(i + vec2f(0.0, 1.0)), f - vec2f(0.0, 1.0)),
              dot(random2(i + vec2f(1.0, 1.0)), f - vec2f(1.0, 1.0)), w.x),
          w.y
        );
      }

      // 「縁が時間と角度で揺れる塗りつぶし円」を 1(内) / 0(外) で返す。
      fn shape(st_in: vec2f, radius: f32) -> f32 {
        let st = vec2f(0.5) - st_in;     // 中心(0.5,0.5)を原点に置き直す
        let r = length(st) * 2.0;        // 中心からの距離 (画面端で約1)
        let a = atan2(st.y, st.x);       // この点の方向 (-π〜π)

        // 角度+時間を一周(2π)で折り返した三角波。time で位相が回り、脈動の元になる。
        var m = abs(gmod(a + u.time * 2.0, 3.14 * 2.0) - 3.14) / 3.6;

        var f = radius;                  // 基準となる縁の半径
        m += noise(st + u.time * 0.1) * 0.5;            // 脈動にノイズの揺らぎを足す
        f += sin(a * 50.0) * noise(st + u.time * 0.2) * 0.1; // 高周波の細かいギザギザ (縁のざわつき)
        f += sin(a * 20.0) * 0.1 * (m * m);             // 低周波の大きなうねり。mで波打ちを変調
        // GLSL の pow(m,2.0) は m が負だと未定義。意味は二乗なので m*m にして安全化。

        // r が f を境に内→外。0.007 幅でなめらかに切り替え、内側=1 外側=0。
        return 1.0 - smoothstep(f, f + 0.007, r);
      }

      // 半径 radius の円から radius-width の円を引く = 太さ width のリングだけ残る。
      fn shapeBorder(st: vec2f, radius: f32, width: f32) -> f32 {
        return shape(st, radius) - shape(st, radius - width);
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        // GLSL は y が下から上、WebGPU は上から下。反転して本と向きを合わせる。
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;

        // リング上=1, それ以外=0。color は白(1)×その値なので、リングだけ白。
        let color = vec3f(1.0) * shapeBorder(st, 0.8, 0.02);

        // 最後に反転。リング(color=1)→黒、背景(color=0)→白。白地に黒い波打つ輪。
        return vec4f(1.0 - color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "circle wave pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format: presentationFormat }] },
  });

  const uniformBufferSize = 4 * 4; // 16 バイト
  const uniformValues = new Float32Array(uniformBufferSize / 4);
  const kResolutionOffset = 0;
  const kTimeOffset = 2;

  const uniformBuffer = device.createBuffer({
    label: "uniforms (resolution, time)",
    size: uniformBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const bindGroup = device.createBindGroup({
    label: "uniforms bind group",
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  function render(device: GPUDevice, time: number) {
    uniformValues.set([canvas.width, canvas.height], kResolutionOffset);
    uniformValues[kTimeOffset] = time;
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

  const frame = (timeMs: number) => {
    render(device, timeMs * 0.001);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main();
