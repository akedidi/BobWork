//! Renderer-independent, credential-free quantum contracts.
//!
//! These are inputs and persistent summaries for the Qiskit Built-in. They do
//! not simulate a circuit themselves: actual metrics/results must originate
//! from the managed Qiskit runtime.

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuantumOperation {
    pub id: String,
    pub gate: String,
    pub qubits: Vec<u32>,
    #[serde(default)]
    pub classical_bits: Vec<u32>,
    #[serde(default)]
    pub parameters: Vec<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuantumCircuitSpec {
    pub name: String,
    pub qubits: u32,
    #[serde(default)]
    pub classical_bits: u32,
    #[serde(default)]
    pub operations: Vec<QuantumOperation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuantumValidation {
    pub valid: bool,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuantumCircuitAnalysis {
    pub qubits: u32,
    pub classical_bits: u32,
    pub depth: u32,
    pub size: u32,
    pub operation_counts: serde_json::Value,
    pub two_qubit_operations: u32,
    pub measurements: u32,
    pub parameters: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum QuantumExecutionTarget {
    LocalSimulator,
    RemoteSimulator,
    IbmQuantumQpu,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuantumSimulationRequest {
    pub circuit: QuantumCircuitSpec,
    pub shots: u32,
    #[serde(default)]
    pub seed: Option<u64>,
    #[serde(default)]
    pub target: Option<QuantumExecutionTarget>,
}

pub fn validate_circuit(spec: &QuantumCircuitSpec) -> QuantumValidation {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();
    if spec.name.trim().is_empty() {
        errors.push("Circuit name is required".into());
    }
    if spec.qubits == 0 {
        errors.push("A circuit requires at least one qubit".into());
    }
    let supported = [
        "h", "x", "y", "z", "s", "sdg", "t", "tdg", "rx", "ry", "rz", "cx", "cz", "swap",
        "barrier", "measure",
    ];
    for operation in &spec.operations {
        let gate = operation.gate.to_ascii_lowercase();
        if operation.id.trim().is_empty() || !supported.contains(&gate.as_str()) {
            errors.push(format!("Unsupported or unnamed gate: {}", operation.gate));
            continue;
        }
        if operation.qubits.is_empty() || operation.qubits.iter().any(|qubit| *qubit >= spec.qubits)
        {
            errors.push(format!("Gate {} references an invalid qubit", operation.id));
        }
        if gate == "measure" {
            if operation.qubits.len() != 1 || operation.classical_bits.len() != 1 {
                errors.push(format!(
                    "Measurement {} must map one qubit to one classical bit",
                    operation.id
                ));
            } else if operation.classical_bits[0] >= spec.classical_bits {
                errors.push(format!(
                    "Measurement {} references an invalid classical bit",
                    operation.id
                ));
            }
        }
        if matches!(gate.as_str(), "cx" | "cz" | "swap") && operation.qubits.len() != 2 {
            errors.push(format!(
                "Two-qubit gate {} requires exactly two qubits",
                operation.id
            ));
        }
    }
    if spec.classical_bits == 0
        && spec
            .operations
            .iter()
            .any(|operation| operation.gate.eq_ignore_ascii_case("measure"))
    {
        errors.push("Measurements require classical bits".into());
    }
    if !spec
        .operations
        .iter()
        .any(|operation| operation.gate.eq_ignore_ascii_case("measure"))
    {
        warnings.push("Circuit has no measurements; shot simulation may not return counts".into());
    }
    QuantumValidation {
        valid: errors.is_empty(),
        warnings,
        errors,
    }
}

pub fn require_valid_circuit(spec: &QuantumCircuitSpec) -> AppResult<()> {
    let validation = validate_circuit(spec);
    if validation.valid {
        Ok(())
    } else {
        Err(AppError::ValidationFailed(validation.errors.join("; ")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bell() -> QuantumCircuitSpec {
        QuantumCircuitSpec {
            name: "Bell".into(),
            qubits: 2,
            classical_bits: 2,
            operations: vec![
                QuantumOperation {
                    id: "h0".into(),
                    gate: "h".into(),
                    qubits: vec![0],
                    classical_bits: vec![],
                    parameters: vec![],
                },
                QuantumOperation {
                    id: "cx01".into(),
                    gate: "cx".into(),
                    qubits: vec![0, 1],
                    classical_bits: vec![],
                    parameters: vec![],
                },
                QuantumOperation {
                    id: "m0".into(),
                    gate: "measure".into(),
                    qubits: vec![0],
                    classical_bits: vec![0],
                    parameters: vec![],
                },
                QuantumOperation {
                    id: "m1".into(),
                    gate: "measure".into(),
                    qubits: vec![1],
                    classical_bits: vec![1],
                    parameters: vec![],
                },
            ],
        }
    }

    #[test]
    fn validates_structured_bell_circuit_without_running_a_simulator() {
        assert!(validate_circuit(&bell()).valid);
    }

    #[test]
    fn rejects_invalid_qubits_and_measurements() {
        let mut circuit = bell();
        circuit.operations[1].qubits = vec![0, 2];
        assert!(!validate_circuit(&circuit).valid);
    }
}
