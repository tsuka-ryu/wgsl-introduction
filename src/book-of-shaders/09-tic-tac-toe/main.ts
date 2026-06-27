// The Book of Shaders — 09 パターン: 練習 Tic-tac-toe (floor でマスを分岐)
// https://thebookofshaders.com/09/?lan=jp
//
// 09-tiling では fract で「マス内のローカル座標」を作り、全マスに同じ形を出した。
// この練習は逆に「マスごとに違う形」を出す。カギは fract と floor の役割分担:
//
//   let stS  = st * 3.0;     // 0〜3
//   let cell = floor(stS);   // (0,1,2) ← どの行・列か = マスの番地
//   let f    = fract(stS);   // 0〜1    ← マスの中のローカル座標
//
// なぜこれで「どのスレッドがどのマスか」分かるか:
//   GPU では各ピクセルが 1 スレッドとして同じコードを並列実行し、違うのは座標だけ。
//   floor(stS) はその座標を整数に丸めるので、同じマスのスレッドは全員同じ cell を得る。
//   = cell はマスの ID。これで分岐すれば ◯/×/空白 をマスごとに描き分けられる。
//
//   f (fract) … マスの中で「形をどこに描くか」     ← 07 までの形の関数に渡す
//   cell (floor) … マスごとに「何を描くか」を選ぶ   ← 盤面のデータを引く添字

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
    label: "book of shaders 09 - tic-tac-toe with floor cell index",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // マスの番地 (col=x, row=y, それぞれ 0..2) → 描く記号。
      // 0=空白 / 1=◯ / 2=× 。下のレイアウトは ◯ が対角に並ぶ勝ち盤面:
      //   y=2 (上):  ×  空  ◯
      //   y=1 (中):  ×  ◯  空
      //   y=0 (下):  ◯  ×  ×
      fn symbolAt(x: i32, y: i32) -> i32 {
        let idx = y * 3 + x;            // 0..8 の通し番号
        switch idx {
          case 0, 4, 8: { return 1; }  // ◯ (左下→中→右上の対角)
          case 1, 2, 3, 6: { return 2; } // ×
          default: { return 0; }       // 空白
        }
      }

      // ◯ = リング。中心 0.5 からの距離を 2 つの smoothstep で挟んで輪にする。
      fn drawO(f: vec2f) -> f32 {
        let d = distance(f, vec2f(0.5));
        let outer = 1.0 - smoothstep(0.30, 0.32, d); // d<0.30 で内側=1
        let inner = smoothstep(0.20, 0.22, d);       // d>0.22 で外側=1
        return outer * inner;                        // 輪 = 内側 ∩ 外側
      }

      // × = 2 本の対角線。線までの距離を細い帯にし、中央の正方形でクリップ。
      fn drawX(f: vec2f) -> f32 {
        let p = f - vec2f(0.5);
        let d1 = abs(p.x - p.y) * 0.70711;   // 斜め線 (／) までの距離
        let d2 = abs(p.x + p.y) * 0.70711;   // 斜め線 (＼) までの距離
        let bar = max(1.0 - smoothstep(0.02, 0.04, d1),
                      1.0 - smoothstep(0.02, 0.04, d2));
        let clip = step(max(abs(p.x), abs(p.y)), 0.30); // 角まで伸ばさない
        return bar * clip;
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        var st = position.xy / u.resolution; // 0〜1 の画面座標
        st.y = 1.0 - st.y;                   // GL と同じく y を上向きに

        let stS = st * 3.0;                  // 0〜3
        let cx = i32(floor(stS.x));          // 列の番地 0..2
        let cy = i32(floor(stS.y));          // 行の番地 0..2
        let f = fract(stS);                  // マス内ローカル座標 0〜1

        var color = vec3f(0.06, 0.07, 0.10); // 盤の背景

        // 盤の格子線 (内側の 2 本ずつ)。境界 stS=1,2 までの距離を細い帯に。
        let gx = min(abs(stS.x - 1.0), abs(stS.x - 2.0));
        let gy = min(abs(stS.y - 1.0), abs(stS.y - 2.0));
        let grid = clamp((1.0 - smoothstep(0.0, 0.03, gx)) +
                         (1.0 - smoothstep(0.0, 0.03, gy)), 0.0, 1.0);
        color = mix(color, vec3f(0.35, 0.38, 0.45), grid);

        // このマスに何を描くか (floor で得た番地で分岐)。
        let s = symbolAt(cx, cy);
        if (s == 1) {
          color = mix(color, vec3f(0.30, 0.70, 1.00), drawO(f)); // ◯ は水色
        } else if (s == 2) {
          color = mix(color, vec3f(1.00, 0.45, 0.35), drawX(f)); // × は橙
        }

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "tic-tac-toe pipeline",
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