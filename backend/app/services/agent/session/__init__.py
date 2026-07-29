"""agent.session — the session pipeline, merged from the former session_agent_service,
session_resource_service, session_state_service, voice_agent_service and lesson_service.

Import submodules directly: `from app.services.agent.session import core, resources, state,
voice, plan` (or `... .core import <symbol>`). Kept intentionally minimal so importing any one
submodule never triggers a heavy package-init cycle through the others.
"""
