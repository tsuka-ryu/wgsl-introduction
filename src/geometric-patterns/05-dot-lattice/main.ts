// 幾何学パターン — 05 ドット格子 (平面 p1): セルを縦横に敷く + ハーフドロップ
// 参考: 幾何学パターンの本 3.1「平面対称・並進」
//
// ── 平面の並進 = fract を縦横 両方に ────────────────────────
//   フリーズ(横 fract だけ)を縦にも広げただけ。色(p)=丸(セル内座標) を
//   縦横に敷き詰める。分類はまだ p1 (並進だけ)。
//
// ── 全体を関数合成で読む ──────────────────────────────────
//   色(p) = セルの色 か 背景。丸の内側ならセルの色。
//   セル(p) = fract(p·GRID + ハーフドロップ) − 0.5    … 縦横タイリング
//   ハーフドロップ = 奇数列だけ y を半分ずらす        … 碁盤の目を崩す (斜方格子)
//   セルの色 = (列, 行) から3色を巡回                  … 座標の純関数
//
// ── 1ピクセルのトレース ──────────────────────────────────
//   p がどのセル (col,row) の内側どこかを fract で出す。奇数列は半分ドロップ。
//   セル中心からの距離が半径以内なら、その (col,row) に割り当てた色で塗る。

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
    label: "geometric-patterns 05 - dot lattice",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const GRID: f32 = 12.0;      // 1辺あたりのセル数
      const RADIUS: f32 = 0.52;    // 丸の半径 (セル半幅=0.5 基準。>0.5 で隣と接触)
      const DROP: f32 = 0.5;       // 奇数列のドロップ量 (0=普通の格子, 0.5=ハーフドロップ)

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        let res = u.resolution;
        var st = position.xy / min(res.x, res.y) * GRID;   // セル単位

        let col = floor(st.x);
        let drop = DROP * f32(i32(col) & 1);               // 奇数列だけドロップ
        st.y = st.y + drop;

        let row = floor(st.y);
        let local = fract(st) - 0.5;                       // セル内 [-0.5,0.5]

        // 3色を (列+行) で巡回。ちょい灰色地
        let red    = vec3f(0.85, 0.22, 0.16);
        let blue   = vec3f(0.13, 0.34, 0.55);
        let purple = vec3f(0.48, 0.45, 0.72);
        let bg     = vec3f(0.86, 0.86, 0.83);

        let k = (i32(col) + i32(row)) % 3;
        var dot = red;
        if (k == 1) { dot = blue; }
        if (k == 2) { dot = purple; }

        // 丸: 中心からの距離が RADIUS 以内なら dot、外は背景
        let d = length(local);
        let inside = 1.0 - smoothstep(RADIUS - 0.02, RADIUS, d);
        let col3 = mix(bg, dot, inside);
        return vec4f(col3, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "dot lattice pipeline",
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
