// The Book of Shaders — 07 形について: SDF を min/max で組み合わせる (集合演算)
// https://thebookofshaders.com/07/?lan=jp
//
// 2 つの形の SDF (符号付き距離: 外=+ / 縁=0 / 中=-) を作り、min/max で合成する。
// 距離フィールドだからこそ、形の「集合演算」が 1 つの式で書ける:
//
//   d = min(d1, d2)    … 和集合 (union)      … どちらかの中 → くっつく
//   d = max(d1, d2)    … 積集合 (intersect)  … 両方の中だけ → 重なりのレンズ
//   d = max(d1, -d2)   … 差     (subtract)   … d1 から d2 をくり抜く (-d2 で内外反転)
//
// なぜ成り立つか (符号で考える: 中が負):
//   min … より小さい(より中)を採用 → どちらかが中なら結果も中 = 和
//   max … より大きい(より外)を採用 → 両方中のときだけ中 = 積
//   -d2 … d2 の内外を反転 → max(d1,-d2) は「d1 の中 かつ d2 の外」= 差
//
// アニメ: 円と四角を左右に往復させ、重なったり離れたりさせる。
//   → union は融合、intersect は重なりだけ出現、subtract は欠けた形、と動きで違いが見える。

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
    label: "book of shaders 07 - combine SDFs with min/max",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // 円の SDF: 中心からの距離 - 半径。外=+ / 縁=0 / 中=-。
      fn sdCircle(p: vec2f, r: f32) -> f32 {
        return length(p) - r;
      }

      // 四角の SDF: 半径 b の長方形。07-distance-field でやった box SDF (外+/中-)。
      fn sdBox(p: vec2f, b: vec2f) -> f32 {
        let d = abs(p) - b;
        return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0);
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;
        st = st * 2.0 - 1.0;                       // 中心を原点に (-1〜+1)
        st.x *= u.resolution.x / u.resolution.y;  // アスペクト補正

        // 円と四角を左右に往復させる (重なり↔分離)。
        let sep = 0.45 * sin(u.time * 0.8);
        let d1 = sdCircle(st - vec2f(-sep, 0.0), 0.45);     // 動く円
        let d2 = sdBox(st - vec2f(sep, 0.0), vec2f(0.38));  // 動く四角

        // ▼ 組み合わせ: 1 行だけ有効に ▼
        let d = min(d1, d2);        // 和集合 (くっつく)
        // let d = max(d1, d2);     // 積集合 (重なりのレンズ)
        // let d = max(d1, -d2);    // 差 (円から四角をくり抜く)
        // ▲ ここまで ▲

        // d<0 が中。縁(d=0)を smoothstep でなめらかに塗る。
        let bg    = vec3f(0.07, 0.08, 0.12);
        let fill  = vec3f(0.95, 0.55, 0.35);
        let mask  = 1.0 - smoothstep(0.0, 0.015, d);
        // 内側の等高線リングをうっすら重ねて SDF らしさを出す。
        let rings = 0.06 * smoothstep(0.45, 0.5, abs(fract(d * 12.0) - 0.5) * 2.0);
        let color = mix(bg, fill, mask) - rings * mask;

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "sdf combine pipeline",
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
