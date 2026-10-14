"""BYDA SmarterWX (Before You Dig Australia) integration for the DBYD service plans of a project.

CONFIRMED by the owner (15/10/2026): the token endpoint ``POST https://smarterwx.byda.com.au/api/community/auth/tokens`` takes ``{clientId, clientSecret}`` and returns
a short lived ``access_token`` that is sent as a Bearer token. EVERYTHING ELSE (every other path, request field, response field, the token lifetime field, the file
download and any webhook signature) is UNCONFIRMED because the BYDA documentation could not be read when this was written; it is isolated in ``mapping.py``
so one file changes when the specification is read. See docs/19-stage8-services.md.

The credentials are the environment variables BYDA_CLIENT_ID and BYDA_CLIENT_SECRET. They are never put in code, logs, responses or error messages.
Current use is a sandbox; commercial use needs the owner's consent first.
"""
