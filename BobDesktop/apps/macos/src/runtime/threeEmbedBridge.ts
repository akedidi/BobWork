import * as Three from 'three'
// `addons` is the typed, public Three.js module path (unlike examples/jsm).
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import * as ECharts from 'echarts'

/**
 * Compatibility bridge for trusted, generated visualization artifacts.
 *
 * Artifacts are rendered in a sandboxed iframe and cannot access the desktop
 * application runtime directly.  The bridge exposes the already packaged
 * Shared Visualization Runtime using the legacy global API used by older
 * generated Qiskit HTML files.  It deliberately exposes renderer APIs only;
 * it never gives the frame access to Bob Work's host APIs or workspace.
 */
const legacyThree = Object.assign({}, Three, { OrbitControls })

declare global {
  interface Window {
    THREE?: typeof legacyThree
    echarts?: typeof ECharts
  }
}

window.THREE = legacyThree
window.echarts = ECharts
window.dispatchEvent(new Event('bob-three-ready'))
