// レイマーチング — 19 行列で捻じるように変換 (ツイスト)
// wgld.org GLSL 連載「オブジェクトを行列で捻じるように変換」を WGSL に忠実移植。
// https://wgld.org/d/glsl/g018.html
//
// ★ 18 の rotate を twist に差し替えただけ + レイマーチ特有の 2 つの補正。
//   twist = Y軸回転だが、回転角が p.y(高さ)に比例 → 高い所ほど大きく回る = 捻れる。
//   §4 頂点07 ツイスト(p ↦ rot(a(y))·p)の距離場版そのもの。座標変換 = 領域変形。
//
// ● twist(p, power): Y軸回転行列だが角度 = power * p.y。
//   高さ y ごとに回転量が変わる → まっすぐな稜線が螺旋にねじれる。
//   軸を変えたい(X/Z で捻る)なら sin/cos に使う成分と行列の形を合わせて変える。
//
// ● レイマーチ特有の補正 2 つ(記事の注意点):
//   ① 貫通対策: 継ぎ足すレイを 0.75 倍に縮小 (dPos = cPos + tmp * ray * 0.75)。
//      薄い/複雑な形だと、一度に伸ばしすぎてレイが表面を突き抜け→奥の物体へ吸われて
//      手前の形が消えることがある。歩幅を保守的にして防ぐ(その分ループ回数が要る)。
//   ② つぶつぶ(法線ノイズ)対策: genNormal の d を 0.0001 → 0.001 に広げる。
//      厳密すぎる勾配計測は捻れた複雑な面でノイズになる。少し大雑把に測る方が綺麗。
//   → 「小さな誤差が大きく効く/大雑把な方が良い時もある」のがレイマーチの機微。
//
// power は time で振動させて、捻れ→戻り→逆捻れ が見えるようにした。

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

  // 3. シェーダモジュール
  const module = device.createShaderModule({
    label: "raymarching 19 - twist",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const cPos = vec3f(0.0, 0.0,  3.0);
      const cDir = vec3f(0.0, 0.0, -1.0);
      const cUp  = vec3f(0.0, 1.0,  0.0);
      const lightDir = vec3f(0.577, 0.577, 0.577);

      // 捻り変換: Y軸回転だが角度 = power * p.y(高さで回転量が変わる)。
      fn twist(p: vec3f, power: f32) -> vec3f {
        let s = sin(power * p.y);
        let c = cos(power * p.y);
        // Y軸回転行列(列優先): col0=(c,0,-s) col1=(0,1,0) col2=(s,0,c)。
        let m = mat3x3f(
          vec3f(c, 0.0, -s),
          vec3f(0.0, 1.0, 0.0),
          vec3f(s, 0.0, c)
        );
        return m * p;
      }

      fn smoothMin(d1: f32, d2: f32, k: f32) -> f32 {
        let h = exp(-k * d1) + exp(-k * d2);
        return -log(h) / k;
      }

      fn distFuncTorus(p: vec3f, r: vec2f) -> f32 {
        let d = vec2f(length(p.xy) - r.x, p.z);
        return length(d) - r.y;
      }

      fn distFuncBox(p: vec3f) -> f32 {
        return length(max(abs(p) - vec3f(2.0, 0.1, 0.5), vec3f(0.0))) - 0.1;
      }

      fn distFuncCylinder(p: vec3f, r: vec2f) -> f32 {
        let d = abs(vec2f(length(p.xy), p.z)) - r;
        return min(max(d.x, d.y), 0.0) + length(max(d, vec2f(0.0))) - 0.1;
      }

      // シーン = p を捻ってから 3形状を smooth min で融合。
      fn distFunc(p: vec3f) -> f32 {
        let power = sin(u.time) * 4.0;   // 捻りの強さを time で振動
        let q = twist(p, power);
        let d1 = distFuncTorus(q, vec2f(1.5, 0.25));
        let d2 = distFuncBox(q);
        let d3 = distFuncCylinder(q, vec2f(0.75, 0.25));
        return smoothMin(smoothMin(d1, d2, 16.0), d3, 16.0);
      }

      // 法線: つぶつぶ対策で d を 0.001 に広げる(18 は 0.0001)。
      fn genNormal(p: vec3f) -> vec3f {
        let d = 0.001;
        return normalize(vec3f(
          distFunc(p + vec3f(  d, 0.0, 0.0)) - distFunc(p + vec3f( -d, 0.0, 0.0)),
          distFunc(p + vec3f(0.0,   d, 0.0)) - distFunc(p + vec3f(0.0,  -d, 0.0)),
          distFunc(p + vec3f(0.0, 0.0,   d)) - distFunc(p + vec3f(0.0, 0.0,  -d))
        ));
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
        var p = (position.xy * 2.0 - u.resolution) / min(u.resolution.x, u.resolution.y);
        p.y = -p.y;

        let cSide = cross(cDir, cUp);
        let targetDepth = 1.0;
        let ray = normalize(cSide * p.x + cUp * p.y + cDir * targetDepth);

        // マーチのループ。貫通対策で継ぎ足しを 0.75 倍に縮小。
        var tmp = 0.0;
        var dist = 0.0;
        var dPos = cPos;
        for (var i = 0; i < 256; i++) {
          dist = distFunc(dPos);
          tmp += dist;
          dPos = cPos + tmp * ray * 0.75;
        }

        var color: vec3f;
        if (abs(dist) < 0.001) {
          let normal = genNormal(dPos);
          let diff = clamp(dot(lightDir, normal), 0.1, 1.0);
          color = vec3f(1.0, 1.0, 1.0) * diff;
        } else {
          color = vec3f(0.0);
        }
        return vec4f(color, 1.0);
      }
    `,
  });

  // 4. パイプライン
  const pipeline = device.createRenderPipeline({
    label: "raymarching 19 pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: {
      module,
      entryPoint: "fs",
      targets: [{ format: presentationFormat }],
    },
  });

  // 5. ユニフォームバッファ (resolution: vec2f, time: f32)
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

  // 毎フレーム time を進めて捻りを振動させる。
  const frame = (timeMs: number) => {
    render(device, timeMs * 0.001);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main();
