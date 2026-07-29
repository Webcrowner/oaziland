"""
agency — deliberately thin. AgencyProfile and AgentProfile (identity/",
including the commission-percent fields) already live in `identity`,
because they are Role attachments to a User (Architecture doc §2.1).
This app is reserved for agency-specific operational features that are
NOT identity concerns: roster analytics, agent performance scoring,
and agency-branded listing pages (Architecture doc §7 "Agent-branded
listing pages" from GRE-TECH-SPEC-001). Not yet implemented — Phase 2.
"""
