use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DiagramKind {
    CloudArchitecture,
    C4,
    EntityRelationship,
    Flowchart,
    Sequence,
    State,
    DependencyGraph,
    DirectedGraph,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DiagramRenderer {
    D2,
    Mermaid,
    Graphviz,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiagramNode {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub group_id: Option<String>,
    #[serde(default)]
    pub metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiagramEdge {
    pub source: String,
    pub target: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub cardinality_source: Option<String>,
    #[serde(default)]
    pub cardinality_target: Option<String>,
    #[serde(default)]
    pub metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiagramGroup {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub parent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiagramSpec {
    pub schema_version: u16,
    pub kind: DiagramKind,
    pub nodes: Vec<DiagramNode>,
    pub edges: Vec<DiagramEdge>,
    #[serde(default)]
    pub groups: Vec<DiagramGroup>,
    #[serde(default)]
    pub direction: Option<String>,
    #[serde(default)]
    pub renderer_preference: Option<DiagramRenderer>,
    #[serde(default)]
    pub metadata: Value,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VisualizationKind {
    BusinessChart,
    Dashboard,
    Kpi,
    Network,
    Statistical,
    Heatmap,
    Contour,
    Scientific3d,
    Scene3d,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum VisualizationRenderer {
    Echarts,
    Plotly,
    Three,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ResponsivePresentation {
    /// Compact presentation used when the visual is embedded in a chat turn.
    #[serde(default)]
    pub conversation: Value,
    #[serde(default)]
    pub desktop: Value,
    #[serde(default)]
    pub tablet: Value,
    #[serde(default)]
    pub mobile: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SceneSpec {
    #[serde(default)]
    pub objects: Vec<Value>,
    #[serde(default)]
    pub relationships: Vec<Value>,
    #[serde(default)]
    pub labels: Vec<Value>,
    #[serde(default)]
    pub materials: Value,
    #[serde(default)]
    pub camera_hint: Value,
    #[serde(default)]
    pub controls: Value,
    #[serde(default)]
    pub animation: Value,
    #[serde(default)]
    pub metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RendererCapability {
    pub renderer: String,
    pub supported_kinds: Vec<String>,
    pub interactive: bool,
    pub animated: bool,
    pub supports_2d: bool,
    pub supports_3d: bool,
    pub vector_export: bool,
    pub raster_export: bool,
    pub mobile: bool,
    pub touch: bool,
    pub large_data: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VisualizationSpec {
    pub schema_version: u16,
    pub kind: VisualizationKind,
    #[serde(default)]
    pub source_reference: Option<String>,
    #[serde(default)]
    pub data_reference: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub subtitle: Option<String>,
    #[serde(default)]
    pub series: Vec<Value>,
    #[serde(default)]
    pub dimensions: Vec<String>,
    #[serde(default)]
    pub axes: Vec<Value>,
    #[serde(default)]
    pub labels: Value,
    #[serde(default)]
    pub legend: Value,
    #[serde(default)]
    pub interactive: bool,
    #[serde(default)]
    pub animated: bool,
    #[serde(default)]
    pub scene: Value,
    #[serde(default)]
    pub camera: Value,
    #[serde(default)]
    pub responsive: ResponsivePresentation,
    #[serde(default)]
    pub export_preferences: Value,
    #[serde(default)]
    pub renderer_preference: Option<VisualizationRenderer>,
}

pub fn renderer_capabilities() -> Vec<RendererCapability> {
    vec![
        RendererCapability {
            renderer: "echarts".into(),
            supported_kinds: vec!["business_chart", "dashboard", "kpi", "network"]
                .into_iter()
                .map(str::to_string)
                .collect(),
            interactive: true,
            animated: true,
            supports_2d: true,
            supports_3d: true,
            vector_export: true,
            raster_export: true,
            mobile: true,
            touch: true,
            large_data: true,
        },
        RendererCapability {
            renderer: "plotly".into(),
            supported_kinds: vec!["statistical", "heatmap", "contour", "scientific3d"]
                .into_iter()
                .map(str::to_string)
                .collect(),
            interactive: true,
            animated: true,
            supports_2d: true,
            supports_3d: true,
            vector_export: true,
            raster_export: true,
            mobile: true,
            touch: true,
            large_data: false,
        },
        RendererCapability {
            renderer: "three".into(),
            supported_kinds: vec!["scene3d".into()],
            interactive: true,
            animated: true,
            supports_2d: false,
            supports_3d: true,
            vector_export: false,
            raster_export: true,
            mobile: true,
            touch: true,
            large_data: false,
        },
        RendererCapability {
            renderer: "d2".into(),
            supported_kinds: vec!["cloud_architecture", "c4", "entity_relationship"]
                .into_iter()
                .map(str::to_string)
                .collect(),
            interactive: false,
            animated: false,
            supports_2d: true,
            supports_3d: false,
            vector_export: true,
            raster_export: true,
            mobile: true,
            touch: false,
            large_data: false,
        },
        RendererCapability {
            renderer: "mermaid".into(),
            supported_kinds: vec!["flowchart", "sequence", "state"]
                .into_iter()
                .map(str::to_string)
                .collect(),
            interactive: false,
            animated: false,
            supports_2d: true,
            supports_3d: false,
            vector_export: true,
            raster_export: true,
            mobile: true,
            touch: false,
            large_data: false,
        },
        RendererCapability {
            renderer: "graphviz".into(),
            supported_kinds: vec!["dependency_graph", "directed_graph"]
                .into_iter()
                .map(str::to_string)
                .collect(),
            interactive: false,
            animated: false,
            supports_2d: true,
            supports_3d: false,
            vector_export: true,
            raster_export: true,
            mobile: true,
            touch: false,
            large_data: true,
        },
    ]
}

pub fn route_diagram(spec: &DiagramSpec) -> AppResult<DiagramRenderer> {
    validate_diagram(spec)?;
    if let Some(renderer) = spec.renderer_preference {
        return Ok(renderer);
    }
    Ok(match spec.kind {
        DiagramKind::CloudArchitecture | DiagramKind::C4 | DiagramKind::EntityRelationship => {
            DiagramRenderer::D2
        }
        DiagramKind::Flowchart | DiagramKind::Sequence | DiagramKind::State => {
            DiagramRenderer::Mermaid
        }
        DiagramKind::DependencyGraph | DiagramKind::DirectedGraph => DiagramRenderer::Graphviz,
    })
}

pub fn route_visualization(spec: &VisualizationSpec) -> AppResult<VisualizationRenderer> {
    validate_visualization(spec)?;
    if let Some(renderer) = spec.renderer_preference {
        if renderer == VisualizationRenderer::Three && spec.kind != VisualizationKind::Scene3d {
            return Err(AppError::ValidationFailed(
                "Three.js is reserved for real 3D scenes, not ordinary charts".into(),
            ));
        }
        return Ok(renderer);
    }
    Ok(match spec.kind {
        VisualizationKind::BusinessChart
        | VisualizationKind::Dashboard
        | VisualizationKind::Kpi
        | VisualizationKind::Network => VisualizationRenderer::Echarts,
        VisualizationKind::Statistical
        | VisualizationKind::Heatmap
        | VisualizationKind::Contour
        | VisualizationKind::Scientific3d => VisualizationRenderer::Plotly,
        VisualizationKind::Scene3d => VisualizationRenderer::Three,
    })
}

fn validate_diagram(spec: &DiagramSpec) -> AppResult<()> {
    if spec.schema_version != 1 || spec.nodes.is_empty() {
        return Err(AppError::ValidationFailed(
            "DiagramSpec v1 requires at least one node".into(),
        ));
    }
    let ids = spec
        .nodes
        .iter()
        .map(|node| node.id.as_str())
        .collect::<std::collections::HashSet<_>>();
    if ids.len() != spec.nodes.len()
        || spec
            .edges
            .iter()
            .any(|edge| !ids.contains(edge.source.as_str()) || !ids.contains(edge.target.as_str()))
    {
        return Err(AppError::ValidationFailed(
            "DiagramSpec contains duplicate nodes or dangling edges".into(),
        ));
    }
    Ok(())
}

fn validate_visualization(spec: &VisualizationSpec) -> AppResult<()> {
    if spec.schema_version != 1 {
        return Err(AppError::ValidationFailed(
            "Unsupported VisualizationSpec version".into(),
        ));
    }
    let raw = serde_json::to_string(spec)?;
    if raw.contains("javascript:") || raw.contains("<script") || raw.contains("new Function(") {
        return Err(AppError::Security(
            "VisualizationSpec cannot contain executable JavaScript".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn diagram(kind: DiagramKind) -> DiagramSpec {
        DiagramSpec {
            schema_version: 1,
            kind,
            nodes: vec![DiagramNode {
                id: "a".into(),
                label: "A".into(),
                kind: None,
                group_id: None,
                metadata: Value::Null,
            }],
            edges: Vec::new(),
            groups: Vec::new(),
            direction: None,
            renderer_preference: None,
            metadata: Value::Null,
        }
    }

    #[test]
    fn semantic_diagram_routing_is_deterministic() {
        assert_eq!(
            route_diagram(&diagram(DiagramKind::CloudArchitecture)).unwrap(),
            DiagramRenderer::D2
        );
        assert_eq!(
            route_diagram(&diagram(DiagramKind::Sequence)).unwrap(),
            DiagramRenderer::Mermaid
        );
        assert_eq!(
            route_diagram(&diagram(DiagramKind::DependencyGraph)).unwrap(),
            DiagramRenderer::Graphviz
        );
        assert_eq!(
            route_diagram(&diagram(DiagramKind::EntityRelationship)).unwrap(),
            DiagramRenderer::D2
        );
    }

    #[test]
    fn three_is_not_an_ordinary_chart_renderer() {
        let spec = VisualizationSpec {
            schema_version: 1,
            kind: VisualizationKind::BusinessChart,
            source_reference: None,
            data_reference: None,
            title: None,
            subtitle: None,
            series: Vec::new(),
            dimensions: Vec::new(),
            axes: Vec::new(),
            labels: Value::Null,
            legend: Value::Null,
            interactive: true,
            animated: false,
            scene: Value::Null,
            camera: Value::Null,
            responsive: ResponsivePresentation::default(),
            export_preferences: Value::Null,
            renderer_preference: Some(VisualizationRenderer::Three),
        };
        assert!(route_visualization(&spec).is_err());
    }

    #[test]
    fn capability_registry_is_semantic_and_scene_specs_remain_data_only() {
        let capabilities = renderer_capabilities();
        assert!(capabilities.iter().any(|capability| {
            capability.renderer == "three"
                && capability.supported_kinds == vec!["scene3d"]
                && capability.touch
        }));
        let scene = SceneSpec {
            objects: vec![serde_json::json!({"kind":"sphere","radius":1})],
            ..SceneSpec::default()
        };
        assert_eq!(scene.objects.len(), 1);
        assert!(!serde_json::to_string(&scene).unwrap().contains("<script"));
    }
}
