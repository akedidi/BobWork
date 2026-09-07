import { describe, expect, it, vi } from "vitest";
import {
  rendererCapabilities,
  routeVisualization,
  SharedRenderingRuntime,
  type VisualizationSpec,
} from "./sharedRenderingRuntime";

const businessSpec: VisualizationSpec = {
  schemaVersion: 1,
  kind: "business_chart",
  series: [{ type: "bar", data: [1, 2] }],
};

describe("SharedRenderingRuntime", () => {
  it("routes semantics deterministically and reserves Three.js for real scenes", () => {
    expect(routeVisualization(businessSpec)).toBe("echarts");
    expect(routeVisualization({ ...businessSpec, kind: "scientific3d" })).toBe("plotly");
    expect(routeVisualization({ ...businessSpec, kind: "scene3d" })).toBe("three");
    expect(() =>
      routeVisualization({ ...businessSpec, rendererPreference: "three" }),
    ).toThrow(/real 3D scenes/);
  });

  it("does not load any engine before it is requested", () => {
    const loaders = {
      echarts: vi.fn(),
      echartsGl: vi.fn(),
      plotly: vi.fn(),
      three: vi.fn(),
    };
    const runtime = new SharedRenderingRuntime(loaders);
    expect(runtime.loadedRenderers()).toEqual([]);
    expect(Object.values(loaders).every((loader) => loader.mock.calls.length === 0)).toBe(true);
  });

  it("rejects executable values before loading a renderer", async () => {
    const runtime = new SharedRenderingRuntime({
      echarts: vi.fn(),
      echartsGl: vi.fn(),
      plotly: vi.fn(),
      three: vi.fn(),
    });
    const unsafe = {
      ...businessSpec,
      series: [{ formatter: () => "unsafe" }],
    } as VisualizationSpec;
    await expect(runtime.render(document.createElement("div"), unsafe)).rejects.toThrow(
      /executable functions/,
    );
    expect(runtime.loadedRenderers()).toEqual([]);
  });

  it("declares touch-capable shared renderers without loading their engines", () => {
    expect(rendererCapabilities.find((capability) => capability.renderer === "three")).toMatchObject({
      supportedKinds: ["scene3d"],
      touch: true,
    });
  });

  it("loads only ECharts and disposes it through the shared lifecycle", async () => {
    const dispose = vi.fn();
    const setOption = vi.fn();
    const loaders = {
      echarts: vi.fn(async () => ({ init: () => ({ setOption, dispose }) })),
      echartsGl: vi.fn(async () => ({})),
      plotly: vi.fn(),
      three: vi.fn(),
    };
    const runtime = new SharedRenderingRuntime(loaders);
    const handle = await runtime.render(document.createElement("div"), businessSpec);
    expect(runtime.loadedRenderers()).toEqual(["echarts"]);
    expect(loaders.echarts).toHaveBeenCalledOnce();
    expect(loaders.echartsGl).not.toHaveBeenCalled();
    expect(loaders.plotly).not.toHaveBeenCalled();
    expect(loaders.three).not.toHaveBeenCalled();
    expect(setOption).toHaveBeenCalledOnce();
    handle.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
