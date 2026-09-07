export type VisualizationKind =
  | "business_chart"
  | "dashboard"
  | "kpi"
  | "network"
  | "statistical"
  | "heatmap"
  | "contour"
  | "scientific3d"
  | "scene3d";

export type VisualizationRenderer = "echarts" | "plotly" | "three";

export interface ResponsivePresentation {
  /** Compact initial view embedded directly in a conversation. */
  conversation?: Record<string, unknown>;
  desktop?: Record<string, unknown>;
  tablet?: Record<string, unknown>;
  mobile?: Record<string, unknown>;
}

/** Renderer-independent semantic scene. Trusted adapters create Three.js objects. */
export interface SceneSpec {
  objects?: unknown[];
  relationships?: unknown[];
  labels?: unknown[];
  materials?: unknown;
  cameraHint?: unknown;
  controls?: unknown;
  animation?: unknown;
  metadata?: unknown;
}

export interface RendererCapability {
  renderer: VisualizationRenderer | "d2" | "mermaid" | "graphviz";
  supportedKinds: string[];
  interactive: boolean;
  animated: boolean;
  supports2d: boolean;
  supports3d: boolean;
  vectorExport: boolean;
  rasterExport: boolean;
  mobile: boolean;
  touch: boolean;
  largeData: boolean;
}

export interface VisualizationSpec {
  schemaVersion: 1;
  kind: VisualizationKind;
  sourceReference?: string;
  dataReference?: string;
  title?: string;
  subtitle?: string;
  series?: unknown[];
  dimensions?: string[];
  axes?: unknown[];
  labels?: unknown;
  legend?: unknown;
  interactive?: boolean;
  animated?: boolean;
  scene?: SceneSpec;
  camera?: unknown;
  responsive?: ResponsivePresentation;
  exportPreferences?: unknown;
  rendererPreference?: VisualizationRenderer;
}

export interface RenderingHandle {
  renderer: VisualizationRenderer;
  dispose: () => void;
}

interface EChartsModule {
  init: (container: HTMLElement) => {
    setOption: (option: Record<string, unknown>) => void;
    dispose: () => void;
  };
}

interface PlotlyModule {
  newPlot: (
    container: HTMLElement,
    data: unknown[],
    layout: Record<string, unknown>,
    config: Record<string, unknown>,
  ) => Promise<unknown> | unknown;
  purge: (container: HTMLElement) => void;
}

interface ThreeModule {
  Scene: new () => ThreeScene;
  PerspectiveCamera: new (
    fov: number,
    aspect: number,
    near: number,
    far: number,
  ) => ThreeCamera;
  WebGLRenderer: new (options: { antialias: boolean; alpha: boolean }) => ThreeRenderer;
  BoxGeometry: new (width: number, height: number, depth: number) => ThreeDisposable;
  SphereGeometry: new (
    radius: number,
    widthSegments: number,
    heightSegments: number,
  ) => ThreeDisposable;
  MeshStandardMaterial: new (options: Record<string, unknown>) => ThreeMaterial;
  Mesh: new (geometry: ThreeDisposable, material: ThreeMaterial) => ThreeObject;
  AmbientLight: new (color: number, intensity: number) => ThreeObject;
  DirectionalLight: new (color: number, intensity: number) => ThreeObject;
}

interface ThreeDisposable {
  dispose: () => void;
}

interface ThreeMaterial extends ThreeDisposable {
  map?: ThreeDisposable | null;
}

interface ThreeObject {
  geometry?: ThreeDisposable;
  material?: ThreeMaterial | ThreeMaterial[];
  position: { set: (x: number, y: number, z: number) => void };
}

interface ThreeScene {
  add: (...objects: ThreeObject[]) => void;
  traverse: (callback: (object: ThreeObject) => void) => void;
  clear: () => void;
}

interface ThreeCamera {
  aspect: number;
  position: { set: (x: number, y: number, z: number) => void };
  updateProjectionMatrix: () => void;
}

interface ThreeRenderer {
  domElement: Node;
  setSize: (width: number, height: number, updateStyle?: boolean) => void;
  render: (scene: ThreeScene, camera: ThreeCamera) => void;
  dispose: () => void;
  forceContextLoss?: () => void;
  setAnimationLoop?: (callback: (() => void) | null) => void;
}

interface RendererLoaders {
  echarts: () => Promise<EChartsModule>;
  echartsGl: () => Promise<unknown>;
  plotly: () => Promise<PlotlyModule>;
  three: () => Promise<ThreeModule>;
}

const defaultLoaders: RendererLoaders = {
  echarts: async () => (await import("echarts")) as unknown as EChartsModule,
  echartsGl: async () => import("echarts-gl"),
  plotly: async () => {
    const module = await import("plotly.js-dist-min");
    return ("default" in module ? module.default : module) as unknown as PlotlyModule;
  },
  three: async () => (await import("three")) as unknown as ThreeModule,
};

const ECHARTS_KINDS = new Set<VisualizationKind>([
  "business_chart",
  "dashboard",
  "kpi",
  "network",
]);
const PLOTLY_KINDS = new Set<VisualizationKind>([
  "statistical",
  "heatmap",
  "contour",
  "scientific3d",
]);

export const rendererCapabilities: readonly RendererCapability[] = [
  { renderer: "echarts", supportedKinds: [...ECHARTS_KINDS], interactive: true, animated: true, supports2d: true, supports3d: true, vectorExport: true, rasterExport: true, mobile: true, touch: true, largeData: true },
  { renderer: "plotly", supportedKinds: [...PLOTLY_KINDS], interactive: true, animated: true, supports2d: true, supports3d: true, vectorExport: true, rasterExport: true, mobile: true, touch: true, largeData: false },
  { renderer: "three", supportedKinds: ["scene3d"], interactive: true, animated: true, supports2d: false, supports3d: true, vectorExport: false, rasterExport: true, mobile: true, touch: true, largeData: false },
  { renderer: "d2", supportedKinds: ["cloud_architecture", "c4", "entity_relationship"], interactive: false, animated: false, supports2d: true, supports3d: false, vectorExport: true, rasterExport: true, mobile: true, touch: false, largeData: false },
  { renderer: "mermaid", supportedKinds: ["flowchart", "sequence", "state"], interactive: false, animated: false, supports2d: true, supports3d: false, vectorExport: true, rasterExport: true, mobile: true, touch: false, largeData: false },
  { renderer: "graphviz", supportedKinds: ["dependency_graph", "directed_graph"], interactive: false, animated: false, supports2d: true, supports3d: false, vectorExport: true, rasterExport: true, mobile: true, touch: false, largeData: true },
];

export function routeVisualization(spec: VisualizationSpec): VisualizationRenderer {
  validateVisualizationSpec(spec);
  if (spec.rendererPreference) {
    if (spec.rendererPreference === "three" && spec.kind !== "scene3d") {
      throw new Error("Three.js is reserved for real 3D scenes");
    }
    return spec.rendererPreference;
  }
  if (ECHARTS_KINDS.has(spec.kind)) return "echarts";
  if (PLOTLY_KINDS.has(spec.kind)) return "plotly";
  return "three";
}

export function validateVisualizationSpec(spec: VisualizationSpec): void {
  if (spec.schemaVersion !== 1) throw new Error("Unsupported VisualizationSpec version");
  if (![...ECHARTS_KINDS, ...PLOTLY_KINDS, "scene3d"].includes(spec.kind)) {
    throw new Error("Unsupported visualization kind");
  }
  assertDataOnly(spec);
}

function assertDataOnly(value: unknown, seen = new Set<object>()): void {
  if (typeof value === "function") {
    throw new Error("VisualizationSpec cannot contain executable functions");
  }
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) throw new Error("VisualizationSpec cannot contain cyclic values");
  seen.add(value);
  for (const nested of Object.values(value)) assertDataOnly(nested, seen);
  seen.delete(value);
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function needsEChartsGl(series: unknown[]): boolean {
  return series.some((item) => {
    const type = item && typeof item === "object" ? (item as { type?: unknown }).type : undefined;
    return typeof type === "string" && type.toLowerCase().endsWith("3d");
  });
}

/**
 * Local Shared Visualization Runtime. Renderer packages are imported only on
 * first use and callers only provide validated semantic data, never JavaScript.
 */
export class SharedRenderingRuntime {
  private readonly loaded = new Set<VisualizationRenderer>();

  constructor(private readonly loaders: RendererLoaders = defaultLoaders) {}

  loadedRenderers(): VisualizationRenderer[] {
    return [...this.loaded];
  }

  async render(container: HTMLElement, spec: VisualizationSpec): Promise<RenderingHandle> {
    const renderer = routeVisualization(spec);
    switch (renderer) {
      case "echarts":
        return this.renderECharts(container, spec);
      case "plotly":
        return this.renderPlotly(container, spec);
      case "three":
        return this.renderThree(container, spec);
    }
  }

  private async renderECharts(
    container: HTMLElement,
    spec: VisualizationSpec,
  ): Promise<RenderingHandle> {
    const series = spec.series ?? [];
    const echarts = await this.loaders.echarts();
    if (needsEChartsGl(series)) await this.loaders.echartsGl();
    this.loaded.add("echarts");
    const chart = echarts.init(container);
    chart.setOption({
      dataset: spec.dimensions?.length ? { dimensions: spec.dimensions } : undefined,
      series,
      xAxis: spec.axes?.[0],
      yAxis: spec.axes?.[1],
      legend: spec.legend,
      animation: spec.animated ?? false,
    });
    return { renderer: "echarts", dispose: () => chart.dispose() };
  }

  private async renderPlotly(
    container: HTMLElement,
    spec: VisualizationSpec,
  ): Promise<RenderingHandle> {
    const plotly = await this.loaders.plotly();
    this.loaded.add("plotly");
    await plotly.newPlot(
      container,
      spec.series ?? [],
      { showlegend: spec.legend !== false, transition: { duration: spec.animated ? 250 : 0 } },
      { responsive: true, displaylogo: false, scrollZoom: spec.interactive ?? false },
    );
    return { renderer: "plotly", dispose: () => plotly.purge(container) };
  }

  private async renderThree(
    container: HTMLElement,
    spec: VisualizationSpec,
  ): Promise<RenderingHandle> {
    const three = await this.loaders.three();
    this.loaded.add("three");
    const scene = new three.Scene();
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    const camera = new three.PerspectiveCamera(45, width / height, 0.1, 1_000);
    const cameraSpec = (spec.camera ?? {}) as Record<string, unknown>;
    camera.position.set(
      finiteNumber(cameraSpec.x, 0),
      finiteNumber(cameraSpec.y, 0),
      finiteNumber(cameraSpec.z, 5),
    );
    const renderer = new three.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height, false);
    container.replaceChildren(renderer.domElement);

    const sceneSpec = (spec.scene ?? {}) as { objects?: unknown[] };
    for (const raw of sceneSpec.objects ?? []) {
      if (!raw || typeof raw !== "object") continue;
      const object = raw as Record<string, unknown>;
      const geometry =
        object.kind === "sphere"
          ? new three.SphereGeometry(finiteNumber(object.radius, 1), 32, 16)
          : new three.BoxGeometry(
              finiteNumber(object.width, 1),
              finiteNumber(object.height, 1),
              finiteNumber(object.depth, 1),
            );
      const material = new three.MeshStandardMaterial({
        color: typeof object.color === "number" ? object.color : 0x5b8def,
      });
      const mesh = new three.Mesh(geometry, material);
      const position = (object.position ?? {}) as Record<string, unknown>;
      mesh.position.set(
        finiteNumber(position.x, 0),
        finiteNumber(position.y, 0),
        finiteNumber(position.z, 0),
      );
      scene.add(mesh);
    }
    scene.add(new three.AmbientLight(0xffffff, 0.65));
    const directional = new three.DirectionalLight(0xffffff, 1);
    directional.position.set(2, 3, 4);
    scene.add(directional);

    const draw = () => renderer.render(scene, camera);
    if (spec.animated && renderer.setAnimationLoop) renderer.setAnimationLoop(draw);
    else draw();

    const resize = () => {
      const nextWidth = Math.max(container.clientWidth, 1);
      const nextHeight = Math.max(container.clientHeight, 1);
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(nextWidth, nextHeight, false);
      if (!spec.animated) draw();
    };
    window.addEventListener("resize", resize);

    return {
      renderer: "three",
      dispose: () => {
        window.removeEventListener("resize", resize);
        renderer.setAnimationLoop?.(null);
        scene.traverse((object) => {
          object.geometry?.dispose();
          const materials = Array.isArray(object.material)
            ? object.material
            : object.material
              ? [object.material]
              : [];
          for (const material of materials) {
            material.map?.dispose();
            material.dispose();
          }
        });
        scene.clear();
        renderer.dispose();
        renderer.forceContextLoss?.();
        container.replaceChildren();
      },
    };
  }
}

export const sharedRenderingRuntime = new SharedRenderingRuntime();

export interface VisualizationRenderRequest {
  requestId: string;
  container: HTMLElement;
  spec: VisualizationSpec;
}

/**
 * Installs the local rendering capability bridge used by artifact previews.
 * The bridge itself is lightweight; dynamic imports above keep every engine
 * out of memory until a validated request selects it.
 */
export function installSharedRenderingRuntimeBridge(): () => void {
  const active = new Map<HTMLElement, RenderingHandle>();
  const onRender = (event: Event) => {
    const detail = (event as CustomEvent<VisualizationRenderRequest>).detail;
    if (!detail?.container || !detail.requestId) return;
    active.get(detail.container)?.dispose();
    active.delete(detail.container);
    void sharedRenderingRuntime
      .render(detail.container, detail.spec)
      .then((handle) => {
        active.set(detail.container, handle);
        window.dispatchEvent(
          new CustomEvent("bob-work:visualization-rendered", {
            detail: { requestId: detail.requestId, renderer: handle.renderer },
          }),
        );
      })
      .catch((error: unknown) => {
        window.dispatchEvent(
          new CustomEvent("bob-work:visualization-error", {
            detail: {
              requestId: detail.requestId,
              message: error instanceof Error ? error.message : String(error),
            },
          }),
        );
      });
  };
  const onDispose = (event: Event) => {
    const container = (event as CustomEvent<{ container?: HTMLElement }>).detail?.container;
    if (!container) return;
    active.get(container)?.dispose();
    active.delete(container);
  };
  window.addEventListener("bob-work:visualization-render", onRender);
  window.addEventListener("bob-work:visualization-dispose", onDispose);
  return () => {
    window.removeEventListener("bob-work:visualization-render", onRender);
    window.removeEventListener("bob-work:visualization-dispose", onDispose);
    for (const handle of active.values()) handle.dispose();
    active.clear();
  };
}
