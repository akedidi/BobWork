#!/bin/bash

# Simple Bob CLI mock for testing stream-json integration
if [ "$1" = "auth" ]; then
    echo "Mock auth completed"
    exit 0
fi
if [ "$1" = "--version" ]; then
    echo "bob version 1.0.0 (mock)"
    exit 0
fi

echo '{"step_update": {"step_type": "thought", "text_delta": "Analyse de votre demande..."}}'
sleep 1
echo '{"step_update": {"step_type": "text", "text_delta": "Je vais devoir lire vos fichiers.\n"}}'
sleep 1
echo '{"step_update": {"step_type": "tool_call", "tool_call": {"name": "read_files"}}}'
sleep 1
echo '{"step_update": {"step_type": "approval_required", "action_type": "read", "human_description": "Lire tous vos fichiers de projet", "risk_level": "medium", "command_or_change": "read /*"}}'

# Wait for approval decision on stdin
read decision

if [ "$decision" = "y" ]; then
    echo '{"step_update": {"step_type": "text", "text_delta": "Autorisation accordée ! Lecture en cours...\n"}}'
    sleep 1
    echo '{"step_update": {"step_type": "text", "text_delta": "Travail terminé avec succès.\n"}}'
else
    echo '{"step_update": {"step_type": "text", "text_delta": "Autorisation refusée. J'\''annule la tâche.\n"}}'
fi
